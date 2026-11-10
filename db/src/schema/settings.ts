import { text, integer, timestamp } from "drizzle-orm/pg-core";
import { masterControlSchema } from "./pg-schema";
import { masterAdminsTable } from "./admins";

/** Platform-wide settings edited from the dashboard (thresholds, alert rules...). Never holds secrets. */
export const platformSettingsTable = masterControlSchema.table("platform_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON
  updatedBy: integer("updated_by").references(() => masterAdminsTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
