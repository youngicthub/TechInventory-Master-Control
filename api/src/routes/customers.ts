import { Router, type IRouter } from "express";
import { and, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  customersTable,
  installationsTable,
  insertCustomerSchema,
} from "@masterctl/db";
import { requireAdminAuth, requirePermission } from "../middlewares/auth";
import { encryptSecret, generateLicenseKey } from "../lib/crypto";
import { deriveInstallationStatus } from "../lib/installation-status";
import { writeMasterAuditLog } from "../lib/audit";
import { ensureCustomerDatabase } from "../lib/ensure-database";

const router: IRouter = Router();
router.use(requireAdminAuth);

function toPublicCustomer<T extends { encryptedDatabaseUrl: string | null; adminPasswordHash: string | null }>(customer: T) {
  const { encryptedDatabaseUrl: _omit, adminPasswordHash: _omitHash, ...rest } = customer;
  return { ...rest, isProvisioned: customer.encryptedDatabaseUrl != null, hasSignupAccount: customer.adminPasswordHash != null };
}

router.get("/customers", async (req, res) => {
  const { search, status } = req.query as Record<string, string | undefined>;
  const statusFilter = status === "pending" || status === "active" || status === "suspended" ? eq(customersTable.status, status) : undefined;
  const customers = await db.query.customersTable.findMany({
    where: and(
      statusFilter,
      search
        ? or(
            ilike(customersTable.name, `%${search}%`),
            ilike(customersTable.businessName, `%${search}%`),
            ilike(customersTable.contactEmail, `%${search}%`),
          )
        : undefined,
    ),
    orderBy: (t, { asc, desc: descOp }) => (statusFilter ? descOp(t.createdAt) : asc(t.name)),
  });
  res.json(customers.map(toPublicCustomer));
});

router.get("/customers/:id", async (req, res) => {
  const customer = await db.query.customersTable.findFirst({
    where: eq(customersTable.id, Number(req.params.id)),
  });
  if (!customer) return res.status(404).json({ error: "Customer not found" });

  const installations = await db.query.installationsTable.findMany({
    where: eq(installationsTable.customerId, customer.id),
    orderBy: (t, { desc: descOp }) => descOp(t.createdAt),
  });

  res.json({
    ...toPublicCustomer(customer),
    installations: installations.map((i) => ({
      ...i,
      agentTokenHash: undefined,
      status: deriveInstallationStatus(i),
    })),
  });
});

router.post("/customers", requirePermission("customers.manage"), async (req, res) => {
  const parsed = insertCustomerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const [customer] = await db
    .insert(customersTable)
    .values({ ...parsed.data, licenseKey: generateLicenseKey() })
    .returning();

  await writeMasterAuditLog({
    adminId: req.admin!.sub,
    action: "customer.create",
    entity: "customer",
    entityId: customer.id,
    description: `Added customer "${customer.name}"`,
  });

  // The license key IS shown here, on creation - this is the one point
  // where showing it plainly is expected (you're about to hand it to the
  // customer). Later reads go through GET /customers/:id/license-key,
  // which is separately audit-logged - see below.
  res.status(201).json({ ...toPublicCustomer(customer), licenseKey: customer.licenseKey });
});

router.put("/customers/:id", requirePermission("customers.manage"), async (req, res) => {
  const parsed = insertCustomerSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  // Status changes must go through /suspend or /reactivate (reason + audit).
  if (parsed.data.status !== undefined) {
    return res.status(400).json({ error: "Use the Suspend / Reactivate actions to change a customer's status (a reason is required)." });
  }

  const [customer] = await db
    .update(customersTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(customersTable.id, Number(req.params.id)))
    .returning();
  if (!customer) return res.status(404).json({ error: "Customer not found" });

  res.json(toPublicCustomer(customer));
});

// Revealing the license key is its own endpoint (rather than always
// including it in GET /customers/:id) so every time it's actually looked
// at gets its own audit trail entry, not just "someone viewed this
// customer's page".
router.get(
  "/customers/:id/license-key",
  requirePermission("customers.manage"),
  async (req, res) => {
    const customer = await db.query.customersTable.findFirst({
      where: eq(customersTable.id, Number(req.params.id)),
    });
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    await writeMasterAuditLog({
      adminId: req.admin!.sub,
      action: "customer.reveal_license_key",
      entity: "customer",
      entityId: customer.id,
      description: `Viewed the license key for "${customer.name}"`,
    });

    res.json({ licenseKey: customer.licenseKey });
  },
);

router.post(
  "/customers/:id/rotate-license-key",
  requirePermission("customers.reveal_secrets"),
  async (req, res) => {
    const newKey = generateLicenseKey();
    const [customer] = await db
      .update(customersTable)
      .set({ licenseKey: newKey, updatedAt: new Date() })
      .where(eq(customersTable.id, Number(req.params.id)))
      .returning();
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    await writeMasterAuditLog({
      adminId: req.admin!.sub,
      action: "customer.rotate_license_key",
      entity: "customer",
      entityId: customer.id,
      description: `Rotated the license key for "${customer.name}" (already-activated installations are unaffected; only new activations need the new key)`,
    });

    res.json({ licenseKey: newKey });
  },
);

// ---- Sign-up requests: approve (releases the activation code) or reject ----

