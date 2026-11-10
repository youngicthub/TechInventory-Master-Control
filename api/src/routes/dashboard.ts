import { Router, type IRouter } from "express";
import { db, customersTable, installationsTable, installationErrorsTable, metricSnapshotsTable, appReleasesTable } from "@masterctl/db";
import { sql, gte, desc, and, eq } from "drizzle-orm";
import { requireAdminAuth } from "../middlewares/auth";
import { deriveInstallationStatus } from "../lib/installation-status";
import { computeFleetCounts } from "../lib/fleet";

const router: IRouter = Router();
router.use(requireAdminAuth);

// Kept for older dashboards.
router.get("/dashboard/summary", async (_req, res) => {
  const [[{ customerCount }], [{ errorCountToday }], fleet] = await Promise.all([
    db.select({ customerCount: sql<number>`count(*)::int` }).from(customersTable),
    db.select({ errorCountToday: sql<number>`count(*)::int` }).from(installationErrorsTable).where(sql`${installationErrorsTable.lastSeenAt} >= current_date`),
    computeFleetCounts(),
  ]);
  const all = await db.query.installationsTable.findMany();
  res.json({
    totalProducts: all.reduce((n, i) => n + (i.productCount ?? 0), 0),
    pendingChanges: fleet.pendingChanges,
    needAttention: fleet.needAttention,
    customers: customerCount,
    installations: fleet.total,
    ...fleet.status,
    errorsToday: errorCountToday,
  });
});

const UNAVAILABLE = {
  syncSuccessRate: "The apps report sync backlog and failures, but not each sync attempt, so a success rate can't be computed yet.",
  oldestUnresolvedSync: "The apps don't report when a sync problem first appeared.",
  backgroundJobs: "No background-job reporting exists in the apps yet.",
  backups: "Backup monitoring isn't integrated.",
};

