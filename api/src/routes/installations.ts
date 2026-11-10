import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  installationsTable,
  installationErrorsTable,
  customersTable,
  installationCommandsTable,
  releaseDeploymentsTable,
  appReleasesTable,
} from "@masterctl/db";
import { requireAdminAuth, requirePermission } from "../middlewares/auth";
import { writeMasterAuditLog } from "../lib/audit";
import { hasPermission } from "../lib/permissions";
import { deriveInstallationStatus } from "../lib/installation-status";

const router: IRouter = Router();
router.use(requireAdminAuth);

router.get("/installations", requirePermission("installations.view"), async (_req, res) => {
  const installations = await db.query.installationsTable.findMany({
    orderBy: (t, { desc: descOp }) => descOp(t.lastSeenAt),
  });
  const customers = await db.query.customersTable.findMany();
  const customerName = new Map(customers.map((c) => [c.id, c.name]));

  res.json(
    installations.map((i) => ({
      id: i.id,
      installationCode: i.installationCode,
      customerId: i.customerId,
      customerName: customerName.get(i.customerId) ?? "Unknown",
      deviceName: i.deviceName,
      appVersion: i.appVersion,
      osVersion: i.osVersion,
      lastSeenAt: i.lastSeenAt,
      lastHealthStatus: i.lastHealthStatus,
      lastSyncStatus: i.lastSyncStatus,
      productCount: i.productCount,
      customerCount: i.customerCount,
      pendingCount: i.pendingCount,
      conflictCount: i.conflictCount,
      failedCount: i.failedCount,
      lastSyncAt: i.lastSyncAt,
      revokedAt: i.revokedAt,
      createdAt: i.createdAt,
      status: deriveInstallationStatus(i),
    })),
  );
});

router.get("/installations/:id", requirePermission("installations.view"), async (req, res) => {
  const installation = await db.query.installationsTable.findFirst({
    where: eq(installationsTable.id, Number(req.params.id)),
  });
  if (!installation) return res.status(404).json({ error: "Installation not found" });

  const customer = await db.query.customersTable.findFirst({
    where: eq(customersTable.id, installation.customerId),
  });

  res.json({
    ...installation,
    agentTokenHash: undefined,
    status: deriveInstallationStatus(installation),
    customerName: customer?.name ?? "Unknown",
  });
});

router.get("/installations/:id/errors", requirePermission("installations.view"), async (req, res) => {
  const errors = await db.query.installationErrorsTable.findMany({
    where: eq(installationErrorsTable.installationId, Number(req.params.id)),
    orderBy: (t, { desc: descOp }) => descOp(t.lastSeenAt),
  });
  res.json(errors);
});

function installationId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const reasonSchema = z.object({ reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500) });

// Disable a device: every call from that app is refused until it is restored. The app keeps its local data.
router.post("/installations/:id/revoke", requirePermission("installations.revoke"), async (req, res) => {
  const id = installationId(req.params.id);
  const parsed = reasonSchema.safeParse(req.body);
  if (!id || !parsed.success) return res.status(400).json({ error: parsed.success ? "Invalid installation" : parsed.error.issues[0]?.message });
  const [row] = await db
    .update(installationsTable)
    .set({ revokedAt: new Date(), revokedReason: parsed.data.reason })
    .where(and(eq(installationsTable.id, id), sql`${installationsTable.revokedAt} is null`))
    .returning({ id: installationsTable.id, code: installationsTable.installationCode, customerId: installationsTable.customerId });
  if (!row) return res.status(409).json({ error: "Installation not found or already disabled" });
  await writeMasterAuditLog({ adminId: req.admin!.sub, action: "installation.revoke", entity: "installation", entityId: id, customerId: row.customerId, installationId: id, reason: parsed.data.reason, description: `Disabled ${row.code}` });
  res.json({ ok: true });
});

