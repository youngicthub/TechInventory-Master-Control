import { assertMasterEnv } from "./lib/env-guard";

// Refuse to start with missing/weak secrets BEFORE anything else loads
// (the db package also throws on a missing MASTER_DATABASE_URL at import
// time, so this has to run first to give the clearer, combined message).
assertMasterEnv();

const { default: app } = await import("./app");
const { warmUpDatabase, ensureMasterColumns } = await import("@masterctl/db");
const { startSnapshotJob } = await import("./lib/fleet");
const { loadSettings } = await import("./lib/settings");

const port = Number(process.env.PORT ?? 4100);
// Local-first: only this machine can reach the API unless you deliberately
// set MASTER_HOST=0.0.0.0 (e.g. inside Docker, or to serve your LAN).
const host = process.env.MASTER_HOST ?? "127.0.0.1";


app.listen(port, host, (err?: Error) => {
  if (err) {
    const code = (err as NodeJS.ErrnoException).code;
    console.error(
      code === "EADDRINUSE"
        ? `[master-api] port ${port} is already in use - the Master App is probably already running in another terminal. ` +
            `Open http://localhost:${port}/console/ , or stop the other copy first (Ctrl+C in its terminal).`
        : `[master-api] couldn't start on ${host}:${port}: ${err.message}`,
    );
    process.exit(1);
  }
  console.log(`[master-api] listening on http://${host}:${port}`);
  // Wake the database now so the first login after a quiet spell doesn't time out.
  void warmUpDatabase().then(async (ok) => {
    console.log(ok ? "[master-api] database connected" : "[master-api] database still unreachable - check your internet connection and MASTER_DATABASE_URL");
    if (ok) {
      await ensureMasterColumns();
      await loadSettings();
      startSnapshotJob();
    }
  });
});
