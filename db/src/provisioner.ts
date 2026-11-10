import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { describeDbError } from "./index";

/**
 * Creates a brand-new, empty-but-ready database for one customer and returns its connection string.
 *
 *  1. Connects to the same Postgres server the Master uses (or MASTER_CUSTOMER_DB_ADMIN_URL if you
 *     want customer databases on a different server) and runs CREATE DATABASE.
 *  2. Connects to the new database and creates every table the POS app needs
 *     (assets/customer-schema.sql - generated from Backend/db with `drizzle-kit export`).
 *
 * Nothing is left half-done: if step 2 fails the new database is dropped again.
 */
/**
 * Optional hardening for self-hosted Postgres (Docker):
 *  - MASTER_CUSTOMER_DB_ISOLATE=true   each customer gets their OWN database login that can open only
 *    their own database, instead of being handed the admin login (which could read every customer).
 *    Needs a database user that may create roles (the default `postgres` user can). If it can't,
 *    activation fails with a clear error.
 *    MASTER_CUSTOMER_DB_ISOLATE=auto     same, but if the database refuses to create a login, fall back to
 *    handing out the admin login (what older versions always did) and log a warning.
 *  - MASTER_CUSTOMER_DB_PUBLIC_HOST=db.example.com:5432   the address customers' apps use to reach the
 *    database, when it differs from the address the Master itself uses (e.g. "postgres" inside Docker).
 *  - MASTER_CUSTOMER_DB_SSLMODE=require   appended to the address handed to customers.
 */
export async function createCustomerDatabase(customerId: number): Promise<string> {
  const adminUrl = process.env.MASTER_CUSTOMER_DB_ADMIN_URL || process.env.MASTER_DATABASE_URL;
  if (!adminUrl) throw new Error("MASTER_DATABASE_URL is not set");

  const suffix = randomBytes(4).toString("hex");
  const dbName = `techwolf_c${customerId}_${suffix}`;
  const isolateMode = (process.env.MASTER_CUSTOMER_DB_ISOLATE ?? "").trim().toLowerCase();
  let isolate = isolateMode === "true" || isolateMode === "auto";
  const roleName = dbName; // one login per customer, named like the database
  const rolePassword = randomBytes(24).toString("hex");
  const target = new URL(adminUrl);
  target.pathname = `/${dbName}`;
  if (isolate) {
    target.username = roleName;
    target.password = rolePassword;
  }

  const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 30_000 });
  try {
    await admin.connect();
    if (isolate) {
      try {
        await admin.query(`CREATE ROLE "${roleName}" LOGIN PASSWORD '${rolePassword}'`);
      } catch (roleErr) {
        if (isolateMode !== "auto") throw roleErr;
        console.warn(
          `[provisioner] This database user can't create logins (${describeDbError(roleErr)}). ` +
            `Customer ${customerId} gets the shared admin login instead. Set MASTER_CUSTOMER_DB_ISOLATE=true to make this an error.`,
        );
        isolate = false;
        const original = new URL(adminUrl);
        target.username = original.username;
        target.password = original.password;
      }
    }
    if (isolate) {
      await admin.query(`CREATE DATABASE "${dbName}" OWNER "${roleName}"`);
      await admin.query(`REVOKE ALL ON DATABASE "${dbName}" FROM PUBLIC`);
      // Also close the door on the database the Master itself runs in (best effort - the Master's own
      // login owns it, so it keeps access).
      await admin.query(`DO $$ BEGIN EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', current_database()); END $$`).catch(() => undefined);
    } else {
      await admin.query(`CREATE DATABASE "${dbName}"`);
    }
  } catch (err) {
    if (isolate) await admin.query(`DROP ROLE IF EXISTS "${roleName}"`).catch(() => undefined);
    throw new Error(
      `Couldn't create a database automatically (${describeDbError(err)}). ` +
        `Your database user needs permission to create databases - or create one yourself and use "Use my own database".`,
    );
  } finally {
    await admin.end().catch(() => undefined);
  }

  const customer = new pg.Client({ connectionString: target.toString(), connectionTimeoutMillis: 30_000 });
  try {
    await customer.connect();
    const sql = readFileSync(new URL("./assets/customer-schema.sql", import.meta.url), "utf8");
    await customer.query(sql);
  } catch (err) {
    await customer.end().catch(() => undefined);
    const cleanup = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 30_000 });
    try {
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      if (isolate) await cleanup.query(`DROP ROLE IF EXISTS "${roleName}"`);
    } catch {
      /* best effort */
    } finally {
      await cleanup.end().catch(() => undefined);
    }
    throw new Error(`Created the database but couldn't set up its tables: ${describeDbError(err)}`);
  }
  await customer.end().catch(() => undefined);

  // What the customer's app is given: possibly a different host, and optionally encrypted.
  const result = new URL(target.toString());
  const publicHost = process.env.MASTER_CUSTOMER_DB_PUBLIC_HOST?.trim();
  if (publicHost) {
    const [host, port] = publicHost.split(":");
    result.hostname = host!;
    if (port) result.port = port;
  }
  const sslmode = process.env.MASTER_CUSTOMER_DB_SSLMODE?.trim();
  if (sslmode) result.searchParams.set("sslmode", sslmode);
  return result.toString();
}
