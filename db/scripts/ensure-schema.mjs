// `drizzle-kit push` can create tables and enums inside a non-"public"
// Postgres schema, but it does NOT create the schema (namespace) itself
// first - if "master_control" doesn't exist yet, push fails partway
// through with a raw "schema does not exist" error instead of a helpful
// one. This runs automatically before every push (see the "prepush" /
// "prepush-force" hooks in package.json) so that gap never bites anyone
// again, including on a freshly reset database.
import pg from "pg";

const { Client } = pg;

async function main() {
  const url = process.env.MASTER_DATABASE_URL;
  if (!url) {
    // Let the actual push command fail with its own clearer error about
    // MASTER_DATABASE_URL being unset, rather than duplicating that
    // message here.
    return;
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS "master_control"');
    console.log('Ensured Postgres schema "master_control" exists.');
  } finally {
    await client.end();
  }
}

function describe(err) {
  // Node 20+ reports "couldn't connect" (IPv4 + IPv6 both failing) as an
  // AggregateError with an EMPTY message - unpack it so the real cause shows.
  const parts = err instanceof AggregateError ? err.errors : [err];
  return parts
    .map((e) => [e.code, e.message, e.hostname && `host ${e.hostname}`].filter(Boolean).join(" - ") || String(e))
    .join("; ");
}

main().catch((err) => {
  console.error("Couldn't ensure the master_control schema exists:", describe(err));
  console.error(
    "\nThis means the database at MASTER_DATABASE_URL couldn't be reached or refused the login. Check: " +
      "(1) this computer is online, (2) the connection string is copied in full from Neon's Connect panel, " +
      "(3) the Neon project isn't paused/deleted, and the password hasn't been rotated.",
  );
  process.exit(1);
});
