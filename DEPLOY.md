# Deploying the buyback platform

A zero-dependency Node application. No build step, no `npm install`, no database server. One SQLite file holds
everything.

## 1. What you need

- **Node 22.5 or newer** (the app uses the built-in `node:sqlite`). Tested on Node 24.
- A host that can run a long-lived Node process **and** keep a file on disk.
- HTTPS on the real domain — the customer flow collects names, addresses and ID numbers.

## 2. Run it

```bash
node server.js
```

Then open `http://localhost:8099/` (customer) and `http://localhost:8099/admin` (staff console).

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8099` | HTTP port |
| `DATA_DIR` | `./data` | directory holding the database |
| `DB_FILE` | `$DATA_DIR/buyback.db` | full path to override the database file |

The first run creates and seeds the database: 34 device variants, five UAE branches, question sets, and four
staff accounts. The banner prints those accounts and their passwords — **change all of them before the site is
public.**

## 3. Host compatibility

| Host | Works? | Notes |
|---|---|---|
| Railway, Render, Fly.io, any VPS | ✅ | set `DATA_DIR=/data` and attach a volume |
| cPanel → *Setup Node.js App* | ✅ | point the startup file at `server.js`; keep the app root outside `public_html` |
| Shared hosting without Node | ❌ | it is not a static site |
| Vercel, Netlify | ❌ | no persistent filesystem and no long-lived process; would need Postgres plus a serverless rewrite |

**Persistent disk is not optional.** If the host wipes the filesystem on redeploy, every order, payment and
inventory record goes with it. Mount a volume and point `DATA_DIR` at it.

## 4. Before go-live

1. **Rotate every seeded password** — the four staff accounts in the banner are public knowledge.
2. **Check the legal identity** in Settings (or run `node scripts/set-legal-identity.mjs`): trade name, registered
   name, Arabic name, TRN, address, phone. These print on the receipt, the tax invoice and the data certificate.
   Never paste the Arabic name through a shell command — it corrupts to `?????`.
3. **Fill `trade_licence` and `domain`** in Settings. They stay off documents until set.
4. **Set `erasure_tool`** — the name of the certified erasure software you actually use. It prints on the
   sanitisation certificate. Leave it blank and the certificate says so rather than inventing one.
5. **Name your licensed recycling partner** in the settings used by the documents.
6. **Have a UAE lawyer read `/terms` and `/privacy`** before you rely on them in a dispute.
7. **Back up the database** daily: copy `data/buyback.db` along with any `-wal` / `-shm` files, or use
   `sqlite3 buyback.db ".backup copy.db"` for a consistent snapshot.
8. **Put TLS in front** — a reverse proxy (Caddy, nginx) or the host's own certificate. The app speaks plain HTTP
   and expects someone else to terminate TLS.

## 5. Verify a deployment

```bash
BASE=https://your-domain node scripts/e2e.mjs     # 86 end-to-end checks
```

The suite creates its own orders and devices. Run it against a staging database, not the live one — it is
re-runnable, but it does add records.

Quick manual checks: `/` renders the flow, `/admin` accepts a staff login, `/terms` and `/privacy` load, and a
completed order produces `/doc/receipt/<order>` and `/doc/sanitisation/<order>`.

## 6. Money and currency

The base currency is an admin setting (default **AED**). Every stored amount is an integer count of the
currency's smallest unit, and every row carries its own currency code — so changing the display currency never
rewrites history. Changing the base currency with *convert existing device prices* off only affects new quoting.
