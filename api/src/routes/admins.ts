import { Router, type IRouter } from "express";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, masterAdminsTable } from "@masterctl/db";
import { adminView } from "../lib/admin-view";
import { ADMIN_ROLES } from "../lib/permissions";
import { requireAdminAuth, requirePermission } from "../middlewares/auth";
import { generateTemporaryPassword, hashPassword } from "../lib/auth";
import { writeMasterAuditLog } from "../lib/audit";

/**
 * Managing the people who can log into the Master App itself. Super admin
 * only - a support or monitoring admin can never create or promote
 * accounts. Passwords are never chosen by the creating admin: a one-time
 * temporary password is generated, shown once, and must be changed at the
 * new admin's first login (master_admins.must_change_password).
 */
const router: IRouter = Router();
router.use("/admins", requireAdminAuth, requirePermission("admins.manage"));

const roleSchema = z.enum(ADMIN_ROLES);

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Other still-active super admins besides `exceptId` - so the last one can never be removed. */
async function otherActiveSuperAdmins(exceptId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(masterAdminsTable)
    .where(
      and(
        eq(masterAdminsTable.role, "super_admin"),
        eq(masterAdminsTable.active, true),
        ne(masterAdminsTable.id, exceptId),
      ),
    );
  return row?.n ?? 0;
}

router.get("/admins", async (_req, res) => {
  const admins = await db.query.masterAdminsTable.findMany({
    orderBy: (t, { asc }) => asc(t.createdAt),
  });
  res.json(admins.map(adminView));
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  role: roleSchema,
});

router.post("/admins", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "A name, a valid email and a role are required" });

  const email = parsed.data.email.toLowerCase();
  const duplicate = await db.query.masterAdminsTable.findFirst({
    where: eq(masterAdminsTable.email, email),
    columns: { id: true },
  });
  if (duplicate) return res.status(409).json({ error: "An admin with that email already exists" });

  const temporaryPassword = generateTemporaryPassword();
  const [created] = await db
    .insert(masterAdminsTable)
    .values({
      name: parsed.data.name,
      email,
      role: parsed.data.role,
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
    })
    .returning();

  await writeMasterAuditLog({
    adminId: req.admin!.sub,
    action: "admin.create",
    entity: "master_admin",
    entityId: created.id,
    description: `Created ${created.role.replace("_", " ")} account for ${created.name} (${created.email})`,
  });

  // The only time the temporary password is ever visible.
  res.status(201).json({ admin: adminView(created), temporaryPassword });
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    role: roleSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

router.put("/admins/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid admin id" });
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Nothing valid to update" });

  const target = await db.query.masterAdminsTable.findFirst({ where: eq(masterAdminsTable.id, id) });
  if (!target) return res.status(404).json({ error: "Admin not found" });

  const losingSuperAdmin =
    target.role === "super_admin" &&
    target.active &&
    ((parsed.data.role && parsed.data.role !== "super_admin") || parsed.data.active === false);

  if (id === req.admin!.sub && (parsed.data.active === false || (parsed.data.role && parsed.data.role !== target.role))) {
    return res.status(400).json({ error: "You can't deactivate or change the role of your own account" });
  }
  if (losingSuperAdmin && (await otherActiveSuperAdmins(id)) === 0) {
    return res.status(400).json({ error: "That would leave no active super admin - promote or create another one first" });
  }

  const sessionsMustEnd = parsed.data.active === false || (parsed.data.role && parsed.data.role !== target.role);
  const [updated] = await db
    .update(masterAdminsTable)
    .set({
      ...parsed.data,
      ...(sessionsMustEnd ? { tokenVersion: sql`${masterAdminsTable.tokenVersion} + 1` } : {}),
    })
    .where(eq(masterAdminsTable.id, id))
    .returning();

  await writeMasterAuditLog({
    adminId: req.admin!.sub,
    action: "admin.update",
    entity: "master_admin",
    entityId: id,
    description: `Updated ${target.name}: ${Object.entries(parsed.data)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(", ")}`,
  });

  res.json(adminView(updated));
});

router.post("/admins/:id/reset-password", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid admin id" });
  if (id === req.admin!.sub) {
    return res.status(400).json({ error: "Use \"Change password\" for your own account" });
  }

  const temporaryPassword = generateTemporaryPassword();
  const [updated] = await db
    .update(masterAdminsTable)
    .set({
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
      failedLoginCount: 0,
      lockedUntil: null,
      tokenVersion: sql`${masterAdminsTable.tokenVersion} + 1`,
    })
    .where(eq(masterAdminsTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Admin not found" });

  await writeMasterAuditLog({
    adminId: req.admin!.sub,
    action: "admin.reset_password",
    entity: "master_admin",
    entityId: id,
    description: `Reset the password for ${updated.name}`,
  });

  res.json({ admin: adminView(updated), temporaryPassword });
});

// Ends every session another admin has (they must sign in again). Does not change their password.
router.post("/admins/:id/revoke-sessions", async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid admin id" });
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (reason.length < 3) return res.status(400).json({ error: "Give a reason (at least 3 characters)" });
  const [updated] = await db
    .update(masterAdminsTable)
    .set({ tokenVersion: sql`${masterAdminsTable.tokenVersion} + 1` })
    .where(eq(masterAdminsTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Admin not found" });
  await writeMasterAuditLog({ adminId: req.admin!.sub, action: "admin.revoke_sessions", entity: "master_admin", entityId: id, reason, description: `Ended all sessions for ${updated.name}` });
  res.json({ ok: true });
});

export default router;
