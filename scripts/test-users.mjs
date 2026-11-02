// Exercises the staff-management endpoints end to end against a running instance.
const B = process.env.BASE || 'http://localhost:8500';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const call = async (p, opt = {}) => {
  const r = await fetch(B + p, { method: opt.method || 'GET',
    headers: { 'content-type': 'application/json', ...(opt.token ? { authorization: 'Bearer ' + opt.token } : {}) },
    body: opt.body ? JSON.stringify(opt.body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, data: j };
};

const admin = (await call('/api/auth/login', { method: 'POST', body: { email: 'admin@indubaicity.com', password: 'admin123' } })).data;
ok(!!admin.token, 'admin can sign in with the seeded password');

const list0 = await call('/api/admin/users', { token: admin.token });
ok(list0.status === 200 && list0.data.length === 4, `user list returns 4 seeded staff (got ${list0.data && list0.data.length})`);

// create with the panel default
const created = await call('/api/admin/users', { method: 'POST', token: admin.token,
  body: { name: 'Test Inspector', email: 'test.inspector@indubaicity.com', role: 'inspector', password: '123123' } });
ok(created.status === 200 && created.data.id, 'can create a staff account with the default password 123123');

const newId = created.data && created.data.id;
const login1 = await call('/api/auth/login', { method: 'POST', body: { email: 'test.inspector@indubaicity.com', password: '123123' } });
ok(!!login1.data.token, 'the new account can sign in with 123123');

const dupe = await call('/api/admin/users', { method: 'POST', token: admin.token,
  body: { name: 'Dup', email: 'test.inspector@indubaicity.com', role: 'inspector', password: '123123' } });
ok(dupe.status === 409, `duplicate email refused (got ${dupe.status})`);

const reset = await call('/api/admin/users/' + newId, { method: 'PATCH', token: admin.token, body: { password: 'newpass1' } });
ok(reset.status === 200, 'password can be reset');
const loginOld = await call('/api/auth/login', { method: 'POST', body: { email: 'test.inspector@indubaicity.com', password: '123123' } });
const loginNew = await call('/api/auth/login', { method: 'POST', body: { email: 'test.inspector@indubaicity.com', password: 'newpass1' } });
ok(!loginOld.data.token, 'the old password stops working');
ok(!!loginNew.data.token, 'the new password works');

const shortPw = await call('/api/admin/users/' + newId, { method: 'PATCH', token: admin.token, body: { password: '123' } });
ok(shortPw.status === 400, `a 3-character password is refused (got ${shortPw.status})`);

const roleUp = await call('/api/admin/users/' + newId, { method: 'PATCH', token: admin.token, body: { role: 'finance' } });
ok(roleUp.status === 200 && roleUp.data.user.role === 'finance', 'role can be changed');
const badRole = await call('/api/admin/users/' + newId, { method: 'PATCH', token: admin.token, body: { role: 'god_mode' } });
ok(badRole.status === 400, `unknown role refused (got ${badRole.status})`);

const disable = await call('/api/admin/users/' + newId, { method: 'PATCH', token: admin.token, body: { active: false } });
ok(disable.status === 200 && disable.data.user.active === 0, 'account can be disabled');
const loginDisabled = await call('/api/auth/login', { method: 'POST', body: { email: 'test.inspector@indubaicity.com', password: 'newpass1' } });
ok(!loginDisabled.data.token, 'a disabled account cannot sign in');

const selfDisable = await call('/api/admin/users/' + admin.user.id, { method: 'PATCH', token: admin.token, body: { active: false } });
ok(selfDisable.status === 400, `cannot disable your own account (got ${selfDisable.status})`);
const selfRole = await call('/api/admin/users/' + admin.user.id, { method: 'PATCH', token: admin.token, body: { role: 'sales' } });
ok(selfRole.status === 400, `cannot drop your own super admin role (got ${selfRole.status})`);

const inspToken = (await call('/api/auth/login', { method: 'POST', body: { email: 'inspector@indubaicity.com', password: 'insp1234' } })).data.token;
const forbidden = await call('/api/admin/users', { token: inspToken });
ok(forbidden.status === 403, `an inspector cannot read the staff list (got ${forbidden.status})`);
const forbiddenPatch = await call('/api/admin/users/' + newId, { method: 'PATCH', token: inspToken, body: { password: 'hacked1' } });
ok(forbiddenPatch.status === 403, `an inspector cannot reset a password (got ${forbiddenPatch.status})`);

const audit = await call('/api/admin/audit?limit=50', { token: admin.token });
const rows = Array.isArray(audit.data) ? audit.data : [];
const pwEntry = rows.find((r) => r.action === 'password_reset');
ok(!!pwEntry, 'password reset is written to the audit log');
ok(!JSON.stringify(rows).includes('newpass1') && !JSON.stringify(rows).includes('123123'), 'no password value ever appears in the audit log');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
