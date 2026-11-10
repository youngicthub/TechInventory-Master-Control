import {
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { masterControlSchema } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { installationsTable } from "./installations";
import { masterAdminsTable } from "./admins";
import { errorSeverityEnum, errorStatusEnum } from "./enums";

/**
 * Application errors reported by an installed app (see routes/agent.ts's
 * POST /agent/errors). Repeated identical errors from the same
 * installation increment `occurrences` and bump `lastSeenAt` rather than
 * creating a new row each time, so a spammy recurring error doesn't
 * flood the Errors screen - see the upsert logic in routes/agent.ts.
 */
export const installationErrorsTable = masterControlSchema.table(
  "installation_errors",
  {
    id: serial("id").primaryKey(),
    installationId: integer("installation_id")
      .notNull()
      .references(() => installationsTable.id, { onDelete: "cascade" }),
    module: text("module"), // e.g. "Checkout", "Sync" - whatever the app names its own subsystem
    severity: errorSeverityEnum("severity").notNull().default("error"),
    message: text("message").notNull(),
    status: errorStatusEnum("status").notNull().default("open"),
    occurrences: integer("occurrences").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    // The incident (grouped across installations) this occurrence belongs to - see schema/incidents.ts.
    incidentId: integer("incident_id"),
  },
  (table) => [
    index("installation_errors_incident_idx").on(table.incidentId),
    index("installation_errors_installation_idx").on(table.installationId),
    index("installation_errors_status_idx").on(table.status),
  ],
);

export const reportErrorSchema = z.object({
  module: z.string().max(100).optional(),
  severity: z.enum(["info", "warning", "error", "critical"]).default("error"),
  // Deliberately a short cap - this is meant to be "Synchronization
  // failed: timeout", not a full stack trace with file paths, which
  // could leak more about a customer's machine than needed to diagnose
  // from the Master App (MASTERAPP.md §12's "don't log more than
  // necessary" principle).
  message: z.string().min(1).max(500),
});

export type InstallationError = typeof installationErrorsTable.$inferSelect;

/**
 * Every administrative action taken in the Master App - append-only from
 * the normal admin interface (MASTERAPP.md §21/§25).
 */
export const masterAuditLogsTable = masterControlSchema.table(
  "master_audit_logs",
  {
    id: serial("id").primaryKey(),
    adminId: integer("admin_id").references(() => masterAdminsTable.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(), // e.g. "customer.create", "customer.reveal_license_key"
    entity: text("entity"), // e.g. "customer", "installation"
    entityId: integer("entity_id"),
    description: text("description").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    // "success" | "failure" - a refused or failed attempt is recorded too.
    outcome: text("outcome").notNull().default("success"),
    // Why a sensitive action was taken (suspension, rollback...). Required by the routes that need one.
    reason: text("reason"),
    customerId: integer("customer_id"),
    installationId: integer("installation_id"),
    // Ties together everything written while handling one request (also returned as X-Request-Id).
    correlationId: text("correlation_id"),
    // Snapshot of who acted, so history stays readable even if the account is later removed.
    actorName: text("actor_name"),
    actorEmail: text("actor_email"),
    ip: text("ip"),
  },
  (table) => [
    index("master_audit_logs_created_idx").on(table.createdAt),
    index("master_audit_logs_action_idx").on(table.action),
    index("master_audit_logs_admin_idx").on(table.adminId),
    index("master_audit_logs_customer_idx").on(table.customerId),
    index("master_audit_logs_installation_idx").on(table.installationId),
  ],
);

export type MasterAuditLog = typeof masterAuditLogsTable.$inferSelect;
