import { Router, type IRouter } from "express";
import { eq, and, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  customersTable,
  installationsTable,
  installationErrorsTable,
  clientFeedbackTable,
  reportErrorSchema,
  installationCommandsTable,
  releaseDeploymentsTable,
} from "@masterctl/db";
import { rateLimit } from "../lib/rate-limit";
import { requireAgentAuth } from "../middlewares/auth";
import { recordErrorOccurrence, sanitizeMessage } from "../lib/incidents";
import {
  decryptSecret,
  generateAgentToken,
  generateInstallationCode,
  hashToken,
} from "../lib/crypto";
import { writeMasterAuditLog } from "../lib/audit";
import { ensureCustomerDatabase } from "../lib/ensure-database";

const router: IRouter = Router();

const activateLimiter = rateLimit({
  name: "activate",
  windowMs: 15 * 60_000,
  max: 30,
  message: "Too many activation attempts - please wait a few minutes and try again.",
});

const activateSchema = z.object({
  licenseKey: z.string().min(1),
  deviceName: z.string().max(120).optional(),
  appVersion: z.string().max(40).optional(),
  osVersion: z.string().max(80).optional(),
});

/**
 * The ONE endpoint on this router not behind requireAgentAuth - there's
 * no installation yet to have a token for. The license key itself is the
 * credential here, exactly once; every call after this uses the
 * per-installation agent token this issues instead (see requireAgentAuth).
 *
 * This is what the desktop app's activation-code-only first-run screen calls.
 * The Master-issued code is the sole customer credential needed here;
 * customer accounts are created afterward in the activated business database.
 */
router.post("/agent/activate", activateLimiter, async (req, res) => {
  const parsed = activateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A license key is required" });

  const customer = await db.query.customersTable.findFirst({
    where: eq(customersTable.licenseKey, parsed.data.licenseKey.trim().toUpperCase()),
  });
  if (!customer) return res.status(401).json({ error: "That license key isn't recognized" });

  if (customer.status === "pending") {
    return res.status(403).json({ error: "Your account is still waiting for approval. We'll send your activation code once it's ready." });
  }
  if (customer.status !== "active") {
    return res.status(403).json({ error: "This account is suspended - contact support" });
  }
  // Entering a valid code must always work: if this customer's database hasn't been created yet, create it now.
  let encryptedDatabaseUrl: string;
  try {
    encryptedDatabaseUrl = await ensureCustomerDatabase(customer);
  } catch (err) {
    console.error("[master-api] couldn't prepare customer database for activation:", err instanceof Error ? err.message : err);
    return res.status(503).json({
      error:
        err instanceof Error && err.message.includes("MASTER_ENCRYPTION_KEY")
          ? err.message
          : "The Master couldn't prepare your database just now. Please try again in a minute (the server owner can see the reason in the Master's terminal).",
    });
  }

  let databaseUrl: string;
  try {
    databaseUrl = decryptSecret(encryptedDatabaseUrl);
  } catch (err) {
    console.error(
      `[master-api] cannot decrypt database connection for customer ${customer.id}; restore the original MASTER_ENCRYPTION_KEY or re-provision the connection`,
      err instanceof Error ? err.message : err,
    );
    return res.status(503).json({
      error:
        "The Master can't unlock this customer's database connection. Its MASTER_ENCRYPTION_KEY may have changed since the connection was saved. Restore the original key in MasterControl/.env and restart the Master, or have the administrator re-enter the database connection before activating.",
    });
  }

  const agentToken = generateAgentToken();
  const [installation] = await db
    .insert(installationsTable)
    .values({
      installationCode: generateInstallationCode(),
      customerId: customer.id,
      deviceName: parsed.data.deviceName,
      appVersion: parsed.data.appVersion,
      osVersion: parsed.data.osVersion,
      agentTokenHash: hashToken(agentToken),
      lastSeenAt: new Date(),
      lastHealthStatus: "healthy",
      lastActivatedAt: new Date(),
    })
    .returning();

  await writeMasterAuditLog({
    adminId: null,
    action: "installation.activate",
    entity: "installation",
    entityId: installation.id,
    description: `New installation activated for "${customer.name}" (${parsed.data.deviceName ?? "unnamed device"})`,
  });

  // The only time the plaintext database URL and agent token ever leave
  // this server - the app is expected to save both locally (agentToken
  // for future heartbeats, databaseUrl for its own local Postgres
  // connection, exactly like DATABASE_URL works today) and never send
  // the databaseUrl anywhere else.
  res.status(201).json({
    installationCode: installation.installationCode,
    agentToken,
    databaseUrl,
    customerName: customer.businessName ?? customer.name,
  });
});

const feedbackLimiter = rateLimit({ name: "feedback", windowMs: 60 * 60_000, max: 20, message: "Too many messages - please try again later." });
const feedbackSchema = z.object({
  message: z.string().trim().min(1, "Write a message first").max(4000),
  category: z.enum(["general", "problem", "idea", "praise"]).default("general"),
  rating: z.number().int().min(1).max(5).optional(),
  fromEmail: z.string().max(200).optional(),
});

/** A customer sending feedback from inside the app (Settings -> Send feedback). */
router.post("/agent/feedback", requireAgentAuth, feedbackLimiter, async (req, res) => {
  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid feedback" });

  const [row] = await db
    .insert(clientFeedbackTable)
    .values({
      customerId: req.installation!.customerId,
      installationId: req.installation!.id,
      fromEmail: parsed.data.fromEmail ?? null,
      category: parsed.data.category,
      rating: parsed.data.rating ?? null,
      message: parsed.data.message,
    })
    .returning();
  res.status(201).json({ received: true, id: row.id });
});

