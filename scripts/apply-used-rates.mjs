// Apply the parsed used-market rates to the catalogue.
//   node scripts/apply-used-rates.mjs            dry run: prints every change, writes nothing
//   node scripts/apply-used-rates.mjs --apply    writes through the audited admin API
//
// Rule: the pasted numbers are used SELLING prices. We buy at 70% of that (the 30% margin),
// rounded to the nearest AED 10. That figure is the base the site shows before questions.
import fs from 'node:fs';

const BASE = process.env.BASE || 'https://recycle.indubaicity.com';
const EMAIL = process.env.ADMIN_EMAIL || 'admin@indubaicity.com';
const PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const APPLY = process.argv.includes('--apply');
const MARKDOWN = Number(process.env.MARKDOWN_PCT || 30) / 100;
const STEP = 10;

const data = JSON.parse(fs.readFileSync('data/prices/used-rates.json', 'utf8'));
const devices = data.devices;

const round10 = (n) => Math.round(n / STEP) * STEP;
const baseFor = (used) => round10(used * (1 - MARKDOWN));
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${out.error || res.status}`);
  return out;
}

const { token } = await call('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });

// index the live catalogue by brand|model|variant (normalised)
const catalogue = await call('/api/catalog?category=mobile');
const brands = Array.isArray(catalogue) ? catalogue : (catalogue.brands || []);
const index = new Map();
for (const b of brands) for (const m of (b.models || [])) for (const v of (m.variants || [])) {
  index.set(`${norm(b.name)}|${norm(m.name)}|${norm(v.variant)}`, { variantId: v.id, brand: b.name, model: m.name, variant: v.variant, current: v.basePrice && v.basePrice.minor });
}

const plan = { update: [], create: [], same: [] };
for (const d of devices) {
  const base = baseFor(d.price);
  const hit = index.get(`${norm(d.brand)}|${norm(d.model)}|${norm(d.variant)}`);
  if (hit) {
    const current = hit.current ? Math.round(hit.current / 100) : null;
    if (current !== base) plan.update.push({ ...d, base, current, variantId: hit.variantId });
    else plan.same.push({ ...d, base });
  } else {
    plan.create.push({ ...d, base });
  }
}

console.log(`rule: base = ${((1 - MARKDOWN) * 100).toFixed(0)}% of used selling price, rounded to AED ${STEP}`);
console.log(`parsed devices: ${devices.length}  ->  update ${plan.update.length} | create ${plan.create.length} | already correct ${plan.same.length}\n`);

const line = (r) => `   ${(r.brand + ' ' + r.model).padEnd(30)} ${r.variant.padEnd(11)} used ${String(r.price).padStart(5)} -> base ${String(r.base).padStart(5)}${r.current != null ? `  (was ${r.current})` : '  (new)'}`;

const apple = plan.update.filter((r) => r.brand === 'Apple');
console.log(`iPhone re-prices (${apple.length}):`);
for (const r of apple.sort((a, b) => a.model.localeCompare(b.model) || a.variant.localeCompare(b.variant))) console.log(line(r));

console.log(`\nOther re-prices: ${plan.update.length - apple.length}`);
console.log(`New devices to create: ${plan.create.length}`);
const newBrands = [...new Set(plan.create.map((r) => r.brand))];
console.log(`   brands involved: ${newBrands.join(', ')}`);

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply.');
  process.exit(0);
}

let updated = 0, created = 0, failed = [];
for (const r of plan.update) {
  try {
    await call('/api/admin/prices', { method: 'POST', token,
      body: { variantId: r.variantId, basePrice: r.base, note: `used market ${r.price} AED, ${(MARKDOWN * 100).toFixed(0)}% margin` } });
    updated++;
  } catch (e) { failed.push(`${r.brand} ${r.model} ${r.variant}: ${e.message}`); }
}
for (const r of plan.create) {
  try {
    await call('/api/admin/variants', { method: 'POST', token,
      body: { category: 'mobile', brand: r.brand, model: r.model, variant: r.variant, basePrice: r.base } });
    created++;
  } catch (e) { failed.push(`${r.brand} ${r.model} ${r.variant}: ${e.message}`); }
}

console.log(`\nAPPLIED: ${updated} updated, ${created} created, ${failed.length} failed`);
for (const f of failed) console.log('   FAIL', f);
