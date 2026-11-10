/**
 * Brings an existing Master database up to date with everything the code expects. Every statement
 * is idempotent and independent (one failing doesn't stop the rest), so it's safe on every start -
 * an update never leaves the dashboard broken just because `db:push` couldn't reach the database.
 */
export declare function ensureMasterColumns(): Promise<void>;
//# sourceMappingURL=self-heal.d.ts.map