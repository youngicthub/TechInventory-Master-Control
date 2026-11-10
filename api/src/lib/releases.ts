import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const RELEASE_PLATFORMS = ["windows", "mac", "linux"] as const;
export type ReleasePlatform = (typeof RELEASE_PLATFORMS)[number];

/** Installer file types allowed per platform - anything else is rejected at upload. */
export const ALLOWED_EXTENSIONS: Record<ReleasePlatform, string[]> = {
  windows: [".exe", ".msi"],
  mac: [".dmg", ".zip", ".pkg"],
  linux: [".appimage", ".deb", ".rpm", ".tar.gz"],
};

// api/src/lib -> MasterControl/. Resolved from this file (not the process's
// working directory) so uploads land in the same place however it's started.
const MASTER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export { MASTER_ROOT };

export function releasesDir(): string {
  const dir = path.resolve(process.env.MASTER_RELEASES_DIR ?? path.join(MASTER_ROOT, "releases-data"));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function maxUploadBytes(): number {
  const mb = Number(process.env.MASTER_MAX_UPLOAD_MB ?? 800);
  return (Number.isFinite(mb) && mb > 0 ? mb : 800) * 1024 * 1024;
}

/** Strict x.y.z (optionally -prerelease). Returns null for anything else. */
export function parseVersion(v: string): { nums: [number, number, number]; pre: string | null } | null {
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-([0-9A-Za-z.-]{1,32}))?$/.exec(v.trim());
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null };
}

export function normalizeVersion(v: string): string | null {
  const p = parseVersion(v);
  return p ? `${p.nums.join(".")}${p.pre ? `-${p.pre}` : ""}` : null;
}

/** <0 if a is older than b, 0 if equal, >0 if newer. A prerelease sorts below its release. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

export function matchExtension(platform: ReleasePlatform, fileName: string): string | null {
  const lower = fileName.toLowerCase();
  return ALLOWED_EXTENSIONS[platform].find((ext) => lower.endsWith(ext)) ?? null;
}

/** Map Node's os.platform() values (what the desktop agent reports) onto ours. */
export function platformFromNode(p: string): ReleasePlatform | null {
  if (p === "win32" || p === "windows") return "windows";
  if (p === "darwin" || p === "mac") return "mac";
  if (p === "linux") return "linux";
  return null;
}
