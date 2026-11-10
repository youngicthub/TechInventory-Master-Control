# Putting the Master server on the internet

This makes your landing page and the installers downloadable by anyone, at
`https://your-domain`. It needs a small always-on Linux server (a ~$5/month VPS
from DigitalOcean, Hetzner, Vultr...) and a domain name. Your laptop does not
need to stay on.

## Using Vercel for the dashboard

For a split deployment, use this VPS for the API and persistent installer
storage, and deploy `web/` to Vercel as described in
[`../web/README.md`](../web/README.md). Give the API its own HTTPS hostname,
such as `api.example.com`, and use that hostname for both
`VITE_MASTER_API_URL=https://api.example.com/api` in Vercel and the desktop
installer's embedded Master URL (`https://api.example.com`). Set
`MASTER_ALLOWED_ORIGINS` in the API's `.env` to the exact Vercel dashboard
origin(s). Customer devices activate against the API, not the dashboard.

## One-time setup

1. Create the server (Ubuntu 22.04+). Install Docker:
   `curl -fsSL https://get.docker.com | sh`
2. In your domain's DNS, add an **A record**: `master` (or whatever you like) ->
   the server's IP address (for a Vercel split deployment, use `api`).
   Wait a few minutes for it to spread.
3. Copy this project to the server (the `MasterControl/` and `Landing/` folders),
   e.g. `scp -r` or `git clone`. **Do not copy your laptop's `node_modules`.**
4. On the server, create `MasterControl/.env` with the same values as on your Mac
   (database URL and the three secrets). Generate new secrets for production:
   `node MasterControl/scripts/gen-secrets.mjs`.
5. Create `MasterControl/deploy/.env` containing one line:
   `DOMAIN=master.example.com`
6. Start it:
   ```bash
   cd MasterControl/deploy
   docker compose up -d --build
   ```
   First start takes a few minutes. Then open `https://master.example.com/` (the
   download page) and `https://master.example.com/console/` (admin).

If you moved to new secrets, the master admin account made on your Mac won't
carry over unless the database is the same and `MASTER_JWT_SECRET` is the same -
simplest is to create the admin again at `/console/` (setup key from the new `.env`)
or keep the same `.env` values you already use.

## Publishing installers to it

Build with the public address baked in, then upload (from your Mac, in the repo root):

```bash
npm run package:all -- --master-url=https://master.example.com
npm run publish:release -- --server=https://master.example.com
```

The download buttons go live within about 30 seconds.

## Everyday commands (on the server, in `MasterControl/deploy`)

| Do this | Command |
|---|---|
| See what's happening | `docker compose logs -f master` |
| Update after changing the code | `docker compose up -d --build` |
| Stop | `docker compose down` (the uploaded installers are kept) |

Uploaded installers live in a Docker volume named `releases`. Back it up if you
can't rebuild the installers easily.
