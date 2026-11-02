// Posts the cosmetic questions to a running instance and proves they move the quote.
const BASE = process.env.BASE || 'http://localhost:8700';
const COSMETIC = (await import('../src/cosmetic-questions.js')).default;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const call = async (p, o = {}) => {
  const r = await fetch(BASE + p, { method: o.method || 'GET',
    headers: { 'content-type': 'application/json', ...(o.token ? { authorization: 'Bearer ' + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};

const admin = (await call('/api/auth/login', { method: 'POST', body: { email: 'admin@indubaicity.com', password: 'admin123' } })).data;
ok(!!admin.token, 'admin signs in');

// fresh install already seeded them from db.js — the API call must be a no-op, not a duplicate
const before = (await call('/api/questions?category=mobile')).data;
const codesBefore = before.map((q) => q.code);
ok(codesBefore.includes('frame') && codesBefore.includes('backglass'),
  `seed created the cosmetic questions (${codesBefore.length} questions: ${codesBefore.join(', ')})`);

const add = await call('/api/admin/questions', { method: 'POST', token: admin.token,
  body: { category: 'mobile', questions: COSMETIC } });
ok(add.status === 200 && add.data.created.length === 0,
  `re-posting is idempotent — created ${add.data && add.data.created.length}, skipped ${add.data && add.data.skipped}`);

const inspToken = (await call('/api/auth/login', { method: 'POST', body: { email: 'inspector@indubaicity.com', password: 'insp1234' } })).data.token;
const forbidden = await call('/api/admin/questions', { method: 'POST', token: inspToken, body: { questions: COSMETIC } });
ok(forbidden.status === 403, `an inspector cannot add questions (got ${forbidden.status})`);

// the maths: same device, cosmetic answers only differing
const base = { screen: 'perfect', body: 'excellent', battery: '90plus', camera: 'working',
  speaker: 'working', faceid: 'working', charging: 'working', water: 'no', repairs: 'never' };
const clean = (await call('/api/quote', { method: 'POST', body: { variantId: 1, category: 'mobile',
  answers: { ...base, frame: 'mint', backglass: 'intact' } } })).data;
const scuffed = (await call('/api/quote', { method: 'POST', body: { variantId: 1, category: 'mobile',
  answers: { ...base, frame: 'scuffs', backglass: 'intact' } } })).data;
const wrecked = (await call('/api/quote', { method: 'POST', body: { variantId: 1, category: 'mobile',
  answers: { ...base, frame: 'bent', backglass: 'cracked' } } })).data;

ok(clean.complete && scuffed.complete && wrecked.complete, 'all three answer sets produce a complete quote');
console.log(`   clean   ${clean.range.text}  (${clean.estimate.formatted}) grade ${clean.grade}`);
console.log(`   scuffed ${scuffed.range.text}  (${scuffed.estimate.formatted}) grade ${scuffed.grade}`);
console.log(`   wrecked ${wrecked.range.text}  (${wrecked.estimate.formatted}) grade ${wrecked.grade}`);

ok(scuffed.estimate.minor < clean.estimate.minor, 'light scuffs reduce the estimate');
ok(wrecked.estimate.minor < scuffed.estimate.minor, 'bent frame + cracked back reduce it further');

const pctCut = (a, b) => ((a.estimate.minor - b.estimate.minor) / a.estimate.minor) * 100;
ok(Math.abs(pctCut(clean, scuffed) - 2) < 0.6, `light scuffs cost ~2% (${pctCut(clean, scuffed).toFixed(1)}%)`);
ok(Math.abs(pctCut(clean, wrecked) - 16) < 2, `bent + cracked cost ~16% (${pctCut(clean, wrecked).toFixed(1)}%)`);
ok(wrecked.grade === 'D' && clean.grade === 'A', `grade follows the worst cosmetic answer (${clean.grade} → ${wrecked.grade})`);

const adj = wrecked.adjustments.filter((a) => a.question === 'frame' || a.question === 'backglass');
ok(adj.length === 2 && adj.every((a) => a.deltaMinor < 0), 'both cosmetic items appear in the breakdown as deductions');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
