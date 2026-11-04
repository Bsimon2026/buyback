// Which iPhone models have a base rate, and which do not. Reads the live catalogue.
const BASE = process.env.BASE || 'https://recycle.indubaicity.com';

const res = await fetch(BASE + '/api/catalog?category=mobile');
const json = await res.json();
const brands = Array.isArray(json) ? json : (json.brands || json.catalog || []);
const apple = brands.find((b) => /apple/i.test(b.name));
if (!apple) { console.log('no Apple brand in the catalogue'); process.exit(0); }

const rows = [];
for (const m of apple.models) {
  for (const v of (m.variants || [])) {
    rows.push({ model: m.name, variant: v.variant, id: v.id, price: v.basePrice && v.basePrice.minor });
  }
}

const priced = rows.filter((r) => r.price);
const unpriced = rows.filter((r) => !r.price);

console.log(`Apple: ${apple.models.length} models, ${rows.length} storage variants, ${priced.length} priced, ${unpriced.length} unpriced\n`);

console.log('PRICED');
for (const r of priced) console.log(`  ${r.model.padEnd(16)} ${String(r.variant).padEnd(8)} AED ${(r.price / 100).toFixed(0)}`);

console.log('\nUNPRICED');
for (const r of unpriced) console.log(`  ${r.model.padEnd(16)} ${String(r.variant).padEnd(8)} (variant ${r.id})`);

const modelsNoPrice = [...new Set(unpriced.map((r) => r.model))];
console.log('\nmodels with no rate at all:', modelsNoPrice.length ? modelsNoPrice.join(' | ') : 'none');
