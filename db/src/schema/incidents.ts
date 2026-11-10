import { serial, integer, text, timestamp, date, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { masterControlSchema } from "./pg-schema";
import { masterAdminsTable } from "./admins";
import { errorSeverityEnum } from "./enums";

export const INCIDENT_STATUSES = ["new", "acknowledged", "investigating", "resolved", "reopened"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/**
 * Identical (normalised) errors from any number of installations roll up into ONE incident, so the
 * same printer fault on 40 tills is a single thing to acknowledge and resolve, not 40 rows.
 */
export const incidentsTable = masterControlSchema.table(
  "incidents",
  {
    id: serial("id").primaryKey(),
    fingerprint: text("fingerprint").notNull(),
    title: text("title").notNull(),
    module: text("module"),
    severity: errorSeverityEnum("severity").notNull().default("error"),
    status: text("status").notNull().default("new"),
    assignedAdminId: integer("assigned_admin_id").references(() => masterAdminsTable.id, { onDelete: "set null" }),
    occurrences: integer("occurrences").notNull().default(1),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    lastAppVersion: text("last_app_version"),
    acknowledgedAt: timestamp("acknowledged_at"),
    resolvedAt: timestamp("resolved_at"),
    resolutionNotes: text("resolution_notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("incidents_fingerprint_idx").on(table.fingerprint),
    index("incidents_status_idx").on(table.status),
    index("incidents_last_seen_idx").on(table.lastSeenAt),
  ],
);

/** Who did what to an incident, in order (acknowledged, assigned, note, resolved, reopened...). */
export const incidentEventsTable = masterControlSchema.table(
  "incident_events",
  {
    id: serial("id").primaryKey(),
    incidentId: integer("incident_id").notNull().references(() => incidentsTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    adminId: integer("admin_id").references(() => masterAdminsTable.id, { onDelete: "set null" }),
    adminName: text("admin_name"),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("incident_events_incident_idx").on(table.incidentId)],
);

/** Occurrences per incident per day - the occurrence timeline. */
export const incidentDaysTable = masterControlSchema.table(
  "incident_days",
  {
    incidentId: integer("incident_id").notNull().references(() => incidentsTable.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.incidentId, table.day] })],
);

export type Incident = typeof incidentsTable.$inferSelect;
