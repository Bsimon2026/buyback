// Add the cosmetic-condition questions to a live site.
//   BASE=https://recycle.indubaicity.com node scripts/add-cosmetic-questions.mjs
// Idempotent — a question that already exists (same code + category) is skipped by the API.
import COSMETIC from '../src/cosmetic-questions.js';

const BASE = process.env.BASE || 'http://localhost:8099';
const ADMIN = process.env.ADMIN_EMAIL || 'admin@indubaicity.com';
const PW = process.env.ADMIN_PASSWORD || 'admin123';

const call = async (p, o = {}) => {
  const r = await fetch(BASE + p, { method: o.method || 'GET',
    headers: { 'content-type': 'application/json', ...(o.token ? { authorization: 'Bearer ' + o.token } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${p}: ${(data && data.error) || r.status}`);
  return data;
};

const login = await call('/api/auth/login', { method: 'POST', body: { email: ADMIN, password: PW } });
const token = login.token;

const before = await call('/api/questions?category=mobile');
console.log('before:', before.length, 'questions —', before.map((q) => q.code).join(', '));

const out = await call('/api/admin/questions', { method: 'POST', token,
  body: { category: 'mobile', questions: COSMETIC } });
console.log('created:', out.created.length ? out.created.join(', ') : '(none — already present)',
  '| skipped:', out.skipped);

const after = await call('/api/questions?category=mobile');
console.log('after :', after.length, 'questions —', after.map((q) => q.code).join(', '));

for (const code of ['frame', 'backglass']) {
  const q = after.find((x) => x.code === code);
  if (!q) { console.log(`MISSING ${code}`); process.exitCode = 1; continue; }
  console.log(` ${code}: ${q.options.map((o) => `${o.code} ${o.adj_value}${o.adj_kind === 'pct' ? 'bp' : ''}`).join(' · ')}`);
}
