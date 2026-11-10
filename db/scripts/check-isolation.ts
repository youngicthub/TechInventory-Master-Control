// Standalone check for per-customer database logins:
//   MASTER_DATABASE_URL=postgres://postgres:pw@127.0.0.1:5432/mc_test npx tsx db/scripts/check-isolation.ts
import pg from "pg";
import { createCustomerDatabase } from "../src/provisioner";

process.env.MASTER_CUSTOMER_DB_ISOLATE = "true";
process.env.MASTER_CUSTOMER_DB_PUBLIC_HOST = "db.example.test:6543";
process.env.MASTER_CUSTOMER_DB_SSLMODE = "require";
let failed = 0;
const check = (n: string, ok: boolean, x = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "  " + x}`); if (!ok) failed++; };

const url = await createCustomerDatabase(901);
const u = new URL(url);
check("returned address uses the public host and port", u.hostname === "db.example.test" && u.port === "6543", url.replace(/:[^:@]*@/, ":***@"));
check("returned address asks for SSL", u.searchParams.get("sslmode") === "require");
check("returned login is NOT the admin login", u.username.startsWith("techwolf_c901_"), u.username);

// Reach it on the real (internal) host with the same credentials
const internal = new URL(process.env.MASTER_DATABASE_URL!);
internal.username = u.username; internal.password = u.password; internal.pathname = u.pathname;
const own = new pg.Client({ connectionString: internal.toString() });
await own.connect();
const tables = (await own.query("select count(*)::int n from information_schema.tables where table_schema='public'")).rows[0].n;
check("customer login can use its own database (tables created)", tables > 5, String(tables));
await own.query("create table scratch_probe(id int)");
check("...and owns it (can create tables)", true);
await own.end();

const other = new URL(internal.toString()); other.pathname = new URL(process.env.MASTER_DATABASE_URL!).pathname;
const bad = new pg.Client({ connectionString: other.toString() });
let denied = false;
try { await bad.connect(); await bad.query("select 1 from master_control.installations limit 1"); } catch { denied = true; } finally { await bad.end().catch(() => undefined); }
check("customer login cannot open or read the Master's database", denied);

// --- "auto" falls back, "true" refuses, when the database user cannot create logins
const adm = new pg.Client({ connectionString: process.env.MASTER_DATABASE_URL });
await adm.connect();
await adm.query("DROP ROLE IF EXISTS limited_probe");
await adm.query("CREATE ROLE limited_probe LOGIN PASSWORD 'lp' CREATEDB NOCREATEROLE");
await adm.query("GRANT CONNECT ON DATABASE postgres TO limited_probe");
const lim = new URL(process.env.MASTER_DATABASE_URL!);
lim.username = "limited_probe"; lim.password = "lp"; lim.pathname = "/postgres";
process.env.MASTER_CUSTOMER_DB_ADMIN_URL = lim.toString();
process.env.MASTER_CUSTOMER_DB_PUBLIC_HOST = "";
process.env.MASTER_CUSTOMER_DB_SSLMODE = "";
process.env.MASTER_CUSTOMER_DB_ISOLATE = "auto";
const fallback = new URL(await createCustomerDatabase(902));
check("auto: falls back to the shared login when logins can't be created", fallback.username === "limited_probe", fallback.username);
process.env.MASTER_CUSTOMER_DB_ISOLATE = "true";
let strictFailed = false;
try { await createCustomerDatabase(903); } catch { strictFailed = true; }
check("true: refuses (clear error) when logins can't be created", strictFailed);
const left = (await adm.query("select count(*)::int n from pg_database where datname like 'techwolf_c903_%'")).rows[0].n;
check("...and leaves nothing half-created", left === 0, String(left));
await adm.query("select pg_terminate_backend(pid) from pg_stat_activity where usename='limited_probe'");
await adm.end();

console.log(failed ? `\n${failed} FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
