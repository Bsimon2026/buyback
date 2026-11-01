// Set the legal identity fields from a UTF-8 source (never from a shell string — that mangles Arabic).
//   node scripts/set-legal-identity.mjs
const BASE = process.env.BASE || 'http://localhost:8099';

const IDENTITY = {
  company_name: 'in Dubai City',
  company_legal_name: 'QAMAR ALNAJAH Audio-Visual, Recording Equipment & Accessories Trading L.L.C S.O.C',
  company_legal_name_ar: '',
  trn: '105531719000003',
  company_address: 'Shop No. 8, Nad Al Hamar, Dubai, United Arab Emirates',
  support_phone: '+971 56 163 8612',
  support_email: 'connect@indubaicity.com',
  jurisdiction: 'Dubai',
  // fill these two when you have them — they print on documents once set
  trade_licence: '',
  domain: 'indubaicity.com',
};

// works on a fresh install and on a database seeded before the domain changed
const EMAILS = [process.env.ADMIN_EMAIL, 'admin@indubaicity.com', 'admin@buyback.ae'].filter(Boolean);
let login = {};
for (const email of EMAILS) {
  login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: process.env.ADMIN_PASSWORD || 'admin123' }),
  }).then((r) => r.json());
  if (login.token) break;
}
if (!login.token) { console.error('login failed:', login); process.exit(1); }

const res = await fetch(BASE + '/api/admin/settings', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + login.token },
  body: JSON.stringify(IDENTITY),
});
const out = await res.json();
if (!res.ok) { console.error('failed:', out); process.exit(1); }

const s = out.settings;
console.log('company       :', s.company_name);
console.log('legal (EN)    :', s.company_legal_name);
console.log('legal (AR)    :', s.company_legal_name_ar, '| chars:', [...s.company_legal_name_ar].length);
console.log('TRN           :', s.trn);
console.log('address       :', s.company_address);
console.log('phone         :', s.support_phone);
