import { Router, type IRouter } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, incidentsTable, incidentEventsTable, incidentDaysTable, installationErrorsTable, installationsTable, customersTable, masterAdminsTable } from "@masterctl/db";
import { requireAdminAuth, requirePermission } from "../middlewares/auth";
import { writeMasterAuditLog } from "../lib/audit";
import { TRANSITIONS } from "../lib/incidents";
import { deriveInstallationStatus } from "../lib/installation-status";
import { getSetting } from "../lib/settings";

const router: IRouter = Router();
router.use("/incidents", requireAdminAuth);
router.use("/alerts", requireAdminAuth);

const parseId = (raw: string) => (Number.isInteger(Number(raw)) && Number(raw) > 0 ? Number(raw) : null);
const like = (v: string) => `%${v.replace(/[%_\\]/g, "\\$&")}%`;

router.get("/incidents", requirePermission("incidents.view"), async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 25, 1), 100);
  const page = Math.max(Number(q.page) || 1, 1);

  const where: ReturnType<typeof sql>[] = [];
  if (q.status === "active") where.push(sql`i.status <> 'resolved'`);
  else if (q.status) {
    const list = q.status.split(",").filter((s) => ["new", "acknowledged", "investigating", "resolved", "reopened"].includes(s));
    if (list.length) where.push(sql`i.status in (${sql.join(list.map((s) => sql`${s}`), sql`, `)})`);
  }
  if (q.severity && ["info", "warning", "error", "critical"].includes(q.severity)) where.push(sql`i.severity = ${q.severity}`);
  if (q.q?.trim()) where.push(sql`(i.title ilike ${like(q.q.trim())} or i.module ilike ${like(q.q.trim())})`);
  if (q.from && !Number.isNaN(Date.parse(q.from))) where.push(sql`i.last_seen_at >= ${new Date(q.from)}`);
  if (q.to && !Number.isNaN(Date.parse(q.to))) where.push(sql`i.last_seen_at <= ${new Date(new Date(q.to).getTime() + 86_399_999)}`);
  if (q.assigned === "me") where.push(sql`i.assigned_admin_id = ${req.admin!.sub}`);
  else if (q.assigned === "none") where.push(sql`i.assigned_admin_id is null`);
  else if (parseId(q.assigned ?? "")) where.push(sql`i.assigned_admin_id = ${Number(q.assigned)}`);
  if (parseId(q.installationId ?? "")) where.push(sql`exists (select 1 from master_control.installation_errors e where e.incident_id = i.id and e.installation_id = ${Number(q.installationId)})`);
  if (parseId(q.customerId ?? "")) where.push(sql`exists (select 1 from master_control.installation_errors e join master_control.installations n on n.id = e.installation_id where e.incident_id = i.id and n.customer_id = ${Number(q.customerId)})`);
  const cond = where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``;

  const rows = await db.execute(sql`
    select i.id, i.title, i.module, i.severity, i.status, i.occurrences,
           i.first_seen_at as "firstSeenAt", i.last_seen_at as "lastSeenAt", i.assigned_admin_id as "assignedAdminId",
           a.name as "assignedAdminName", i.last_app_version as "lastAppVersion",
           (select count(distinct e.installation_id)::int from master_control.installation_errors e where e.incident_id = i.id) as "affectedInstallations",
           (select count(distinct n.customer_id)::int from master_control.installation_errors e join master_control.installations n on n.id = e.installation_id where e.incident_id = i.id) as "affectedCustomers"
    from master_control.incidents i
    left join master_control.master_admins a on a.id = i.assigned_admin_id
    ${cond}
    order by case i.severity when 'critical' then 0 when 'error' then 1 when 'warning' then 2 else 3 end, i.last_seen_at desc
    limit ${pageSize} offset ${(page - 1) * pageSize}`);
  const total = await db.execute(sql`select count(*)::int as n from master_control.incidents i ${cond}`);
  res.json({ rows: rows.rows, total: (total.rows[0] as { n: number }).n, page, pageSize });
});

