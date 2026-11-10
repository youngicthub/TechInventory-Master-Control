import { eq } from "drizzle-orm";
import { db, customersTable, createCustomerDatabase } from "@masterctl/db";
import { decryptSecret, encryptSecret } from "./crypto";

const inFlight = new Map<number, Promise<string>>();

function validateSavedConnection(encrypted: string): string {
  try {
    decryptSecret(encrypted);
    return encrypted;
  } catch {
    throw new Error(
      "The saved customer database connection cannot be decrypted with the current MASTER_ENCRYPTION_KEY. Restore the original key or replace the database connection in the Master dashboard before issuing an activation code.",
    );
  }
}

/**
 * Makes sure a customer has a database, creating one automatically if not. Returns the encrypted
 * connection string. Safe to call from several places at once (two tills activating together
 * share one creation instead of making two databases).
 */
export function ensureCustomerDatabase(customer: { id: number; encryptedDatabaseUrl: string | null }): Promise<string> {
  if (customer.encryptedDatabaseUrl) return Promise.resolve(validateSavedConnection(customer.encryptedDatabaseUrl));
  const existing = inFlight.get(customer.id);
  if (existing) return existing;

  const job = (async () => {
    // Re-read: another request may have finished while we waited.
    const fresh = await db.query.customersTable.findFirst({ where: eq(customersTable.id, customer.id) });
    if (fresh?.encryptedDatabaseUrl) return validateSavedConnection(fresh.encryptedDatabaseUrl);
    const encrypted = encryptSecret(await createCustomerDatabase(customer.id));
    await db.update(customersTable).set({ encryptedDatabaseUrl: encrypted, updatedAt: new Date() }).where(eq(customersTable.id, customer.id));
    return validateSavedConnection(encrypted);
  })().finally(() => inFlight.delete(customer.id));
  inFlight.set(customer.id, job);
  return job;
}
