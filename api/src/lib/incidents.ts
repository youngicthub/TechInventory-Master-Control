import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, incidentsTable, incidentEventsTable, incidentDaysTable, installationErrorsTable, type Installation } from "@masterctl/db";
import { and, eq } from "drizzle-orm";

/** Strips anything that looks like a secret or personal path before an error is stored or shown. */
export function sanitizeMessage(raw: string): string {
  return raw
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]")
    .replace(/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, "[redacted-token]")
    .replace(/(bearer\s+)[\w.\-+/=]+/gi, "$1[redacted]")
    .replace(/\b(password|passwd|pwd|token|secret|api[_-]?key|authorization|license[_-]?key|database[_-]?url)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi, "$1$2[redacted]")
    .replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, "[redacted]")
    .replace(/([A-Za-z]:\\Users\\)[^\\\s]+/gi, "$1[user]")
    .replace(/(\/(?:home|Users)\/)[^/\s]+/g, "$1[user]")
    .slice(0, 500);
}

/** Same fault, different numbers/ids/paths -> same fingerprint, so occurrences group into one incident. */
export function fingerprintOf(module: string | null | undefined, message: string): string {
  const normalised = message
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "#")
    .replace(/0x[0-9a-f]+/g, "#")
    .replace(/\d+(\.\d+)*/g, "#")
    .replace(/"[^"]*"|'[^']*'/g, "'…'")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha1").update(`${(module ?? "").toLowerCase()}|${normalised}`).digest("hex").slice(0, 24);
}

const RANK = { info: 0, warning: 1, error: 2, critical: 3 } as const;
type Severity = keyof typeof RANK;

export const TRANSITIONS: Record<string, string[]> = {
  new: ["acknowledged", "investigating", "resolved"],
  acknowledged: ["investigating", "resolved"],
  investigating: ["acknowledged", "resolved"],
  reopened: ["acknowledged", "investigating", "resolved"],
  resolved: ["reopened"],
};

/**
 * Records one error report from an installation: groups it into an incident (creating or re-opening
 * it as needed), keeps the per-installation row, and bumps the daily occurrence counter.
 */
export async function recordErrorOccurrence(installation: Installation, input: { module?: string | null; severity: Severity; message: string }) {
  const message = sanitizeMessage(input.message);
  const module = input.module ? sanitizeMessage(input.module).slice(0, 100) : null;
  const fingerprint = fingerprintOf(module, message);

  return db.transaction(async (tx) => {
    // Create-or-fetch the incident atomically (the unique fingerprint index settles any race).
    const inserted = await tx
      .insert(incidentsTable)
      .values({ fingerprint, title: message, module, severity: input.severity, lastAppVersion: installation.appVersion })
      .onConflictDoNothing()
      .returning();
    let incident = inserted[0];
    let reopened = false;
    if (!incident) {
      const [existing] = await tx.select().from(incidentsTable).where(eq(incidentsTable.fingerprint, fingerprint)).for("update");
      reopened = existing.status === "resolved";
      const severity = RANK[input.severity] > RANK[existing.severity as Severity] ? input.severity : existing.severity;
      [incident] = await tx
        .update(incidentsTable)
        .set({
          occurrences: sql`${incidentsTable.occurrences} + 1`,
          lastSeenAt: new Date(),
          severity,
          lastAppVersion: installation.appVersion ?? existing.lastAppVersion,
          ...(reopened ? { status: "reopened", resolvedAt: null } : {}),
        })
        .where(eq(incidentsTable.id, existing.id))
        .returning();
    } else {
      await tx.insert(incidentEventsTable).values({ incidentId: incident.id, kind: "created", note: `First reported by ${installation.deviceName ?? installation.installationCode}` });
    }
    if (reopened) await tx.insert(incidentEventsTable).values({ incidentId: incident.id, kind: "reopened", note: "Occurred again after being resolved" });

    await tx
      .insert(incidentDaysTable)
      .values({ incidentId: incident.id, day: sql`current_date` as unknown as string, count: 1 })
      .onConflictDoUpdate({ target: [incidentDaysTable.incidentId, incidentDaysTable.day], set: { count: sql`${incidentDaysTable.count} + 1` } });

    // Per-installation row: collapse repeats from the same till into one row.
    const [row] = await tx
      .select()
      .from(installationErrorsTable)
      .where(and(eq(installationErrorsTable.installationId, installation.id), eq(installationErrorsTable.incidentId, incident.id), eq(installationErrorsTable.status, "open")))
      .limit(1);
    if (row) {
      await tx.update(installationErrorsTable).set({ occurrences: row.occurrences + 1, lastSeenAt: new Date(), severity: RANK[input.severity] > RANK[row.severity as Severity] ? input.severity : row.severity }).where(eq(installationErrorsTable.id, row.id));
      return { errorId: row.id, incidentId: incident.id, created: false };
    }
    const [created] = await tx
      .insert(installationErrorsTable)
      .values({ installationId: installation.id, module, severity: input.severity, message, incidentId: incident.id })
      .returning();
    return { errorId: created.id, incidentId: incident.id, created: true };
  });
}