router.post("/installations/:id/restore", requirePermission("installations.revoke"), async (req, res) => {
  const id = installationId(req.params.id);
  const parsed = reasonSchema.safeParse(req.body);
  if (!id || !parsed.success) return res.status(400).json({ error: parsed.success ? "Invalid installation" : parsed.error.issues[0]?.message });
  const [row] = await db
    .update(installationsTable)
    .set({ revokedAt: null, revokedReason: null })
    .where(and(eq(installationsTable.id, id), sql`${installationsTable.revokedAt} is not null`))
    .returning({ id: installationsTable.id, code: installationsTable.installationCode, customerId: installationsTable.customerId });
  if (!row) return res.status(409).json({ error: "Installation not found or not disabled" });
  await writeMasterAuditLog({ adminId: req.admin!.sub, action: "installation.restore", entity: "installation", entityId: id, customerId: row.customerId, installationId: id, reason: parsed.data.reason, description: `Re-enabled ${row.code}` });
  res.json({ ok: true });
});

// ---- Remote requests. They wait in a queue until the app next checks in; nothing is "done" until the app says so.
const commandSchema = z.object({ type: z.enum(["sync", "diagnostics"]) });

router.post("/installations/:id/commands", async (req, res) => {
  const id = installationId(req.params.id);
  const parsed = commandSchema.safeParse(req.body);
  if (!id || !parsed.success) return res.status(400).json({ error: "Choose sync or diagnostics" });
  const needed = parsed.data.type === "sync" ? "installations.sync" : "installations.diagnostics";
  if (!hasPermission(req.admin!.role, needed)) {
    await writeMasterAuditLog({ adminId: req.admin!.sub, action: "access.denied", outcome: "failure", description: `Refused ${parsed.data.type} request - needs ${needed}` });
    return res.status(403).json({ error: "You don't have permission to do that", code: "forbidden" });
  }
  const installation = await db.query.installationsTable.findFirst({ where: eq(installationsTable.id, id) });
  if (!installation) return res.status(404).json({ error: "Installation not found" });
  if (installation.revokedAt) return res.status(409).json({ error: "This device is disabled - re-enable it first." });
  const open = await db.query.installationCommandsTable.findFirst({
    where: and(eq(installationCommandsTable.installationId, id), eq(installationCommandsTable.type, parsed.data.type), inArray(installationCommandsTable.status, ["queued", "delivered"])),
  });
  if (open) return res.status(409).json({ error: "The same request is already waiting for this device.", command: open });
  const [command] = await db.insert(installationCommandsTable).values({ installationId: id, type: parsed.data.type, requestedBy: req.admin!.sub }).returning();
  const status = deriveInstallationStatus(installation);
  await writeMasterAuditLog({ adminId: req.admin!.sub, action: `installation.${parsed.data.type}_requested`, entity: "installation", entityId: id, customerId: installation.customerId, installationId: id, description: `Requested ${parsed.data.type} on ${installation.installationCode}` });
  res.status(202).json({
    command,
    deviceStatus: status,
    note: status === "online" ? "Queued - the app picks it up at its next check-in (within about 30 seconds)." : "Queued - this device is not online right now. It will run when the app next checks in.",
  });
});

router.get("/installations/:id/commands", requirePermission("installations.view"), async (req, res) => {
  const id = installationId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid installation" });
  res.json(await db.select().from(installationCommandsTable).where(eq(installationCommandsTable.installationId, id)).orderBy(desc(installationCommandsTable.requestedAt)).limit(20));
});

router.get("/installations/:id/deployments", requirePermission("installations.view"), async (req, res) => {
  const id = installationId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid installation" });
  res.json(
    await db
      .select({ version: appReleasesTable.version, platform: appReleasesTable.platform, status: releaseDeploymentsTable.status, error: releaseDeploymentsTable.error, updatedAt: releaseDeploymentsTable.updatedAt })
      .from(releaseDeploymentsTable)
      .innerJoin(appReleasesTable, eq(appReleasesTable.id, releaseDeploymentsTable.releaseId))
      .where(eq(releaseDeploymentsTable.installationId, id))
      .orderBy(desc(releaseDeploymentsTable.updatedAt))
      .limit(20),
  );
});

export default router;
