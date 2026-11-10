import { serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { masterControlSchema } from "./pg-schema";
import { masterAdminsTable } from "./admins";
import { installationsTable } from "./installations";
import { appReleasesTable } from "./releases";

/**
 * What actually happened to one release on one installation. A row is only ever created or advanced
 * by something the installation did (it asked, it downloaded, it reported success or failure, or its
 * heartbeat showed the new version) - publishing a release never marks anything "installed".
 */
export const releaseDeploymentsTable = masterControlSchema.table(
  "release_deployments",
  {
    id: serial("id").primaryKey(),
    releaseId: integer("release_id").notNull().references(() => appReleasesTable.id, { onDelete: "cascade" }),
    installationId: integer("installation_id").notNull().references(() => installationsTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("offered"), // offered | downloaded | installed | failed
    error: text("error"),
    offeredAt: timestamp("offered_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("release_deployments_unique_idx").on(t.releaseId, t.installationId),
    index("release_deployments_release_idx").on(t.releaseId),
  ],
);

/** Remote requests to an installation. They stay "queued" until the app next checks in - never reported as done early. */
export const installationCommandsTable = masterControlSchema.table(
  "installation_commands",
  {
    id: serial("id").primaryKey(),
    installationId: integer("installation_id").notNull().references(() => installationsTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // sync | diagnostics
    status: text("status").notNull().default("queued"), // queued | delivered | completed | failed
    requestedBy: integer("requested_by").references(() => masterAdminsTable.id, { onDelete: "set null" }),
    requestedAt: timestamp("requested_at").notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at"),
    completedAt: timestamp("completed_at"),
    result: text("result"), // short JSON from the app (diagnostics snapshot or an error message)
  },
  (t) => [index("installation_commands_installation_idx").on(t.installationId, t.status)],
);

export type ReleaseDeployment = typeof releaseDeploymentsTable.$inferSelect;
export type InstallationCommand = typeof installationCommandsTable.$inferSelect;
