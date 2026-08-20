# Deploying

Three supported shapes, cheapest first. All of them keep the system sovereign:
your server, your database, your data.

| | Setup | Good for |
|---|---|---|
| **A. One container** (recommended) | `docker compose -f docker-compose.prod.yml up -d --build` | Almost everyone. One VPS, automatic HTTPS. |
| **B. No Docker** | `npm run build` + systemd | You already run Node and Postgres. |
| **C. Split tiers** | `api/Dockerfile` + `web/Dockerfile` | Separate web tier, CDN, or Kubernetes. |

In A and B the API also serves the dashboard, so there is **one origin, one
port, and no CORS to configure**. The session cookie just works.

---

> **Build verification status.** The container build is exercised on every push
> by [CI](.github/workflows/ci.yml): it builds all three images, boots the
> single-container image against a real Postgres, and asserts it serves the
> dashboard, handles client-side routes, still 404s unknown API routes as JSON,
> excludes the dev mock buyer, and can bootstrap an admin who then signs in.
> `web/nginx.conf` is loaded by the nginx image build but its runtime behaviour
> is not yet asserted.

## Before anything: what you need

- A server. 1 vCPU / 1 GB RAM handles a lot of pings; 2 vCPU / 2 GB is
  comfortable. Any VPS works — Hetzner, DigitalOcean, Vultr, Lightsail, EC2.
- A domain, with an **A record pointing at the server's IP**. Do this first:
  TLS issuance fails until DNS resolves.
- Ports **80** and **443** open inbound. Nothing else needs to be public —
  in particular, do not expose Postgres.

Generate your two secrets now:

```bash
openssl rand -base64 32   # POSTGRES_PASSWORD
openssl rand -base64 48   # JWT_SECRET
```

---

## A. One container with automatic HTTPS

```bash
git clone <your-repo> leadgen && cd leadgen

cp .env.production.example .env
nano .env          # set APP_DOMAIN, POSTGRES_PASSWORD, JWT_SECRET

docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f app
```

That starts three containers: Postgres (not published to the host), the app,
and Caddy, which obtains and renews a Let's Encrypt certificate for
`APP_DOMAIN` by itself. Database migrations run automatically on boot.

**Create your first admin** (the dev seed is not used in production):

```bash
docker compose -f docker-compose.prod.yml exec app \
  node api/dist/src/scripts/createAdmin.js you@example.com 'a-long-passphrase'
```

Then open `https://your-domain` and sign in. Go to **Verticals** and define
your first niche — production starts empty, with none of the example data.

### Check it's healthy

```bash
curl https://your-domain/health
# {"ok":true,"service":"lead-gen-sys","db":"up","time":"..."}
```

---

## B. No Docker (Node + Postgres directly)

Useful if you already run Postgres, or Docker isn't available.

```bash
# 1. Database
sudo -u postgres createuser leadgen --pwprompt
sudo -u postgres createdb leadgen -O leadgen

# 2. Build
git clone <your-repo> /opt/leadgen && cd /opt/leadgen
npm ci
npm run build                      # builds api + web

# 3. Configure
cp api/.env.example api/.env
nano api/.env
```

`api/.env` for production:

```ini
NODE_ENV=production
PORT=4000
DATABASE_URL="postgresql://leadgen:YOUR_PASSWORD@localhost:5432/leadgen?schema=public"
JWT_SECRET="<openssl rand -base64 48>"
COOKIE_SECURE=true
CORS_ORIGIN="https://your-domain"
# Serve the dashboard from this same process:
SERVE_WEB_DIR="/opt/leadgen/web/dist"
LOG_LEVEL=info
```

```bash
# 4. Migrate and create your admin
npm --workspace api run migrate
node api/dist/src/scripts/createAdmin.js you@example.com 'a-long-passphrase'

# 5. Run it
node api/dist/src/index.js
```

### As a systemd service

`/etc/systemd/system/leadgen.service`:

```ini
[Unit]
Description=Lead Distribution CRM
After=network.target postgresql.service

[Service]
Type=simple
User=leadgen
WorkingDirectory=/opt/leadgen
ExecStart=/usr/bin/node api/dist/src/index.js
Restart=always
RestartSec=5
EnvironmentFile=/opt/leadgen/api/.env
# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/leadgen

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now leadgen
sudo journalctl -u leadgen -f
```

Put Caddy or nginx in front for TLS. With Caddy, the entire config is:

```
your-domain {
	reverse_proxy 127.0.0.1:4000
}
```

---

## C. Split tiers

Use `api/Dockerfile` (API only) and `web/Dockerfile` (nginx serving the built
SPA and proxying `/api` to the API service). `web/nginx.conf` already does the
proxying, the SPA fallback, and the cache headers.

Because nginx proxies `/api` through, the browser still sees one origin. If you
instead serve the dashboard from a different hostname or a CDN, you must:

