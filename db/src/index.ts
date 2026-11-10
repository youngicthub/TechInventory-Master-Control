import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.MASTER_DATABASE_URL) {
  throw new Error(
    "MASTER_DATABASE_URL must be set. This is the control-plane database - " +
      "see MasterControl/.env.example. It must never be pointed at a customer's own database.",
  );
}

export const pool = new Pool({
  connectionString: process.env.MASTER_DATABASE_URL,
  // Hosted databases (Neon) go to sleep when idle and can be slow or flaky to reach the first time.
  // Without a timeout a stuck connect hangs, and without keep-alive an idle connection can be dropped.
  connectionTimeoutMillis: 30_000,
  idleTimeoutMillis: 30_000,
  keepAlive: true,
  max: 5,
});
// An idle connection that the database closes must not crash the whole server.
pool.on("error", (err) => console.error("[master-db] idle connection error:", describeDbError(err)));
export const db = drizzle(pool, { schema });

/** Node reports "couldn't connect" (IPv4 + IPv6 both failing) as an AggregateError with an EMPTY message. */
export function describeDbError(err: unknown): string {
  const parts: unknown[] = err instanceof AggregateError ? err.errors : [err];
  return parts
    .map((e) => {
      const x = e as { code?: string; message?: string; address?: string };
      return [x.code, x.message, x.address].filter(Boolean).join(" - ") || String(e);
    })
    .join("; ");
}

/**
 * Wakes the database (retrying while it starts up) and then pings it every few minutes so a sleeping
 * free-tier database doesn't make the next login time out. Safe to ignore the result.
 */
export async function warmUpDatabase(): Promise<boolean> {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      await pool.query("select 1");
      const timer = setInterval(() => pool.query("select 1").catch(() => undefined), 4 * 60_000);
      timer.unref();
      return true;
    } catch (err) {
      console.log(`[master-db] database not ready yet (${describeDbError(err)}) - retrying (${attempt}/6)...`);
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
  return false;
}

export * from "./schema";
export * from "./provisioner";
export * from "./self-heal";




