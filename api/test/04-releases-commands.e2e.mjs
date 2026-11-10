// Releases: draft -> staged -> published -> withdrawn/rollback, rollout %, integrity, tracking of what apps really did.
// Remote requests: queued until the app checks in; revoke blocks a device.
import fs from "node:fs";
import path from "node:path";
import { BASE, call, check, failures, adminToken, makeInstallation, heartbeat } from "./lib.mjs";
const token = await adminToken();
const RELEASES = process.env.MASTER_RELEASES_DIR;

const upload = async (version, bytes = 2048) => {
  const body = Buffer.alloc(bytes, version.charCodeAt(version.length - 1));
  const r = await fetch(`${BASE}/api/releases/upload?version=${version}&platform=windows&arch=x64&filename=Setup-${version}.exe`, {
    method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" }, body,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const publicList = async () => (await call("GET", "/public/releases")).body ?? [];

// 20 installations on 1.0.0 (Windows)
const fleet = [];
for (let i = 0; i < 20; i++) fleet.push(await makeInstallation(token, `Fleet${i}`, { osVersion: "win32 10.0.19045" }));
check("20 installations activated", fleet.every((f) => !!f.agent));
const check1 = (agent) => call("GET", "/agent/update-check?platform=win32&arch=x64&version=1.0.0", null, agent);
const offeredCount = async () => (await Promise.all(fleet.map((f) => check1(f.agent)))).filter((r) => r.body?.updateAvailable).length;

const up = await upload("1.0.1");
const r1 = up.body;
check("upload creates a DRAFT", up.status === 201 && r1?.status === "draft" && r1?.active === false, JSON.stringify(up));
check("draft not on the landing page", !(await publicList()).some((r) => r.version === "1.0.1"));
check("draft not offered to any app", (await offeredCount()) === 0);

check("publishing needs explicit confirmation", (await call("POST", `/releases/${r1.id}/transition`, { to: "published" }, token)).body?.code === "confirm_required");
check("staged at 100% is refused", (await call("POST", `/releases/${r1.id}/transition`, { to: "staged", rolloutPercent: 100 }, token)).status === 400);
const st = await call("POST", `/releases/${r1.id}/transition`, { to: "staged", rolloutPercent: 50 }, token);
check("stage at 50%", st.status === 200 && st.body?.status === "staged" && st.body?.rolloutPercent === 50, JSON.stringify(st));
const half = await offeredCount();
check(`50% rollout offers some but not all apps (${half}/20)`, half > 0 && half < 20);
check("staged build is NOT on the landing page", !(await publicList()).some((r) => r.version === "1.0.1"));
check("same devices stay in as it widens (stable bucketing)", (await offeredCount()) === half);

check("a floor above the installed version hides it", (await call("PUT", `/releases/${r1.id}`, { minFromVersion: "1.0.5" }, token)).status === 200 && (await offeredCount()) === 0);
await call("PUT", `/releases/${r1.id}`, { minFromVersion: null }, token);

check("publish to everyone", (await call("POST", `/releases/${r1.id}/transition`, { to: "published", confirm: true }, token)).status === 200);
check("everyone is offered it", (await offeredCount()) === 20);
check("now on the landing page", (await publicList()).some((r) => r.version === "1.0.1"));
check("invalid transition refused (published -> staged)", (await call("POST", `/releases/${r1.id}/transition`, { to: "staged", rolloutPercent: 10 }, token)).status === 409);

// What apps really did
const a = fleet[0].agent, b = fleet[1].agent, c = fleet[2].agent;
let dep = (await call("GET", `/releases/${r1.id}/deployments`, null, token)).body;
check("publishing alone marks nothing installed", dep.counts.installed === 0 && dep.counts.offered === 20, JSON.stringify(dep.counts));
const dl = await fetch(`${BASE}/api/agent/download/${r1.id}`, { headers: { authorization: `Bearer ${a}` } });
check("download works and carries the checksum", dl.status === 200 && !!dl.headers.get("x-checksum-sha256"));
await call("POST", "/agent/update-result", { releaseId: r1.id, status: "failed", error: "integrity check failed" }, b);
await heartbeat(a, { appVersion: "1.0.1" });
dep = (await call("GET", `/releases/${r1.id}/deployments`, null, token)).body;
check("installed only after the app reports the new version", dep.counts.installed === 1, JSON.stringify(dep.counts));
check("failed update is recorded with its reason", dep.counts.failed === 1 && dep.rows.some((r) => r.status === "failed" && /integrity/.test(r.error ?? "")));
await heartbeat(b, { appVersion: "1.0.1" });
dep = (await call("GET", `/releases/${r1.id}/deployments`, null, token)).body;
check("a failed device that later runs the new version becomes installed", dep.counts.failed === 0 && dep.counts.installed === 2, JSON.stringify(dep.counts));

// Integrity: tamper with a stored file
const up2 = (await upload("1.0.2")).body;
const stored = fs.readdirSync(RELEASES).map((f) => path.join(RELEASES, f)).filter((f) => fs.statSync(f).size === 2048 && fs.readFileSync(f)[0] === "2".charCodeAt(0));
fs.appendFileSync(stored[0], "tamper");
const bad = await call("POST", `/releases/${up2.id}/transition`, { to: "published", confirm: true }, token);
check("a tampered installer cannot be published", bad.status === 409 && bad.body?.code === "artifact_invalid", JSON.stringify(bad));

// Rollback
const up3 = (await upload("1.0.3")).body;
await call("POST", `/releases/${up3.id}/transition`, { to: "published", confirm: true }, token);
check("1.0.3 is the latest on the landing page", (await publicList()).find((r) => r.platform === "windows")?.version === "1.0.3");
check("rollback needs a reason + confirmation", (await call("POST", `/releases/${up3.id}/rollback`, { toReleaseId: r1.id }, token)).status === 400);
check("cannot roll back to a newer build", (await call("POST", `/releases/${r1.id}/rollback`, { toReleaseId: up3.id, reason: "oops", confirm: true }, token)).status === 400);
const rb = await call("POST", `/releases/${up3.id}/rollback`, { toReleaseId: r1.id, reason: "Crash on checkout", confirm: true }, token);
check("rollback succeeds", rb.status === 200, JSON.stringify(rb));
check("landing page is back on 1.0.1", (await publicList()).find((r) => r.platform === "windows")?.version === "1.0.1");
check("withdrawn build is not offered", (await call("GET", "/agent/update-check?platform=win32&arch=x64&version=1.0.0", null, fleet[5].agent)).body?.version === "1.0.1");

// Roles
const mk = async (role, email) => {
  const r = await call("POST", "/admins", { name: role, email, role }, token);
  const l = await call("POST", "/admin/login", { email, password: r.body?.temporaryPassword });
  return l.body?.token;
};
const sup = await mk("support_admin", "sup4@example.com");
const rel = await mk("release_manager", "rel4@example.com");
const ops = await mk("platform_ops", "ops4@example.com");
const up4 = (await upload("1.0.4")).body;
check("support cannot publish", (await call("POST", `/releases/${up4.id}/transition`, { to: "published", confirm: true }, sup)).status === 403);
check("release manager can stage", (await call("POST", `/releases/${up4.id}/transition`, { to: "staged", rolloutPercent: 10 }, rel)).status === 200);
check("withdrawing needs a reason", (await call("POST", `/releases/${up4.id}/transition`, { to: "withdrawn" }, rel)).status === 400);
check("release manager can withdraw with a reason", (await call("POST", `/releases/${up4.id}/transition`, { to: "withdrawn", reason: "bad build" }, rel)).status === 200);

// Remote requests
const t = fleet[10];
const instId = (await call("GET", "/installations", null, token)).body.find((i) => i.installationCode && i.customerId === t.customerId).id;
await heartbeat(t.agent, { appVersion: "1.0.0" });
const q = await call("POST", `/installations/${instId}/commands`, { type: "sync" }, token);
check("sync request is QUEUED (not done)", q.status === 202 && q.body?.command?.status === "queued", JSON.stringify(q));
check("duplicate request refused", (await call("POST", `/installations/${instId}/commands`, { type: "sync" }, token)).status === 409);
check("auditor-style roles cannot request", (await call("POST", `/installations/${instId}/commands`, { type: "sync" }, rel)).status === 403);
const hb = await heartbeat(t.agent, { appVersion: "1.0.0" });
const cmd = hb.body?.commands?.[0];
check("app receives it at its next heartbeat", cmd?.type === "sync", JSON.stringify(hb.body));
let list = (await call("GET", `/installations/${instId}/commands`, null, token)).body;
check("delivered but not yet complete", list[0]?.status === "delivered");
check("app reports back -> completed", (await call("POST", "/agent/command-result", { id: cmd.id, ok: true, result: "Sync cycle finished" }, t.agent)).status === 200);
list = (await call("GET", `/installations/${instId}/commands`, null, token)).body;
check("status is completed with the app's answer", list[0]?.status === "completed" && /finished/.test(list[0]?.result ?? ""));
check("another device cannot answer it", (await call("POST", "/agent/command-result", { id: cmd.id, ok: true }, fleet[11].agent)).status === 404);

// Revoke
check("support cannot disable a device", (await call("POST", `/installations/${instId}/revoke`, { reason: "stolen till" }, sup)).status === 403);
check("revoke needs a reason", (await call("POST", `/installations/${instId}/revoke`, {}, ops)).status === 400);
check("platform ops can disable a device", (await call("POST", `/installations/${instId}/revoke`, { reason: "stolen till" }, ops)).status === 200);
const blocked = await heartbeat(t.agent, {});
check("disabled device is refused by the backend", blocked.status === 403 && blocked.body?.code === "installation_revoked");
check("cannot queue requests for a disabled device", (await call("POST", `/installations/${instId}/commands`, { type: "diagnostics" }, token)).status === 409);
check("restore works", (await call("POST", `/installations/${instId}/restore`, { reason: "recovered" }, ops)).status === 200 && (await heartbeat(t.agent, {})).status === 200);

const audit = JSON.stringify((await call("GET", "/audit-logs?limit=200", null, token)).body);
for (const a of ["release.staged", "release.published", "release.rollback", "release.withdrawn", "installation.revoke", "installation.restore", "installation.sync_requested"])
  check(`audit has ${a}`, audit.includes(a));

console.log(failures() ? `\n${failures()} FAILED` : "\nAll checks passed");
process.exit(failures() ? 1 : 0);
