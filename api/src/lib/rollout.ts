import { createHash } from "node:crypto";
import { compareVersions } from "./releases";

/** Stable 0-99 bucket for one installation and one release, so the same devices stay in a staged rollout as it widens. */
export function rolloutBucket(installationId: number, releaseId: number): number {
  const h = createHash("sha1").update(`${installationId}:${releaseId}`).digest("hex").slice(0, 8);
  return parseInt(h, 16) % 100;
}

/** Releases move only along these paths; anything else is refused. */
export const RELEASE_TRANSITIONS: Record<string, string[]> = {
  draft: ["staged", "published"],
  staged: ["staged", "published", "withdrawn"],
  published: ["withdrawn"],
  withdrawn: ["staged", "published"],
};

export function isOfferedTo(
  release: { id: number; status: string; rolloutPercent: number; minFromVersion: string | null },
  installation: { id: number },
  currentVersion: string,
): boolean {
  if (release.status !== "staged" && release.status !== "published") return false;
  if (release.minFromVersion && compareVersions(currentVersion, release.minFromVersion) < 0) return false;
  if (release.status === "published" && release.rolloutPercent >= 100) return true;
  return rolloutBucket(installation.id, release.id) < release.rolloutPercent;
}
