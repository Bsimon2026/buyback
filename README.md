# BuyBack Platform — UAE launch (AED)

Mobile & laptop buyback for the UAE: customer quote → pickup → inspection → final offer → payment →
inventory → repair → resale → VAT-aware P&L.

Zero dependencies (Node 22.5+ only, `node:sqlite` + built-in http). No build step.

```bash
npm start          # http://localhost:8099 (customer)  /admin (staff)
npm test           # 63-check end-to-end run against a running server
```

First run creates `data/buyback.db` and seeds 34 devices in AED, the condition question sets, 5 UAE branches
and 4 staff accounts. **Reset by deleting `data/buyback.db*`.**

**Seeded logins (change before go-live):** `admin@indubaicity.com / admin123` (super admin),
`ops@indubaicity.com / ops12345`, `inspector@indubaicity.com / insp1234`, `finance@indubaicity.com / fin12345`.

---

## UAE-specific decisions baked in

| Area | Behaviour |
|---|---|
| Currency | **AED** is the base currency; quotes, offers and payouts are in dirhams and fils. Rounding step is 10 AED. |
| Payment rails | `bank_transfer`, `cheque`, `cash` — the Indian rails (UPI/IMPS/NEFT) are gone and the API refuses them. Cash is a policy switch, on by default (normal trade practice here). |
| VAT | Resale invoices are **VAT-inclusive at 5%**. The sale row stores the VAT contained (`vat_minor`, `vat_rate_bp`), and gross profit is computed **net of VAT**. Set the rate to 0 in Settings if you are below the AED 375k registration threshold. |
| KYC | Emirates ID / Passport / UAE driving licence / GCC national ID. |
| Branches | Abu Dhabi — Al Danah, Abu Dhabi — Mussafah, Dubai — Deira, Dubai — Al Barsha, Sharjah — Al Nahda. |
| Device identity | IMEI required for phones, serial required for laptops. |

VAT note: selling a used device you bought from a consumer is a margin-scheme question under UAE VAT rules.
The software records the numbers either way — **confirm the treatment with your accountant before invoicing**;
the profit figures assume standard 5% output VAT on the full selling price.

## Go-live checklist (do these in this order)

1. **Settings → Platform policies**: fill `Legal name`, `TRN`, `Registered address`. Invoices print `TRN: NOT SET`
   until you do, and the dashboard shows a red warning.
2. **Change the four seeded passwords** and delete/replace the seeded staff accounts (`admin@indubaicity.com` etc).
3. **Price master**: replace the seeded buy prices with today's real prices. Every edit is versioned and audited.
4. **Confirm the VAT treatment** with your accountant (see the VAT note above) — the software stores both figures,
   but which one you report is their call.
5. **Count a drawer against the dashboard cash position** on day one, so the habit exists before you scale.
6. Delete the demo trade: `rm data/buyback.db*` before the first real customer (it wipes the seeded catalogue too —
   re-seed by restarting, then re-enter your prices and TRN).

## Legal identity, brand and the legal pages

Two names are in play, and the software keeps them separate on purpose:

| Where | Name used |
|---|---|
| Site chrome, logo, browser title | **in Dubai City** — the domain / trade name (`company_name`) |
| Every document, footer block, terms and privacy page | **QAMAR ALNAJAH Audio-Visual, Recording Equipment & Accessories Trading L.L.C S.O.C** — the registered seller (`company_legal_name`) |

- **TRN `105531719000003`**, address (Shop No. 8, Nad Al Hamar, Dubai), phone `+971 56 163 8612` and email
  `connect@indubaicity.com` are settings, and they print on the purchase receipt, the tax invoice and the data
  certificate — along with the **Arabic legal name**, right-to-left, as UAE bilingual invoicing expects.
- Change any of it in Settings, or run `node scripts/set-legal-identity.mjs`. **Use the script for the Arabic
  name** — pasting Arabic through a shell/curl command corrupts it to `?????` (that happened once; the script
  exists so it cannot happen again).
- `trade_licence` and `domain` stay empty until you fill them; they print on documents once set.

Legal pages ship as real documents, not placeholders:

- **`/terms`** — 16 sections: who the contracting party is, eligibility, quotes-are-estimates, inspection and
  refusal rights, how the final price is set, payment and the VAT position (no VAT on buying from a private
  individual; 5% on resale), ownership/locks/blocked devices, data treatment, devices we don't buy, finality of
  sale, liability cap, complaints, governing law (Dubai courts), contact.
