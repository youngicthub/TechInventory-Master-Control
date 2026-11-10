import { getSetting } from "./settings";
export type InstallationStatus = "online" | "warning" | "offline" | "critical" | "unknown";

// Configurable thresholds (MASTERAPP.md §5 calls for these to be
// configurable - env vars are the simplest version of that for v1).
// Read from platform settings on every call (defaults to MASTER_OFFLINE_THRESHOLD_SECONDS / 120 s).

/**
 * Status is derived here, at read time, rather than stored as a column -
 * see the comment on installationsTable. An installation that stops
 * heartbeating doesn't need anything to notice and flip a flag; the very
 * next time anyone asks "what's its status", this just looks stale
 * automatically.
 */
export function deriveInstallationStatus(installation: {
  lastSeenAt: Date | null;
  lastHealthStatus: string | null;
}): InstallationStatus {
  if (!installation.lastSeenAt) return "unknown"; // activated but never actually checked in
  if (installation.lastHealthStatus === "critical") return "critical";

  const secondsSinceLastSeen = (Date.now() - installation.lastSeenAt.getTime()) / 1000;
  if (secondsSinceLastSeen > getSetting("heartbeat.offlineAfterSeconds")) return "offline";
  if (installation.lastHealthStatus === "error") return "warning";
  return "online";
}
