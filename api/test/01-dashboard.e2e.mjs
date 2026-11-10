// Dashboard overview: figures come from real records, use the same status rules as the
// Installations list, and unavailable data is labelled rather than shown as zero.
import { call, check, failures, adminToken, makeInstallation, heartbeat, sleep } from "./lib.mjs";

const token = await adminToken();
check("admin token available", !!token);

check("overview requires authentication", (await call("GET", "/dashboard/overview")).status === 401);

// ---- empty system: zeros are real zeros, trends empty, unavailable metrics labelled
const empty = (await call("GET", "/dashboard/overview?days=7", null, token)).body;
check("empty: no installations", empty?.installations?.total === 0 && empty?.installations?.online === 0);
check("empty: no pending changes", empty?.sync?.pendingChanges === 0 && empty?.sync?.lastSuccessfulSyncAt === null);
check("empty: unavailable metrics are labelled with a reason", typeof empty?.unavailable?.syncSuccessRate === "string" && empty.unavailable.syncSuccessRate.length > 10);
check("invalid period falls back to 7 days", (await call("GET", "/dashboard/overview?days=abc", null, token)).body?.rangeDays === 7);
check("period 30 accepted", (await call("GET", "/dashboard/overview?days=30", null, token)).body?.rangeDays === 30);
const before = empty?.customers?.total ?? 0;

// ---- build a known fleet
const a = await makeInstallation(token, "Alpha Stores");
const b = await makeInstallation(token, "Beta Mart", { appVersion: "1.1.0" });
const c = await makeInstallation(token, "Gamma Shop");
check("three installations activated", [a, b, c].every((x) => x.agent));
const now = new Date().toISOString();
await heartbeat(a.agent, { appVersion: "1.0.0", healthStatus: "healthy", productCount: 40, pendingCount: 5, lastSyncAt: now });
await heartbeat(b.agent, { appVersion: "1.1.0", healthStatus: "healthy", productCount: 10, pendingCount: 0, failedCount: 2, lastSyncAt: now });
await heartbeat(c.agent, { appVersion: "1.0.0", healthStatus: "critical", pendingCount: 0 });
// an error group
await call("POST", "/agent/errors", { module: "Sync", severity: "critical", message: "Sync failed: timeout" }, c.agent);
for (let n = 0; n < 3; n++) await call("POST", "/agent/errors", { module: "Checkout", severity: "error", message: "Printer offline" }, a.agent);

const o = (await call("GET", "/dashboard/overview?days=7", null, token)).body;
check("customers total matches records", o.customers.total === before + 3, JSON.stringify(o.customers));
check("installations total = 3", o.installations.total === 3);
check("online = 2 (healthy ones)", o.installations.online === 2, JSON.stringify(o.installations));
check("critical = 1", o.installations.critical === 1);
check("needs attention = 2 (failed changes + critical)", o.installations.needAttention === 2, String(o.installations.needAttention));
check("pending changes = 5 across 1 installation", o.sync.pendingChanges === 5 && o.sync.installationsPendingSync === 1);
check("failed changes = 2", o.sync.failedChanges === 2);
check("last successful sync is reported", !!o.sync.lastSuccessfulSyncAt);
check("version distribution", JSON.stringify(o.installations.versions.map((v) => [v.version, v.count]).sort()) === JSON.stringify([["1.0.0", 2], ["1.1.0", 1]]), JSON.stringify(o.installations.versions));
check("open critical errors = 1", o.errors.openCritical === 1, JSON.stringify(o.errors));
check("repeated error groups = 1 (3 occurrences)", o.errors.repeatedGroups === 1);
check("errors today counts both groups", o.errors.today === 2);
check("attention list is prioritised (critical first)", o.attention[0]?.status === "critical" && o.attention.length === 2, JSON.stringify(o.attention.map((x) => x.status)));
check("new registrations in period counted", o.customers.newInPeriod >= 3);
check("sign-up trend includes today", o.trends.registrations.some((r) => r.n >= 3));
check("database health reported", o.health.database === "ok");

// ---- same status rules as the Installations list
const list = (await call("GET", "/installations", null, token)).body;
const listOnline = list.filter((i) => i.status === "online").length;
check("dashboard online count equals Installations list", o.installations.online === listOnline);

// ---- offline follows the heartbeat threshold (test server runs with a 3 second threshold)
await sleep(4500);
await heartbeat(a.agent, { healthStatus: "healthy", pendingCount: 5 }); // only Alpha keeps checking in
const o2 = (await call("GET", "/dashboard/overview?days=7", null, token)).body;
check("silent installation becomes offline, active one stays online", o2.installations.online === 1 && o2.installations.offline === 1, JSON.stringify(o2.installations));
const list2 = (await call("GET", "/installations", null, token)).body;
check("list and dashboard still agree", list2.filter((i) => i.status === "offline").length === o2.installations.offline);

// ---- suspension is reflected
await call("POST", `/customers/${a.customerId}/suspend`, { reason: "dashboard test" }, token);
const o3 = (await call("GET", "/dashboard/overview?days=7", null, token)).body;
check("suspended customers counted", o3.customers.suspended === 1, JSON.stringify(o3.customers));

console.log(failures() ? `\n${failures()} FAILED` : "\nAll checks passed");
process.exit(failures() ? 1 : 0);