- **`/privacy`** — 14 sections aligned to **UAE Federal Decree-Law No. 45 of 2021 (PDPL)**: what is collected,
  the explicit statement that device contents are never read or copied, legal bases, cookies (none — two
  localStorage entries only), sharing, retention (5 years for order/tax/audit records), security, PDPL rights and
  how to exercise them, marketing, children, contact.

The flow's ownership declaration now links to `/terms`, so acceptance is recorded alongside the order.

**Not legal advice.** These were written to match how the software actually behaves and the UAE framework it
operates in. Have a UAE lawyer read them before relying on them in a dispute — particularly the retention
periods, the finality-of-sale clause, and whether your trade licence permits buying used devices at these
premises.

## Environmental positioning and the data claim

The landing page leads with the second-hand argument rather than the cash: **the greenest device is the one that
stays in use.** Every number on the site is sourced and printed with its citation at the foot of the page.

| Claim on the site | Source |
|---|---|
| 62 Mt of e-waste generated in 2022; 22.3% documented as formally recycled | Global E-waste Monitor 2024 (ITU / UNITAR) |
| US$91bn of metals embedded; US$28bn actually recovered | Global E-waste Monitor 2024 |
| 56 kg CO₂e to build an iPhone 15 (128GB), ~80% of it in production | Apple, *iPhone 15 Product Environmental Report*, Sept 2023 |

**On "100% deletion":** the site does not claim it, and neither should you. On modern phones the defensible
operation is a **cryptographic erase** (destroy the key, the ciphertext is useless) verified against
**NIST SP 800-88 Rev.2 (Purge)** and aligned to **IEEE 2883-2022**; where the media fails verification, or the
customer asks for it, the storage is **physically destroyed** and that is the only basis for "unrecoverable by any
means". The software can't prove a negative on failing flash, so it states the method it used.

What is built around that:

- **Data treatment is chosen by the customer at booking** — `reuse` (erase, refurbish, resell) or `destroy`
  (storage destroyed). Stored per order as `data_handling`.
- **A certificate is only issued after the device is paid for and the erase is actually recorded**
  (`POST /api/admin/orders/:code/sanitise`). It cannot be reissued silently, and
  `/doc/sanitisation/:code` returns **409 until then** — so a certificate can never exist for work that wasn't done.
- The certificate is generated from the order record — device, IMEI, serial, grade, custody reference, payment
  reference, method, standard, verification, operator, date — not typed by hand.
- `erasure_standard` and `erasure_tool` are settings: put your real tool in (`e.g. Blancco Mobile Diagnostics and
  Erasure`, ADISA-certified) and it prints on the certificate and the landing page.
- `recycling_partner` is a setting for the licensed UAE facility that takes devices you don't buy.

**Not built, and it matters for this positioning:** there is no weight-based recycling ledger yet — we don't record
kilos diverted from landfill or issue an annual impact statement to a corporate client. If you sell to businesses
(ITAD), that report is the thing they ask for, and it needs a `recycling_manifest` table plus weight capture at
handover.

## Design direction: the ledger

The site is built as a printed ledger rather than an app: white `#FFFFFF` with a cool light panel `#F4F5F2`, ink
`#12110F`, one vermilion accent `#C0392B`. Archivo for display, IBM Plex Mono for anything numeric or labelled, Inter Tight for body copy.

Rules that keep it from looking like a template:

- **No cards, no pills, no gradients, no glows.** Sections are separated by hairlines; the price list is a
  table with a header row, not a grid of tiles.
- **The product is the visual.** The hero's right column is the live price tape plus a rubber-stamp stub —
  not a stock photo of a phone.
- **Numbers are tabular and right-aligned**, in mono, because this is a money page.
- Left-aligned everything, numbered sections (`01 — Method`), a mono ticker strip instead of icon+badge trust
  rows.
- One photograph only, hard-cropped to greyscale for texture. Stock product photography is the clearest tell of
  an AI-generated site, so it is used as material, not as a hero.

Typography and palette live in `public/assets/styles.css`; layout in `public/assets/customer.css`.
The admin console reuses the same tokens on a dark surface (see the `:root` override at the top of
`public/admin.html`).

## Cash-first operation (the launch model)

