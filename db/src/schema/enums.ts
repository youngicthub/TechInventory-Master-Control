import { masterControlSchema } from "./pg-schema";

// Who can log into the Master App itself (you and anyone you add) - see
// MASTERAPP.md §22. Kept to three roles for v1; the doc's distinction
// between "support" (can run approved commands) and "monitoring"
// (view-only) only matters once remote commands exist (a later phase),
// but the column is here now so adding that later doesn't need a migration.
export const masterAdminRoleEnum = masterControlSchema.enum("master_admin_role", [
  "super_admin",
  "support_admin",
  "monitoring_admin",
  // Added later (see api/src/lib/permissions.ts for exactly what each role may do):
  "platform_ops",
  "release_manager",
  "auditor",
]);

export const customerStatusEnum = masterControlSchema.enum("customer_status", [
  "active",
  "suspended",
  // Signed up from the desktop app (email + password) and waiting for you to
  // set up their database and approve them. Cannot activate until approved.
  "pending",
]);

export const feedbackStatusEnum = masterControlSchema.enum("feedback_status", [
  "new",
  "read",
  "resolved",
]);

// Derived at read time from lastSeenAt/lastHealthStatus rather than
// stored as a column - see lib/installation-status.ts. Kept here anyway
// as the canonical list of values the API can return.
export const installationStatusValues = [
  "online",
  "warning",
  "offline",
  "critical",
  "unknown",
] as const;

export const errorSeverityEnum = masterControlSchema.enum("error_severity", [
  "info",
  "warning",
  "error",
  "critical",
]);

export const errorStatusEnum = masterControlSchema.enum("error_status", [
  "open",
  "investigating",
  "resolved",
  "ignored",
]);

export const releasePlatformEnum = masterControlSchema.enum("release_platform", [
  "windows",
  "mac",
  "linux",
]);
