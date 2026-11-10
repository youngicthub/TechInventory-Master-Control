import { Router, type IRouter, type Request } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Transform } from "stream";
import { z } from "zod";
import { db, appReleasesTable, releaseDeploymentsTable, installationsTable, customersTable } from "@masterctl/db";
import { requireAdminAuth, requirePermission } from "../middlewares/auth";
import { hasPermission } from "../lib/permissions";
import { writeMasterAuditLog } from "../lib/audit";
import { RELEASE_TRANSITIONS, isOfferedTo } from "../lib/rollout";
import {
  RELEASE_PLATFORMS,
  compareVersions,
  platformFromNode,
  matchExtension,
  maxUploadBytes,
  normalizeVersion,
  releasesDir,
  type ReleasePlatform,
} from "../lib/releases";

/**
 * Master-admin side of releases: upload an installer build, list builds,
 * withdraw / re-enable one, mark one as a required update. Everything the
 * public landing page and installed apps read lives in public.ts and
 * agent-updates.ts.
 */
const router: IRouter = Router();
router.use("/releases", requireAdminAuth);

router.get("/releases", async (_req, res) => {
  const rows = await db.query.appReleasesTable.findMany({
    orderBy: (t) => [desc(t.createdAt)],
  });
  // storedFileName is server-internal - the UI never needs the on-disk name.
  res.json(rows.map(({ storedFileName: _s, ...rest }) => rest));
});

const uploadQuery = z.object({
  version: z.string().min(1).max(40),
  platform: z.enum(RELEASE_PLATFORMS),
  arch: z.enum(["x64", "arm64"]).default("x64"),
  filename: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
  mandatory: z.enum(["true", "false"]).default("false"),
});

/**
 * Streams the installer straight to disk (no whole-file buffering, no
 * multipart dependency) while hashing it, so a 300 MB .exe never sits in
 * memory. Body is the raw file; metadata travels in the query string:
 *   PUT /api/releases/upload?version=1.2.0&platform=windows&arch=x64&filename=Setup.exe
 */
router.put("/releases/upload", requirePermission("releases.publish"), async (req: Request, res) => {
  const parsed = uploadQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "version, platform (windows|mac|linux), arch and filename are required" });
  }
  const { platform, arch, filename, notes } = parsed.data;

  const version = normalizeVersion(parsed.data.version);
  if (!version) return res.status(400).json({ error: "Version must look like 1.2.0 (optionally 1.2.0-beta.1)" });

  const ext = matchExtension(platform, filename);
  if (!ext) {
    return res.status(400).json({ error: `That file type isn't allowed for ${platform} builds.` });
  }

  const duplicate = await db.query.appReleasesTable.findFirst({
    where: and(
      eq(appReleasesTable.version, version),
      eq(appReleasesTable.platform, platform),
      eq(appReleasesTable.arch, arch),
    ),
    columns: { id: true },
  });
  if (duplicate) {
    return res.status(409).json({ error: `Version ${version} for ${platform}/${arch} already exists - bump the version number.` });
  }

  const limit = maxUploadBytes();
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) {
    return res.status(413).json({ error: `File is larger than the ${Math.round(limit / 1024 / 1024)} MB upload limit.` });
  }
  if (declared === 0) return res.status(400).json({ error: "The uploaded file is empty." });

  const dir = releasesDir();
  const storedFileName = `${platform}-${arch}-${version}-${crypto.randomBytes(6).toString("hex")}${ext}`;
  const finalPath = path.join(dir, storedFileName);
  const tmpPath = `${finalPath}.part`;

  const hash = crypto.createHash("sha256");
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > limit) return cb(new Error("UPLOAD_TOO_LARGE"));
      hash.update(chunk);
      cb(null, chunk);
    },
  });

  try {
    await pipeline(req, meter, fs.createWriteStream(tmpPath, { flags: "wx" }));
  } catch (err) {
    await fs.promises.rm(tmpPath, { force: true });
    if (err instanceof Error && err.message === "UPLOAD_TOO_LARGE") {
      return res.status(413).json({ error: `File is larger than the ${Math.round(limit / 1024 / 1024)} MB upload limit.` });
    }
    return res.status(400).json({ error: "The upload was interrupted - please try again." });
  }

  if (size === 0) {
    await fs.promises.rm(tmpPath, { force: true });
    return res.status(400).json({ error: "The uploaded file is empty." });
  }

  await fs.promises.rename(tmpPath, finalPath);

  // Friendly download name: letters, digits, dot, dash, underscore only.
  const downloadFileName = path.basename(filename).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 120);

  let created;
  try {
    [created] = await db
      .insert(appReleasesTable)
      .values({
        version,
        platform,
        arch,
        storedFileName,
        downloadFileName,
        sizeBytes: size,
        sha256: hash.digest("hex"),
        notes: notes?.trim() || null,
        mandatory: parsed.data.mandatory === "true",
        // Every upload starts as a draft: nobody is offered it until an admin stages or publishes it.
        status: "draft",
        active: false,
        uploadedBy: req.admin!.sub,
      })
      .returning();
  } catch (err) {
    // Don't leave an orphaned file behind if the row couldn't be saved.
    await fs.promises.rm(finalPath, { force: true });
    throw err;
  }

  await writeMasterAuditLog({
    adminId: req.admin!.sub,
    action: "release.upload",
    entity: "release",
    entityId: created.id,
    description: `Uploaded ${platform}/${arch} build ${version} as a draft (${(size / 1024 / 1024).toFixed(1)} MB)${created.mandatory ? " - marked required" : ""}`,
  });

  const { storedFileName: _omit, ...publicRow } = created;
  res.status(201).json(publicRow);
});

