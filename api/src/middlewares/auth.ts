import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, installationsTable, customersTable, masterAdminsTable, type Installation } from "@masterctl/db";
import { verifyAdminToken, type MasterJwtPayload } from "../lib/auth";
import { hashToken } from "../lib/crypto";
import { hasPermission, type Permission } from "../lib/permissions";
import { writeMasterAuditLog } from "../lib/audit";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      admin?: MasterJwtPayload;
      installation?: Installation;
    }
  }
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

/**
 * Protects every /admin/* and management route - a logged-in Master App
 * session. The signed token alone isn't trusted: the admin is re-read from
 * the database on every request, so deactivating an account, changing its
 * role, or bumping its token version (password change / logout) takes
 * effect immediately instead of whenever the 12-hour token happens to expire.
 */
export async function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: "Missing Authorization header" });

  let payload: MasterJwtPayload;
  try {
    payload = verifyAdminToken(token);
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  const admin = await db.query.masterAdminsTable.findFirst({
    where: eq(masterAdminsTable.id, payload.sub),
    columns: { id: true, name: true, role: true, active: true, tokenVersion: true },
  });
  if (!admin || !admin.active || admin.tokenVersion !== payload.tv) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }

  // Role comes from the database, not the token, so a demotion applies at once.
  req.admin = { sub: admin.id, role: admin.role, name: admin.name, tv: admin.tokenVersion };
  next();
}

export function requireAdminRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      return res.status(403).json({ error: "You don't have permission to do that" });
    }
    next();
  };
}

/**
 * Protects /agent/heartbeat and /agent/errors (NOT /agent/activate,
 * which is the one endpoint authenticated by the license key itself
 * instead - see routes/agent.ts). The agent sends its per-installation
 * token as a Bearer token; this looks up which installation that hashes
 * to, exactly like login sessions but scoped to one device rather than
 * one admin.
 */
export async function requireAgentAuth(req: Request, res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: "Missing Authorization header" });

  const installation = await db.query.installationsTable.findFirst({
    where: eq(installationsTable.agentTokenHash, hashToken(token)),
  });
  if (!installation) return res.status(401).json({ error: "Invalid installation token" });

  if (installation.revokedAt) {
    return res.status(403).json({ error: "This device has been disabled - contact support", code: "installation_revoked" });
  }

  // Enforce account status on the server for EVERY agent call (heartbeat,
  // errors, feedback, updates) - not just at activation - so suspending a
  // customer takes effect even though their app is already activated.
  const [customer] = await db
    .select({ status: customersTable.status })
    .from(customersTable)
    .where(eq(customersTable.id, installation.customerId))
    .limit(1);
  if (!customer || customer.status !== "active") {
    return res.status(403).json({
      error: "This account is suspended - contact support",
      code: "account_suspended",
    });
  }

  req.installation = installation;
  next();
}

/**
 * Backend permission check (see lib/permissions.ts). A refused attempt is itself written to the audit
 * log, so someone probing for access they don't have leaves a trail.
 */
export function requirePermission(...permissions: Permission[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.admin && permissions.some((p) => hasPermission(req.admin!.role, p))) return next();
    if (req.admin) {
      await writeMasterAuditLog({
        adminId: req.admin.sub,
        action: "access.denied",
        outcome: "failure",
        description: `Refused ${req.method} ${req.path} - needs ${permissions.join(" or ")}`,
      });
    }
    return res.status(403).json({ error: "You don't have permission to do that", code: "forbidden" });
  };
}