router.post("/customers/:id/approve", requirePermission("signups.review"), async (req, res) => {
  const customer = await db.query.customersTable.findFirst({ where: eq(customersTable.id, Number(req.params.id)) });
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  if (customer.status === "active") return res.status(409).json({ error: "This customer is already approved." });
  // No manual database step any more: approving creates the customer's database automatically.
  try {
    await ensureCustomerDatabase(customer);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "Couldn't create the customer's database." });
  }

  const [updated] = await db
    .update(customersTable)
    .set({ status: "active", approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(customersTable.id, customer.id))
    .returning();

  await writeMasterAuditLog({
    adminId: req.admin!.sub,
    action: "customer.approve",
    entity: "customer",
    entityId: customer.id,
    description: `Approved ${customer.contactEmail ?? customer.name} and released their activation code`,
  });

  // The activation code is shown here so you can send it to them.
  res.json({ ...toPublicCustomer(updated), licenseKey: updated.licenseKey });
});

const statusReasonSchema = z.object({ reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500) });

router.post("/customers/:id/suspend", requirePermission("customers.suspend"), async (req, res) => {
  const parsed = statusReasonSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "A reason is required" });
  const [customer] = await db
    .update(customersTable)
    .set({ status: "suspended", updatedAt: new Date() })
    .where(and(eq(customersTable.id, Number(req.params.id)), eq(customersTable.status, "active")))
    .returning();
  if (!customer) return res.status(409).json({ error: "Only an active customer can be suspended" });
  await writeMasterAuditLog({
    adminId: req.admin!.sub,
    action: "customer.suspend",
    entity: "customer",
    entityId: customer.id,
    description: `Suspended ${customer.contactEmail ?? customer.name}. Reason: ${parsed.data.reason}`,
  });
  res.json(toPublicCustomer(customer));
});

router.post("/customers/:id/reactivate", requirePermission("customers.suspend"), async (req, res) => {
  const parsed = statusReasonSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "A reason is required" });
  const [customer] = await db
    .update(customersTable)
    .set({ status: "active", updatedAt: new Date() })
    .where(and(eq(customersTable.id, Number(req.params.id)), eq(customersTable.status, "suspended")))
    .returning();
  if (!customer) return res.status(409).json({ error: "Only a suspended customer can be reactivated" });
  await writeMasterAuditLog({
    adminId: req.admin!.sub,
    action: "customer.reactivate",
    entity: "customer",
    entityId: customer.id,
    description: `Reactivated ${customer.contactEmail ?? customer.name}. Reason: ${parsed.data.reason}`,
  });
  res.json(toPublicCustomer(customer));
});

router.post("/customers/:id/reject", requirePermission("signups.review"), async (req, res) => {
  const [customer] = await db
    .update(customersTable)
    .set({ status: "suspended", updatedAt: new Date() })
    .where(eq(customersTable.id, Number(req.params.id)))
    .returning();
  if (!customer) return res.status(404).json({ error: "Customer not found" });

  await writeMasterAuditLog({
    adminId: req.admin!.sub,
    action: "customer.reject",
    entity: "customer",
    entityId: customer.id,
    description: `Declined / suspended ${customer.contactEmail ?? customer.name}`,
  });
  res.json(toPublicCustomer(customer));
});

/**
 * One click, always works: makes sure this customer can activate an app right now.
 * - creates their database if it doesn't exist yet,
 * - approves them if they were still pending (or re-opens a suspended account only when asked to),
 * - returns the activation code (optionally a brand-new one that replaces the old).
 */
router.post("/customers/:id/activation-code", requirePermission("signups.review", "customers.manage"), async (req, res) => {
  const customer = await db.query.customersTable.findFirst({ where: eq(customersTable.id, Number(req.params.id)) });
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  if (customer.status === "suspended" && req.body?.reactivate !== true) {
    return res.status(409).json({ error: "This account is suspended. Reactivate it first if you want to give them a code." });
  }

  try {
    await ensureCustomerDatabase(customer);
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : "Couldn't create the customer's database." });
  }

  const rotate = req.body?.rotate === true;
  const [updated] = await db
    .update(customersTable)
    .set({
      status: "active",
      approvedAt: customer.approvedAt ?? new Date(),
      ...(rotate ? { licenseKey: generateLicenseKey() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(customersTable.id, customer.id))
    .returning();

  await writeMasterAuditLog({
    adminId: req.admin!.sub,
    action: "customer.generate_activation_code",
    entity: "customer",
    entityId: customer.id,
    description: `${rotate ? "Generated a new" : "Showed the"} activation code for "${customer.name}"`,
  });

  res.json({ ...toPublicCustomer(updated), licenseKey: updated.licenseKey });
});

const provisionSchema = z.object({
  // The full connection string for a database you've already created for
  // this customer (e.g. a fresh Neon project/database). Automatically
  // creating that database via Neon's API is a good later improvement -
  // v1 keeps that a manual step so a provisioning bug can't accidentally
  // spin up (and get billed for) infrastructure on its own.
  databaseUrl: z.string().min(1),
});

router.post(
  "/customers/:id/provision",
  requirePermission("customers.reveal_secrets"),
  async (req, res) => {
    const parsed = provisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "databaseUrl is required" });

    const [customer] = await db
      .update(customersTable)
      .set({ encryptedDatabaseUrl: encryptSecret(parsed.data.databaseUrl), updatedAt: new Date() })
      .where(eq(customersTable.id, Number(req.params.id)))
      .returning();
    if (!customer) return res.status(404).json({ error: "Customer not found" });

    await writeMasterAuditLog({
      adminId: req.admin!.sub,
      action: "customer.provision",
      entity: "customer",
      entityId: customer.id,
      // Deliberately never logs the connection string itself.
      description: `Set the database connection for "${customer.name}"`,
    });

    res.json(toPublicCustomer(customer));
  },
);

export default router;
