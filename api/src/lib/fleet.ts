import { db, installationsTable, metricSnapshotsTable } from "@masterctl/db";
import { sql, lt } from "drizzle-orm";
import { deriveInstallationStatus, type InstallationStatus } from "./installation-status";

export interface FleetCounts {
  total: number;
  status: Record<InstallationStatus, number>;
  pendingChanges: number;
  failedChanges: number;
  conflicts: number;
  installationsPendingSync: number;
  needAttention: number;
  lastSuccessfulSyncAt: Date | null;
}

/** One place that decides what "online / offline / needs attention" means, used by the dashboard AND the snapshot job. */
export async function computeFleetCounts(): Promise<FleetCounts> {
  const rows = await db.query.installationsTable.findMany();
  const status: Record<InstallationStatus, number> = { online: 0, warning: 0, offline: 0, critical: 0, unknown: 0 };
  let pendingChanges = 0, failedChanges = 0, conflicts = 0, installationsPendingSync = 0, needAttention = 0;
  let lastSuccessfulSyncAt: Date | null = null;
  for (const i of rows) {
    const s = deriveInstallationStatus(i);
    status[s]++;
    pendingChanges += i.pendingCount ?? 0;
    failedChanges += i.failedCount ?? 0;
    conflicts += i.conflictCount ?? 0;
    if ((i.pendingCount ?? 0) > 0) installationsPendingSync++;
    if ((i.conflictCount ?? 0) > 0 || (i.failedCount ?? 0) > 0 || s === "critical" || s === "warning") needAttention++;
    if (i.lastSyncAt && (!lastSuccessfulSyncAt || i.lastSyncAt > lastSuccessfulSyncAt)) lastSuccessfulSyncAt = i.lastSyncAt;
  }
  return { total: rows.length, status, pendingChanges, failedChanges, conflicts, installationsPendingSync, needAttention, lastSuccessfulSyncAt };
}

const SNAPSHOT_EVERY_MS = 5 * 60_000;
const KEEP_DAYS = 90;

async function takeSnapshot(): Promise<void> {
  const c = await computeFleetCounts();
  await db.insert(metricSnapshotsTable).values({
    online: c.status.online, offline: c.status.offline, warning: c.status.warning,
    critical: c.status.critical, unknown: c.status.unknown,
    pendingChanges: c.pendingChanges, failedChanges: c.failedChanges, conflicts: c.conflicts,
  });
  await db.delete(metricSnapshotsTable).where(lt(metricSnapshotsTable.takenAt, sql`now() - interval '${sql.raw(String(KEEP_DAYS))} days'`));
}

/** Records the fleet's state every 5 minutes so the dashboard can show real trends (nothing is back-filled). */
export function startSnapshotJob(): void {
  const run = () => takeSnapshot().catch((err) => console.error("[master-api] snapshot failed:", err instanceof Error ? err.message : err));
  setTimeout(run, 15_000);
  setInterval(run, SNAPSHOT_EVERY_MS).unref();
}
