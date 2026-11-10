import {
  serial,
  integer,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { masterControlSchema } from "./pg-schema";
import { customersTable } from "./customers";

/**
 * One row per device that has activated the inventory app (a customer
 * with 3 tills has 3 rows here, all pointing at the same customerId).
 *
 * Status (online/warning/offline/critical) is deliberately NOT a stored
 * column - it's derived from lastSeenAt/lastHealthStatus at read time
 * (see api/src/lib/installation-status.ts). A stored status column would
 * go stale the moment a heartbeat stops arriving (e.g. the PC was simply
 * turned off) unless something actively swept and updated it - deriving
 * it on read is always correct with zero extra work.
 */
export const installationsTable = masterControlSchema.table(
  "installations",
  {
    id: serial("id").primaryKey(),
    // Public-facing ID shown in the Master App, e.g. "INS-8F72A91D" -
    // separate from the internal serial `id` so it can be shown to a
    // customer over the phone without exposing row counts.
    installationCode: text("installation_code").notNull(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customersTable.id, { onDelete: "cascade" }),
    deviceName: text("device_name"),
    appVersion: text("app_version"),
    osVersion: text("os_version"),
    // sha256 of the per-installation secret issued at activation (see
    // routes/agent.ts). The agent sends this secret as a Bearer token on
    // every heartbeat/error call afterwards instead of resending the
    // license key - a compromised agent token only exposes one device,
    // not the whole customer's license.
    agentTokenHash: text("agent_token_hash").notNull(),

    lastSeenAt: timestamp("last_seen_at"),
    lastHealthStatus: text("last_health_status"), // "healthy" | "error" | null (never checked in yet)
    lastSyncStatus: text("last_sync_status"),

    // Live numbers reported by the app on every heartbeat (see routes/agent.ts) - what the
    // Installations screen shows so you can see at a glance that a till is complete and in step.
    productCount: integer("product_count"),
    customerCount: integer("customer_count"),
    pendingCount: integer("pending_count"), // changes saved on the till but not yet in the database
    conflictCount: integer("conflict_count"),
    failedCount: integer("failed_count"),
    lastSyncAt: timestamp("last_sync_at"), // last time the till finished a successful sync
    lastActivatedAt: timestamp("last_activated_at"),
    // Set when an admin revokes this device: it is refused by every agent call until restored.
    revokedAt: timestamp("revoked_at"),
    revokedReason: text("revoked_reason"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("installations_code_idx").on(table.installationCode),
    index("installations_customer_idx").on(table.customerId),
  ],
);

export type Installation = typeof installationsTable.$inferSelect;
export type PublicInstallation = Omit<Installation, "agentTokenHash">;
