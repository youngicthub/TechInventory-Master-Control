// Incidents: grouping, lifecycle rules, secrets scrubbed, audit; roles enforced by the backend.
import { call, check, failures, adminToken, makeInstallation, heartbeat } from "./lib.mjs";
const token = await adminToken();
check("admin token", !!token);

const a = await makeInstallation(token, "IncA");
const b = await makeInstallation(token, "IncB");
const err = (agent, message, severity = "error") => call("POST", "/agent/errors", { module: "Sync", severity, message }, agent);

await err(a.agent, "Sync failed: timeout after 30 seconds for order 1001");
await err(a.agent, "Sync failed: timeout after 45 seconds for order 2002");
await err(b.agent, "Sync failed: timeout after 12 seconds for order 3");
const secret = await err(a.agent, "Cannot connect postgres://admin:SuperSecret99@db.example.com/app password=hunter2", "critical");
check("error report accepted", secret.status === 201, JSON.stringify(secret));

const list = await call("GET", "/incidents?status=active", null, token);
const rows = list.body?.rows ?? [];
const timeout = rows.find((r) => /timeout after/i.test(r.title));
check("repeated errors grouped into one incident", rows.filter((r) => /timeout after/i.test(r.title)).length === 1, JSON.stringify(rows.map((r) => r.title)));
check("occurrences counted (3)", timeout?.occurrences === 3, JSON.stringify(timeout));
check("affects two installations", timeout?.affectedInstallations === 2 || timeout?.affected === 2, JSON.stringify(timeout));
const leaked = JSON.stringify(rows).includes("SuperSecret99") || JSON.stringify(rows).includes("hunter2");
check("secrets are scrubbed from stored errors", !leaked);
check("critical incident sorted first", rows[0]?.severity === "critical", JSON.stringify(rows[0]));

const id = timeout?.id;
check("resolve straight from new needs a note", (await call("POST", `/incidents/${id}/transition`, { to: "resolved" }, token)).status === 400);
check("acknowledge works", (await call("POST", `/incidents/${id}/transition`, { to: "acknowledged" }, token)).status === 200);
check("invalid transition refused (acknowledged -> reopened)", (await call("POST", `/incidents/${id}/transition`, { to: "reopened", note: "nope" }, token)).status === 409);
const me = await call("GET", "/admin/me", null, token);
check("assign to an active admin", (await call("POST", `/incidents/${id}/assign`, { adminId: me.body?.id ?? me.body?.admin?.id }, token)).status === 200);
check("add a note", (await call("POST", `/incidents/${id}/note`, { note: "Looking at the network" }, token)).status === 200);
check("resolve with a note", (await call("POST", `/incidents/${id}/transition`, { to: "resolved", note: "Fixed in 1.0.1" }, token)).status === 200);
const detail = await call("GET", `/incidents/${id}`, null, token);
check("detail has a timeline", JSON.stringify(detail.body).includes("Fixed in 1.0.1"));
await err(a.agent, "Sync failed: timeout after 99 seconds for order 9");
const after = await call("GET", `/incidents/${id}`, null, token);
check("a new occurrence reopens a resolved incident", JSON.stringify(after.body).includes('"reopened"'), JSON.stringify(after.body).slice(0, 300));

// ---- roles
const mk = async (role, email) => {
  const r = await call("POST", "/admins", { name: role, email, role }, token);
  const pw = r.body?.temporaryPassword;
  const login = await call("POST", "/admin/login", { email, password: pw });
  return { id: r.body?.admin?.id ?? r.body?.id, token: login.body?.token, create: r.status, login: login.status, mustChange: login.body?.mustChangePassword };
};
const aud = await mk("auditor", "aud@example.com");
const rel = await mk("release_manager", "rel@example.com");
const sup = await mk("support_admin", "sup@example.com");
check("admins created with new roles", aud.create === 201 && rel.create === 201 && sup.create === 201, JSON.stringify({ aud, rel, sup }));

if (aud.token) {
  check("auditor can read audit log", (await call("GET", "/audit-logs?limit=5", null, aud.token)).status === 200);
  check("auditor can export audit log", (await call("GET", "/audit-logs/export", null, aud.token)).status === 200);
  check("auditor cannot resolve incidents", (await call("POST", `/incidents/${id}/transition`, { to: "resolved", note: "x y z" }, aud.token)).status === 403);
  check("auditor cannot suspend customers", (await call("POST", `/customers/${a.customerId}/suspend`, { reason: "abc" }, aud.token)).status === 403);
  check("auditor cannot create admins", (await call("POST", "/admins", { name: "x", email: "x@example.com", role: "super_admin" }, aud.token)).status === 403);
}
if (rel.token) {
  check("release manager cannot suspend customers", (await call("POST", `/customers/${a.customerId}/suspend`, { reason: "abc" }, rel.token)).status === 403);
  check("release manager cannot read audit log", (await call("GET", "/audit-logs?limit=5", null, rel.token)).status === 403);
}
if (sup.token) {
  check("support can suspend customers", (await call("POST", `/customers/${b.customerId}/suspend`, { reason: "billing" }, sup.token)).status === 200);
  check("support cannot publish/withdraw releases", (await call("PUT", "/releases/1", { active: false }, sup.token)).status === 403);
  check("support cannot create admins", (await call("POST", "/admins", { name: "y", email: "y@example.com", role: "super_admin" }, sup.token)).status === 403);
}
const audit = JSON.stringify((await call("GET", "/audit-logs?limit=100", null, token)).body);
check("denied attempts are audited", audit.includes("access.denied"));
check("incident actions are audited", audit.includes("incident.resolved") && audit.includes("incident.acknowledged"));

console.log(failures() ? `\n${failures()} FAILED` : "\nAll checks passed");
process.exit(failures() ? 1 : 0);
