// Parse the pasted used-phone market list into structured, canonical rows.
//   node scripts/parse-used-rates.mjs [file]
// Writes data/prices/used-rates.json and prints what it understood plus every line it could not.
//
// The pasted numbers are used *selling* prices. The buy base is 70% of these (the 30% margin),
// rounded to AED 10 — the importer does that conversion, so this file stays a faithful record of
// exactly what the market list said.
import fs from 'node:fs';

const SRC = process.argv[2] || 'data/prices/market-used-2026-11-04.txt';
const OUT = 'data/prices/used-rates.json';

// A section heading is the bare word, never a product line ("NOTE" vs "NOTE 10 256 -465").
const SECTIONS = [
  [/^iphones?(\s+used)?$/i, { brand: 'Apple', kind: 'iphone' }],
  [/^samsung$/i,            { brand: 'Samsung', kind: 'galaxy' }],
  [/^note$/i,               { brand: 'Samsung', kind: 'note' }],
  [/^small\s+lcd$/i,        { brand: 'Samsung', kind: 'galaxy', defect: 'small lcd' }],
  [/^aquos$/i,              { brand: 'Sharp', kind: 'generic' }],
  [/^motorola$/i,           { brand: 'Motorola', kind: 'moto' }],
  [/^zte$/i,                { brand: 'ZTE', kind: 'generic' }],
  [/^sony$/i,               { brand: 'Sony', kind: 'generic' }],
  [/^nokia$/i,              { brand: 'Nokia', kind: 'generic' }],
  [/^oppo$/i,               { brand: 'Oppo', kind: 'generic' }],
  [/^redmi([\s-]*poco)?$/i, { brand: 'Xiaomi', kind: 'xi' }],
  [/^huawei$/i,             { brand: 'Huawei', kind: 'generic' }],
  [/^google\s+pixel$/i,     { brand: 'Google', kind: 'pixel' }],
];

// Brand words that win over whatever section the line sits under.
const BRAND_WORDS = [
  [/\bhuawei\b/i, 'Huawei'], [/\bvivo\b/i, 'Vivo'], [/\btcl\b/i, 'TCL'],
  [/\bkyocera\b/i, 'Kyocera'], [/\barrows\b/i, 'Fujitsu'], [/\btorque\b/i, 'Kyocera'],
  [/\baquos|sense\b/i, 'Sharp'], [/\bpixel\b/i, 'Google'], [/\bredmi\b/i, 'Xiaomi'],
  [/\bxiaomi\b/i, 'Xiaomi'], [/^note\s*\d+\s*pro/i, 'Xiaomi'],
  [/\bdingno\b/i, 'Dingno'], [/\bgrid\b/i, 'Grid'],
];

const FLAGS = [
  ['box',       /\bbox\b|with\s*box/i],
  ['2sim',      /2\s*sim/i],
  ['esim',      /e\s*sim/i],
  ['japan',     /japp?an/i],
  ['korea',     /koriya|korea/i],
  ['pen',       /\bpen\b/i],
  ['cover',     /cover/i],
  ['grade',     /\ba\+\+\b/i],
  ['brand new', /brand\s*new/i],
];

const STORAGE_SIZES = [8, 16, 32, 64, 128, 256, 512, 1024];

function findStorage(low) {
  // explicit forms first: 12/256, 1tb, 128gb — "text" lets the model be cut by position later
  let m = low.match(/(\d{1,2})\s*\/\s*(\d{2,4})\s*(gb|g)?/);
  if (m) return { label: `${Number(m[1])}/${Number(m[2])}GB`, ram: Number(m[1]), storage: Number(m[2]), at: m.index, text: m[0] };
  m = low.match(/(\d)\s*tb\b/);
  if (m) return { label: `${m[1]}TB`, ram: null, storage: Number(m[1]) * 1024, at: m.index, text: m[0] };
  m = low.match(/(\d{2,4})\s*(gb|g)\b/);
  if (m) return { label: `${Number(m[1])}GB`, ram: null, storage: Number(m[1]), at: m.index, text: m[0] };
  // bare size: the RIGHTMOST one, so "16 pro 256" reads 256 as the storage and 16 as the model
  m = [...low.matchAll(new RegExp(`(?<![\\d/])(${STORAGE_SIZES.join('|')})(?![\\d/])`, 'g'))].pop();
  if (m) return { label: `${m[1]}GB`, ram: null, storage: Number(m[1]), at: m.index, text: m[0] };
  return null;
}