router.get("/dashboard/overview", async (req, res) => {
  const requested = Number(req.query.days);
  const days = [1, 7, 30, 90].includes(requested) ? requested : 7;
  const since = new Date(Date.now() - days * 86_400_000);

  const dbStarted = Date.now();
  const [customerRows, fleet, allInstallations, errorStats, regTrend, errTrend, snapshots, recentCustomers, criticalErrors, releases] = await Promise.all([
    db.select({ status: customersTable.status, n: sql<number>`count(*)::int`, recent: sql<number>`count(*) filter (where ${customersTable.createdAt} >= ${since})::int` }).from(customersTable).groupBy(customersTable.status),
    computeFleetCounts(),
    db.query.installationsTable.findMany(),
    db.select({
      today: sql<number>`count(*) filter (where ${installationErrorsTable.lastSeenAt} >= current_date)::int`,
      openCritical: sql<number>`count(*) filter (where ${installationErrorsTable.severity} = 'critical' and ${installationErrorsTable.status} in ('open','investigating'))::int`,
      repeated: sql<number>`count(*) filter (where ${installationErrorsTable.occurrences} >= 3 and ${installationErrorsTable.status} in ('open','investigating'))::int`,
    }).from(installationErrorsTable),
    db.execute(sql`select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*)::int as n from master_control.customers where created_at >= ${since} group by 1 order by 1`),
    db.execute(sql`select to_char(date_trunc('day', first_seen_at), 'YYYY-MM-DD') as day, count(*)::int as n from master_control.installation_errors where first_seen_at >= ${since} group by 1 order by 1`),
    db.select().from(metricSnapshotsTable).where(gte(metricSnapshotsTable.takenAt, since)).orderBy(metricSnapshotsTable.takenAt),
    db.query.customersTable.findMany({ orderBy: (t, { desc: d }) => d(t.createdAt), limit: 6 }),
    db.query.installationErrorsTable.findMany({ where: and(eq(installationErrorsTable.severity, "critical")), orderBy: (t, { desc: d }) => d(t.lastSeenAt), limit: 6 }),
    db.query.appReleasesTable.findMany({ where: eq(appReleasesTable.active, true), orderBy: desc(appReleasesTable.createdAt), limit: 20 }),
  ]);
  const dbLatencyMs = Date.now() - dbStarted;

  const byStatus = Object.fromEntries(customerRows.map((r) => [r.status, r.n])) as Record<string, number>;
  const customers = {
    total: customerRows.reduce((n, r) => n + r.n, 0),
    pending: byStatus.pending ?? 0,
    active: byStatus.active ?? 0,
    suspended: byStatus.suspended ?? 0,
    newInPeriod: customerRows.reduce((n, r) => n + r.recent, 0),
  };

  const customerName = new Map((await db.query.customersTable.findMany({ columns: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const versionCounts = new Map<string, number>();
  for (const i of allInstallations) versionCounts.set(i.appVersion ?? "unknown", (versionCounts.get(i.appVersion ?? "unknown") ?? 0) + 1);

  const priority = { critical: 0, warning: 1, offline: 2, unknown: 3, online: 4 } as const;
  const attention = allInstallations
    .map((i) => {
      const status = deriveInstallationStatus(i);
      const reasons: string[] = [];
      if (status === "critical") reasons.push("Critical health");
      if (status === "warning") reasons.push("Reporting errors");
      if (status === "offline") reasons.push("Offline");
      if ((i.failedCount ?? 0) > 0) reasons.push(`${i.failedCount} failed change(s)`);
      if ((i.conflictCount ?? 0) > 0) reasons.push(`${i.conflictCount} conflict(s)`);
      if ((i.pendingCount ?? 0) >= 20) reasons.push(`${i.pendingCount} changes waiting to sync`);
      return { id: i.id, code: i.installationCode, device: i.deviceName, customer: customerName.get(i.customerId) ?? "Unknown", status, reasons, lastSeenAt: i.lastSeenAt };
    })
    .filter((r) => r.reasons.length > 0)
    .sort((a, b) => priority[a.status] - priority[b.status] || b.reasons.length - a.reasons.length)
    .slice(0, 8);

  const recentActivity = [...allInstallations]
    .filter((i) => i.lastSeenAt)
    .sort((a, b) => b.lastSeenAt!.getTime() - a.lastSeenAt!.getTime())
    .slice(0, 6)
    .map((i) => ({ id: i.id, code: i.installationCode, device: i.deviceName, customer: customerName.get(i.customerId) ?? "Unknown", status: deriveInstallationStatus(i), lastSeenAt: i.lastSeenAt }));

  // Latest published version per platform, and how many installs are on it.
  const latestByPlatform = new Map<string, string>();
  for (const r of releases) if (!latestByPlatform.has(r.platform)) latestByPlatform.set(r.platform, r.version);
  const latestVersions = [...latestByPlatform.values()];
  const onLatest = allInstallations.filter((i) => i.appVersion && latestVersions.includes(i.appVersion)).length;

  res.json({
    generatedAt: new Date().toISOString(),
    rangeDays: days,
    customers,
    installations: {
      total: fleet.total,
      ...fleet.status,
      needAttention: fleet.needAttention,
      versions: [...versionCounts.entries()].map(([version, count]) => ({ version, count })).sort((a, b) => b.count - a.count),
    },
    sync: {
      pendingChanges: fleet.pendingChanges,
      installationsPendingSync: fleet.installationsPendingSync,
      failedChanges: fleet.failedChanges,
      conflicts: fleet.conflicts,
      lastSuccessfulSyncAt: fleet.lastSuccessfulSyncAt,
    },
    errors: { today: errorStats[0]?.today ?? 0, openCritical: errorStats[0]?.openCritical ?? 0, repeatedGroups: errorStats[0]?.repeated ?? 0 },
    health: { api: "ok", database: "ok", databaseLatencyMs: dbLatencyMs },
    releases: {
      latest: [...latestByPlatform.entries()].map(([platform, version]) => ({ platform, version })),
      installationsOnLatest: onLatest,
      installationsTotal: fleet.total,
    },
    trends: {
      registrations: regTrend.rows,
      errors: errTrend.rows,
      connectivity: snapshots.map((s) => ({ t: s.takenAt, online: s.online, offline: s.offline, warning: s.warning, critical: s.critical, pending: s.pendingChanges, failed: s.failedChanges })),
    },
    recent: { customers: recentCustomers.map((c) => ({ id: c.id, name: c.name, status: c.status, createdAt: c.createdAt })), criticalErrors, activity: recentActivity },
    attention,
    unavailable: UNAVAILABLE,
  });
});

export default router;
