import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

function getJwtSecret(): string {
  const secret = process.env.MASTER_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "MASTER_JWT_SECRET must be set. Generate one with `npm run gen:secrets` - use a DIFFERENT value than the main app's JWT_SECRET so a leak of one can't be used to forge sessions for the other.",
    );
  }
  return secret;
}

export interface MasterJwtPayload {
  sub: number;
  role: string;
  name: string;
  /** Token version the session was issued under - see master_admins.token_version. */
  tv: number;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// Compared against when the email doesn't exist, so "no such account" costs
// the same bcrypt time as "wrong password" - response timing can't be used
// to discover which emails are real admin accounts.
let dummyHash: string | null = null;
export async function burnPasswordCheck(plain: string): Promise<void> {
  dummyHash ??= await bcrypt.hash("not-a-real-password", 12);
  await bcrypt.compare(plain, dummyHash);
}

/**
 * bcrypt silently ignores everything past 72 bytes, so a longer "password"
 * would be weaker than it looks - cap it instead of truncating silently.
 */
export function validateNewPassword(password: string): string | null {
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (Buffer.byteLength(password, "utf8") > 72) return "Password must be at most 72 bytes (about 72 characters).";
  return null;
}

/** Constant-time string comparison (hashes first so lengths needn't match). */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** One-time temporary password handed to a newly created / reset admin. */
export function generateTemporaryPassword(): string {
  return crypto.randomBytes(12).toString("base64url"); // 16 chars
}

export function signAdminToken(admin: { id: number; role: string; name: string; tokenVersion: number }): string {
  const payload: MasterJwtPayload = { sub: admin.id, role: admin.role, name: admin.name, tv: admin.tokenVersion };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "12h", algorithm: "HS256" });
}

export function verifyAdminToken(token: string): MasterJwtPayload {
  return jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"] }) as unknown as MasterJwtPayload;
}
