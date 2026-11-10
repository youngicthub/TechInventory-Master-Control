#!/bin/bash
# Boots the Master API against a throw-away local Postgres database and runs every *.e2e.mjs here.
#   bash api/test/run-tests.sh        (needs a local Postgres; set MASTER_TEST_DB_URL to override)
cd "$(dirname "$0")/../.." || exit 1
export MASTER_DATABASE_URL="${MASTER_TEST_DB_URL:-postgres://postgres:pw@127.0.0.1:5432/mc_test}"
export MASTER_JWT_SECRET=testtesttesttesttesttesttesttest12
export MASTER_ENCRYPTION_KEY=$(printf 'ab%.0s' $(seq 32))
export MASTER_SETUP_KEY=test-setup-key-123456
export MASTER_OFFLINE_THRESHOLD_SECONDS=3
export MASTER_RELEASES_DIR=/tmp/mc-test-releases; rm -rf "$MASTER_RELEASES_DIR"
export MASTER_RATE_LIMIT_MULTIPLIER=100
fuser -k 4199/tcp >/dev/null 2>&1; sleep 1
export PORT=4199 MASTER_PORT=4199 MASTER_HOST=127.0.0.1
# fresh schema every run
node -e '
const {Client}=require("pg");(async()=>{const c=new Client({connectionString:process.env.MASTER_DATABASE_URL});await c.connect();
await c.query("DROP SCHEMA IF EXISTS master_control CASCADE");await c.end()})().catch(e=>{console.error(e.message);process.exit(1)})' || exit 1
(cd db && npx drizzle-kit push --force --config ./drizzle.config.ts >/tmp/mc-push.log 2>&1) || { tail -5 /tmp/mc-push.log; exit 1; }
(cd api && npx tsx src/index.ts >/tmp/mc-api.log 2>&1 & echo $! > /tmp/mc-api.pid)
for i in $(seq 1 40); do curl -s http://127.0.0.1:4199/api/admin/setup-status >/dev/null && break; sleep 1; done
rc=0
for t in api/test/*.e2e.mjs; do
  echo "=== $t"
  node "$t" || rc=1
done
fuser -k 4199/tcp >/dev/null 2>&1
exit $rc
