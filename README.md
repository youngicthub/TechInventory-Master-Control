# MasterControl (Master API)

This is the foundation of the "monitor every installation" system: a
completely separate service from the inventory app, with its own
database, that (1) manages customers and their license keys, (2)
provisions each customer's own private database, and (3) records
heartbeats and errors from installed apps.

**What's built:** the API, its database, and now the dashboard (`web/`)
you actually log into - create customers, reveal/rotate license keys,
provision databases, and watch installation health and errors, all from
the browser instead of raw `curl` calls. See `web/README.md` for how to
run it.

**What's NOT built yet:**
- Automatic Neon database provisioning. Creating each new customer's
  database is a manual step for now (see "Onboarding a new customer"
  below) - deliberately, so a bug here can't accidentally create (and
  bill you for) infrastructure on its own.

This was built as a fully separate project on purpose - it has its own
`package.json`, own dependencies, own Docker setup, and is never touched
by the main inventory app's `npm run build:windows` / `build:mac`. Cross
that boundary only if you're sure; keeping them apart is what makes it
safe to change one without risking the other.

## Hosting everything on this machine (one command)

The Master API serves the public landing page and the admin dashboard itself,
so a single process hosts all of it:

```bash
cd MasterControl
npm install
npm run gen:secrets          # prints fresh values - paste them into .env
npm run db:push              # creates/updates the master_control tables
npm run build --workspace=@masterctl/web
npm start                    # (or: npm run dev while developing)
```

| What | Address |
|---|---|
| Public landing page + download buttons | `http://localhost:4100/` |
| Master admin dashboard | `http://localhost:4100/console/` |
| API | `http://localhost:4100/api` |

By default the server only listens on this machine (`MASTER_HOST=127.0.0.1`).
To let other computers on your network reach it, set `MASTER_HOST=0.0.0.0` in
`.env` and open `http://<this-computer's-LAN-IP>:4100/`. Before putting it on the
public internet, put it behind HTTPS (a reverse proxy such as Caddy or nginx)
and set `MASTER_TRUST_PROXY=true` and `MASTER_ALLOWED_ORIGINS`.

### Master admin login

- First visit: the login page detects that no admin exists and shows only the
  **Create the master admin account** form (needs `MASTER_SETUP_KEY`). It works
  once, then disappears.
- After that: normal login. 5 wrong passwords lock that account for 15 minutes;
  logging in is also rate-limited per device. Passwords are 10+ characters.
- **Admins** page (super admin only): add support/monitoring admins. They get a
  one-time temporary password and must choose their own at first login. You can
  change roles, deactivate, or reset passwords - the last active super admin
  can't be removed. Changes take effect immediately (sessions are checked
  against the database on every request, and logout ends sessions everywhere).
- **Audit log** page: every login, failed login, admin change, customer action,
  release upload and update download.

### Shipping downloads and updates

1. Build the installers (`npm run build:windows` / `build:mac` in `Frontend/electron`).
2. Dashboard -> **Releases** -> **Upload build**: pick the version, system and file.
   The server stores it, computes its SHA-256, and the newest *Live* build per
   system instantly appears on the landing page.
3. Installed apps check for a newer build every 6 hours (and shortly after start).
   If one exists they download it, verify the checksum (a bad download is
   discarded), and ask the user to install. **Make required** removes the
   "Later" option. **Withdraw** pulls a build back from the page and from updates.
4. The version number you upload must be higher than what's installed - it is
   compared against `version` in `Frontend/electron/package.json`, so bump that
   before each build.

Uploaded files live in `MasterControl/releases-data/` (git-ignored; back it up).
Upload size limit: `MASTER_MAX_UPLOAD_MB` (default 800).

## Running it locally (API + dashboard)

```bash
cd MasterControl
npm install
cp .env.example .env
# fill in MASTER_DATABASE_URL (a separate Neon database - see .env.example),
# MASTER_JWT_SECRET, MASTER_ENCRYPTION_KEY, MASTER_SETUP_KEY
npm run db:push
npm run dev:all
```

`dev:all` runs the API (`http://localhost:4100`) and the dashboard
(`http://localhost:4200`) together. Open `http://localhost:4200` in a
browser, click "First-time setup", and create your own admin account
using the `MASTER_SETUP_KEY` from `.env` - after that, everything below
(creating customers, provisioning databases, revealing/rotating license
keys, watching installation health) can be done from the dashboard
instead of `curl`. See `web/README.md` for more on the dashboard itself.

If you only want the API (e.g. to keep using `curl` / Postman, or you're
scripting something), `npm run dev` on its own still works exactly as
before - the dashboard is optional, not a replacement for the API.

Prefer the raw API? Here's the equivalent one-time admin setup by hand:

```bash
curl -X POST http://localhost:4100/api/admin/setup \
  -H "Content-Type: application/json" \
  -d '{"name":"Your Name","email":"you@example.com","password":"at-least-8-chars","setupKey":"<MASTER_SETUP_KEY from .env>"}'
```

That response includes a `token` - use it as `Authorization: Bearer <token>`
on every other request below.

## Running it in Docker

```bash
cd MasterControl
docker compose up --build
```

Same `.env` file, same port.

## Wiring up YOUR OWN store (as customer #1)

