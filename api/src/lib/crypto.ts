import crypto from "crypto";

/**
 * Every customer's own database connection string (full credentials to
 * their entire business's data) is stored here, encrypted at rest with
 * AES-256-GCM. MASTER_ENCRYPTION_KEY is a separate secret from
 * MASTER_DATABASE_URL and JWT_SECRET - if the master database is ever
 * read (backup leak, misconfigured access, etc.), the connection strings
 * inside it are still useless without this key, which should be kept
 * somewhere different (e.g. your host's secret manager, not committed
 * alongside the DB credentials it protects).
 */

function getEncryptionKey(): Buffer {
  const key = process.env.MASTER_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "MASTER_ENCRYPTION_KEY must be set. Generate one with `openssl rand -hex 32` and put it in .env - keep it somewhere separate from your database backups.",
    );
  }
  const buf = Buffer.from(key, "hex");
  if (buf.length !== 32) {
    throw new Error("MASTER_ENCRYPTION_KEY must be a 32-byte hex string (64 hex characters) - generate with `openssl rand -hex 32`.");
  }
  return buf;
}

/** Returns "iv:authTag:ciphertext", all hex, safe to store in a text column. */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

export function decryptSecret(stored: string): string {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, ciphertextHex] = stored.split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Malformed encrypted value - expected 'iv:authTag:ciphertext'");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** Human-enterable activation code, e.g. "A1B2C3-D4E5F6-A7B8C9-D0E1F2". */
export function generateLicenseKey(): string {
  const groups = Array.from({ length: 4 }, () =>
    crypto.randomBytes(3).toString("hex").toUpperCase(),
  );
  return groups.join("-");
}

/** Long, non-human-facing secret the agent stores locally after activation. */
export function generateAgentToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** sha256 - same fast-hash-plus-length-limits reasoning as the main app's OTP codes (see Backend/api-server/src/lib/otp.ts): this is a high-entropy 32-byte token, not a guessable short code, so a slow KDF adds cost with no real benefit. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateInstallationCode(): string {
  return `INS-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}