const updateSchema = z
  .object({
    mandatory: z.boolean().optional(),
    notes: z.string().max(2000).nullable().optional(),
    minFromVersion: z.string().max(40).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

function releaseId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
const publicRow = ({ storedFileName: _omit, ...rest }: typeof appReleasesTable.$inferSelect) => rest;

// Notes, "required update" and the compatibility floor can be edited; going live or off goes through /transition.
router.put("/releases/:id", requirePermission("releases.publish"), async (req, res) => {
  const id = releaseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid release id" });
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Nothing valid to update" });
  if (parsed.data.minFromVersion && !normalizeVersion(parsed.data.minFromVersion)) {
    return res.status(400).json({ error: "The minimum version must look like 1.0.0" });
  }
  const [updated] = await db
    .update(appReleasesTable)
    .set({ ...parsed.data, ...(parsed.data.minFromVersion ? { minFromVersion: normalizeVersion(parsed.data.minFromVersion) } : {}) })
    .where(eq(appReleasesTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Release not found" });
  await writeMasterAuditLog({
    adminId: req.admin!.sub,
    action: "release.update",
    entity: "release",
    entityId: id,
    description: `Updated ${updated.platform}/${updated.arch} ${updated.version}: ${Object.keys(parsed.data).join(", ")}`,
  });
  res.json(publicRow(updated));
});

const transitionSchema = z.object({
  to: z.enum(["staged", "published", "withdrawn"]),
  rolloutPercent: z.number().int().min(1).max(100).optional(),
  reason: z.string().trim().max(500).optional(),
  // Required when a build goes to everyone - a deliberate second step, not a stray click.
  confirm: z.boolean().optional(),
});

router.post("/releases/:id/transition", async (req, res) => {
  const id = releaseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid release id" });
  const parsed = transitionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose staged, published or withdrawn (rollout 1-100)" });
  const { to, reason } = parsed.data;
  const needed = to === "withdrawn" ? "releases.rollback" : "releases.publish";
  if (!hasPermission(req.admin!.role, needed)) {
    await writeMasterAuditLog({ adminId: req.admin!.sub, action: "access.denied", outcome: "failure", description: `Refused release ${to} - needs ${needed}` });
    return res.status(403).json({ error: "You don't have permission to do that", code: "forbidden" });
  }
  const release = await db.query.appReleasesTable.findFirst({ where: eq(appReleasesTable.id, id) });
  if (!release) return res.status(404).json({ error: "Release not found" });
  if (!(RELEASE_TRANSITIONS[release.status] ?? []).includes(to)) {
    return res.status(409).json({ error: `A build that is "${release.status}" can't become "${to}".` });
  }
  if ((to === "withdrawn" || release.status === "withdrawn") && (!reason || reason.length < 3)) {
    return res.status(400).json({ error: "Give a reason (at least 3 characters)." });
  }
  const percent = to === "published" ? 100 : to === "staged" ? (parsed.data.rolloutPercent ?? release.rolloutPercent) : release.rolloutPercent;
  if (to === "staged" && percent >= 100) return res.status(400).json({ error: "A staged rollout must be below 100% - publish it to go to everyone." });
  if (to === "published" && parsed.data.confirm !== true) {
    return res.status(400).json({ error: "Confirm that this build should go to everyone.", code: "confirm_required" });
  }
  // A file that is missing or fails its checksum must never go out.
  if (to !== "withdrawn") {
    const problem = await verifyArtifact(release);
    if (problem) return res.status(409).json({ error: problem, code: "artifact_invalid" });
  }

  const now = new Date();
  const [updated] = await db
    .update(appReleasesTable)
    .set({
      status: to,
      active: to !== "withdrawn",
      rolloutPercent: percent,
      ...(to === "withdrawn" ? { withdrawnAt: now, withdrawnReason: reason } : { withdrawnAt: null, withdrawnReason: null, publishedAt: release.publishedAt ?? now, publishedBy: req.admin!.sub }),
    })
    .where(and(eq(appReleasesTable.id, id), eq(appReleasesTable.status, release.status)))
    .returning();
  if (!updated) return res.status(409).json({ error: "Someone else just changed this build - reload and try again." });
  await writeMasterAuditLog({
    adminId: req.admin!.sub,
    action: `release.${to}`,
    entity: "release",
    entityId: id,
    reason,
    description: `${to === "withdrawn" ? "Withdrew" : to === "staged" ? `Staged at ${percent}%` : "Published"} ${updated.platform}/${updated.arch} build ${updated.version}`,
  });
  res.json(publicRow(updated));
});

/**
 * Rollback = stop offering this build and make an earlier, known-good build the current one.
 * Apps that already installed the bad build are NOT downgraded; they move on when a newer fixed
 * build is published. The response says so plainly.
 */
const rollbackSchema = z.object({ toReleaseId: z.number().int().positive(), reason: z.string().trim().min(3).max(500), confirm: z.literal(true) });
router.post("/releases/:id/rollback", requirePermission("releases.rollback"), async (req, res) => {
  const id = releaseId(req.params.id);
  const parsed = rollbackSchema.safeParse(req.body);
  if (!id || !parsed.success) return res.status(400).json({ error: "Choose the build to go back to, give a reason, and confirm." });
  const [bad, good] = await Promise.all([
    db.query.appReleasesTable.findFirst({ where: eq(appReleasesTable.id, id) }),
    db.query.appReleasesTable.findFirst({ where: eq(appReleasesTable.id, parsed.data.toReleaseId) }),
  ]);
  if (!bad || !good) return res.status(404).json({ error: "Release not found" });
  if (bad.platform !== good.platform || bad.arch !== good.arch) return res.status(400).json({ error: "Roll back to a build for the same platform and architecture." });
  if (compareVersions(good.version, bad.version) >= 0) return res.status(400).json({ error: "Roll back to an OLDER build." });
  if (!(RELEASE_TRANSITIONS[bad.status] ?? []).includes("withdrawn")) return res.status(409).json({ error: `A build that is "${bad.status}" can't be rolled back.` });
  if (good.status === "draft") return res.status(409).json({ error: "That build was never published - choose one that was." });
  const problem = await verifyArtifact(good);
  if (problem) return res.status(409).json({ error: problem, code: "artifact_invalid" });

  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.update(appReleasesTable).set({ status: "withdrawn", active: false, withdrawnAt: now, withdrawnReason: parsed.data.reason }).where(eq(appReleasesTable.id, bad.id));
    await tx.update(appReleasesTable).set({ status: "published", active: true, rolloutPercent: 100, withdrawnAt: null, withdrawnReason: null, publishedAt: good.publishedAt ?? now, publishedBy: req.admin!.sub }).where(eq(appReleasesTable.id, good.id));
  });
  await writeMasterAuditLog({
    adminId: req.admin!.sub,
    action: "release.rollback",
    entity: "release",
    entityId: bad.id,
    reason: parsed.data.reason,
    description: `Rolled back ${bad.platform}/${bad.arch} from ${bad.version} to ${good.version}`,
  });
  res.json({ ok: true, note: "New downloads and updates now use the earlier build. Apps that already installed the withdrawn build stay on it until a newer fixed build is published." });
});

async function verifyArtifact(release: { storedFileName: string; sha256: string; sizeBytes: number }): Promise<string | null> {
  const filePath = path.join(releasesDir(), path.basename(release.storedFileName));
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return "The installer file is missing on the server - upload it again.";
  }
  if (stat.size !== release.sizeBytes) return "The installer file on the server doesn't match what was uploaded (size differs).";
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(filePath), hash);
  if (hash.digest("hex") !== release.sha256) return "The installer file failed its integrity check (checksum differs).";
  return null;
}

