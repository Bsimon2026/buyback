// Proves the OTP path without reading the inbox: recover the code from the stored hash
// (it is a 6-digit space, so this is instant) and then verify it through the API.
//   node scripts/verify-otp-flow.mjs
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const BASE = process.env.BASE || 'http://localhost:8910';
const EMAIL = process.env.EMAIL || 'cbijusimon@gmail.com';
const DB = process.env.DB_FILE || 'data/otp-test.db';

const db = new DatabaseSync(DB, { readOnly: true });
const row = db.prepare(`SELECT * FROM email_verifications WHERE email = ? ORDER BY id DESC LIMIT 1`).get(EMAIL);
db.close();
if (!row) { console.error('no code row for', EMAIL); process.exit(1); }

const hash = (code) => crypto.createHash('sha256').update(`${EMAIL}:${code}`).digest('hex');
let found = null;
for (let i = 0; i <= 999999; i++) {
  const c = String(i).padStart(6, '0');
  if (hash(c) === row.code_hash) { found = c; break; }
}
console.log('code row id:', row.id, '| expires:', row.expires_at, '| recovered code:', found ? found.replace(/\d(?=\d{2})/g, '•') : 'NOT FOUND');
if (!found) process.exit(1);

const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

const wrong = await post('/api/otp/verify', { email: EMAIL, code: found === '000000' ? '111111' : '000000' });
console.log('wrong code      ->', wrong.status, wrong.data.error);

const good = await post('/api/otp/verify', { email: EMAIL, code: found });
console.log('correct code    ->', good.status, good.data.token ? `token ${good.data.token.slice(0, 8)}… (${good.data.token.length} chars)` : good.data.error);

const replay = await post('/api/otp/verify', { email: EMAIL, code: found });
console.log('replay same code->', replay.status, replay.data.token ? 'ACCEPTED AGAIN (bad)' : replay.data.error);