router.get("/incidents/:id", requirePermission("incidents.view"), async (req, res) => {
  const id = parseId(String(req.params.id));
  if (!id) return res.status(404).json({ error: "Incident not found" });
  const incident = await db.query.incidentsTable.findFirst({ where: eq(incidentsTable.id, id) });
  if (!incident) return res.status(404).json({ error: "Incident not found" });

  const [occ, events, days, assignee] = await Promise.all([
    db.select({
      installationId: installationsTable.id, code: installationsTable.installationCode, device: installationsTable.deviceName,
      customerId: customersTable.id, customer: customersTable.name, appVersion: installationsTable.appVersion,
      occurrences: installationErrorsTable.occurrences, firstSeenAt: installationErrorsTable.firstSeenAt, lastSeenAt: installationErrorsTable.lastSeenAt,
      lastSeen: installationsTable.lastSeenAt, health: installationsTable.lastHealthStatus,
      pending: installationsTable.pendingCount, failed: installationsTable.failedCount, lastSyncAt: installationsTable.lastSyncAt,
    }).from(installationErrorsTable)
      .innerJoin(installationsTable, eq(installationErrorsTable.installationId, installationsTable.id))
      .innerJoin(customersTable, eq(installationsTable.customerId, customersTable.id))
      .where(eq(installationErrorsTable.incidentId, id)).orderBy(desc(installationErrorsTable.lastSeenAt)),
    db.select().from(incidentEventsTable).where(eq(incidentEventsTable.incidentId, id)).orderBy(asc(incidentEventsTable.id)),
    db.select().from(incidentDaysTable).where(eq(incidentDaysTable.incidentId, id)).orderBy(asc(incidentDaysTable.day)),
    incident.assignedAdminId ? db.query.masterAdminsTable.findFirst({ where: eq(masterAdminsTable.id, incident.assignedAdminId), columns: { name: true } }) : null,
  ]);

  const installations = occ.map((o) => ({ ...o, status: deriveInstallationStatus({ lastSeenAt: o.lastSeen, lastHealthStatus: o.health }) }));
  const versions = new Map<string, number>();
  for (const o of occ) versions.set(o.appVersion ?? "unknown", (versions.get(o.appVersion ?? "unknown") ?? 0) + 1);
  res.json({
    ...incident,
    assignedAdminName: assignee?.name ?? null,
    allowedTransitions: TRANSITIONS[incident.status] ?? [],
    installations,
    versions: [...versions.entries()].map(([version, count]) => ({ version, count })),
    events,
    days: days.map((d) => ({ day: d.day, count: d.count })),
  });
});

async function load(res: import("express").Response, rawId: string) {
  const id = parseId(rawId);
  const incident = id ? await db.query.incidentsTable.findFirst({ where: eq(incidentsTable.id, id) }) : undefined;
  if (!incident) res.status(404).json({ error: "Incident not found" });
  return incident;
}

async function addEvent(incidentId: number, kind: string, req: import("express").Request, note?: string) {
  const adminName = (await db.query.masterAdminsTable.findFirst({ where: eq(masterAdminsTable.id, req.admin!.sub), columns: { name: true } }))?.name;
  await db.insert(incidentEventsTable).values({ incidentId, kind, adminId: req.admin!.sub, adminName, note });
}

const transitionSchema = z.object({ to: z.enum(["acknowledged", "investigating", "resolved", "reopened"]), note: z.string().trim().max(1000).optional() });

router.post("/incidents/:id/transition", requirePermission("incidents.manage"), async (req, res) => {
  const incident = await load(res, String(req.params.id));
  if (!incident) return;
  const parsed = transitionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a valid status" });
  const { to, note } = parsed.data;
  if (!(TRANSITIONS[incident.status] ?? []).includes(to)) {
    return res.status(409).json({ error: `An incident that is "${incident.status}" can't move to "${to}".` });
  }
  if ((to === "resolved" || to === "reopened") && (!note || note.length < 3)) {
    return res.status(400).json({ error: to === "resolved" ? "Add a short resolution note." : "Say why it is being reopened." });
  }

  const [updated] = await db.update(incidentsTable).set({
    status: to,
    ...(to === "acknowledged" || to === "investigating" ? { acknowledgedAt: incident.acknowledgedAt ?? new Date() } : {}),
    ...(to === "resolved" ? { resolvedAt: new Date(), resolutionNotes: note } : {}),
    ...(to === "reopened" ? { resolvedAt: null } : {}),
  }).where(and(eq(incidentsTable.id, incident.id), eq(incidentsTable.status, incident.status))).returning();
  if (!updated) return res.status(409).json({ error: "Someone else just changed this incident - reload and try again." });

  if (to === "resolved") await db.update(installationErrorsTable).set({ status: "resolved" }).where(eq(installationErrorsTable.incidentId, incident.id));
  if (to === "reopened") await db.update(installationErrorsTable).set({ status: "open" }).where(eq(installationErrorsTable.incidentId, incident.id));
  await addEvent(incident.id, to, req, note);
  await writeMasterAuditLog({ adminId: req.admin!.sub, action: `incident.${to}`, entity: "incident", entityId: incident.id, description: `Incident #${incident.id} (${incident.title.slice(0, 80)}) → ${to}`, reason: note });
  res.json(updated);
});

