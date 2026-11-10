import * as schema from "./schema";
export declare const pool: import("pg").Pool;
export declare const db: import("drizzle-orm/node-postgres").NodePgDatabase<typeof schema> & {
    $client: import("pg").Pool;
};
/** Node reports "couldn't connect" (IPv4 + IPv6 both failing) as an AggregateError with an EMPTY message. */
export declare function describeDbError(err: unknown): string;
/**
 * Wakes the database (retrying while it starts up) and then pings it every few minutes so a sleeping
 * free-tier database doesn't make the next login time out. Safe to ignore the result.
 */
export declare function warmUpDatabase(): Promise<boolean>;
export * from "./schema";
export * from "./provisioner";
export * from "./self-heal";
//# sourceMappingURL=index.d.ts.map