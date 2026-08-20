# Lead Distribution CRM — Ping & Post

A sovereign, self-hosted lead exchange. It runs the two-phase **Ping & Post**
auction used by real lead marketplaces, owns all of its data, and depends on no
third-party SaaS.

It is **not** built for any particular industry. A "vertical" is a row you
create at runtime with its own field schema, and that schema drives ping
validation, the lead forms, and the campaign filter builder. Adding a niche —
solar, legal, insurance, roofing, mortgage, anything — is a configuration action
in the dashboard. There is no industry name anywhere in the engine.

---

## Table of contents

- [What it does](#what-it-does)
- [The Ping & Post flow](#the-ping--post-flow)
- [Architecture](#architecture)
- [One-command setup](#one-command-setup)
- [The API contract](#the-api-contract)
- [Defining a new vertical](#defining-a-new-vertical)
- [Campaign controls](#campaign-controls)
- [Routing strategies](#routing-strategies)
- [Generic webhook delivery](#generic-webhook-delivery)
- [Deduplication](#deduplication)
- [The dashboard](#the-dashboard)
- [Tests](#tests)
- [Self-hosting and production notes](#self-hosting-and-production-notes)
- [Project layout](#project-layout)

---

## What it does

You sit between **sources** (people who generate leads) and **buyers** (people
who pay for them). A source offers you a lead; you run an instant auction across
every buyer campaign that qualifies; the highest-ranked buyer wins; you deliver
the lead to their system and record the sale.

| Concept | What it is |
| --- | --- |
| **Vertical** | A niche you define, with its own custom field schema. |
| **Source** | A lead publisher. Authenticates with an API key. |
| **Buyer** | A lead purchaser. Receives leads over a configurable webhook. |
| **Campaign** | A buyer's standing order: bid, geo, attribute filters, caps, schedule. |
| **Ping** | Phase 1 — non-PII attributes in, ranked offers out. Never sells. |
| **Lead** | Phase 2 — the awarded lead, its price, and its delivery outcome. |

---

## The Ping & Post flow

Two HTTP calls per lead. A ping never sells; a post always references a prior
ping.

```
┌──────────┐                                          ┌──────────────────────┐
│  SOURCE  │                                          │   BUYER CAMPAIGNS    │
└────┬─────┘                                          └──────────┬───────────┘
     │                                                           │
     │  ① POST /api/ping                                         │
     │     X-Api-Key: <source key>                               │
     │     { vertical, state, zip, ...attributes }               │
     │     ── NO PII ──                                          │
     ├──────────────────────────►┌───────────────────┐           │
     │                           │  MATCHING ENGINE  │◄──────────┤
     │                           │                   │  for each campaign:
     │                           │  geo → filters →  │   active? buyer active?
     │                           │  schedule → caps  │   state/zip? rules?
     │                           │        ↓          │   inside schedule?
     │                           │   RANK by active  │   under its caps?
     │                           │      strategy     │
     │                           └─────────┬─────────┘
     │  ◄────────────────────────────────  │
     │  { ping_id, status, expires_at,     │   Ping row persisted:
     │    winner, offers[], rejected[] }   │   payload, offers, rejections
     │                                     │
     │  ── nothing sold, nothing charged ──│
     │                                     │
     │  ② POST /api/post                   │
     │     { ping_id, campaign_id?,        │
     │       ...full lead INCLUDING PII }  │
     ├──────────────────────────►┌─────────┴─────────┐
     │                           │ validate ping is  │
     │                           │ open + unexpired  │
     │                           │        ↓          │
     │                           │ RE-RUN the auction│  caps/schedules are
     │                           │ (caps can change) │  re-checked at award
     │                           │        ↓          │
     │                           │  DUPLICATE CHECK  │  phone/email hash,
     │                           │        ↓          │  same vertical, in window
     │                           │   RECORD THE SALE │
     │                           └─────────┬─────────┘
     │                                     │  ③ deliver over webhook
     │                                     │     (json | form | xml,
     │                                     │      custom headers + mapping,
     │                                     │      timeout + retry/backoff)
     │                                     ├──────────────────────►┌──────────┐
     │                                     │                       │ BUYER'S  │
     │                                     │  ◄────────────────────│  SYSTEM  │
     │  ◄────────────────────────────────  │      2xx / error      └──────────┘
     │  { accepted, lead_id, sold_to,      │
     │    price, delivery: { ... } }       │   Lead row: sold → delivered
     │                                     │              or delivery_failed
```

Pings expire (default 5 minutes, configurable). An expired, already-posted, or
no-bid ping cannot be posted against.

---

## Architecture

```
┌─────────────────┐         ┌──────────────────────────────────────┐
│  Admin browser  │ ──────► │  /web   React + Vite + Tailwind      │
│                 │ cookie  │         shadcn/ui, Recharts,         │
└─────────────────┘  (JWT)  │         TanStack Query               │
                            └───────────────────┬──────────────────┘
┌─────────────────┐                             │  /api  (dev: Vite proxy)
│  Lead sources   │ ──────► ┌──────────────────▼──────────────────┐
│  (any HTTP      │ X-Api-  │  /api   Node 20+ · TypeScript ·     │
│   client)       │  Key    │         Express · Zod               │
└─────────────────┘         │                                     │
                            │  src/core/     pure engine, no I/O  │
                            │    filters · schedule · matching ·  │
                            │    ranking · dedup · verticalSchema │
                            │  src/services/ DB-aware orchestration│
                            │    auction · caps · ping · post ·   │
                            │    delivery                          │
                            │  src/routes/   HTTP surface          │
                            └───────────────────┬──────────────────┘
                                                │ Prisma
                            ┌───────────────────▼──────────────────┐
                            │  PostgreSQL 16 (docker-compose)      │
                            │  all your data, on your infra        │
                            └──────────────────────────────────────┘
                                                │ outbound webhooks
                            ┌───────────────────▼──────────────────┐
                            │  Buyer endpoints (any HTTP receiver) │
                            └──────────────────────────────────────┘
```

**The engine is pure.** Everything in `api/src/core` takes its inputs as
arguments — campaigns, attributes, the current time, cap counters — and returns
a decision. No database, no clock reads, no network. That is what makes the
auction unit-testable and what keeps industry knowledge out of it: the engine
only ever sees a `verticalId` and a bag of attributes.

---

## One-command setup

**Requirements:** Node.js 20+ and Docker (for Postgres).

```bash
git clone <your-fork> && cd Lead-Gen-SYS

cp api/.env.example api/.env      # defaults match docker-compose
npm run setup                     # install + start Postgres + migrate + seed
npm run dev                       # API on :4000, dashboard on :5173
```

`npm run setup` is the composite of:

```bash
npm install          # installs both workspaces
npm run db:up        # docker compose up -d db
npm run migrate      # prisma migrate deploy && prisma generate
npm run seed         # seed data; prints the admin login and API keys
```

Then open **http://localhost:5173** and sign in with the credentials the seed
printed (default `admin@leadgen.local` / `admin12345`).

Go to **Playground**, pick a vertical, hit **Ping**, then **Post to winner** —
you'll see the auction, the award, and the delivery in one screen.

### Without Docker

Point `DATABASE_URL` in `api/.env` at any PostgreSQL 14+ instance and run
`npm run migrate && npm run seed`. Nothing else assumes Docker.

### Useful scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the API and the dashboard together |
| `npm test` | Runs the API test suite (unit + integration) |
| `npm run build` | Type-checks and builds both workspaces for production |
| `npm run migrate` | Applies migrations and regenerates the Prisma client |
| `npm run seed` | Re-seeds (idempotent — safe to re-run) |
| `npm run db:up` / `db:down` | Starts / stops the Postgres container |

---

## The API contract

### Authentication

| Surface | Method |
| --- | --- |
| `POST /api/ping`, `POST /api/post` | `X-Api-Key: <source key>` |
| Everything under `/api/*` (management) | JWT in an httpOnly cookie from `POST /api/auth/login`, or `Authorization: Bearer <token>` |

Errors are always `{ "error": "...", "code": "...", "details"?: ... }` with a
meaningful HTTP status.

### `POST /api/ping`

Send only qualifying, non-PII attributes. Keys other than `vertical`, `state`
and `zip` are validated against the vertical's own field schema. Any PII the
source sends anyway is stripped before storage.

```http
POST /api/ping
X-Api-Key: lgs_seed_acme_5f3a9c21d84b47e0aa16
Content-Type: application/json

{
  "vertical": "home_improvement",
  "state": "CA",
  "zip": "90210",
  "homeowner": true,
  "property_age": 30,
  "timeline": "immediately",
  "project_type": "roofing"
}
```

```jsonc
{
  "ping_id": "6f1c1e6e-3e1a-4a1b-9f0e-2c5f0d9b1a77",
  "status": "open",                       // "open" | "no_bid"
  "expires_at": "2026-08-20T17:35:00.000Z",
  "routing_strategy": "bid",
  "vertical": "home_improvement",
  "matched": 4,
  "winner": {
    "campaign_id": "…", "campaign_name": "Premium Immediate Projects",
    "buyer_id": "…",    "buyer_name": "Northstar Exteriors",
    "bid": 68, "routing_priority": 20
  },
  "offers": [ /* every accepting campaign, ranked by the active strategy */ ],
  "rejected": [
    { "campaign_id": "…", "campaign_name": "Evening Bath Remodels",
      "reason": "filter:project_type",
      "detail": "expected project_type eq \"bath\", got \"roofing\"" }
  ]
}
```

**Rejection reasons** are machine-readable, so a source can tell *why* it didn't
get a bid: `campaign_inactive`, `buyer_inactive`, `vertical_mismatch`,
`geo_state`, `geo_zip`, `filter:<fieldName>`, `schedule`, `daily_cap`,
`monthly_cap`, `concurrency_cap`.

### `POST /api/post`

Now send the full lead, including PII, plus the `ping_id`.

```http
POST /api/post
X-Api-Key: lgs_seed_acme_5f3a9c21d84b47e0aa16
Content-Type: application/json

{
  "ping_id": "6f1c1e6e-3e1a-4a1b-9f0e-2c5f0d9b1a77",
  "campaign_id": "…",                     // optional; defaults to the top offer
  "first_name": "Jane",
  "last_name": "Doe",
  "phone": "555-010-1234",
  "email": "jane.doe@example.com",
  "address": "742 Evergreen Terrace",
  "state": "CA", "zip": "90210",
  "homeowner": true, "property_age": 30,
  "timeline": "immediately", "project_type": "roofing"
}
```

```jsonc
{
  "accepted": true,
  "lead_id": "…",
  "status": "delivered",                  // sold | delivered | delivery_failed | rejected_dup
  "price": 68,
  "sold_to": { "buyer_id": "…", "buyer_name": "Northstar Exteriors",
               "campaign_id": "…", "campaign_name": "Premium Immediate Projects" },
  "delivery": { "outcome": "delivered", "attempts": 1, "status": 200, "response": "…" },
  "vertical": "home_improvement"
}
```

A duplicate comes back `200` with `accepted: false`, `status: "rejected_dup"`,
`price: 0` and a `reason` of `duplicate_phone` or `duplicate_email`.

`campaign_id` must be one of the offers that ping returned. The auction is
re-run at post time, so a campaign that hit its cap between the ping and the
post no longer wins.

### Management API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/login` · `/logout` · `/password`, `GET /me` | Admin session |
| `GET POST PATCH DELETE` | `/api/verticals` | Niches and their field schemas |
| `GET POST PATCH DELETE` | `/api/sources` (+ `POST /:id/rotate-key`) | Publishers and API keys |
| `GET POST PATCH DELETE` | `/api/buyers` (+ `POST /:id/test-delivery`) | Purchasers and delivery config |
| `GET POST PATCH DELETE` | `/api/campaigns` | Bids, geo, filters, caps, schedule |
| `GET` | `/api/leads` (+ `POST /:id/redeliver`) | Sold-lead log, filterable |
| `GET` | `/api/pings` | Auction log |
| `GET` | `/api/stats`, `/stats/timeseries`, `/stats/rollup?by=…` | Reporting |
| `GET PATCH` | `/api/settings` | Routing strategy, dedup window, ping TTL, timezone |
| `GET` | `/health` | Liveness + database check |

Full worked examples for both seed verticals — plus creating a vertical, running
the bid war, switching strategies and triggering the dedup path — are in
[`requests.http`](./requests.http).

---

## Defining a new vertical

This is the whole point of the system: **a new niche is data, not code.**

**In the dashboard:** Verticals → New vertical → name it, then add fields
(name, label, type `text`/`number`/`enum`/`boolean`, required, enum options).
Save. It is immediately selectable in Campaigns and the Playground, its form
renders from the schema you just wrote, and `POST /api/ping` accepts it.

**Over the API:**

```http
POST /api/verticals
Content-Type: application/json

{
  "key": "commercial_solar",
  "name": "Commercial Solar",
  "fieldSchema": [
    { "name": "roof_sqft",  "label": "Roof Area (sq ft)", "type": "number",  "required": true },
    { "name": "ownership",  "label": "Building Ownership", "type": "enum",   "required": true,
      "options": ["owned", "leased"] },
    { "name": "decision_maker", "label": "Decision Maker", "type": "boolean", "required": false }
  ]
}
```

That single row now controls:

- **Ping validation** — required fields are enforced, numbers and booleans are
  coerced from their string forms, enum values are checked against the options.
- **The Playground form** — rendered field by field from the schema.
- **The campaign rule builder** — offers exactly these fields, with operators
  appropriate to each type.

`state` and `zip` are always collected and never need declaring. Unknown extra
attributes a source sends are preserved and remain filterable.

The seed ships two deliberately unalike examples — `home_improvement`
(homeowner / property_age / timeline / project_type) and `insurance`
(coverage_type / current_insurer / monthly_premium). **They are illustrations.**
Delete them and define your own; the engine never knew they were there.

---

## Campaign controls

Every campaign belongs to one buyer and one vertical, and bids only when *all*
of these pass:

| Control | Behaviour |
| --- | --- |
| **Bid** | Dollars per lead. What the buyer pays when they win. |
| **Routing priority** | Integer, lower is preferred. Decides the winner under the `priority` strategy. |
| **States / ZIPs** | Empty list means *no restriction*, not "matches nothing". |
| **Attribute filters** | `{ field, op, value }` over the vertical's fields, ANDed. Ops: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `contains`, `exists`. |
| **Schedule** | `{ days: [1–7], start: "HH:MM", end: "HH:MM" }`. Empty = 24/7. An `end` before `start` wraps past midnight. Evaluated in the platform timezone. |
| **Daily / monthly caps** | Awarded leads in the current local day/month. `0` = unlimited. |
| **Concurrency cap** | Leads awarded but not yet confirmed delivered. `0` = unlimited. |
| **Active** | Toggled inline from the Campaigns table. |

Filters compare loosely on purpose: `"30"` and `30`, `"true"` and `true`, and
`"IMMEDIATELY"` and `"immediately"` all match, because attributes arrive over
HTTP as strings. A **missing** attribute fails every operator except `ne` and a
negative `exists` — a campaign demanding `homeowner = true` never wins a ping
that never mentioned `homeowner`.

Caps are enforced **twice**: at ping time, so a capped campaign stops appearing
in offers, and again at post time, so a burst of concurrent pings can't oversell
it.

---

## Routing strategies

Set globally under **Settings** (or `PATCH /api/settings`). The strategy only
decides who is ranked *first* — the full ranked `offers[]` always goes back to
the source, which may take any of them.

| Strategy | Winner | Use it when |
| --- | --- | --- |
| `bid` *(default)* | Highest bid | You're running an open exchange and want maximum revenue per lead. |
| `priority` | Lowest `routingPriority` | Contractual preference outranks price — a waterfall to preferred buyers. |
| `round_robin` | Even rotation, one turn per ping, per vertical | You're distributing volume fairly across buyers. |

Ties break deterministically (bid → priority → campaign id), so the same inputs
always produce the same order. `round_robin` uses a per-vertical counter
incremented atomically in Postgres, so concurrent pings can't share a turn.

---

## Generic webhook delivery

**There are no vendor integrations in this codebase, by design.** A buyer is a
URL. Anything that can receive an HTTP request can be a buyer, and anything that
can send one can be a source.

Per buyer you configure:

- **`deliveryUrl`** — any endpoint. Empty means the lead is marked `sold` and
  waits for manual pickup on the Leads page.
- **`deliveryMethod`** — `json` (default), `form` (`application/x-www-form-urlencoded`),
  or `xml` (a flat `<lead>` document).
- **`deliveryHeaders`** — arbitrary headers, e.g. `{"Authorization": "Bearer …"}`.
- **`fieldMapping`** — optional `{ outgoing_name: "lead_field" }` remap, with dot
  paths supported. When non-empty it also acts as an **allow-list**: only mapped
  fields are sent, which is how you avoid handing a buyer PII they shouldn't get.

The delivered document is the full lead payload plus `lead_id`, `ping_id`,
`vertical`, `campaign_id`, `campaign_name`, `buyer_id`, `price`, `source_id`,
`source_name` and `received_at`.

Delivery retries with exponential backoff (3 attempts by default, tunable via
`DELIVERY_MAX_ATTEMPTS` / `DELIVERY_BACKOFF_MS` / `DELIVERY_TIMEOUT_MS`). 5xx,
408 and 429 are retried; other 4xx are treated as permanent, because a buyer
that rejected a lead won't accept it on the second try. The final status, HTTP
response and attempt count are recorded on the lead, and a failed delivery can
be retried by hand from the Leads page — **the sale still stands either way.**

**Buyers** → *Send test delivery* fires a synthetic lead at the configured
endpoint so you can verify the wiring before pointing live campaigns at it.

A local mock buyer is mounted at `/mock/buyer/:slug` outside production so the
full loop works out of the box; `GET /mock/deliveries` shows what it received.
Remove the mount in `api/src/app.ts` if you'd rather it never exist.

---

## Deduplication

On post, the phone and email are normalised and hashed with SHA-256:

- **Phone** → digits only, with a leading NANP `1` stripped from 11-digit
  values, so `(555) 010-1234`, `555-010-1234`, `+1 555 010 1234` and
  `15550101234` all collide. Note this rule is NANP-oriented: other country
  codes are not stripped, so `+44 20 …` and `020 …` hash differently. If you
  operate outside North America, normalise to E.164 before posting, or adjust
  `normalizePhone` in `api/src/core/dedup.ts` — it is a pure function with its
  own unit tests.
- **Email** → trimmed and lowercased.

A lead is rejected as `rejected_dup` if either hash matches a prior sale **in the
same vertical** inside the dedup window (default 30 days; `0` disables dedup).
The rejected attempt is still recorded, at price 0, so your fill-rate and
duplicate-rate reporting stays honest.

Only the hashes are indexed and compared — `Lead(verticalId, phoneHash, emailHash)`
— so dedup never requires scanning raw PII.

---

## The dashboard

| Page | What it's for |
| --- | --- |
| **Overview** | Revenue today/all-time, leads sold, fill rate, no-bid rate; revenue and fill-rate charts; top buyers; per-vertical filter. |
| **Verticals** | CRUD plus the field-schema builder. This is where a new niche is born. |
| **Campaigns** | Table of bid/geo/caps/schedule with inline active toggles; drawer with a rule builder driven by the selected vertical's schema, geo multiselect, caps and a dayparting editor. |
| **Buyers** | CRUD, delivery config (URL, format, headers, field mapping), and a *send test delivery* button. |
| **Sources** | CRUD, reveal/copy/rotate API keys, per-source volume and fill rate. |
| **Leads** | Searchable, paginated log; expand a row for the full payload and the buyer's delivery response; retry failed deliveries. |
| **Pings** | Every auction, with matched counts, best bid, and the full offers/rejections. |
| **Playground** | The ping → post tester. Forms render from the selected vertical's schema; shows ranked offers, per-campaign rejection reasons, the award and the delivery result. |
| **Settings** | Routing strategy, dedup window, ping TTL, platform timezone. |

The Playground calls the **public** API with an `X-Api-Key`, exactly as an
external source would — it is not a privileged shortcut, so what you see there
is what an integrating partner gets.

---

## Tests

```bash
npm test           # from the repo root, or: npm --workspace api run test
```

**89 tests, all passing.**

- **63 unit tests** over the pure engine — filter operators and their coercion
  rules, dayparting including midnight-wrapping windows and timezones, campaign
  matching and its rejection reasons, all three routing strategies, dedup
  normalisation and hashing, and field-schema validation.
- **26 integration tests** driving the real Express app over a real socket
  against a real Postgres, with a throwaway HTTP server standing in for the
  buyer: auth, the bid war, "a ping never sells", PII stripping, no-bid,
  award + delivery of PII, field-mapped form delivery, delivery failure,
  double-post, expiry, cross-source rejection, all four dedup behaviours,
  strategy switching, round-robin rotation, and cap enforcement.

The integration fixtures deliberately invent a nonsense vertical
(`widget_leasing`, with `fleet_size` / `lease_term` / `certified`) — if anything
passed because the code knew about a real industry, those names wouldn't work.

The integration suite needs `DATABASE_URL` to point at a reachable Postgres. It
creates and tears down its own fixtures and does not touch seed data.

---

## Self-hosting and production notes

### Everything is yours

No external accounts, no proprietary APIs, no phone-home. The only outbound
traffic is the webhooks you configure. Run it on a laptop, a VPS, or a cluster.

### Before you expose it

1. **Rotate the seed credentials.** The seeded API keys and admin password are
   fixed values committed to this repo. Rotate each source key (Sources →
   Rotate key) and change the admin password (`POST /api/auth/password`).
2. **Set a real `JWT_SECRET`.** The API refuses to boot in production with the
   development default. Use 32+ random bytes.
3. **Set `COOKIE_SECURE=true`** and terminate TLS in front of the API.
4. **Set `CORS_ORIGIN`** to your dashboard's real origin. It defaults to
   `http://localhost:5173`.
5. **Delete the example verticals** and define your own.
6. **Drop the mock buyer.** It is only mounted when `NODE_ENV !== 'production'`,
   but you can remove the mount in `api/src/app.ts` outright.

### Building and running

```bash
npm run build                                  # both workspaces
node api/dist/src/index.js                     # API (serve web/dist statically)
```

Serve `web/dist` from any static host or reverse proxy, and proxy `/api` and
`/health` to the API process.

### Auth model

Admins get a JWT in an `httpOnly`, `SameSite=Lax` cookie — no token is reachable
from JavaScript. `Authorization: Bearer` is also accepted for scripting.
Passwords are bcrypt-hashed, login is rate-limited to 20 attempts per 15
minutes, and a failed login runs a dummy compare so a missing account and a
wrong password take similar time. Source API keys are compared in constant time.

### Rate limiting

The public ping/post endpoints are limited per API key (falling back to IP),
configurable via `RATE_LIMIT_WINDOW_MS` and `RATE_LIMIT_MAX` — the defaults are
600 requests/minute per source. The app sets `trust proxy`, so put it behind a
reverse proxy that sets `X-Forwarded-For` correctly.

### Scaling to multiple nodes

The API is stateless — every piece of shared state lives in Postgres — so you
can run N instances behind a load balancer. Two details make that safe:

- The **round-robin cursor** is incremented with an atomic
  `INSERT … ON CONFLICT DO UPDATE … RETURNING`, so concurrent pings on different
  nodes never share a turn.
- **Caps are re-checked at post time**, not just at ping time, so parallel pings
  can't oversell a capped campaign.

Each instance runs a one-minute in-process sweeper that retires expired pings;
that work is idempotent, so several nodes doing it concurrently is harmless. If
you'd rather it ran once, remove the interval from `api/src/index.ts` and run
`expireStalePings()` from cron.

For high volume, move delivery onto a queue: `services/delivery.ts` is already
isolated, so enqueuing the call in `services/post.ts` and marking the lead
`sold` until a worker confirms is a contained change.

### Backups

All state is in Postgres.

```bash
docker compose exec db pg_dump -U leadgen leadgen | gzip > backup-$(date +%F).sql.gz
gunzip -c backup-2026-08-20.sql.gz | docker compose exec -T db psql -U leadgen leadgen
```

Back up nightly, keep the dumps off-box, and rehearse a restore. Lead payloads
contain PII — encrypt the backups at rest and apply whatever retention your
jurisdiction requires. Migrations are checked in under
`api/prisma/migrations`, so a restore plus `npm run migrate` reproduces any
schema version.

### Observability

The API logs one structured JSON line per request (method, path, status,
duration, correlation id, echoed as `X-Request-Id`) — pipe stdout into whatever
you already run. `GET /health` returns 503 when the database is unreachable, so
it works directly as a load-balancer and container health check.

---

## Project layout

```
.
├── docker-compose.yml          Postgres for local development
├── requests.http               Worked examples for both seed verticals
├── package.json                Workspace root; dev/setup/test scripts
│
├── api/
│   ├── prisma/
│   │   ├── schema.prisma       Vertical, Source, Buyer, Campaign, Ping, Lead, …
│   │   ├── migrations/         Checked in
│   │   └── seed.ts             Example data; prints credentials
│   └── src/
│       ├── core/               PURE ENGINE — no I/O, fully unit-tested
│       │   ├── filters.ts          operators + loose comparison
│       │   ├── schedule.ts         dayparting, timezone-aware
│       │   ├── matching.ts         does this campaign bid, and if not, why
│       │   ├── ranking.ts          bid | priority | round_robin
│       │   ├── dedup.ts            normalise + hash + compare
│       │   └── verticalSchema.ts   field schema → validation, PII stripping
│       ├── services/           DB-aware orchestration
│       │   ├── auction.ts          load campaigns, count caps, match, rank
│       │   ├── ping.ts             phase 1
│       │   ├── post.ts             phase 2: award, dedup, record, deliver
│       │   ├── delivery.ts         generic webhook, retries, mapping
│       │   ├── caps.ts             daily / monthly / concurrent counters
│       │   └── time.ts             timezone-aware period boundaries
│       ├── routes/             HTTP surface (public, auth, management, mock)
│       ├── middleware/         auth, rate limiting, request logging
│       └── tests/              6 unit suites + 1 integration suite
│
└── web/
    └── src/
        ├── components/
        │   ├── FieldSchemaBuilder.tsx   define a niche
        │   ├── RuleBuilder.tsx          filters from that niche's schema
        │   ├── DynamicFields.tsx        forms from that niche's schema
        │   ├── ScheduleEditor.tsx       dayparting
        │   └── ui/                      shadcn/ui components
        └── pages/              Overview, Verticals, Campaigns, Buyers,
                                Sources, Leads, Pings, Playground, Settings
```

---

## License

Yours to use, modify and self-host.
