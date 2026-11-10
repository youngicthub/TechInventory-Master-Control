# What changed in this round

**Master admin login / setup (hardened)**
- Login page now asks the API whether an admin exists and shows setup OR login, not both.
- Setup is race-safe (transaction + advisory lock), constant-time key check, rate limited.
- Login: per-device rate limit, per-account lockout (5 tries / 15 min), no "which emails exist" timing or message leaks, audit-logged.
- Sessions are verified against the database each request (deactivate/role change/logout/password change apply immediately).
- New: change password, forced change for temporary passwords, logout everywhere.
- Startup guard refuses to boot on missing/weak/duplicated secrets (see "Your .env" below).

**Admin management** - `/api/admins` (super admin only) + Admins page.
**Audit log viewer** - `/api/audit-logs` + Audit log page.

**Releases / downloads / updates**
- `app_releases` table; streamed upload with checksum; Releases page.
- Public: `GET /api/public/releases`, `GET /api/downloads/:platform`; landing page reads these live (Windows, Mac, Linux).
- Installed apps: `GET /api/agent/update-check`, `GET /api/agent/download/:id` (device token required, suspended customers blocked).
- Desktop: `master-agent.cjs` downloads + SHA-256-verifies, `main.cjs` asks before installing.

**Hosting** - one process serves landing (`/`), dashboard (`/console/`) and API (`/api`); binds to 127.0.0.1 by default.

## Your .env (action needed)
`MasterControl/.env` as shipped would let setup succeed but break later:
- `MASTER_ENCRYPTION_KEY` is 68 characters (must be exactly 64 hex) - provisioning a customer or activating a device would throw.
- `MASTER_ENCRYPTION_KEY` and `MASTER_SETUP_KEY` are the same value.
- Both `.env` files in the zip contain a live database connection string. Rotate the Neon password and avoid sharing zips with `.env` in them.
Run `npm run gen:secrets` and paste the three new values in. (Safe now: no customer database has been provisioned with the old key. If you had, re-run "provision" for each after changing it.)

## Needs `npm run db:push` (MasterControl/)
New columns on `master_admins` (token_version, must_change_password, failed_login_count, locked_until), new `release_platform` enum and `app_releases` table. Answer "create" (not "rename") to any enum prompt.
