import { Router, type IRouter } from "express";
import { and, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { db, masterAuditLogsTable, masterAdminsTable } from "@masterctl/db";
import { requireAdminAuth, requirePermission } from "../middlewares/auth";
import { writeMasterAuditLog } from "../lib/audit";

const router: IRouter = Router();
router.use("/audit-logs", requireAdminAuth);

const like = (v: string) => `%${v.replace(/[%_\\]/g, "\\$&")}%`;

function filters(q: Record<string, unknown>): SQL | undefined {
  const str = (k: string) => (typeof q[k] === "string" ? (q[k] as string).trim() : "");
  const num = (k: string) => (Number.isInteger(Number(q[k])) && Number(q[k]) > 0 ? Number(q[k]) : null);
  const c: (SQL | undefined)[] = [];
  if (str("action")) c.push(ilike(masterAuditLogsTable.action, `${str("action").replace(/[%_\\]/g, "\\$&")}%`));
  if (num("adminId")) c.push(eq(masterAuditLogsTable.adminId, num("adminId")!));
  if (str("outcome") === "success" || str("outcome") === "failure") c.push(eq(masterAuditLogsTable.outcome, str("outcome")));
  if (str("entity")) c.push(eq(masterAuditLogsTable.entity, str("entity")));
  if (num("customerId")) c.push(eq(masterAuditLogsTable.customerId, num("customerId")!));
  if (num("installationId")) c.push(eq(masterAuditLogsTable.installationId, num("installationId")!));
  if (str("correlationId")) c.push(eq(masterAuditLogsTable.correlationId, str("correlationId")));
  const from = str("from"), to = str("to");
  if (from && !Number.isNaN(Date.parse(from))) c.push(gte(masterAuditLogsTable.createdAt, new Date(from)));
  if (to && !Number.isNaN(Date.parse(to))) c.push(lte(masterAuditLogsTable.createdAt, new Date(new Date(to).getTime() + 86_400_000 - 1)));
  if (str("search")) {
    const t = like(str("search"));
    c.push(or(ilike(masterAuditLogsTable.description, t), ilike(masterAuditLogsTable.reason, t), ilike(masterAuditLogsTable.actorEmail, t)));
  }
  const real = c.filter((x): x is SQL => x !== undefined);
  return real.length ? and(...real) : undefined;
}

const columns = {
  id: masterAuditLogsTable.id,
  action: masterAuditLogsTable.action,
  entity: masterAuditLogsTable.entity,
  entityId: masterAuditLogsTable.entityId,
  description: masterAuditLogsTable.description,
  createdAt: masterAuditLogsTable.createdAt,
  adminId: masterAuditLogsTable.adminId,
  adminName: sql<string | null>`coalesce(${masterAdminsTable.name}, ${masterAuditLogsTable.actorName})`,
  actorEmail: masterAuditLogsTable.actorEmail,
  outcome: masterAuditLogsTable.outcome,
  reason: masterAuditLogsTable.reason,
  customerId: masterAuditLogsTable.customerId,
  installationId: masterAuditLogsTable.installationId,
  correlationId: masterAuditLogsTable.correlationId,
  ip: masterAuditLogsTable.ip,
};

/** Newest first, paged (page/pageSize) with a total. Filters: action prefix, adminId, outcome, entity, customerId, installationId, from/to, search. */
router.get("/audit-logs", requirePermission("audit.view"), async (req, res) => {
  const pageSize = Math.min(Math.max(Number(req.query.pageSize ?? req.query.limit) || 50, 1), 200);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const where = filters(req.query);

  const [rows, [{ total }]] = await Promise.all([
    db.select(columns).from(masterAuditLogsTable)
      .leftJoin(masterAdminsTable, eq(masterAuditLogsTable.adminId, masterAdminsTable.id))
      .where(where).orderBy(desc(masterAuditLogsTable.id)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(masterAuditLogsTable).where(where),
  ]);
  res.json({ rows, total, page, pageSize });
});

function csvCell(v: unknown): string {
  let s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  // Stop spreadsheet formula injection from text that came from outside (e.g. a typed email at login).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Controlled export: needs audit.export, honours the same filters, capped at 10,000 rows, and is itself audited. */
router.get("/audit-logs/export", requirePermission("audit.export"), async (req, res) => {
  const rows = await db.select(columns).from(masterAuditLogsTable)
    .leftJoin(masterAdminsTable, eq(masterAuditLogsTable.adminId, masterAdminsTable.id))
    .where(filters(req.query)).orderBy(desc(masterAuditLogsTable.id)).limit(10_000);
  await writeMasterAuditLog({ adminId: req.admin!.sub, action: "audit.export", description: `Exported ${rows.length} audit entries`, });
  const header = ["id", "time", "actor", "actor_email", "action", "outcome", "entity", "entity_id", "customer_id", "installation_id", "description", "reason", "correlation_id", "ip"];
  const lines = rows.map((r) => [r.id, r.createdAt, r.adminName, r.actorEmail, r.action, r.outcome, r.entity, r.entityId, r.customerId, r.installationId, r.description, r.reason, r.correlationId, r.ip].map(csvCell).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send([header.join(","), ...lines].join("\n"));
});

export default router;
