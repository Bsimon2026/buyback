// Set the business default phone number, then verify what each domain publishes.
// Uses node:http because fetch() silently strips a custom Host header.
//   node scripts/set-contact-numbers.mjs
//   BASE=https://recycle.indubaicity.com node scripts/set-contact-numbers.mjs
import http from 'node:http';

const BASE = new URL(process.env.BASE || 'http://localhost:8800');
const PHONE = process.env.PHONE || '+971 56 891 1233';

function req(path, { method = 'GET', body, host, token } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const r = http.request({
      host: BASE.hostname, port: BASE.port || 80, path, method,
      headers: {
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        ...(host ? { host } : {}),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(d || '{}') }));
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

const login = await req('/api/auth/login', { method: 'POST', body: { email: 'admin@indubaicity.com', password: 'admin123' } });
const save = await req('/api/admin/settings', { method: 'POST', token: login.data.token, body: { support_phone: PHONE } });
console.log('settings.support_phone ->', save.data.settings && save.data.settings.support_phone);

for (const host of ['recycle.indubaicity.com', 'sellformoney.com', 'www.sellformoney.com', 'something-else.com']) {
  const cfg = await req('/api/config', { host });
  console.log(String(host).padEnd(26), '->', cfg.data.support.phone);
}
