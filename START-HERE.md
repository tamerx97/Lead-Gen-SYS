# Start here

This guide gets your lead system online. **No technical knowledge needed.**
It takes about 20 minutes, and most of that is waiting.

If you get stuck at any step, the [Troubleshooting](#if-something-goes-wrong)
section at the bottom covers the common problems.

---

## What you're setting up

A private website that only you can log into. It receives leads from your
suppliers, runs an instant auction between your buyers, sells each lead to the
highest bidder, and sends it straight to that buyer's system.

You'll end up with a web address like `https://leads.yourcompany.com` and a
password to get in.

---

## What it costs

| Thing | Cost | Why |
|---|---|---|
| A server | **$5–6/month** | The computer that runs it, on 24/7 |
| A domain name | **~$12/year** | Your web address |
| The software | **Free** | It's yours |

You do not need to buy anything else. There are no per-lead fees, no
subscriptions, and no company sitting between you and your data.

---

## Step 1 — Rent a server (5 minutes)

A "server" is just a computer in a data centre that stays on all the time.

1. Go to **[hetzner.com/cloud](https://www.hetzner.com/cloud)** (cheapest, ~$5/mo)
   or **[digitalocean.com](https://www.digitalocean.com/)** (easiest, ~$6/mo).
2. Create an account.
3. Create a new server with these settings:
   - **Location:** whichever is closest to you
   - **Image / operating system:** **Ubuntu 24.04**
   - **Size:** the cheapest option with **at least 2 GB of memory (RAM)**
   - **Authentication:** choose **password** and set one you'll remember
4. Click create. After about 30 seconds you'll see an **IP address** — four
   numbers like `203.0.113.45`.

**Write down the IP address and the password.** You need both next.

---

## Step 2 — Point your domain at it (5 minutes)

*Skip this step if you don't have a domain yet — see the note at the end of
this step.*

1. Log in wherever you bought your domain (GoDaddy, Namecheap, Cloudflare…).
2. Find the section called **DNS**, or **DNS records**, or **Manage DNS**.
3. Add a new record:
   - **Type:** `A`
   - **Name:** `leads` (this makes your address `leads.yourcompany.com`)
   - **Value / Points to:** the IP address from Step 1
   - **TTL:** leave as-is
4. Save.

This can take a few minutes to take effect. Go make a coffee.

> **No domain?** You can skip this entirely. The installer will use your IP
> address instead, and you'll reach the system at `http://203.0.113.45`.
> It works exactly the same, but the connection won't be encrypted — fine for
> testing, not ideal once you're handling real people's phone numbers. You can
> add a domain later and just re-run the installer.

---

## Step 3 — Run one command (10 minutes, mostly waiting)

Now you connect to your server and paste a single line.

**On Windows:** open **PowerShell** (press Start, type "PowerShell", hit Enter).
**On Mac:** open **Terminal** (press ⌘+Space, type "Terminal", hit Enter).

**1.** Connect to your server. Type this, replacing the numbers with your IP:

```
ssh root@203.0.113.45
```

It will ask `Are you sure you want to continue connecting?` — type `yes` and
press Enter. Then it asks for the password from Step 1. **Nothing appears as
you type the password — that's normal.** Type it and press Enter.

**2.** Now paste this single line and press Enter:

```
curl -fsSL https://raw.githubusercontent.com/tamerx97/Lead-Gen-SYS/main/install.sh | sudo bash
```

**3.** It will ask you two questions:

- **Domain:** type `leads.yourcompany.com` (or press Enter to use the IP address)
- **Email:** the email address you want to log in with

Then it does everything else by itself. It takes a few minutes and prints a lot
of text — that's normal, you can ignore it.

**4.** When it finishes you'll see a box like this:

```
────────────────────────────────────────────────────────────
  YOUR LEAD SYSTEM IS LIVE
────────────────────────────────────────────────────────────

  Open this in your browser:
    https://leads.yourcompany.com

  Sign in with:
    Email:     you@yourcompany.com
    Password:  v81Q8BvkGCbkTiClARiM

  Write this password down now — it is not shown again.
```

**Write down that password.** Then open the web address in your browser and
sign in.

> If the page doesn't load immediately, wait 1–2 minutes and refresh. The
> security certificate for your domain is being issued. It only happens once.

---

## Step 4 — Set it up for your business (15 minutes)

You're now looking at your dashboard. It's empty, which is correct — it's your
system, so it starts with none of our example data.

Do these four things in order. **Verticals first** — everything else depends on it.

### 1. Verticals — what kind of leads you handle

Click **Verticals** → **New vertical**.

A "vertical" is a type of lead. If you sell roofing leads, that's a vertical.
Insurance leads are a different vertical.

- **Display name:** what you call it, e.g. `Roofing`
- **Fields:** the questions you ask about each lead. Click **Add field** for each.

For a roofing vertical you might add:

| Label | Type | Required? |
|---|---|---|
| Homeowner | Yes / No | Yes |
| Roof age in years | Number | No |
| When do they want it done | Choice → `asap, 1-3 months, just looking` | Yes |

Click **Create vertical**.

> This is the heart of the system. Whatever fields you define here appear
> automatically everywhere else — in the forms, in the buyer rules, in the API.
> Adding a new type of lead later never requires a programmer.

### 2. Buyers — who you sell to

Click **Buyers** → **New buyer**.

- **Name:** the company buying your leads
- **Delivery URL:** where to send their leads. **Ask the buyer for this** — say:
  *"What's the webhook URL I should post leads to?"* Every CRM has one.
- Leave the rest as-is unless the buyer asked for something specific.

Click the **lightning bolt** button next to the buyer to send them a test lead.
If it goes green, they're connected. **Do this before sending real leads.**

> If a buyer can't give you a URL, leave it empty. Their leads will collect in
> the **Leads** page for you to send over manually.

### 3. Campaigns — what each buyer wants, and what they pay

Click **Campaigns** → **New campaign**.

- **Buyer:** who's buying
- **Vertical:** which type of lead
- **Bid:** what they pay per lead, e.g. `45.00`
- **States:** which states they want. **Leave empty to mean everywhere.**
- **Attribute filters:** their requirements, e.g. `Homeowner is yes`
- **Caps:** the most they'll take per day or month. `0` means unlimited.

One buyer can have several campaigns — different prices for different states or
lead qualities.

### 4. Sources — who sends you leads

Click **Sources** → **New source**.

Name it after your supplier. You'll get an **API key** — a long password.
Copy it with the copy button and send it to that supplier. That's what lets
them send you leads.

> If a supplier stops working with you, click **Rotate key**. Their old key
> stops working immediately.

---

## Step 5 — Test it before going live

Click **Playground**. This is a safe practice area — it uses your real setup
but you control it.

1. Pick your vertical and fill in a pretend lead.
2. Click **Ping**. You'll see every buyer who wants it, ranked by price, and
   the reason each other buyer said no.
3. Click **Post to winner**. The lead is sold and sent to that buyer.

Check with the buyer that it arrived. **Once that works, you're live.**

---

## Day-to-day use

| Page | What it's for |
|---|---|
| **Overview** | Your money: revenue today, leads sold, how many you're filling |
| **Leads** | Every lead you sold, who bought it, and whether it arrived |
| **Pings** | Every lead offered to you, including ones nobody wanted |
| **Campaigns** | Change prices and turn buyers on/off |
| **Settings** | How winners are chosen, and duplicate blocking |

**The two things worth checking weekly:**

- **Fill rate** on the Overview. If it drops, your buyers may be paused or have
  hit their caps.
- **Delivery status** on the Leads page. Red means a buyer's system rejected it
  — click the retry button, and tell them if it keeps failing.

---

## If something goes wrong

**The page won't load.**
Wait 2 minutes and refresh — the certificate takes a moment on first setup.
Still nothing? Check your domain's `A` record points at the right IP address.

**I forgot my password.**
Connect to your server (Step 3) and run:

```
cd /opt/leadgen && docker compose -f docker-compose.prod.yml exec app \
  node api/dist/src/scripts/createAdmin.js you@youremail.com 'your-new-password'
```

Use your real email and pick a password of at least 12 characters.

**I want to see what it's doing.**

```
cd /opt/leadgen && docker compose -f docker-compose.prod.yml logs -f
```

Press `Ctrl+C` to stop watching.

**Turn it off / back on.**

```
cd /opt/leadgen && docker compose -f docker-compose.prod.yml down
cd /opt/leadgen && docker compose -f docker-compose.prod.yml up -d
```

**Update to the newest version.**

```
curl -fsSL https://raw.githubusercontent.com/tamerx97/Lead-Gen-SYS/main/install.sh | sudo bash
```

Your data and password are kept.

---

## Protect your data

Your leads are real people's contact details. Two things matter:

**1. Back it up.** Run this to save a copy:

```
cd /opt/leadgen && docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U leadgen leadgen | gzip > ~/backup-$(date +%F).sql.gz
```

Then copy that file off the server — email it to yourself or put it in cloud
storage. Do this weekly, or set up the automatic version in `DEPLOY.md`.

**2. Keep your `.env` file private.** It lives at `/opt/leadgen/.env` and holds
your passwords. Never paste its contents anywhere.

---

## Want more detail?

- **`README.md`** — how the system works and the full technical reference
- **`DEPLOY.md`** — other ways to host it, backups, and running at larger scale
