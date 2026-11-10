// End-to-end check: suspension is enforced by the Master backend on every
// agent call, needs a reason, is audited, and reactivation restores access.
// Run:  bash api/test/run-suspension-test.sh   (needs a local Postgres)
import { call, check, failures, adminToken, makeInstallation, heartbeat } from "./lib.mjs";

const token = await adminToken();
check("admin token available", !!token);

const made = await makeInstallation(token, "Suspension Co");
check("customer created and activated", !!made.customerId && !!made.agent, JSON.stringify(made.activation));
const id = made.customerId;
const agent = made.agent;

const hb = () => call("POST", "/agent/heartbeat", { appVersion: "1.0.0" }, agent);
check("heartbeat OK while active", (await hb()).status === 200);

const noReason = await call("POST", `/customers/${id}/suspend`, {}, token);
check("suspend without a reason is rejected", noReason.status === 400);
check("status cannot be changed through the generic update route", (await call("PUT", `/customers/${id}`, { status: "suspended" }, token)).status === 400);

const sus = await call("POST", `/customers/${id}/suspend`, { reason: "Unpaid invoice" }, token);
check("suspend with a reason works", sus.status === 200 && sus.body?.status === "suspended", JSON.stringify(sus));
const blocked = await hb();
check("heartbeat blocked after suspension (403 account_suspended)", blocked.status === 403 && blocked.body?.code === "account_suspended", JSON.stringify(blocked));
check("errors endpoint blocked too", (await call("POST", "/agent/errors", { message: "x" }, agent)).status === 403);
check("update-check blocked too", (await call("GET", "/agent/update-check?platform=windows&version=1.0.0", null, agent)).status === 403);
check("suspending twice is refused", (await call("POST", `/customers/${id}/suspend`, { reason: "again" }, token)).status === 409);

const re = await call("POST", `/customers/${id}/reactivate`, { reason: "Paid" }, token);
check("reactivate works", re.status === 200 && re.body?.status === "active", JSON.stringify(re));
check("heartbeat OK again after reactivation", (await hb()).status === 200);

const audit = await call("GET", "/audit-logs?limit=50", null, token);
const text = JSON.stringify(audit.body);
check("audit log records suspend with reason", text.includes("customer.suspend") && text.includes("Unpaid invoice"));
check("audit log records reactivate with reason", text.includes("customer.reactivate") && text.includes("Paid"));

console.log(failures() ? `\n${failures()} FAILED` : "\nAll checks passed");
process.exit(failures() ? 1 : 0);
