// Build a fill-in sheet of every iPhone rate we do not have.
//   node scripts/iphone-gaps.mjs
// Writes data/prices/iphone-rates-missing.txt:
//   section A: in the catalogue, but on the old price basis (no rate in the market list)
//   section B: real Apple storage configurations we do not carry at all
import fs from 'node:fs';

const BASE = process.env.BASE || 'https://sellformoney.com';
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// every storage tier Apple actually sold, per model
const CONFIGS = {
  'iPhone 8 Plus': ['64GB', '256GB'],
  'iPhone X': ['64GB', '256GB'],
  'iPhone XR': ['64GB', '128GB', '256GB'],
  'iPhone XS': ['64GB', '256GB', '512GB'],
  'iPhone XS Max': ['64GB', '256GB', '512GB'],
  'iPhone 11': ['64GB', '128GB', '256GB'],
  'iPhone 11 Pro': ['64GB', '256GB', '512GB'],
  'iPhone 11 Pro Max': ['64GB', '256GB', '512GB'],
  'iPhone SE (2nd)': ['64GB', '128GB', '256GB'],
  'iPhone SE (3rd)': ['64GB', '128GB', '256GB'],
  'iPhone 12 Mini': ['64GB', '128GB', '256GB'],
  'iPhone 12': ['64GB', '128GB', '256GB'],
  'iPhone 12 Pro': ['128GB', '256GB', '512GB'],
  'iPhone 12 Pro Max': ['128GB', '256GB', '512GB'],
  'iPhone 13 Mini': ['128GB', '256GB', '512GB'],
  'iPhone 13': ['128GB', '256GB', '512GB'],
  'iPhone 13 Pro': ['128GB', '256GB', '512GB', '1TB'],
  'iPhone 13 Pro Max': ['128GB', '256GB', '512GB', '1TB'],
  'iPhone 14': ['128GB', '256GB', '512GB'],
  'iPhone 14 Plus': ['128GB', '256GB', '512GB'],
  'iPhone 14 Pro': ['128GB', '256GB', '512GB', '1TB'],
  'iPhone 14 Pro Max': ['128GB', '256GB', '512GB', '1TB'],
  'iPhone 15': ['128GB', '256GB', '512GB'],
  'iPhone 15 Plus': ['128GB', '256GB', '512GB'],
  'iPhone 15 Pro': ['128GB', '256GB', '512GB', '1TB'],
  'iPhone 15 Pro Max': ['256GB', '512GB', '1TB'],
  'iPhone 16': ['128GB', '256GB', '512GB'],
  'iPhone 16 Plus': ['128GB', '256GB', '512GB'],
  'iPhone 16 Pro': ['128GB', '256GB', '512GB', '1TB'],
  'iPhone 16 Pro Max': ['256GB', '512GB', '1TB'],
  'iPhone 16e': ['128GB', '256GB', '512GB'],
  'iPhone 17': ['256GB', '512GB'],
  'iPhone 17 Pro': ['256GB', '512GB', '1TB'],
  'iPhone 17 Pro Max': ['256GB', '512GB', '1TB'],
  'iPhone Air': ['256GB', '512GB', '1TB'],
};

const market = JSON.parse(fs.readFileSync('data/prices/used-rates.json', 'utf8')).devices
  .filter((d) => d.brand === 'Apple');
const hasRate = new Set(market.map((d) => `${norm(d.model)}|${norm(d.variant)}`));

const cat = await (await fetch(BASE + '/api/catalog?category=mobile')).json();
const brands = Array.isArray(cat) ? cat : (cat.brands || []);
const apple = brands.find((b) => b.name === 'Apple');
if (!apple) throw new Error('Apple not in the catalogue');

const inCatalogue = new Map(); // model|variant -> price
for (const m of apple.models) for (const v of m.variants) {
  inCatalogue.set(`${norm(m.name)}|${norm(v.variant)}`, { model: m.name, variant: v.variant, price: v.basePrice.formatted });
}

const pad = (s, n) => String(s).padEnd(n);
const size = (v) => (String(v).includes('TB') ? 1024 : parseInt(v, 10) || 0);
const byModelThenSize = (x, y) => x.model.localeCompare(y.model) || size(x.variant) - size(y.variant);

const A = []; // in catalogue, no rate in the list
const B = []; // not in the catalogue at all
for (const [model, variants] of Object.entries(CONFIGS)) {
  for (const variant of variants) {
    const k = `${norm(model)}|${norm(variant)}`;
    if (hasRate.has(k)) continue;                    // priced from the market list
    if (inCatalogue.has(k)) A.push({ model, variant, old: inCatalogue.get(k).price });
    else B.push({ model, variant });
  }
}

const out = [];
out.push('iPHONE RATES MISSING');
out.push(`generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} from the live catalogue`);
out.push('');
out.push('Fill the price column (USED SELLING price, AED) and send the file back.');
out.push('The site will show 70% of whatever you write, rounded to AED 10.');
out.push('');
out.push('A. IN THE CATALOGUE, BUT ON THE OLD PRICE BASIS (' + A.length + ')');
out.push('   these are live now with a figure derived from refurbished retail, not from your list');
out.push('');
out.push('   ' + pad('MODEL', 22) + pad('STORAGE', 9) + pad('LIVE NOW', 10) + 'USED PRICE');
for (const r of A.sort(byModelThenSize)) {
  out.push('   ' + pad(r.model, 22) + pad(r.variant, 9) + pad(r.old, 10) + '______');
}
out.push('');
out.push('B. NOT IN THE CATALOGUE AT ALL (' + B.length + ')');
out.push('   customers cannot quote these today; a price here creates them');
out.push('');
out.push('   ' + pad('MODEL', 22) + pad('STORAGE', 9) + 'USED PRICE');
for (const r of B.sort(byModelThenSize)) {
  out.push('   ' + pad(r.model, 22) + pad(r.variant, 9) + '______');
}
out.push('');
out.push('C. LINES FROM YOUR SHEET THAT COULD NOT BE READ');
out.push('');
out.push('   M53 5g 6/128-                     no price given');
out.push('   Redmi note 10pro 6/128gb -        no price given');
out.push('   S23 ul koriya A++ boxd -1650      no storage (128 or 256?)');
out.push('   S25 ultra-2500AED box pi\'s        no storage');
out.push('   Fold 2 A grade -1050              no storage');
out.push('   NOTE 10 PLUS 1SIM -435AED         no storage (small-LCD grade)');
out.push('');
out.push('D. DUPLICATES I RESOLVED BY TAKING THE PLAIN / CHEAPEST ENTRY');
out.push('');
out.push('   13 128GB            910  used (950 with box ignored)');
out.push('   15 Plus 128GB     1,710  used (1,740 with box ignored)');
out.push('   12 128GB            725  used (740 with box ignored)');
out.push('   S23 Ultra 256GB   1,250  used (1,600 koriya 12/256, 1,650 koriya A++ boxed ignored)');
out.push('   Xiaomi 13 Pro+    710    used (720 with box ignored)');

fs.writeFileSync('data/prices/iphone-rates-missing.txt', out.join('\r\n') + '\r\n');
console.log(`A: ${A.length} in catalogue without a market rate`);
console.log(`B: ${B.length} configurations not in the catalogue`);
console.log('written data/prices/iphone-rates-missing.txt');
