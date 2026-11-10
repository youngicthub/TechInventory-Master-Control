// Recovery tool for Master admin accounts. Runs on THIS computer against the database in
// MasterControl/.env, so nothing here is reachable from the internet.
//
//   npm run admin -- list
//   npm run admin -- create --email you@example.com --name "Your Name" --password "a-long-password"
//   npm run admin -- reset  --email you@example.com --password "a-new-long-password"
//
// "create" makes a new Super Admin (works even if the first-time setup screen is already gone).
// "reset" sets a new password, unlocks the account, re-activates it and signs it out everywhere.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Client } = require("pg");
const bcrypt = require("bcryptjs");

const [command, ...rest] = process.argv.slice(2);
const flags = {};
for (let i = 0; i < rest.length; i += 2) flags[rest[i].replace(/^--/, "")] = rest[i + 1];

function fail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

if (!["list", "create", "reset"].includes(command)) {
  fail('Use one of:\n  npm run admin -- list\n  npm run admin -- create --email E --name "N" --password "P"\n  npm run admin -- reset --email E --password "P"');
}
const url = process.env.MASTER_DATABASE_URL;
if (!url || /@host[:/]/.test(url)) fail("MASTER_DATABASE_URL in MasterControl/.env is missing or still a placeholder.");

// Node reports "couldn't connect" (IPv4 + IPv6 both failing) as an AggregateError with an EMPTY
// message - unpack it so the real cause shows.
function describe(err) {
  const parts = err instanceof AggregateError ? err.errors : [err];
  return parts.map((e) => [e.code, e.message, e.hostname && `host ${e.hostname}`].filter(Boolean).join(" - ") || String(e)).join("; ");
}

// A free Neon database goes to sleep when idle and can take several seconds to wake up, so the
// first attempt after a quiet spell may time out. Retry a few times before giving up.
let client;
let lastError;
for (let attempt = 1; attempt <= 4; attempt++) {
  client = new Client({ connectionString: url, connectionTimeoutMillis: 20000 });
  try {
    await client.connect();
    lastError = null;
    break;
  } catch (e) {
    lastError = e;
    await client.end().catch(() => {});
    if (attempt < 4) {
      console.log(`Database not ready yet (${describe(e) || "no details"}) - trying again (${attempt}/3)...`);
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}
if (lastError) {
  fail(
    `Couldn't reach the Master database: ${describe(lastError) || "no details"}\n\n` +
      "Check: this computer is online; MASTER_DATABASE_URL is the full string from Neon's Connect panel; " +
      "the Neon project isn't paused or deleted; and the password hasn't been rotated.",
  );
}

try {
  if (command === "list") {
    const { rows } = await client.query(
      "select id, email, name, role, active, locked_until from master_control.master_admins order by id",
    );
    if (!rows.length) console.log("\nNo Master admins exist yet - the first-time setup screen should appear at /console/.\n");
    else {
      console.log("");
      for (const r of rows) {
        const locked = r.locked_until && new Date(r.locked_until) > new Date() ? "  [LOCKED until " + new Date(r.locked_until).toLocaleTimeString() + "]" : "";
        console.log(`#${r.id}  ${r.email}  (${r.name}, ${r.role}, ${r.active ? "active" : "INACTIVE"})${locked}`);
      }
      console.log("");
    }
  } else {
    const email = String(flags.email || "").trim().toLowerCase();
    const password = String(flags.password || "");
    if (!email.includes("@")) fail("Give an email: --email you@example.com");
    if (password.length < 10) fail("The password must be at least 10 characters: --password \"...\"");
    const hash = await bcrypt.hash(password, 12);

    if (command === "create") {
      const name = String(flags.name || "").trim() || email.split("@")[0];
      const exists = await client.query("select 1 from master_control.master_admins where lower(email) = $1", [email]);
      if (exists.rowCount) fail(`${email} already exists. Use "reset" to set a new password for it.`);
      await client.query(
        "insert into master_control.master_admins (name, email, password_hash, role, active) values ($1, $2, $3, 'super_admin', true)",
        [name, email, hash],
      );
      console.log(`\nCreated Super Admin ${email}. Log in at /console/ with that email and password.\n`);
    } else {
      const r = await client.query(
        `update master_control.master_admins
            set password_hash = $2, token_version = token_version + 1, failed_login_count = 0,
                locked_until = null, active = true, must_change_password = false
          where lower(email) = $1`,
        [email, hash],
      );
      if (!r.rowCount) fail(`No admin with the email ${email}. Run: npm run admin -- list`);
      console.log(`\nPassword reset for ${email}. Log in at /console/ with the new password.\n`);
    }
  }
} finally {
  await client.end();
}