- **Cash is the default payout method** — it is first in the payment picker and enabled by default. Bank transfer
  and cheque exist for when a customer asks.
- Every cash payout produces a **printable purchase receipt** (`/doc/receipt/<receipt-no>`, linked from the order
  after payment): device, IMEI, grade, amount, method, customer, and the ownership declaration. No VAT is charged
  on a purchase from a private individual, and the receipt says so.
- Every resale records **how the buyer paid** (cash / card / bank transfer).
- Dashboard shows a **daily cash position**: cash received on sales, cash paid out for devices, and the net
  movement to count the drawer against. `GET /api/admin/reports/cash?date=YYYY-MM-DD` returns it per branch,
  plus a split of sales and payouts by method.

## Paperwork: payout receipt + 5% VAT tax invoice

`src/docs.js` renders both documents server-side, print-ready (Cmd/Ctrl-P → PDF).

| Document | URL | Notes |
|---|---|---|
| Purchase receipt | `/doc/receipt/BUY-…` | cash/bank payout to the customer, no VAT, ownership declaration, signature lines |
| Tax invoice | `/doc/invoice/INV-…` | seller TRN, buyer TRN (optional, B2B), net + VAT 5% + total, second-hand "sold as seen" wording |

- VAT is **inclusive** in the selling price: `VAT = gross × 5 / 105`. The split is stored per sale row, so old
  invoices never change when you change the rate.
- **Reports → VAT summary** gives taxable sales, sales ex-VAT, VAT due and a monthly breakdown for the return.
- **Set your TRN before the first sale.** Until it is filled in, invoices print `TRN: NOT SET` and the dashboard
  shows a red warning — an invoice without a TRN is not a valid UAE tax invoice.

## Where the buy prices come from

Rule from the client: **we pay 85% of what a refurbished unit sells for** — a 15% markdown off the market price.
The markdown is an admin setting (`buy_markdown_bp`, default `1500`), not a constant, so changing it to 30% and
re-running `scripts/apply-market-prices.mjs` re-prices the whole catalogue with a full audit trail.

- `data/prices/price-master-uae.json` holds every device with: the refurbished retail median (AED), the resulting
  buy price, the confidence level and the source note. The script recomputes the buy price from the market figure
  and the current markdown setting, so this file stays a record of the research, not a hard-coded price list.
- Refurbished/renewed asking prices were read live on 2026-10-31 in AED — amazon.ae (Amazon Renewed),
  fonezone.ae, phonebay.ae, techorigins.ae, exphone.ae, jarir.com (Renewed Grade A), allware.com. No brand-new
  prices were used, so the buy price is anchored to the second-hand market we compete in.
- 20 of 34 variants have a market-derived price. The other 14 had **no refurbished listing anywhere reachable**
  (mostly 2023–24 mid-tier Androids and the MacBook Pro 14 M3 16/512, which the UAE refurb market simply doesn't
  carry). Those keep an estimate and are marked **unverified** in the admin price master — don't buy those models
  until you've priced them.
- Re-apply or refresh: `node scripts/apply-market-prices.mjs` (dry run) then `--apply`. It writes through the admin
  API, so every change lands in `device_prices` history and `audit_logs` with the source note.
- The marketing grid on the home page only advertises models with researched prices.

Low-confidence prices worth re-quoting before launch: ThinkPad E14 (single Amazon listing), Vivobook 15
(config mismatch across sources), Acer Aspire 5 (single Jarir grade-A listing at AED 2,649, which looks high for
that model — our buy price of 1,850 is likely too generous).

## Currency is an admin setting (not a constant)

- `settings.base_currency` drives every new quote, order, offer and payment.
- Every money row stores integer **minor units** (fils/cents) **plus its own currency**, so switching currency
  never revalues history. The test asserts it: after switching to USD, the old order still reads AED.
- Settings → Currency lets the admin change currency and optionally **convert the price master** at a rate
  they supply. Converted values are rounded to whole units (a price list must not read AED750.03) and the full
  price history is kept.
- No conversion + a device priced in the old currency ⇒ the quote **fails with a 409 naming the fix**, rather
  than guessing a rate. A guessed rate is a wrong payout.
- Formatting uses each currency's real decimal count (JPY 0, KWD 3).

## One price engine, used twice