/** Who actually got this build: only what the installations themselves reported. */
router.get("/releases/:id/deployments", requirePermission("releases.view"), async (req, res) => {
  const id = releaseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid release id" });
  const release = await db.query.appReleasesTable.findFirst({ where: eq(appReleasesTable.id, id) });
  if (!release) return res.status(404).json({ error: "Release not found" });

  const rows = await db
    .select({
      installationId: releaseDeploymentsTable.installationId,
      code: installationsTable.installationCode,
      device: installationsTable.deviceName,
      customer: customersTable.name,
      appVersion: installationsTable.appVersion,
      status: releaseDeploymentsTable.status,
      error: releaseDeploymentsTable.error,
      updatedAt: releaseDeploymentsTable.updatedAt,
    })
    .from(releaseDeploymentsTable)
    .innerJoin(installationsTable, eq(installationsTable.id, releaseDeploymentsTable.installationId))
    .innerJoin(customersTable, eq(customersTable.id, installationsTable.customerId))
    .where(eq(releaseDeploymentsTable.releaseId, id))
    .orderBy(desc(releaseDeploymentsTable.updatedAt))
    .limit(200);
  const [counts] = await db
    .select({
      offered: sql<number>`count(*) filter (where status = 'offered')::int`,
      downloaded: sql<number>`count(*) filter (where status = 'downloaded')::int`,
      installed: sql<number>`count(*) filter (where status = 'installed')::int`,
      failed: sql<number>`count(*) filter (where status = 'failed')::int`,
    })
    .from(releaseDeploymentsTable)
    .where(eq(releaseDeploymentsTable.releaseId, id));

  // Installations that would be offered this build but haven't asked yet (offline, or not checked since it went live).
  const all = await db.query.installationsTable.findMany();
  const reported = new Set(rows.map((r) => r.installationId));
  const waiting = all.filter(
    (i) =>
      !i.revokedAt &&
      !reported.has(i.id) &&
      i.appVersion &&
      platformFromNode((i.osVersion ?? "").split(" ")[0]) === release.platform &&
      compareVersions(i.appVersion, release.version) < 0 &&
      isOfferedTo(release, i, i.appVersion),
  ).length;

  res.json({ release: publicRow(release), counts: { ...counts, waiting }, rows });
});

export default router;
export type { ReleasePlatform };
