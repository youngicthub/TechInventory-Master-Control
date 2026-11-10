/**
 * Fails fast, at startup, with a message that says exactly what to fix -
 * instead of the API booting "fine" and then 500ing the first time
 * someone provisions a customer (bad encryption key) or logs in.
 *
 * Mirrors the main app's env-guard.ts: the server refuses to start with
 * missing or weak secrets.
 */
export function assertMasterEnv(env: NodeJS.ProcessEnv = process.env): void {
  const problems: string[] = [];

  const dbUrl = env.MASTER_DATABASE_URL;
  if (!dbUrl || !/^postgres(ql)?:\/\//.test(dbUrl)) {
    problems.push("MASTER_DATABASE_URL must be set to a postgres:// or postgresql:// connection string.");
  }

  const jwt = env.MASTER_JWT_SECRET;
  if (!jwt || jwt.length < 32) {
    problems.push("MASTER_JWT_SECRET must be at least 32 characters. Generate one: npm run gen:secrets");
  }

  const enc = env.MASTER_ENCRYPTION_KEY;
  if (!enc || !/^[0-9a-fA-F]{64}$/.test(enc)) {
    problems.push(
      `MASTER_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes) - yours is ${enc ? `${enc.length} characters` : "missing"}. ` +
        "With a wrong-length key, provisioning a customer's database or activating an installation would fail. Generate one: npm run gen:secrets",
    );
  }

  const setup = env.MASTER_SETUP_KEY;
  if (!setup || setup.length < 16) {
    problems.push("MASTER_SETUP_KEY must be at least 16 characters. Generate one: npm run gen:secrets");
  }

  // These three protect different things and must never be the same value:
  // the setup key is typed into a browser form, the encryption key guards
  // every customer's database credentials, the JWT secret signs sessions.
  const secrets: Array<[string, string | undefined]> = [
    ["MASTER_JWT_SECRET", jwt],
    ["MASTER_ENCRYPTION_KEY", enc],
    ["MASTER_SETUP_KEY", setup],
  ];
  for (let i = 0; i < secrets.length; i++) {
    for (let j = i + 1; j < secrets.length; j++) {
      const [nameA, a] = secrets[i];
      const [nameB, b] = secrets[j];
      if (a && b && a === b) {
        problems.push(`${nameA} and ${nameB} are the same value - each secret must be unique. Generate fresh ones: npm run gen:secrets`);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Master API can't start - fix these in MasterControl/.env:\n  - ${problems.join("\n  - ")}`,
    );
  }
}
