// Plan the iPhone catalogue from the Revibe refurbished-retail feed.
//
//   node scripts/plan-iphone-catalogue.mjs
//
// Same rule the client signed off for the existing prices:
//   buy = retail − max(AED 150, 20% of retail), rounded to the nearest AED 10
// where retail = median across colours of Revibe's "Good" grade for that exact
// model + storage.
//
// Two guards keep obviously wrong source rows out of the catalogue:
//   * a "Good" price within 2% of the "New" price for the same variant is a
//     data-entry error at the source (Good is never the New price)
//   * a tier priced more than 45% above the next cheaper tier of the same model
//   * a tier priced below the cheaper tier (non-monotonic)
//
// Output: the SEED_DEVICES rows to paste into src/db.js, plus a provenance
// snapshot at data/prices/revibe-catalogue.json.
import fs from 'node:fs';

const SOURCE = 'https://revibe.me/collections/refurbished-iphones-uae/products.json?limit=250';
const FLOOR = 150;
const PCT = 0.20;
const ROUND = 10;
const MAX_TIER_JUMP = 1.45;
const GOOD_VS_NEW = 0.02;
// Everything from iPhone 15 up, plus the Air. Older families are unchanged.
const FAMILIES = /^iPhone (15|16|17|Air)\b/;
const STORAGE_RANK = (s) => (/TB$/.test(s) ? Number(s.replace(/TB/, '')) * 1024 : Number(s.replace(/GB/, '')));

const median = (xs) => {
  const a = [...xs].sort((p, q) => p - q);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

const raw = await (await fetch(SOURCE, { headers: { 'user-agent': 'Mozilla/5.0' } })).json();

// model | storage -> { good: [prices], new: [prices] }
const market = new Map();
for (const p of raw.products || []) {
  const model = String(p.title).trim();
  if (!FAMILIES.test(model)) continue;
  for (const v of p.variants || []) {
    const parts = String(v.title).split('/').map((x) => x.trim());
    let storage = (parts.find((x) => /^\d+\s?(GB|TB)$/i.test(x)) || '').replace(/\s+/g, '').toUpperCase();
    if (!storage) continue;
    if (storage === '1000GB') storage = '1TB';
    if (storage === '2000GB') storage = '2TB';
    const grade = (parts[parts.length - 1] || '').toLowerCase();
    if (grade !== 'good' && grade !== 'new') continue;
    const key = `${model}|${storage}`;
    if (!market.has(key)) market.set(key, { good: [], new: [] });
    market.get(key)[grade === 'good' ? 'good' : 'new'].push(Number(v.price));
  }
}

// group by model so the tier guards can compare neighbours
const byModel = new Map();
for (const [key, prices] of market) {
  if (!prices.good.length) continue;
  const [model, storage] = key.split('|');
  if (!byModel.has(model)) byModel.set(model, []);
  byModel.get(model).push({ storage, ...prices });
}

const rows = [];
const rejected = [];
for (const [model, tiers] of byModel) {
  tiers.sort((a, b) => STORAGE_RANK(a.storage) - STORAGE_RANK(b.storage));
  let prevRetail = 0;
  for (const t of tiers) {
    const retail = median(t.good);
    const newRetail = t.new.length ? median(t.new) : null;
    let why = null;
    if (newRetail && Math.abs(retail - newRetail) / newRetail <= GOOD_VS_NEW) why = `Good retail equals New retail (AED${newRetail})`;
    else if (prevRetail && retail < prevRetail) why = `cheaper than the tier below (AED${prevRetail})`;
    else if (prevRetail && retail > prevRetail * MAX_TIER_JUMP) why = `${Math.round((retail / prevRetail - 1) * 100)}% above the tier below (AED${prevRetail})`;
    if (why) { rejected.push({ model, storage: t.storage, retail, why }); continue; }

    const discount = Math.max(FLOOR, Math.round(retail * PCT));
    const buy = Math.round((retail - discount) / ROUND) * ROUND;
    rows.push({ model, storage: t.storage, retail, discount, buy, colours: t.good.length });
    prevRetail = retail;
  }
}

rows.sort((a, b) => a.model.localeCompare(b.model) || STORAGE_RANK(a.storage) - STORAGE_RANK(b.storage));

console.log(`source: ${SOURCE}`);
console.log(`rule  : buy = retail − max(AED${FLOOR}, ${PCT * 100}% of retail), rounded to AED${ROUND}`);
console.log(`basis : median of "Good" grade across colours, per model + storage\n`);
console.log('model'.padEnd(20) + 'storage'.padEnd(9) + 'retail'.padStart(7) + 'buy'.padStart(8) + '   n');
for (const r of rows) {
  console.log(r.model.padEnd(20) + r.storage.padEnd(9) + String(r.retail).padStart(7) + String(r.buy).padStart(8) + String(r.colours).padStart(4));
}
if (rejected.length) {
  console.log('\nexcluded — source price looked wrong:');
  for (const r of rejected) console.log(`  ${r.model} ${r.storage}: ${r.why}`);
}

console.log('\n--- SEED_DEVICES rows ---');
for (const r of rows) console.log(`  ['mobile', 'Apple', '${r.model}', '${r.storage}', ${r.buy}],`);

fs.mkdirSync(new URL('../data/prices/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../data/prices/revibe-catalogue.json', import.meta.url), JSON.stringify({
  source: SOURCE, fetchedAt: new Date().toISOString(),
  rule: { floorAED: FLOOR, percent: PCT * 100, roundTo: ROUND, maxTierJump: MAX_TIER_JUMP, goodVsNew: GOOD_VS_NEW },
  models: rows, excluded: rejected,
}, null, 2));
console.log(`\nwrote data/prices/revibe-catalogue.json (${rows.length} rows, ${rejected.length} excluded)`);