1. Set `CORS_ORIGIN` on the API to that exact origin.
2. Set `COOKIE_SECURE=true` and serve both over HTTPS.
3. Be aware the session cookie is `SameSite=Lax`, so a genuinely cross-site
   dashboard needs it changed to `SameSite=None` in
   `api/src/middleware/auth.ts`. Keeping one origin avoids this entirely — it
   is the reason the single-container layout is recommended.

### Managed Postgres

Any Postgres 14+ works — RDS, Cloud SQL, Neon, Supabase, Crunchy. Point
`DATABASE_URL` at it and drop the `db` service from the compose file. Most
managed providers require TLS:

```
DATABASE_URL="postgresql://user:pass@host:5432/leadgen?schema=public&sslmode=require"
```

### PaaS (Render / Railway / Fly.io)

The root `Dockerfile` is all these platforms need.

- **Build:** Dockerfile at the repo root. **Port:** 4000.
- **Health check path:** `/health`.
- Attach their managed Postgres and set `DATABASE_URL` from it.
- Set `JWT_SECRET`, `COOKIE_SECURE=true`, `CORS_ORIGIN=https://<your-app-url>`.
- Migrations run on container start; no release command needed.
- Create the admin from their shell/exec feature with `createAdmin.js`.

---

## First-boot checklist

Production starts with an empty database — no example verticals, no seeded API
keys. Working through this in order:

1. **Create your admin** — `createAdmin.js`, as above. Use a long passphrase.
2. **Define a vertical** — Verticals → New vertical. Add the attributes your
   niche qualifies on.
3. **Add buyers** — their webhook URL, body format, headers, and optional field
   mapping. Use **Send test delivery** to confirm the endpoint accepts a lead
   *before* pointing live campaigns at it.
4. **Create campaigns** — bid, geo, filters, caps, schedule.
5. **Add a source** — copy its API key and give it to the lead vendor. Rotate
   it from this screen whenever you need to; the old key dies immediately.
6. **Set your routing strategy, dedup window, ping TTL, timezone and phone
   region** under Settings.
7. **Smoke-test the loop** in the Playground: ping, check the offers, post,
   confirm the buyer received it.

> If you ever run `npm run seed` against production, it will insert the two
> example verticals and **two API keys that are published in this repo**.
> Don't — use `createAdmin.js` instead. If it happens by accident, delete those
> sources immediately (or rotate their keys) and remove the example verticals.

---

## Operating it

### Upgrades

```bash
cd /opt/leadgen && git pull
docker compose -f docker-compose.prod.yml up -d --build   # A
# or, for B:
npm ci && npm run build && npm --workspace api run migrate && sudo systemctl restart leadgen
```

Migrations are applied automatically on boot in A and C. They are additive and
take an advisory lock, so a rolling restart across replicas is safe.

### Backups

Everything is in Postgres. Nightly dump, kept off the box:

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U leadgen leadgen | gzip > leadgen-$(date +%F).sql.gz
```

As a cron entry:

```cron
15 3 * * * cd /opt/leadgen && docker compose -f docker-compose.prod.yml exec -T db pg_dump -U leadgen leadgen | gzip > /var/backups/leadgen-$(date +\%F).sql.gz && find /var/backups -name 'leadgen-*.sql.gz' -mtime +30 -delete
```

Restore:

```bash
gunzip -c leadgen-2026-08-20.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T db psql -U leadgen leadgen
```

Two things worth doing rather than assuming: **rehearse a restore** into a
scratch database, and **copy the dumps off the server**. Lead payloads contain
PII, so encrypt them at rest and apply whatever retention your jurisdiction
requires.

### Scaling

The API is stateless — all shared state is in Postgres — so you can run several
replicas behind a load balancer. Two details already make that safe: the
round-robin cursor is incremented with an atomic `INSERT … ON CONFLICT DO
UPDATE … RETURNING`, and caps are re-checked at post time, not just at ping
time, so parallel pings can't oversell a capped campaign.

Each instance runs a one-minute sweeper that retires expired pings. It's
idempotent, so several nodes doing it concurrently is harmless.

When outbound delivery becomes the bottleneck, move it to a queue:
`api/src/services/delivery.ts` is already isolated, so enqueue the call in
`services/post.ts` and leave the lead `sold` until a worker confirms.

### Monitoring

- `GET /health` returns 503 when the database is unreachable — wire it straight
  into your load balancer and uptime checker.
- The API logs one JSON line per request (method, path, status, duration,
  request id). Ship stdout wherever you already collect logs.
- Worth alerting on: `delivery_failed` leads climbing (a buyer's endpoint is
  down), fill rate dropping (campaigns paused or capped out), and ping volume
  falling to zero (a source broke).

### Security posture

- Firewall everything except 80/443. Postgres must not be reachable publicly.
- `JWT_SECRET` must be real. In production the API refuses to boot if it is a
  placeholder published in this repo, or shorter than 32 characters.
- Rotate source API keys from the Sources page whenever a partner relationship
  changes.
- Give each buyer a `fieldMapping`. It doubles as an allow-list, so a buyer
  receives only the fields you mapped and no other PII.
- Keep `COOKIE_SECURE=true` and serve only over HTTPS.
- Back up before every upgrade.
