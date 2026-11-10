import { pgSchema } from "drizzle-orm/pg-core";

/**
 * Every Master Control table lives inside this Postgres schema, not the
 * default "public" one. That's what makes it safe to point
 * MASTER_DATABASE_URL at the EXACT SAME database the main inventory app
 * already uses - the main app's tables (products, customers, sales, ...)
 * live in "public"; this app's tables live in "master_control". Nothing
 * can collide even though both share one physical database/connection
 * string. `drizzle-kit push` creates the schema automatically the first
 * time this is pushed - no manual `CREATE SCHEMA` step needed.
 *
 * If you'd rather keep them as two fully separate databases instead
 * (e.g. once you have other customers whose data shouldn't live next to
 * your own), that still works too - just point MASTER_DATABASE_URL at a
 * different connection string. Nothing here requires them to be the same
 * database, it just no longer requires them to be different either.
 */
export const masterControlSchema = pgSchema("master_control");
