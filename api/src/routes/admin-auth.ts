import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, masterAdminsTable } from "@masterctl/db";
import { adminView } from "../lib/admin-view";
import {
  hashPassword,
  verifyPassword,
  burnPasswordCheck,
  validateNewPassword,
  safeEqual,
  signAdminToken,
} from "../lib/auth";
import { requireAdminAuth } from "../middlewares/auth";
import { writeMasterAuditLog } from "../lib/audit";
import { rateLimit } from "../lib/rate-limit";

const router: IRouter = Router();

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;
// Arbitrary constant - makes concurrent first-time setups run one at a time.
const SETUP_LOCK_KEY = 4_100_001;

const loginLimiter = rateLimit({
  name: "admin-login",
  windowMs: 15 * 60_000,
  max: 30,
  message: "Too many login attempts from this device - wait a few minutes and try again.",
});
const setupLimiter = rateLimit({
  name: "admin-setup",
  windowMs: 60 * 60_000,
  max: 10,
  message: "Too many setup attempts - wait an hour and try again.",
});

function cleanEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Lets the login screen know whether to offer first-time setup (only ever true until the first admin exists). */
router.get("/admin/setup-status", async (_req, res) => {
  const existing = await db.query.masterAdminsTable.findFirst({ columns: { id: true } });
  res.json({ needsSetup: !existing });
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(200),
});

router.post("/admin/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Email and password are required" });

  const email = cleanEmail(parsed.data.email);
  const admin = await db.query.masterAdminsTable.findFirst({
    where: eq(masterAdminsTable.email, email),
  });

  if (!admin) {
    await burnPasswordCheck(parsed.data.password); // same timing as a real failed check
    await writeMasterAuditLog({
      adminId: null,
      action: "admin.login_failed",
      outcome: "failure",
      actorEmail: email.slice(0, 120),
      description: `Failed login for unknown email "${email.slice(0, 120)}"`,
    });
    return res.status(401).json({ error: "Incorrect email or password" });
  }

  if (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.max(1, Math.ceil((admin.lockedUntil.getTime() - Date.now()) / 60_000));
    return res.status(429).json({
      error: `This account is temporarily locked after too many wrong passwords. Try again in ${minutes} minute(s).`,
    });
  }

  const passwordOk = await verifyPassword(parsed.data.password, admin.passwordHash);

  if (!passwordOk || !admin.active) {
    if (!passwordOk) {
      // Atomic increment so parallel guesses can't dodge the counter.
      const [updated] = await db
        .update(masterAdminsTable)
        .set({ failedLoginCount: sql`${masterAdminsTable.failedLoginCount} + 1` })
        .where(eq(masterAdminsTable.id, admin.id))
        .returning({ failedLoginCount: masterAdminsTable.failedLoginCount });

      if (updated && updated.failedLoginCount >= MAX_FAILED_LOGINS) {
        await db
          .update(masterAdminsTable)
          .set({ failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) })
          .where(eq(masterAdminsTable.id, admin.id));
      }
    }
    await writeMasterAuditLog({
      adminId: admin.id,
      action: "admin.login_failed",
      outcome: "failure",
      entity: "master_admin",
      entityId: admin.id,
      description: passwordOk
        ? `Login blocked - account for ${admin.email} is deactivated`
        : `Wrong password for ${admin.email}`,
    });
    // Same message for wrong password and deactivated account: don't reveal which.
    return res.status(401).json({ error: "Incorrect email or password" });
  }

  const [updated] = await db
    .update(masterAdminsTable)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(masterAdminsTable.id, admin.id))
    .returning();

  await writeMasterAuditLog({
    adminId: admin.id,
    action: "admin.login",
    entity: "master_admin",
    entityId: admin.id,
    description: `${admin.name} logged in`,
  });

  res.json({ token: signAdminToken(updated), admin: adminView(updated) });
});

router.get("/admin/me", requireAdminAuth, async (req, res) => {
  const admin = await db.query.masterAdminsTable.findFirst({
    where: eq(masterAdminsTable.id, req.admin!.sub),
  });
  if (!admin) return res.status(404).json({ error: "Not found" });
  res.json(adminView(admin));
});