const heartbeatSchema = z.object({
  appVersion: z.string().max(40).optional(),
  osVersion: z.string().max(80).optional(),
  healthStatus: z.enum(["healthy", "error", "critical"]).optional(),
  syncStatus: z.string().max(40).optional(),
  productCount: z.number().int().min(0).optional(),
  customerCount: z.number().int().min(0).optional(),
  pendingCount: z.number().int().min(0).optional(),
  conflictCount: z.number().int().min(0).optional(),
  failedCount: z.number().int().min(0).optional(),
  lastSyncAt: z.string().max(40).nullable().optional(),
});

router.post("/agent/heartbeat", requireAgentAuth, async (req, res) => {
  const parsed = heartbeatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  await db
    .update(installationsTable)
    .set({
      lastSeenAt: new Date(),
      ...(parsed.data.appVersion ? { appVersion: parsed.data.appVersion } : {}),
      ...(parsed.data.osVersion ? { osVersion: parsed.data.osVersion } : {}),
      ...(parsed.data.healthStatus ? { lastHealthStatus: parsed.data.healthStatus } : {}),
      ...(parsed.data.syncStatus ? { lastSyncStatus: parsed.data.syncStatus } : {}),
      ...(parsed.data.productCount != null ? { productCount: parsed.data.productCount } : {}),
      ...(parsed.data.customerCount != null ? { customerCount: parsed.data.customerCount } : {}),
      ...(parsed.data.pendingCount != null ? { pendingCount: parsed.data.pendingCount } : {}),
      ...(parsed.data.conflictCount != null ? { conflictCount: parsed.data.conflictCount } : {}),
      ...(parsed.data.failedCount != null ? { failedCount: parsed.data.failedCount } : {}),
      ...(parsed.data.lastSyncAt && !Number.isNaN(Date.parse(parsed.data.lastSyncAt)) ? { lastSyncAt: new Date(parsed.data.lastSyncAt) } : {}),
    })
    .where(eq(installationsTable.id, req.installation!.id));

  // The app reporting a version that matches a build we offered it is the proof it was installed.
  if (parsed.data.appVersion) {
    await db.execute(sql`
      update master_control.release_deployments d set status = 'installed', error = null, updated_at = now()
      from master_control.app_releases r
      where d.release_id = r.id and d.installation_id = ${req.installation!.id}
        and r.version = ${parsed.data.appVersion} and d.status in ('offered', 'downloaded', 'failed')`);
  }

  // Hand over remote requests that are waiting; they count as delivered now, completed only when the app reports back.
  const waiting = await db
    .select({ id: installationCommandsTable.id, type: installationCommandsTable.type })
    .from(installationCommandsTable)
    .where(and(eq(installationCommandsTable.installationId, req.installation!.id), eq(installationCommandsTable.status, "queued")));
  if (waiting.length) {
    await db
      .update(installationCommandsTable)
      .set({ status: "delivered", deliveredAt: new Date() })
      .where(inArray(installationCommandsTable.id, waiting.map((c) => c.id)));
  }
  res.json({ acknowledged: true, commands: waiting });
});

const commandResultSchema = z.object({ id: z.number().int().positive(), ok: z.boolean(), result: z.string().max(4000).optional() });
router.post("/agent/command-result", requireAgentAuth, async (req, res) => {
  const parsed = commandResultSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid result" });
  const [row] = await db
    .update(installationCommandsTable)
    .set({ status: parsed.data.ok ? "completed" : "failed", completedAt: new Date(), result: parsed.data.result ? sanitizeMessage(parsed.data.result) : null })
    .where(and(eq(installationCommandsTable.id, parsed.data.id), eq(installationCommandsTable.installationId, req.installation!.id), eq(installationCommandsTable.status, "delivered")))
    .returning({ id: installationCommandsTable.id });
  if (!row) return res.status(404).json({ error: "No such request is waiting" });
  res.json({ acknowledged: true });
});

const updateResultSchema = z.object({ releaseId: z.number().int().positive(), status: z.enum(["downloaded", "failed"]), error: z.string().max(500).optional() });
router.post("/agent/update-result", requireAgentAuth, async (req, res) => {
  const parsed = updateResultSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid result" });
  await db
    .insert(releaseDeploymentsTable)
    .values({ releaseId: parsed.data.releaseId, installationId: req.installation!.id, status: parsed.data.status, error: parsed.data.error ? sanitizeMessage(parsed.data.error) : null })
    .onConflictDoUpdate({
      target: [releaseDeploymentsTable.releaseId, releaseDeploymentsTable.installationId],
      set: { status: sql`case when ${releaseDeploymentsTable.status} = 'installed' then 'installed' else ${parsed.data.status} end`, error: parsed.data.error ? sanitizeMessage(parsed.data.error) : null, updatedAt: new Date() },
    });
  res.json({ acknowledged: true });
});

router.post("/agent/errors", requireAgentAuth, async (req, res) => {
  const parsed = reportErrorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  // Repeats of the same fault - from this till or any other - roll up into one incident
  // (lib/incidents.ts); the message is scrubbed of secrets/paths before it is stored.
  const result = await recordErrorOccurrence(req.installation!, parsed.data);
  res.status(result.created ? 201 : 200).json({ acknowledged: true, errorId: result.errorId });
});

export default router;
