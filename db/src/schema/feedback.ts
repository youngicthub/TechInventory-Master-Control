import { serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { masterControlSchema } from "./pg-schema";
import { customersTable } from "./customers";
import { installationsTable } from "./installations";
import { feedbackStatusEnum } from "./enums";

/**
 * Messages customers send from inside the desktop app (Settings -> Send
 * feedback). Arrives with the installation's agent token, so every message is
 * tied to a known customer and device.
 */
export const clientFeedbackTable = masterControlSchema.table(
  "client_feedback",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customersTable.id, { onDelete: "cascade" }),
    installationId: integer("installation_id").references(() => installationsTable.id, { onDelete: "set null" }),
    // Who wrote it (the signed-in person's email inside the app), if the app supplied it.
    fromEmail: text("from_email"),
    category: text("category").notNull().default("general"), // "general" | "problem" | "idea" | "praise"
    rating: integer("rating"), // 1-5, optional
    message: text("message").notNull(),
    status: feedbackStatusEnum("status").notNull().default("new"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("client_feedback_customer_idx").on(table.customerId), index("client_feedback_created_idx").on(table.createdAt)],
);

export type ClientFeedback = typeof clientFeedbackTable.$inferSelect;