`src/pricing.js` scores the customer's declared answers and the inspector's confirmed findings with the same
code. There is no separate staff price list — that's where buyback businesses leak money.

```
estimate = base price + Σ option adjustments   (flat minor units, or % of base)
         clamped to ≥ 15% of base
         rounded to the nearest 10 AED
range    = estimate ± 5%      ← what the customer sees
```

All three knobs are admin settings. Example: iPhone 15 128GB at AED 1,650 with body "Excellent" → `AED1,640 – AED1,820`.

## Fraud controls that are enforced (and tested)

- IMEI duplicate detection against live orders *and* existing stock.
- **Partial inspection rejected** — an unanswered checklist item scores as "no deduction" and inflates the
  offer. Everything must be recorded, or an admin overrides *with a reason*.
- Overrides, price changes, currency changes, payments and sales all write `audit_logs` with old value, new
  value, actor, reason and timestamp.
- IMEI masked to the last 4 digits on the customer tracking page.
- Role guards on every admin route — an inspector cannot read the price master or touch currency.
- Cash payout gated by policy; the Indian payment rails are explicitly refused.

## Built and working

Customer (`/`): brand → model → variant → condition questions → **KYC + device + pickup details** → price range
with per-answer breakdown → book pickup → order code → tracking timeline → accept/reject.

The order matters: the price is withheld until the details step is complete, so every quote is tied to a real
person and a real device. Nothing is booked until the customer has seen the number.

Admin (`/admin`): dashboard (purchases, sales, VAT collected, net gross profit, pending queues, stock value) ·
orders + search · order detail with inspection checklist, computed offer and audited override · payment
(bank transfer / cash / cheque) creating the stock unit and receipt · inventory with repairs, listing price,
VAT and expected profit · resale with VAT-aware gross profit · price master with versioned history · reports
with VAT · settings (currency, VAT, policies) · audit log.

## NOT built yet — read before promising anything

1. **Notifications don't send.** Rows queue in `notifications` on every status change; no SMS/WhatsApp/email
   provider is wired (UAE options: Unifonic, Infobip, Twilio, WhatsApp Cloud API).
2. **KYC is captured, not verified.** No ICP/Emirates ID integration, no document upload, no file storage.
3. **Photo capture** — fields are wired end to end, no upload endpoint or storage.
4. **Coupons, referrals, expenses: tables only.** No routes/UI. Branch CRUD and user-management UI also pending.
5. **No FTA / e-invoicing integration** and no Arabic-language invoice. Documents print from the browser as PDF;
   there is no document archive (the HTML is regenerated from the database on demand).
6. **Pledge / lending module**: schema only, deliberately — needs a licence or a regulated partner first.
7. **Auth is pilot-grade**: 12-hour bearer tokens, scrypt hashing, no 2FA/rate-limit/password-reset.
8. **SQLite, single node.** Schema ports to PostgreSQL cleanly; do that before multi-branch volume.
9. **No deployment automation** — no Dockerfile, no TLS, no backups.

## API map

```
GET  /api/config                       currency, VAT rate, branches
GET  /api/catalog?category=mobile|laptop      GET /api/questions?category=
POST /api/quote                        {variantId, category, answers} → range + breakdown
POST /api/orders                       quote + customer + KYC + pickup → order code
GET  /api/orders/:code                 public tracking
POST /api/orders/:code/accept|reject
POST /api/auth/login|logout            GET /api/auth/me
GET  /api/admin/dashboard | orders | orders/:code | inventory | inventory/:stockId
POST /api/admin/orders/:code/inspection | payment | status
POST /api/admin/inventory/:stockId/repair | list | sale
GET/POST /api/admin/prices             price master + versioned history
POST /api/admin/currency               switch currency (convertPrices, rate, reason)
POST /api/admin/settings | fx | users  GET /api/admin/audit | reports | payment-methods
```

## Tests

`npm test` (77 checks) asserts exact AED amounts (not just HTTP 200), the floor and band, duplicate IMEI, ownership
declaration, role denials, inspection → offer → acceptance → payment → stock → repair → sale, **VAT split and
VAT-net profit**, double-sale refusal, cash policy toggle, refusal of UPI, partial-inspection rejection, audit
entries, AED→USD→AED round trip with historical-currency preservation, and the laptop question set.

77 checks, all green. Both surfaces, both printed documents and the cash/VAT reports were also walked in a real browser.
