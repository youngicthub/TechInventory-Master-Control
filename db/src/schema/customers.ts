import {
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { masterControlSchema } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { customerStatusEnum } from "./enums";

/**
 * One row per business you sell/deploy the inventory app to. Each
 * customer gets their own private Postgres database (per the "each store
 * gets its own database" decision) - that connection string lives here,
 * ENCRYPTED (see lib/crypto.ts), because this single column is the
 * literal keys to a customer's entire business data. If this table is
 * ever exposed, encryption is the only thing standing between that and
 * every customer's database being wide open.
 *
 * `licenseKey` is what the installer asks the shop owner to type in on
 * first run (see MasterControl/api/src/routes/agent.ts /activate). It's
 * shared by every till/device that business installs - multiple
 * installations, one customer, one database, matching how the inventory
 * app already works today (many logged-in staff, one shared database).
 */
export const customersTable = masterControlSchema.table(
  "customers",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    businessName: text("business_name"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    address: text("address"),
    status: customerStatusEnum("status").notNull().default("active"),
    notes: text("notes"),

    // Legacy self-service-signup field. Activation no longer returns this
    // hash; the customer creates their first local admin after activation.
    adminPasswordHash: text("admin_password_hash"),
    signupSource: text("signup_source").notNull().default("manual"), // "manual" | "app"
    approvedAt: timestamp("approved_at"),

    licenseKey: text("license_key").notNull(),
    // AES-256-GCM ciphertext of the customer's own DATABASE_URL, as
    // "iv:authTag:ciphertext" hex - see lib/crypto.ts. Null until you've
    // actually provisioned their database and set it (see routes/customers.ts).
    encryptedDatabaseUrl: text("encrypted_database_url"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("customers_license_key_idx").on(table.licenseKey)],
);

export const insertCustomerSchema = createInsertSchema(customersTable).omit({
  id: true,
  licenseKey: true,
  encryptedDatabaseUrl: true,
  adminPasswordHash: true,
  signupSource: true,
  approvedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customersTable.$inferSelect;
// What the Master App's frontend ever gets to see - the encrypted
// connection string never needs to leave the server, not even encrypted.
export type PublicCustomer = Omit<Customer, "encryptedDatabaseUrl" | "adminPasswordHash">;
