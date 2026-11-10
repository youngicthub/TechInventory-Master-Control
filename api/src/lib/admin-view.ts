import { toPublicAdmin, type MasterAdmin } from "@masterctl/db";
import { permissionsFor, ROLE_LABELS } from "./permissions";

/** An admin as the dashboard sees them: no credentials, plus what their role may do. */
export function adminView(admin: MasterAdmin) {
  return { ...toPublicAdmin(admin), roleLabel: ROLE_LABELS[admin.role] ?? admin.role, permissions: permissionsFor(admin.role) };
}