/** Ends every session this admin has anywhere (not just this browser). */
router.post("/admin/logout", requireAdminAuth, async (req, res) => {
  await db
    .update(masterAdminsTable)
    .set({ tokenVersion: sql`${masterAdminsTable.tokenVersion} + 1` })
    .where(eq(masterAdminsTable.id, req.admin!.sub));
  await writeMasterAuditLog({ adminId: req.admin!.sub, action: "admin.logout", entity: "master_admin", entityId: req.admin!.sub, description: "Signed out (all sessions ended)" });
  res.json({ ok: true });
});

/** This admin's own recent sign-ins, failed attempts and password changes. */
router.get("/admin/login-history", requireAdminAuth, async (req, res) => {
  const me = await db.query.masterAdminsTable.findFirst({ where: eq(masterAdminsTable.id, req.admin!.sub), columns: { email: true } });
  const rows = await db.execute(sql`
    select action, outcome, description, ip, created_at as "createdAt"
    from master_control.master_audit_logs
    where (admin_id = ${req.admin!.sub} or actor_email = ${me?.email ?? ""})
      and action in ('admin.login', 'admin.login_failed', 'admin.logout', 'admin.change_password')
    order by created_at desc limit 25`);
  res.json(rows.rows);
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().max(200),
});

router.post("/admin/change-password", requireAdminAuth, loginLimiter, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Current and new password are required" });

  const policyError = validateNewPassword(parsed.data.newPassword);
  if (policyError) return res.status(400).json({ error: policyError });

  const admin = await db.query.masterAdminsTable.findFirst({
    where: eq(masterAdminsTable.id, req.admin!.sub),
  });
  if (!admin) return res.status(404).json({ error: "Not found" });

  if (!(await verifyPassword(parsed.data.currentPassword, admin.passwordHash))) {
    return res.status(400).json({ error: "Your current password is incorrect" });
  }
  if (parsed.data.newPassword === parsed.data.currentPassword) {
    return res.status(400).json({ error: "Choose a password different from your current one" });
  }

  const [updated] = await db
    .update(masterAdminsTable)
    .set({
      passwordHash: await hashPassword(parsed.data.newPassword),
      mustChangePassword: false,
      tokenVersion: sql`${masterAdminsTable.tokenVersion} + 1`, // signs out every other session
    })
    .where(eq(masterAdminsTable.id, admin.id))
    .returning();

  await writeMasterAuditLog({
    adminId: admin.id,
    action: "admin.change_password",
    entity: "master_admin",
    entityId: admin.id,
    description: `${admin.name} changed their password`,
  });

  // New token under the new version so THIS session carries on seamlessly.
  res.json({ token: signAdminToken(updated), admin: adminView(updated) });
});

const setupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  password: z.string().max(200),
  setupKey: z.string().min(1).max(200),
});

/**
 * One-time bootstrap for the very first master admin (you). Only works
 * while master_admins is empty, and requires MASTER_SETUP_KEY so it
 * can't be triggered by anyone who finds the URL - identical reasoning
 * to the main app's own /auth/setup. The empty-check and the insert run
 * inside one transaction holding an advisory lock, so two simultaneous
 * requests can't both slip through and create two super admins.
 */
router.post("/admin/setup", setupLimiter, async (req, res) => {
  const existing = await db.query.masterAdminsTable.findFirst({ columns: { id: true } });
  if (existing) return res.status(409).json({ error: "Setup has already been completed" });

  const parsed = setupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Name, a valid email, a password and the setup key are required" });
  }
  const policyError = validateNewPassword(parsed.data.password);
  if (policyError) return res.status(400).json({ error: policyError });

  const expectedKey = process.env.MASTER_SETUP_KEY;
  if (!expectedKey || !safeEqual(parsed.data.setupKey.trim(), expectedKey)) {
    return res.status(403).json({ error: "Incorrect setup key" });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const email = cleanEmail(parsed.data.email);

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SETUP_LOCK_KEY})`);
    const already = await tx.query.masterAdminsTable.findFirst({ columns: { id: true } });
    if (already) return null;
    const [created] = await tx
      .insert(masterAdminsTable)
      .values({ name: parsed.data.name, email, passwordHash, role: "super_admin", lastLoginAt: new Date() })
      .returning();
    return created;
  });

  if (!result) return res.status(409).json({ error: "Setup has already been completed" });

  await writeMasterAuditLog({
    adminId: result.id,
    action: "admin.create",
    entity: "master_admin",
    entityId: result.id,
    description: `Initial Master App admin account created for ${result.name}`,
  });

  res.status(201).json({ token: signAdminToken(result), admin: adminView(result) });
});

export default router;