You don't need a second database for this - Master Control's tables live
in their own Postgres schema (`master_control`, see `db/src/schema/
pg-schema.ts`), so `MASTER_DATABASE_URL` can be the exact same connection
string as the main app's `DATABASE_URL`. Nothing collides.

1. In the dashboard (or via `curl`), create a customer record for your
   own business - name it after your shop. Copy the
   license key shown - it's only shown in full this once (later views go
   through "Reveal", which is logged).
2. Provision it with your EXISTING database's connection string (the
   same `DATABASE_URL` your main app already uses) - not a new one.
3. In the repo root `.env`, set `MASTER_API_URL` (where this API is
   reachable) and `MASTER_LICENSE_KEY` (the key from step 1). See the
   root `.env.example` for both.
4. Run `npm run build:windows` / `build:mac` again so the new build picks
   up those two values (same `prebuild:*` copy-`.env` step as
   `DATABASE_URL` already goes through).
5. Install/open the new build. On first launch it activates once
   automatically (no license-key screen to fill in - it's baked in, same
   as `DATABASE_URL` already is) and starts sending a heartbeat every
   60 seconds. Open the dashboard's Installations page and your till
   should show up as "online" within a minute.

Every till you build this way becomes its own installation row under the
same one customer record - exactly like a real customer with several
tills would look, just with your own business as customer #1.

## Onboarding a new customer (today's manual process)

1. Create the customer record:
   ```bash
   curl -X POST http://localhost:4100/api/customers \
     -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
     -d '{"name":"Jane Doe","businessName":"ABC Supermarket","contactPhone":"+234..."}'
   ```
   The response includes a `licenseKey` - this is what you'll give the
   customer once their database is ready (step 3).
2. Create a new database for them (e.g. a new Neon project, or a new
   database inside an existing Neon project) - the same way you created your
   own store's database originally.
3. Tell the Master API about it:
   ```bash
   curl -X POST http://localhost:4100/api/customers/<id>/provision \
     -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
     -d '{"databaseUrl":"postgresql://...their new database..."}'
   ```
4. Run the inventory app's own `npm run db:push` and `npm run db:seed`
   (or your admin-registration flow) against *that* new database, exactly
   like you did for your own store's, so it has the right tables before
   anyone logs in.
5. Build the installer with the public Master URL embedded, then give the
   customer the installer and their activation code. The customer enters only
   that code; the app retrieves the database connection from Master.

## Desktop app activation

```
POST /api/agent/activate
{ "licenseKey": "...", "deviceName": "POS-01", "appVersion": "1.0.0", "osVersion": "Windows 11" }

→ { "installationCode": "INS-XXXXXXXX", "agentToken": "...", "databaseUrl": "postgresql://..." }
```

The app saves `agentToken` and `databaseUrl` locally. The Master URL is
embedded in the installer; customer database credentials are not. The app
uses `agentToken` as a bearer token on:

```
POST /api/agent/heartbeat   { appVersion, osVersion, healthStatus, syncStatus }
POST /api/agent/errors      { module, severity, message }
```

## Checking on things as an admin

```
GET  /api/dashboard/summary
GET  /api/customers
GET  /api/customers/:id            (includes its installations)
GET  /api/installations
GET  /api/installations/:id
GET  /api/installations/:id/errors
```

## Security notes worth knowing

## Troubleshooting

**`db:push` fails with `schema "master_control" does not exist`:** fixed
as of this version - `npm run db:push`/`db:push-force` now automatically
run `db/scripts/ensure-schema.mjs` first, which creates the
`master_control` Postgres schema if it's missing before drizzle-kit tries
to create anything inside it. If you still hit this (e.g. an older
checkout), just run this once in Neon's SQL editor, then push again:
```sql
CREATE SCHEMA IF NOT EXISTS master_control;
```

**`db:push` asks "Is X enum created or renamed from another enum?"**
when `MASTER_DATABASE_URL` points at the same database as your main
app's `DATABASE_URL`: this is expected and harmless. drizzle-kit scans
the whole database, not just its own schema, so a `master_control` enum
that looks structurally similar to one of the main app's own enums
(`customer_status` vs. `customer_type`, etc.) gets flagged as a possible
rename. Always answer **"create enum"** (the option with `+`), never
"rename" - picking rename would try to rename one of your real POS
enums into a Master Control one. Skip the prompts entirely with
`npm run db:push-force`.

**"The master control-plane database schema hasn't been created yet"**
when creating your admin account: means `npm run db:push` hasn't
actually succeeded against the database `MASTER_DATABASE_URL` currently
points to. Double check you're running it from inside `MasterControl/`
(not the repo root, which has its own same-named `db:push` for the main
app's schema), and read the full output for a connection error or an
unanswered yes/no prompt rather than assuming it finished.


- Every customer's database connection string is encrypted at rest
  (`MASTER_ENCRYPTION_KEY`) - even someone with full read access to the
  master database can't see it without that separate key.
- The license key only ever authenticates the *first* activation of a
  device. After that, each device gets its own `agentToken` - if one
  device's token ever leaked, rotating it doesn't affect any other device
  or the customer's license key.
- Every admin action that touches a customer (create, edit, provision,
  reveal license key, rotate license key) is written to
  `master_audit_logs`. There's no API route to view them yet - that's
  part of the Master App dashboard, not built this round.
