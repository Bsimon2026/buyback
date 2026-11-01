// Apply the researched UAE refurbished-market prices to the live price master.
//   node scripts/apply-market-prices.mjs            (dry run: prints the plan)
//   node scripts/apply-market-prices.mjs --apply    (writes, via the admin API so audit + history are kept)
//
// Rule: buy price = 70% of the refurbished retail median, rounded to the nearest AED 10.
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8099';
const FILE = new URL('../data/prices/price-master-uae.json', import.meta.url);
const APPLY = process.argv.includes('--apply');

const plan = JSON.parse(fs.readFileSync(FILE, 'utf8'));

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${data.error || res.status}`);
  return data;
}

const login = await call('/api/auth/login', { method: 'POST', body: { email: 'admin@indubaicity.com', password: 'admin123' } });
const token = login.token;
const settings = await call('/api/admin/settings', { token });
const markdownPct = Number(settings.buy_markdown_bp || plan.markdownBp || 1500) / 10000;
console.log(`Rule: we pay ${(100 - markdownPct * 100).toFixed(0)}% of the refurbished market price (markdown ${(markdownPct * 100).toFixed(0)}%)
`);
const buyFromMarket = (refurb) => Math.round((refurb * (1 - markdownPct)) / 10) * 10;

const rows = await call('/api/admin/prices?limit=300', { token });
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
// "Apple" + "iPhone 15" -> "apple iphone 15";  "OnePlus" + "OnePlus 12" -> "oneplus 12" (don't double the brand)
const label = (brand, model) =>
  norm(String(model).toLowerCase().startsWith(String(brand).toLowerCase()) ? model : `${brand} ${model}`);

let changed = 0, same = 0, missing = [];

for (const d of plan.devices) {
  const hit = rows.find((r) => label(r.brand, r.model) === norm(d.model) && norm(r.variant) === norm(d.variant));
  if (!hit) { missing.push(`${d.model} ${d.variant}`); continue; }

  const target = d.refurb ? buyFromMarket(d.refurb) : d.buy;
  const currentAED = hit.base_price_minor / 100;
  if (currentAED === target) { same++; continue; }

  const note = d.refurb
    ? `UAE refurb market AED${d.refurb} − ${(markdownPct * 100).toFixed(0)}% → AED${target} (${d.note})`
    : `no refurb price found — seeded estimate AED${target} (${d.note})`;

  console.log(`${APPLY ? 'SET ' : 'plan'} ${d.model} ${d.variant}: AED${currentAED} → AED${target}  [${d.confidence}]`);
  if (APPLY) {
    await call('/api/admin/prices', { method: 'POST', token,
      body: { variantId: hit.variantId, basePrice: target, note } });
  }
  changed++;
}

console.log(`\n${APPLY ? 'applied' : 'would change'}: ${changed} · already correct: ${same} · not in catalogue: ${missing.length}`);
if (missing.length) console.log('not in catalogue:', missing.join(', '));
if (!APPLY) console.log('\nRun with --apply to write these to the price master.');