router.post("/incidents/:id/assign", requirePermission("incidents.manage"), async (req, res) => {
  const incident = await load(res, String(req.params.id));
  if (!incident) return;
  const raw = req.body?.adminId;
  const adminId = raw === null || raw === undefined ? null : Number(raw);
  let name: string | null = null;
  if (adminId !== null) {
    const admin = Number.isInteger(adminId) ? await db.query.masterAdminsTable.findFirst({ where: eq(masterAdminsTable.id, adminId), columns: { name: true, active: true } }) : undefined;
    if (!admin?.active) return res.status(400).json({ error: "Choose an active administrator" });
    name = admin.name;
  }
  await db.update(incidentsTable).set({ assignedAdminId: adminId }).where(eq(incidentsTable.id, incident.id));
  await addEvent(incident.id, "assigned", req, name ? `Assigned to ${name}` : "Unassigned");
  await writeMasterAuditLog({ adminId: req.admin!.sub, action: "incident.assign", entity: "incident", entityId: incident.id, description: `Incident #${incident.id} ${name ? `assigned to ${name}` : "unassigned"}` });
  res.json({ ok: true });
});

router.post("/incidents/:id/note", requirePermission("incidents.manage"), async (req, res) => {
  const incident = await load(res, String(req.params.id));
  if (!incident) return;
  const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
  if (note.length < 1 || note.length > 1000) return res.status(400).json({ error: "Write a note (up to 1000 characters)" });
  await addEvent(incident.id, "note", req, note);
  res.json({ ok: true });
});

// ---- Alerts: computed live from the thresholds in Settings; nothing here is stored or invented.
router.get("/alerts", requirePermission("incidents.view"), async (_req, res) => {
  const repeated = getSetting("alerts.repeatedErrorOccurrences");
  const outageMin = getSetting("alerts.outageMinutes");
  const backlog = getSetting("alerts.syncBacklogChanges");
  const unackMin = getSetting("alerts.unacknowledgedCriticalMinutes");

  const [incidents, installs, customers] = await Promise.all([
    db.query.incidentsTable.findMany({ where: sql`${incidentsTable.status} <> 'resolved' and ${incidentsTable.severity} = 'critical'` }),
    db.query.installationsTable.findMany(),
    db.query.customersTable.findMany({ columns: { id: true, name: true, status: true } }),
  ]);
  const cust = new Map(customers.map((c) => [c.id, c]));
  const alerts: { id: string; type: string; severity: "critical" | "warning"; title: string; detail: string; link: string; since: string | null }[] = [];

  for (const i of incidents) {
    if (i.occurrences >= repeated) alerts.push({ id: `repeat-${i.id}`, type: "repeated_critical", severity: "critical", title: `Repeated critical failure: ${i.title.slice(0, 80)}`, detail: `${i.occurrences} occurrences (alert at ${repeated})`, link: `/incidents/${i.id}`, since: i.lastSeenAt.toISOString() });
    if (i.status === "new" && Date.now() - i.firstSeenAt.getTime() > unackMin * 60_000) alerts.push({ id: `unack-${i.id}`, type: "unacknowledged_critical", severity: "critical", title: `Critical incident not acknowledged: ${i.title.slice(0, 80)}`, detail: `Waiting more than ${unackMin} min`, link: `/incidents/${i.id}`, since: i.firstSeenAt.toISOString() });
  }
  for (const n of installs) {
    const c = cust.get(n.customerId);
    if (!c || c.status !== "active") continue;
    if (n.lastSeenAt && Date.now() - n.lastSeenAt.getTime() > outageMin * 60_000) alerts.push({ id: `outage-${n.id}`, type: "prolonged_outage", severity: "warning", title: `${c.name} · ${n.deviceName ?? n.installationCode} offline`, detail: `No heartbeat for more than ${outageMin} min`, link: `/installations/${n.id}`, since: n.lastSeenAt.toISOString() });
    if ((n.pendingCount ?? 0) >= backlog) alerts.push({ id: `backlog-${n.id}`, type: "sync_backlog", severity: "warning", title: `${c.name} · ${n.deviceName ?? n.installationCode} has a sync backlog`, detail: `${n.pendingCount} changes waiting (alert at ${backlog})`, link: `/installations/${n.id}`, since: null });
  }
  alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
  res.json({ alerts, thresholds: { repeated, outageMin, backlog, unackMin } });
});

export default router;
