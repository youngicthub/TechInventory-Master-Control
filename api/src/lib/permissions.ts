/**
 * What each Master role may do. The backend checks these on every request (requirePermission);
 * the dashboard only uses them to hide buttons that would be refused anyway.
 */
export const ALL_PERMISSIONS = [
  "customers.view", "customers.manage", "customers.suspend", "customers.reveal_secrets",
  "signups.review",
  "installations.view", "installations.diagnostics", "installations.sync", "installations.revoke",
  "incidents.view", "incidents.manage",
  "feedback.view", "feedback.manage",
  "releases.view", "releases.publish", "releases.rollback",
  "admins.manage",
  "audit.view", "audit.export",
  "settings.view", "settings.manage",
] as const;
export type Permission = (typeof ALL_PERMISSIONS)[number];

const VIEW: Permission[] = ["customers.view", "installations.view", "incidents.view", "feedback.view", "releases.view", "settings.view"];

export const ADMIN_ROLES = ["super_admin", "support_admin", "platform_ops", "release_manager", "monitoring_admin", "auditor"] as const;
export type AdminRoleName = (typeof ADMIN_ROLES)[number];

export const ROLE_PERMISSIONS: Record<AdminRoleName, Permission[]> = {
  super_admin: [...ALL_PERMISSIONS],
  // Customer Support: people and their problems; cannot touch releases, admins or platform settings.
  support_admin: [
    "customers.view", "customers.manage", "customers.suspend", "signups.review",
    "installations.view", "installations.diagnostics", "installations.sync",
    "incidents.view", "incidents.manage", "feedback.view", "feedback.manage", "releases.view", "settings.view",
  ],
  // Platform Operations: keeps the fleet healthy; may revoke installations and tune thresholds.
  platform_ops: [
    "customers.view", "installations.view", "installations.diagnostics", "installations.sync", "installations.revoke",
    "incidents.view", "incidents.manage", "feedback.view", "releases.view", "audit.view", "settings.view", "settings.manage",
  ],
  // Release Manager: ships and rolls back software; nothing about customer accounts.
  release_manager: ["customers.view", "installations.view", "incidents.view", "releases.view", "releases.publish", "releases.rollback", "settings.view"],
  // Read-only monitoring (kept from the original three roles).
  monitoring_admin: [...VIEW],
  // Read-only Auditor: sees everything including the audit log, changes nothing.
  auditor: [...VIEW, "audit.view", "audit.export"],
};

export const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super administrator",
  platform_ops: "Platform operations",
  support_admin: "Customer support",
  release_manager: "Release manager",
  monitoring_admin: "Monitoring (view only)",
  auditor: "Read-only auditor",
};


export function permissionsFor(role: string): Permission[] {
  return ROLE_PERMISSIONS[role as AdminRoleName] ?? [];
}
export function hasPermission(role: string, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}
