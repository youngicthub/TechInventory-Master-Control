import {
  serial,
  integer,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { masterControlSchema } from "./pg-schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { masterAdminRoleEnum } from "./enums";

// Deliberately a completely separate table from the main app's `users` -
// there is no overlap between "someone who can log into a customer's till"
// and "someone who can log into your Master App and see every customer".
export const masterAdminsTable = masterControlSchema.table(
  "master_admins",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: masterAdminRoleEnum("role").notNull().default("monitoring_admin"),
    active: boolean("active").notNull().default(true),
    // Bumped on password change, password reset, deactivation and logout -
    // every session token carries the value it was issued under, so
    // bumping this instantly invalidates all of that admin's existing
    // sessions (a stateless JWT alone can't be revoked before it expires).
    tokenVersion: integer("token_version").notNull().default(0),
    // True for accounts created by another admin (or reset by one): the
    // temporary password they were handed must be changed at first login.
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    // Brute-force protection on top of the per-IP rate limit: 5 wrong
    // passwords in a row locks this one account for 15 minutes.
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until"),
    lastLoginAt: timestamp("last_login_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("master_admins_email_idx").on(table.email)],
);

export const insertMasterAdminSchema = createInsertSchema(masterAdminsTable)
  .omit({
    id: true,
    passwordHash: true,
    tokenVersion: true,
    mustChangePassword: true,
    failedLoginCount: true,
    lockedUntil: true,
    lastLoginAt: true,
    createdAt: true,
  })
  .extend({ password: z.string().min(8) });

export type InsertMasterAdmin = z.infer<typeof insertMasterAdminSchema>;
export type MasterAdmin = typeof masterAdminsTable.$inferSelect;
// What the API ever returns about an admin - none of the credential or
// lockout bookkeeping leaves the server.
export type PublicMasterAdmin = Omit<
  MasterAdmin,
  "passwordHash" | "tokenVersion" | "failedLoginCount" | "lockedUntil"
>;

export function toPublicAdmin(admin: MasterAdmin): PublicMasterAdmin {
  const {
    passwordHash: _p,
    tokenVersion: _t,
    failedLoginCount: _f,
    lockedUntil: _l,
    ...publicAdmin
  } = admin;
  return publicAdmin;
}
