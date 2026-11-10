import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { db, appReleasesTable, type AppRelease } from "@masterctl/db";
import { RELEASE_PLATFORMS, compareVersions, releasesDir, type ReleasePlatform } from "../lib/releases";
import { rateLimit } from "../lib/rate-limit";

/**
 * Unauthenticated endpoints for the public landing page: which installer
 * is current for each OS, and the download itself. Deliberately exposes
 * nothing beyond version, size, checksum, notes and a download link.
 */
const router: IRouter = Router();

const publicLimiter = rateLimit({ name: "public", windowMs: 60_000, max: 120 });
const downloadLimiter = rateLimit({
  name: "download",
  windowMs: 10 * 60_000,
  max: 30,
  message: "Too many downloads from this device - please wait a few minutes.",
});

/** Newest active build per platform+arch. */
export async function latestActiveReleases(): Promise<AppRelease[]> {
  const rows = await db.query.appReleasesTable.findMany({
    where: and(eq(appReleasesTable.active, true), eq(appReleasesTable.status, "published")),
    orderBy: (t) => [desc(t.createdAt)],
  });
  const best = new Map<string, AppRelease>();
  for (const r of rows) {
    const key = `${r.platform}/${r.arch}`;
    const current = best.get(key);
    if (!current || compareVersions(r.version, current.version) > 0) best.set(key, r);
  }
  return [...best.values()];
}

router.get("/public/releases", publicLimiter, async (_req, res) => {
  const latest = await latestActiveReleases();
  res.setHeader("Cache-Control", "public, max-age=30");
  res.json(
    latest.map((r) => ({
      platform: r.platform,
      arch: r.arch,
      version: r.version,
      sizeBytes: r.sizeBytes,
      sha256: r.sha256,
      notes: r.notes,
      releasedAt: r.createdAt,
      downloadUrl: `/api/downloads/${r.platform}?arch=${r.arch}`,
    })),
  );
});

router.get("/downloads/:platform", downloadLimiter, async (req, res) => {
  const platform = req.params.platform as ReleasePlatform;
  if (!RELEASE_PLATFORMS.includes(platform)) return res.status(404).json({ error: "Unknown platform" });

  const arch = req.query.arch === "arm64" ? "arm64" : "x64";
  const candidates = await db.query.appReleasesTable.findMany({
    where: and(
      eq(appReleasesTable.active, true),
      eq(appReleasesTable.status, "published"),
      eq(appReleasesTable.platform, platform),
      eq(appReleasesTable.arch, arch),
    ),
  });
  const release = candidates.sort((a, b) => compareVersions(b.version, a.version))[0];
  if (!release) return res.status(404).json({ error: `No ${platform} build has been published yet.` });

  const filePath = path.join(releasesDir(), path.basename(release.storedFileName));
  if (!fs.existsSync(filePath)) {
    console.error(`[master-api] release ${release.id} is in the database but its file is missing from disk`);
    return res.status(404).json({ error: "That build is temporarily unavailable." });
  }

  res.setHeader("X-Checksum-Sha256", release.sha256);
  res.download(filePath, release.downloadFileName);
});

export default router;
