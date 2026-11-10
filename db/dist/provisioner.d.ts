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
export declare function createCustomerDatabase(customerId: number): Promise<string>;
//# sourceMappingURL=provisioner.d.ts.map