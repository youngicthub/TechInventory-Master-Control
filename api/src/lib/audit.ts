import { db, masterAuditLogsTable, masterAdminsTable } from "@masterctl/db";
import { eq } from "drizzle-orm";
import { currentContext } from "./request-context";

interface AuditLogInput {
  adminId: number | null;
  action: string;
  entity?: string;
  entityId?: number;
  description: string;
  /** "failure" for refused / failed attempts. Defaults to "success". */
  outcome?: "success" | "failure";
  reason?: string;
  customerId?: number;
  installationId?: number;
  /** Used for events with no signed-in admin (e.g. a failed login) so the attempt is still attributable. */
  actorEmail?: string;
}

const actorCache = new Map<number, { name: string; email: string; at: number }>();

async function actorFor(adminId: number | null) {
  if (!adminId) return null;
  const hit = actorCache.get(adminId);
  if (hit && Date.now() - hit.at < 60_000) return hit;
  const row = await db.query.masterAdminsTable.findFirst({ where: eq(masterAdminsTable.id, adminId), columns: { name: true, email: true } });
  if (!row) return null;
  const entry = { name: row.name, email: row.email, at: Date.now() };
  actorCache.set(adminId, entry);
  return entry;
}

/**
 * Appends to the audit log (the database refuses edits and deletes). A failure to log never takes
 * down the request that caused it - it's printed instead.
 */
export async function writeMasterAuditLog(input: AuditLogInput): Promise<void> {
  try {
    const ctx = currentContext();
    const actor = await actorFor(input.adminId);
    await db.insert(masterAuditLogsTable).values({
      adminId: input.adminId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      description: input.description,
      outcome: input.outcome ?? "success",
      reason: input.reason,
      customerId: input.customerId ?? (input.entity === "customer" ? input.entityId : undefined),
      installationId: input.installationId ?? (input.entity === "installation" ? input.entityId : undefined),
      correlationId: ctx?.correlationId,
      actorName: actor?.name,
      actorEmail: actor?.email ?? input.actorEmail,
      ip: ctx?.ip ?? undefined,
    });
  } catch (err) {
    console.error("Failed to write master audit log:", err);
  }
}
