import { serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { masterControlSchema } from "./pg-schema";

/**
 * A reading of the fleet taken every few minutes by the Master itself, so the dashboard can draw
 * real connectivity / sync-backlog trends. Nothing is back-filled or invented: a chart only has
 * points from the moment the Master started recording.
 */
export const metricSnapshotsTable = masterControlSchema.table(
  "metric_snapshots",
  {
    id: serial("id").primaryKey(),
    takenAt: timestamp("taken_at").notNull().defaultNow(),
    online: integer("online").notNull().default(0),
    offline: integer("offline").notNull().default(0),
    warning: integer("warning").notNull().default(0),
    critical: integer("critical").notNull().default(0),
    unknown: integer("unknown").notNull().default(0),
    pendingChanges: integer("pending_changes").notNull().default(0),
    failedChanges: integer("failed_changes").notNull().default(0),
    conflicts: integer("conflicts").notNull().default(0),
  },
  (table) => [index("metric_snapshots_taken_idx").on(table.takenAt)],
);

export type MetricSnapshot = typeof metricSnapshotsTable.$inferSelect;
