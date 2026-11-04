// Add the newer question sets (cosmetic + accessories) to a live site.
//   BASE=https://recycle.indubaicity.com node scripts/add-questions.mjs
// Idempotent: the API skips any question that already exists for that category.
import COSMETIC from '../src/cosmetic-questions.js';
import EXTRAS from '../src/extras-questions.js';

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

const { token } = await call('/api/auth/login', { method: 'POST', body: { email: ADMIN, password: PW } });
const before = await call('/api/questions?category=mobile');
console.log('before:', before.length, '—', before.map((q) => q.code).join(', '));

const out = await call('/api/admin/questions', { method: 'POST', token,
  body: { category: 'mobile', questions: [...COSMETIC, ...EXTRAS] } });
console.log('created:', out.created.length ? out.created.join(', ') : '(none — already present)', '| skipped:', out.skipped);

const after = await call('/api/questions?category=mobile');
console.log('after :', after.length, '—', after.map((q) => q.code).join(', '));

const bySection = {};
after.forEach((q) => { bySection[q.section] = (bySection[q.section] || 0) + 1; });
console.log('sections:', JSON.stringify(bySection));
