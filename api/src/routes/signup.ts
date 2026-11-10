import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, customersTable } from "@masterctl/db";
import { burnPasswordCheck, hashPassword, verifyPassword } from "../lib/auth";
import { generateLicenseKey } from "../lib/crypto";
import { writeMasterAuditLog } from "../lib/audit";
import { rateLimit } from "../lib/rate-limit";

/**
 * Self-service sign-up from the desktop app. Anyone who downloaded the app can
 * ask for an account with just an email and a password. That creates a PENDING
 * customer: nothing is provisioned and no activation code is released until a
 * Master admin sets up their database and approves them (routes/customers.ts).
 */
const router: IRouter = Router();

const signupLimiter = rateLimit({
  name: "signup",
  windowMs: 60 * 60_000,
  max: 10,
  message: "Too many sign-up attempts from this computer - please try again later.",
});
const statusLimiter = rateLimit({
  name: "signup-status",
  windowMs: 15 * 60_000,
  max: 30,
  message: "Too many attempts - please wait a few minutes.",
});

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    // bcrypt silently ignores everything past 72 bytes - refuse instead of weakening quietly.
    .refine((p) => Buffer.byteLength(p, "utf8") <= 72, "Password must be at most 72 characters"),
});

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Check the details and try again.";
}

const findByEmail = (email: string) =>
  db.query.customersTable.findFirst({ where: sql`lower(${customersTable.contactEmail}) = ${email}` });

router.post("/public/signup", signupLimiter, async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error) });
  const { email, password } = parsed.data;

  if (await findByEmail(email)) {
    return res.status(409).json({
      error: "That email is already registered. Contact your Master Control administrator for an activation code.",
    });
  }

  const deviceName = typeof req.body?.deviceName === "string" ? req.body.deviceName.slice(0, 120) : null;
  const [customer] = await db
    .insert(customersTable)
    .values({
      name: email,
      contactEmail: email,
      status: "pending",
      signupSource: "app",
      adminPasswordHash: await hashPassword(password),
      licenseKey: generateLicenseKey(),
      notes: deviceName ? `Signed up from device: ${deviceName}` : null,
    })
    .returning();

  await writeMasterAuditLog({
    adminId: null,
    action: "signup.request",
    entity: "customer",
    entityId: customer.id,
    description: `New sign-up request from ${email}`,
  });

  res.status(201).json({ status: "pending" });
});

/** "Has my request been approved yet?" - never reveals the activation code; that comes from you. */
router.post("/public/signup/status", statusLimiter, async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: firstIssue(parsed.error) });
  const { email, password } = parsed.data;

  const customer = await findByEmail(email);
  if (!customer?.adminPasswordHash) {
    await burnPasswordCheck(password);
    return res.status(401).json({ error: "We couldn't find a sign-up with that email and password." });
  }
  if (!(await verifyPassword(password, customer.adminPasswordHash))) {
    return res.status(401).json({ error: "We couldn't find a sign-up with that email and password." });
  }

  res.json({
    status: customer.status, // "pending" | "active" | "suspended"
    message:
      customer.status === "pending"
        ? "Your request is waiting for approval. We'll send you an activation code as soon as your account is ready."
        : customer.status === "active"
          ? "You're approved. Enter the activation code we sent you."
          : "This account has been suspended. Please contact support.",
  });
});

export default router;
