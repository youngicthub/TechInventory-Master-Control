import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { db, appReleasesTable, customersTable, releaseDeploymentsTable } from "@masterctl/db";
import { requireAgentAuth } from "../middlewares/auth";
import { writeMasterAuditLog } from "../lib/audit";
import { compareVersions, parseVersion, platformFromNode, releasesDir } from "../lib/releases";
import { isOfferedTo } from "../lib/rollout";

/**
 * What an installed desktop app calls to learn "is there a newer version
 * for me?" and to fetch it. Both need the per-installation agent token, so
 * only devices that activated with a valid license can pull builds - and a
 * suspended customer's devices stop receiving updates.
 */
const router: IRouter = Router();

async function customerIsActive(customerId: number): Promise<boolean> {
  const c = await db.query.customersTable.findFirst({
    where: eq(customersTable.id, customerId),
    columns: { status: true },
  });
  return c?.status === "active";
}

router.get("/agent/update-check", requireAgentAuth, async (req, res) => {
  const platform = platformFromNode(String(req.query.platform ?? ""));
  const arch = req.query.arch === "arm64" ? "arm64" : "x64";
  const current = String(req.query.version ?? "");
  if (!platform || !parseVersion(current)) {
    return res.status(400).json({ error: "platform and a valid current version are required" });
  }
  if (!(await customerIsActive(req.installation!.customerId))) {
    return res.json({ updateAvailable: false });
  }

  // Only builds this device is actually offered: live (staged/published), inside its rollout
  // percentage, and compatible with the version it is on today.
  const live = await db.query.appReleasesTable.findMany({
    where: and(
      eq(appReleasesTable.active, true),
      eq(appReleasesTable.platform, platform),
      eq(appReleasesTable.arch, arch),
    ),
  });
  const candidates = live.filter((r) => isOfferedTo(r, req.installation!, current));
  const newest = candidates.sort((a, b) => compareVersions(b.version, a.version))[0];
  if (!newest || compareVersions(newest.version, current) <= 0) {
    return res.json({ updateAvailable: false });
  }

  // Required if ANY active build newer than the one installed is marked
  // required - an admin can't be bypassed by skipping straight past a
  // mandatory release to a later optional one.
  const required = candidates.some((r) => r.mandatory && compareVersions(r.version, current) > 0);

  // Record that this device was offered the build (an acknowledgement, never "installed").
  await db
    .insert(releaseDeploymentsTable)
    .values({ releaseId: newest.id, installationId: req.installation!.id, status: "offered" })
    .onConflictDoNothing();

  res.json({
    updateAvailable: true,
    releaseId: newest.id,
    version: newest.version,
    mandatory: required,
    notes: newest.notes,
    sizeBytes: newest.sizeBytes,
    sha256: newest.sha256,
    fileName: newest.downloadFileName,
    downloadUrl: `/api/agent/download/${newest.id}`,
  });
});

router.get("/agent/download/:id", requireAgentAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid release id" });
  if (!(await customerIsActive(req.installation!.customerId))) {
    return res.status(403).json({ error: "This account is suspended - contact support" });
  }

  const release = await db.query.appReleasesTable.findFirst({
    where: and(eq(appReleasesTable.id, id), eq(appReleasesTable.active, true)),
  });
  if (!release) return res.status(404).json({ error: "That build isn't available" });
  if (!isOfferedTo(release, req.installation!, req.installation!.appVersion ?? "0.0.0")) {
    return res.status(404).json({ error: "That build isn't available" });
  }

  const filePath = path.join(releasesDir(), path.basename(release.storedFileName));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "That build is temporarily unavailable." });

  await writeMasterAuditLog({
    adminId: null,
    action: "installation.update_download",
    entity: "installation",
    entityId: req.installation!.id,
    description: `${req.installation!.installationCode} downloaded ${release.platform}/${release.arch} build ${release.version}`,
  });

  await db
    .insert(releaseDeploymentsTable)
    .values({ releaseId: release.id, installationId: req.installation!.id, status: "downloaded" })
    .onConflictDoUpdate({
      target: [releaseDeploymentsTable.releaseId, releaseDeploymentsTable.installationId],
      set: { status: sql`case when ${releaseDeploymentsTable.status} in ('installed') then 'installed' else 'downloaded' end`, updatedAt: new Date() },
    });

  res.setHeader("X-Checksum-Sha256", release.sha256);
  res.download(filePath, release.downloadFileName);
});

export default router;