const SERIES = /\b(a|s|m|j|z|f|note)\s?(\d{1,3})(\s?fe|\s?plus|\s?ultra|\s?lite|\s?pro|\s?e)?\b/gi;

function cleanModel(head, kind) {
  let s = head
    .replace(/\(\s*[^)]*\)/g, ' ')
    .replace(/\bwith\s*box\b/gi, ' ')
    .replace(/\bbox(d)?\b/gi, ' ')
    .replace(/\ba\+\+\b/gi, ' ')
    .replace(/\b(og\s*)?pen\b/gi, ' ')
    .replace(/cover\s*chainge?/gi, ' ')
    .replace(/\b(japp?an|japp?an|koriya|koriyaa|korea)\b/gi, ' ')
    .replace(/\bbrand\s*new\s*usa\b/gi, ' ')
    .replace(/\bnone\s*active\b/gi, ' ')
    .replace(/\b(1|2)\s*sim\b/gi, ' ')
    .replace(/e\s*sim/gi, ' ')
    .replace(/&/g, ' ')
    .replace(/\b(5g|4g)\b/gi, ' ')
    .replace(/pi[’']?s/gi, ' ')
    .replace(/\bsmall\b/gi, ' ')
    .replace(/\b\d{1,2}\s*\/\s*\d{2,4}\s*(gb|g)?\b/gi, ' ')
    .replace(/\b\d{2,4}\s*(gb|g)\b/gi, ' ')
    .replace(/\b\d\s*tb\b/gi, ' ')
    .replace(/[-,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // leftovers like "S23ULTRA8/" or "M33 5g6/"
  s = s.replace(/\b([A-Za-z]+)(\d+)$/, '$1 $2').replace(/\s+/g, ' ').trim();

  if (kind === 'iphone') {
    const map = [
      [/^se\s*2$/i, 'SE (2nd)'], [/^se\s*3$/i, 'SE (3rd)'],
      [/^17\s*air$/i, 'Air'], [/^air$/i, 'Air'],
    ];
    s = s.replace(/\b(\d{1,2})\s*(plus|max|pro|mini|air)\b/gi, (m, n, w) =>
      `${n} ${w[0].toUpperCase()}${w.slice(1).toLowerCase()}`.replace(/Pro max/i, 'Pro Max'));
    for (const [re, name] of map) if (re.test(s)) { s = name; break; }
    return ('iPhone ' + s).replace(/\bPRO\b/g, 'Pro').replace(/\bMAX\b/g, 'Max')
      .replace(/\bmax\b/g, 'Max').replace(/\bPLUS\b/g, 'Plus').replace(/\bMINI\b/g, 'Mini')
      .replace(/\s+/g, ' ').trim();
  }

  if (kind === 'galaxy' || kind === 'note') {
    let t = s;
    // Z Flip / Z Fold written as Flip3, ZFLIP 3, z fold 4
    t = t.replace(/^z?\s*(flip|fold)\s*(\d)\b/i, (m, w, n) => `Z ${w[0].toUpperCase()}${w.slice(1).toLowerCase()} ${n}`);
    t = t.replace(SERIES, (m, series, num, suffix) => {
      const S = series.toLowerCase() === 'note' ? 'Note' : series.toUpperCase();
      const suf = suffix ? ' ' + suffix.trim().toUpperCase().replace(/^FE$/, 'FE')
        .replace(/^PLUS$/, 'Plus').replace(/^ULTRA$/, 'Ultra').replace(/^LITE$/, 'Lite')
        .replace(/^PRO$/, 'Pro').replace(/^E$/, 'E') : '';
      return `${S}${num}${suf}`;
    });
    if (kind === 'note' && !/^note/i.test(t)) t = 'Note ' + t;
    return ('Galaxy ' + t).replace(/\s+/g, ' ').trim();
  }

  if (kind === 'pixel') {
    return ('Pixel ' + s.replace(/^pixel\s*/i, '')).replace(/\b([a-z])\b/g, (m) => m.toUpperCase()).trim();
  }

  // generic: keep the words, title-case the brand token only
  return s.replace(/^(aquos|arrows|torque|kyocera|tcl|dingno|grid|sense\s*\d*|sony|nokia|zte|oppo|vivo|huawei|moto|redmi)/i,
    (m) => m[0].toUpperCase() + m.slice(1));
}

function brandFor(line, section) {
  for (const [re, brand] of BRAND_WORDS) if (re.test(line)) return brand;
  return section.brand || 'Unknown';
}

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);
let section = null;
const rows = [];
const problems = [];

for (const raw of lines) {
  const line = raw.trim();
  if (!line) continue;

  const sec = SECTIONS.find(([re]) => re.test(line));
  if (sec) { section = sec[1]; continue; }
  if (!section) { problems.push({ line, why: 'outside any section' }); continue; }

  const cleaned = line.replace(/aed/gi, ' ').replace(/,/g, ' ')
    .replace(/\([^)]*\)/g, ' ')           // "(Box 720)" is a note, not the price
    .replace(/\s+/g, ' ').trim();

  const nums = [...cleaned.matchAll(/(\d{2,5})(?!\d)/g)];
  if (!nums.length) { problems.push({ line, why: 'no price' }); continue; }
  const last = nums[nums.length - 1];
  const price = Number(last[1]);
  if (!(price >= 40 && price <= 12000)) { problems.push({ line, why: `implausible price ${price}` }); continue; }

  const head = cleaned.slice(0, last.index).replace(/[-–\s]+$/, '').trim();
  const low = head.toLowerCase();
  const st = findStorage(low);
  if (!st) { problems.push({ line, why: 'no storage' }); continue; }

  // the model is the head minus the storage token itself
  const modelHead = (low.slice(0, st.at) + ' ' + low.slice(st.at + String(st.label).replace('GB', '').length + 2)).trim();
  const flags = {};
  for (const [name, re] of FLAGS) if (re.test(head)) flags[name] = true;
  if (section.defect) flags[section.defect] = true;

  const brand = brandFor(line, section);
  const kind = brand === 'Samsung' ? section.kind : (brand === 'Apple' ? 'iphone' : section.kind);
  // cut the storage token out by position: a global regex here would eat the model number
  // ("8 plus 64 gb" must keep its 8, "16 pro 256" must keep its 16)
  const cut = st.text ? st.text.length : 3;
  const headNoStorage = (head.slice(0, st.at) + ' ' + head.slice(st.at + cut)).trim();
  const model = cleanModel(headNoStorage, kind);
  if (!model || model.replace(/^iphone\s*$/i, '').trim() === '') { problems.push({ line, why: 'no model' }); continue; }

  rows.push({ brand, kind, model, variant: st.label, ram: st.ram, storage: st.storage, price, flags, raw: line });
}

// ---- one row per model+storage: prefer the plain entry, then the cheapest
const key = (r) => `${r.brand}|${r.model.toLowerCase()}|${r.variant}`;
const groups = new Map();
for (const r of rows) {
  const k = key(r);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
const chosen = [];
const alternates = [];
for (const [, list] of groups) {
  const plain = list.filter((r) => !Object.keys(r.flags).length);
  const pool = (plain.length ? plain : list).slice().sort((a, b) => a.price - b.price);
  chosen.push(pool[0]);
  for (const other of list) if (other !== pool[0]) alternates.push({ ...other, usedPrice: pool[0].price });
}

const defective = chosen.filter((r) => r.flags['small lcd']);
const sellable = chosen.filter((r) => !r.flags['small lcd']);

fs.writeFileSync(OUT, JSON.stringify({
  source: SRC.split('/').pop(),
  parsedAt: new Date().toISOString(),
  rule: 'pasted prices are used selling prices; buy base = 70% of these, rounded to AED 10',
  devices: sellable.sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model) || a.storage - b.storage),
  excluded: defective,
  alternates,
  problems,
}, null, 1));

const byBrand = {};
for (const r of sellable) byBrand[r.brand] = (byBrand[r.brand] || 0) + 1;
console.log(`lines: ${lines.length} | rows: ${rows.length} | devices: ${chosen.length} = ${sellable.length} sellable + ${defective.length} excluded`);
console.log('by brand:', Object.entries(byBrand).map(([b, n]) => `${b} ${n}`).join(', '));
console.log(`alternates kept: ${alternates.length}`);
console.log(`\nunreadable (${problems.length}):`);
for (const p of problems) console.log(`   [${p.why}] ${p.line}`);
