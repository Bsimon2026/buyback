// Set iPhone buy prices from the Revibe (revibe.me) refurbished retail price.
//
//   node scripts/apply-revibe-prices.mjs                 # dry run, prints the table
//   node scripts/apply-revibe-prices.mjs --apply         # writes via the admin API (audited + versioned)
//   BASE=https://recycle.indubaicity.com node scripts/apply-revibe-prices.mjs --apply
//
// Rule (client's): buy price = retail − max(AED 150, 20% of retail), rounded to the nearest AED 10.
// Reference retail = median across colours of Revibe's "Good" grade for that exact model + storage,
// because that is the cheapest honest retail for the spec — the like-for-like comparison.
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8099';
const APPLY = process.argv.includes('--apply');
const SOURCE = 'https://revibe.me/collections/refurbished-iphones-uae/products.json?limit=250';
const FLOOR = 150;        // AED — never discount less than this
const PCT = 0.20;         // or 20% of retail, whichever is higher
const ROUND = 10;         // round the buy price to the nearest AED 10

const call = async (path, { method = 'GET', body, token } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${data.error || res.status}`);
  return data;
};

const median = (xs) => {
  const a = [...xs].sort((p, q) => p - q);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

// ---------- 1. read the market ----------
const raw = await (await fetch(SOURCE, { headers: { 'user-agent': 'Mozilla/5.0' } })).json();
const market = new Map();   // "iphone 13|128GB" -> [prices]

for (const p of raw.products || []) {
  const model = String(p.title).trim();
  for (const v of p.variants || []) {
    const parts = String(v.title).split('/').map((x) => x.trim());
    const storage = (parts.find((x) => /^\d+\s?(GB|TB)$/i.test(x)) || '').replace(/\s+/g, '').toUpperCase();
    const grade = (parts[parts.length - 1] || '').toLowerCase();
    if (!storage) continue;
    if (grade !== 'good') continue;                 // like-for-like: the cheapest honest retail condition
    const key = `${model.toLowerCase()}|${storage}`;
    if (!market.has(key)) market.set(key, []);
    market.get(key).push({ price: Number(v.price), colour: parts[0] });
  }
}

// ---------- 2. match to our catalogue ----------
const login = await call('/api/auth/login', { method: 'POST', body: { email: 'admin@indubaicity.com', password: 'admin123' } });
const token = login.token;
const rows = await call('/api/admin/prices?limit=500', { token });

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
const label = (brand, model) =>
  norm(String(model).toLowerCase().startsWith(String(brand).toLowerCase()) ? model : `${brand} ${model}`);

const plan = [];
for (const r of rows) {
  const storage = String(r.variant).replace(/\s+/g, '').toUpperCase();
  // Revibe titles have no brand prefix ("iPhone 13"), our rows are brand + model ("Apple" + "iPhone 13")
  const keys = [`${norm(r.model)}|${storage}`, `${label(r.brand, r.model)}|${storage}`];
  const prices = keys.map((k) => market.get(k)).find(Boolean);
  if (!prices || !prices.length) continue;

  const retail = median(prices.map((x) => x.price));
  const discount = Math.max(FLOOR, Math.round(retail * PCT));
  const buy = Math.round((retail - discount) / ROUND) * ROUND;
  const current = r.base_price_minor / 100;

  plan.push({
    variantId: r.variantId, model: `${r.brand} ${r.model}`, variant: r.variant,
    retail, discount, buy, current, colours: prices.length,
  });
}

plan.sort((a, b) => a.model.localeCompare(b.model) || a.variant.localeCompare(b.variant));

console.log(`source: ${SOURCE}`);
console.log(`rule  : buy = retail − max(AED${FLOOR}, ${PCT * 100}% of retail), rounded to AED${ROUND}`);
console.log(`basis : median of "Good" grade across colours, per model + storage\n`);
console.log('model                 storage  retail   cut   buy(new)  buy(now)  change  colours');
for (const p of plan) {
  const delta = p.buy - p.current;
  console.log(
    `${p.model.padEnd(21)} ${p.variant.padEnd(7)} ${String(p.retail).padStart(6)} ${String(p.discount).padStart(5)} ` +
    `${String(p.buy).padStart(9)} ${String(p.current).padStart(9)} ${(delta > 0 ? '+' : '') + delta}`.padStart(0) +
    `  ${String(p.colours).padStart(2)}`
  );
}

if (!plan.length) {
  console.log('\nNo overlap between Revibe models and our catalogue — nothing to do.');
  process.exit(0);
}

// ---------- 3. write ----------
if (APPLY) {
  const today = new Date().toISOString().slice(0, 10);
  let n = 0;
  for (const p of plan) {
    if (p.buy === p.current) continue;
    await call('/api/admin/prices', { method: 'POST', token, body: {
      variantId: p.variantId,
      basePrice: p.buy,
      note: `Revibe retail AED${p.retail} (median, Good grade, ${p.colours} colours, ${today}) − max(AED${FLOOR}, 20%) = AED${p.buy}`,
    } });
    n++;
  }
  console.log(`\napplied ${n} price change(s); ${plan.length - n} already correct.`);
} else {
  console.log(`\n${plan.reduce((n, p) => n + (p.buy !== p.current ? 1 : 0), 0)} would change. Run with --apply to write them.`);
}

// provenance snapshot, small enough to commit
fs.writeFileSync(new URL('../data/prices/revibe-reference.json', import.meta.url), JSON.stringify({
  source: SOURCE, fetchedAt: new Date().toISOString(), rule: { floorAED: FLOOR, percent: PCT * 100, roundTo: ROUND },
  reference: plan.map(({ model, variant, retail, discount, buy, colours }) => ({ model, variant, retail, discount, buy, colours })),
}, null, 2));
