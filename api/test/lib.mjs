export const BASE = process.env.TEST_BASE || "http://127.0.0.1:4199";
export const ADMIN = { name: "Tester", email: "t@example.com", password: "Str0ng!Passw0rd#1" };
let failed = 0;
export const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + extra}`);
  if (!ok) failed++;
};
export const failures = () => failed;
export const call = async (method, path, body, token) => {
  const r = await fetch(BASE + "/api" + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** First test run creates the super admin; later runs just log in. */
export async function adminToken() {
  const s = await call("POST", "/admin/setup", { ...ADMIN, setupKey: process.env.MASTER_SETUP_KEY });
  if (s.body?.token) return s.body.token;
  const l = await call("POST", "/admin/login", { email: ADMIN.email, password: ADMIN.password });
  return l.body?.token;
}
/** Creates a customer and activates one installation; returns ids + agent token. */
export async function makeInstallation(token, name, extra = {}) {
  const c = await call("POST", "/customers", { name, contactEmail: `${name.replace(/\W/g, "").toLowerCase()}@example.com` }, token);
  const a = await call("POST", "/agent/activate", { licenseKey: c.body?.licenseKey, deviceName: `${name}-till`, appVersion: "1.0.0", ...extra });
  return { customerId: c.body?.id, agent: a.body?.agentToken, activation: a };
}
export const heartbeat = (agent, body) => call("POST", "/agent/heartbeat", body, agent);
