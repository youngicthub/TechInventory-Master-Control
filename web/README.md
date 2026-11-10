# Master App dashboard

The browser UI for MasterControl's API - a standalone React + Vite app,
separate from both the main SuperMart POS frontend and the Master API
itself. It talks to the API purely over HTTP, so it can be run, deployed,
or restarted independently of it.

## Running it

From `MasterControl/` (the parent folder), the easiest way is:

```bash
npm run dev:all
```

This starts the API on `http://localhost:4100` and this dashboard on
`http://localhost:4200` together. Or, to run just the dashboard (useful
if the API is already running elsewhere, e.g. a deployed instance):

```bash
cd MasterControl/web
npm install
npm run dev
```

Open `http://localhost:4200`. If no admin account exists yet, use the
"First-time setup" tab (needs `MASTER_SETUP_KEY` from `MasterControl/.env`);
otherwise log in normally.

## Pointing it at a different API

By default it talks to `http://localhost:4100/api`. To point it somewhere
else (e.g. a deployed API, or a different port), copy `.env.example` to
`.env` in this folder and set `VITE_MASTER_API_URL`.

## What's here

- **Dashboard** - customer/installation/error counts at a glance.
- **Customers** - search, create (shows the license key once, on
  creation), open a customer to reveal/rotate their license key, mark a
  customer active/suspended, and provision their database connection.
- **Installations** - every activated device across every customer, with
  derived status (online/warning/offline/critical) and last-seen time;
  open one to see its reported errors.

Actions that need `super_admin` or `support_admin` (creating a customer,
provisioning a database, rotating a license key) are hidden for a
`monitoring_admin` account - matching the roles already enforced by the
API itself. Hiding the button here is a UX nicety, not the actual security
boundary - the API still checks the role in every case.

## Building for production

```bash
npm run build
```

Outputs static files to `dist/`. When the API serves the dashboard at
`/console/`, its assets use that path. Vercel builds use the site root.

### Deploy the dashboard to Vercel

The dashboard can run on Vercel independently, but the Master API must
remain on an always-on host with persistent storage. The API handles
desktop activation, database access, and uploaded installer files; Vercel
is only serving the browser dashboard.

1. Import this repository into Vercel and set **Root Directory** to `web`.
2. Use the Vite defaults: build command `npm run build` and output directory
   `dist`.
3. Add the Vercel environment variable `VITE_MASTER_API_URL` for the
   Production environment (and Preview if you use preview deployments), for example
   `https://api.example.com/api`. This is the public HTTPS URL of the
   separately hosted API, not the Vercel dashboard URL.
4. On the API host, set `MASTER_ALLOWED_ORIGINS` to the exact dashboard
   origin(s), comma-separated and without trailing slashes, for example
   `https://master.example.com,https://your-project.vercel.app`. Include a
   custom Vercel domain if you use one, then restart/redeploy the API.
5. Redeploy the Vercel project after saving its environment variable. Open
   the dashboard URL and create the first admin through the setup flow.

The desktop installer also needs the API's public origin embedded when it
is built (for example `https://api.example.com`), because devices call
`POST /api/agent/activate` there. Do not embed the Vercel dashboard URL
unless the API is actually served from that same origin. See the parent
README for the installer build and activation details, and
[`../deploy/README-DEPLOY.md`](../deploy/README-DEPLOY.md) for the existing
always-on Docker deployment.

## Not built yet

- No way to edit a customer's contact name/business name/phone from the
  UI yet (only status toggle) - use `PUT /api/customers/:id` directly if
  needed.
- No audit log viewer (the API writes `master_audit_logs` for every
  sensitive action, but there's no route or screen to read them back
  yet - see the main README's "Security notes").
- No way to add a second Master App admin account from the UI (only the
  one-time `/admin/setup` bootstrap) - would need a
  `POST /api/admins` route added to the API first.
