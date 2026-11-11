'use strict';
/* Admin console — vanilla, no build step. */
let TOKEN = localStorage.getItem('bb_admin_token') || '';
let ME = null;
let CFG = null;
let TAB = 'dashboard';
let OPEN_ORDER = null;
let OPEN_STOCK = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', ...(TOKEN ? { authorization: 'Bearer ' + TOKEN } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { TOKEN = ''; localStorage.removeItem('bb_admin_token'); showLogin(); throw new Error('Session expired'); }
  if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
  return data;
}

function toast(msg, isErr) {
  const d = document.createElement('div');
  d.className = 'toast' + (isErr ? ' err' : '');
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 3400);
}

function showLogin() {
  $('loginWrap').classList.remove('hidden');
  $('appWrap').classList.add('hidden');
}
async function boot() {
  if (!TOKEN) return showLogin();
  try {
    const me = await api('/api/auth/me');
    ME = me.user;
    CFG = await api('/api/config');
    $('whoami').innerHTML = `<b>${esc(ME.name)}</b><br><span class="dim">${esc(ME.role.replace(/_/g, ' '))}</span>`;
    $('curBadge').textContent = 'Prices in ' + CFG.currency;
    $('loginWrap').classList.add('hidden');
    $('appWrap').classList.remove('hidden');
    document.querySelectorAll('.nav').forEach((b) => b.addEventListener('click', () => { TAB = b.dataset.tab; render(); }));
    render();
  } catch (e) { showLogin(); }
}
async function login() {
  $('lErr').textContent = '';
  try {
    // Posted directly, not through api(): a 401 here is "wrong password", not an
    // expired session, and api() would replace the real message with "Session expired".
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: $('lEmail').value.trim(), password: $('lPass').value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Sign-in failed (${res.status})`);
    TOKEN = data.token; localStorage.setItem('bb_admin_token', TOKEN);
    boot();
  } catch (e) { $('lErr').textContent = e.message; }
}
function logout() { api('/api/auth/logout', { method: 'POST' }).catch(() => {}); TOKEN = ''; localStorage.removeItem('bb_admin_token'); showLogin(); }

// ---------- render ----------
const TITLES = {
  dashboard: ['Dashboard', "Today's business at a glance"],
  leads: ['Leads', 'People who asked for a price before they booked'],
  orders: ['Orders', 'Buyback pipeline: pickup → inspection → offer → payment'],
  inventory: ['Inventory', 'Purchased devices, repair cost and resale profit'],
  prices: ['Price master', 'Base buy prices. Every change is versioned and audited.'],
  reports: ['Reports', 'Purchases, sales and gross profit by period'],
  settings: ['Settings', 'Currency, policies and staff'],
  users: ['Users', 'Staff accounts, roles and passwords. Every change is audited.'],
  audit: ['Audit log', 'Who changed what, when — the fraud paper trail'],
};

async function render() {
  document.querySelectorAll('.nav').forEach((b) => b.classList.toggle('on', b.dataset.tab === TAB));
  $('pageTitle').textContent = TITLES[TAB][0];
  $('pageSub').textContent = TITLES[TAB][1];
  $('view').innerHTML = '<div class="muted" style="padding:20px">Loading…</div>';
  try {
    if (TAB === 'dashboard') return await dashboard();
    if (TAB === 'leads') return await leadsList();
    if (TAB === 'orders') return OPEN_ORDER ? await orderDetail(OPEN_ORDER) : await ordersList();
    if (TAB === 'inventory') return OPEN_STOCK ? await itemDetail(OPEN_STOCK) : await inventoryList();
    if (TAB === 'prices') return await prices();
    if (TAB === 'reports') return await reports();
    if (TAB === 'settings') return await settings();
    if (TAB === 'users') return await users();
    if (TAB === 'audit') return await auditLog();
  } catch (e) {
    $('view').innerHTML = `<div class="card panel"><div class="err">${esc(e.message)}</div></div>`;
  }
}

// ---------- leads ----------
async function leadsList() {
  const d = await api('/api/admin/leads');
  if (!d.leads.length) {
    $('view').innerHTML = `<div class="card panel"><div class="muted">No leads yet. A lead is
      created the moment someone gives their number and sees a first price.</div></div>`;
    return;
  }
  const rows = d.leads.map((l) => `
    <tr>
      <td class="mono">${esc(l.phone)}</td>
      <td>${esc(l.name || '—')}</td>
      <td>${esc(l.email || '—')}${l.verified ? ' <span class="pill ok">verified</span>' : ''}</td>
      <td>${esc(l.device || '—')}</td>
      <td class="num">${esc(l.firstQuote)}</td>
      <td>${esc(l.source || '—')}</td>
      <td class="muted">${esc((l.createdAt || '').slice(0, 16))}</td>
    </tr>`).join('');
  $('view').innerHTML = `
    <div class="kpis" style="margin-bottom:14px">
      <div class="card kpi"><div class="lab">Leads captured</div><div class="val">${d.total}</div>
        <div class="foot">asked for a price, no booking yet</div></div>
      <div class="card kpi"><div class="lab">Email verified</div><div class="val green">${d.verified}</div>
        <div class="foot">code confirmed from the inbox</div></div>
    </div>
    <div class="card panel">
      <table class="tbl">
        <thead><tr><th>Mobile</th><th>Name</th><th>Email</th><th>Device</th>
          <th class="num">First price</th><th>Source</th><th>When</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ---------- dashboard ----------
async function dashboard() {
  const d = await api('/api/admin/dashboard');
  const st = await api('/api/admin/settings');
  const cash = await api('/api/admin/reports/cash');
  const k = (label, val, foot, cls) => `
    <div class="card kpi"><div class="lab">${esc(label)}</div>
      <div class="val ${cls || ''}">${esc(val)}</div><div class="foot">${esc(foot || '')}</div></div>`;
  $('view').innerHTML = `
    <div class="sec-title">Today</div>
    <div class="kpis">
      ${k('Devices purchased', d.today.purchased, d.today.purchaseValue.formatted + ' paid out')}
      ${k('Devices sold', d.today.sold, d.today.salesValue.formatted + ' revenue', 'blue')}
      ${k('VAT collected', d.today.vatCollected.formatted, '5% on resale invoices')}
      ${k('Gross profit', d.today.grossProfit.formatted, 'net of VAT, cost and repairs', 'green')}
      ${k('All-time gross profit', d.allTimeGrossProfit.formatted, '', 'green')}
    </div>
    <div class="sec-title">Needs action</div>
    <div class="kpis">
      ${k('Pending pickups', d.pending.pickups, 'awaiting collection')}
      ${k('Pending inspections', d.pending.inspections, 'device with us, not valued')}
      ${k('Offers awaiting customer', d.pending.offers, 'sent, no answer yet')}
      ${k('Ready to pay', d.pending.payments, 'accepted, unpaid')}
    </div>
    <div class="sec-title">Cash position today (${esc(cash.date)})</div>
    <div class="kpis">
      ${k('Cash received (sales)', cash.cashIn.formatted, 'cash sales only', 'blue')}
      ${k('Cash paid out (devices)', cash.cashOut.formatted, 'cash payouts to customers')}
      ${k('Net cash movement', cash.netCash.formatted, 'count the drawer against this', 'green')}
    </div>
    <div class="sec-title">Stock on hand</div>
    <div class="kpis">
      ${k('Units in stock', d.stock.units, 'cost value ' + d.stock.costValue.formatted)}
    </div>
    ${!st.trn ? `<div class="notice" style="margin-top:22px;border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.08);color:#fca5a5">
      <b>No TRN set.</b> Tax invoices print without a Tax Registration Number, which makes them invalid for a VAT
      return. Add it in Settings → Platform policies before you sell anything.
    </div>` : ''}
    <div class="notice" style="margin-top:22px">
      Currency in use: <b>${esc(d.currency)}</b>. Change it in Settings → Currency. Historical orders keep the
      currency they were booked in, so past payouts never silently change value.
    </div>`;
}

// ---------- orders ----------
const STATUSES = ['', 'created', 'pickup_scheduled', 'collected', 'inspection', 'offer_generated', 'accepted', 'paid', 'completed', 'rejected'];
async function ordersList() {
  const rows = await api('/api/admin/orders?limit=100');
  const opts = STATUSES.map((s) => `<option value="${s}">${s ? s.replace(/_/g, ' ') : 'All statuses'}</option>`).join('');
  $('view').innerHTML = `
    <div class="card panel" style="margin-bottom:14px">
      <div class="pill-form">
        <input id="oq" placeholder="Search code, name, phone, IMEI">
        <select id="ostatus">${opts}</select>
        <button class="btn sm" onclick="ordersList.filtered()">Filter</button>
      </div>
    </div>
    <div class="card tbl-wrap">
      <table><thead><tr><th>Order</th><th>Device</th><th>Customer</th><th>Estimate</th><th>Status</th><th>Created</th><th></th></tr></thead>
      <tbody>${rows.map((o) => `
        <tr><td class="mono">${esc(o.code)}</td><td>${esc(o.device)}</td>
          <td>${esc(o.customer)}<div class="tag mono">${esc(o.phone)}</div></td>
          <td class="money">${esc(o.estimate)}</td>
          <td><span class="badge ${['accepted','paid','completed'].includes(o.status) ? 'ok' : ['rejected'].includes(o.status) ? 'bad' : 'info'}">${esc(o.status.replace(/_/g, ' '))}</span></td>
          <td class="tag">${esc(o.createdAt)}</td>
          <td><button class="btn sm" onclick="openOrder('${esc(o.code)}')">Open</button></td></tr>`).join('') ||
        '<tr><td colspan="7" class="muted" style="padding:20px">No orders yet.</td></tr>'}</tbody></table>
    </div>`;
  ordersList.filtered = async () => {
    const q = $('oq').value.trim(), s = $('ostatus').value;
    const res = await api(`/api/admin/orders?limit=100&q=${encodeURIComponent(q)}&status=${encodeURIComponent(s)}`);
    $('view').querySelector('tbody').innerHTML = res.map((o) => `
      <tr><td class="mono">${esc(o.code)}</td><td>${esc(o.device)}</td>
        <td>${esc(o.customer)}<div class="tag mono">${esc(o.phone)}</div></td>
        <td class="money">${esc(o.estimate)}</td>
        <td><span class="badge info">${esc(o.status.replace(/_/g, ' '))}</span></td>
        <td class="tag">${esc(o.createdAt)}</td>
        <td><button class="btn sm" onclick="openOrder('${esc(o.code)}')">Open</button></td></tr>`).join('') ||
      '<tr><td colspan="7" class="muted" style="padding:20px">No matches.</td></tr>';
  };
}

function openOrder(code) { OPEN_ORDER = code; TAB = 'orders'; render(); }
function closeOrder() { OPEN_ORDER = null; render(); }

async function orderDetail(code) {
  const d = await api('/api/admin/orders/' + encodeURIComponent(code));
  const o = d.order;
  const qs = await api('/api/admin/questions?category=' + o.category);
  const declared = o.declared || {};
  const canInspect = !['completed', 'cancelled', 'rejected'].includes(o.status);
  const openOffer = d.offers.find((x) => x.status === 'pending');

  const chips = (q, source) => q.options.map((opt) => {
    const sel = source[q.code] === opt.code;
    const bad = /cracked|damaged|not_working|below|locked|broken|yes/i.test(opt.code) && opt.adj_value < 0;
    return `<button class="chip ${sel ? 'sel' : ''} ${bad ? 'bad' : ''}" data-q="${esc(q.code)}" data-o="${esc(opt.code)}"
      data-insp="${q.code}=${opt.code}">${esc(opt.label)}</button>`;
  }).join('');

  $('view').innerHTML = `
    <div class="row" style="margin-bottom:14px"><button class="btn sm ghost" onclick="closeOrder()">← All orders</button></div>
    <div class="detail">
      <div>
        <div class="card panel">
          <div class="spread"><div>
            <div class="mono dim" style="font-size:12.5px">${esc(o.code)}</div>
            <h2 style="font-size:20px;margin-top:4px">${esc(o.variant_label)}</h2>
          </div><span class="badge info">${esc(o.status.replace(/_/g, ' '))}</span></div>
          <hr>
          <dl class="kv">
            <dt>Customer</dt><dd>${esc(o.customer_name)} · <span class="mono">${esc(o.phone)}</span></dd>
            <dt>Email</dt><dd>${esc(o.email || '—')}</dd>
            <dt>Address</dt><dd>${esc(o.address || '—')} ${esc(o.pincode || '')}</dd>
            <dt>IMEI / serial</dt><dd class="mono">${esc(o.imei || '—')} / ${esc(o.serial || '—')}</dd>
            <dt>KYC</dt><dd>${d.kyc.length ? esc(d.kyc[0].id_type) + ' · ' + esc(d.kyc[0].id_number) + ' <span class="badge warn">' + esc(d.kyc[0].status) + '</span>' : '<span class="dim">not submitted</span>'}</dd>
            <dt>Data treatment</dt><dd>${o.data_handling === 'destroy'
              ? '<b>Destroy storage</b> — physically destroyed'
              : '<b>Erase &amp; resell</b> — certified erase'}</dd>
            <dt>Collection</dt><dd>${esc(o.pickup_type)} ${esc(o.pickup_date || '')} ${esc(o.pickup_slot || '')}</dd>
            <dt>Estimate</dt><dd class="money">${esc(d.estimate.low.formatted)} – ${esc(d.estimate.high.formatted)}</dd>
            <dt>Declared</dt><dd>${qs.map((q) => declared[q.code] ? `${esc(q.label)}: <b>${esc((q.options.find((x) => x.code === declared[q.code]) || {}).label || declared[q.code])}</b>` : '').filter(Boolean).join(' · ')}</dd>
          </dl>
        </div>

        ${canInspect ? `
        <div class="sec-title">Physical inspection</div>
        <div class="card panel">
          <p class="muted" style="font-size:13px;margin:0 0 6px">Record what you actually see. Same engine as the customer quote — no separate price list.</p>
          <label class="row" style="gap:8px;margin:10px 0 14px;font-size:13.5px">
            <input type="checkbox" id="imeiOk" style="width:auto" ${o.imei ? 'checked' : ''}> IMEI on device matches the order</label>
          ${qs.map((q) => `<div style="padding:10px 0;border-top:1px solid var(--line)">
            <div style="font-size:13px;color:var(--muted);margin-bottom:7px">${esc(q.label)}</div>
            <div class="chips" data-group="${esc(q.code)}">${chips(q, {})}</div></div>`).join('')}
          <hr>
          <div class="row" style="justify-content:space-between;margin-bottom:6px">
            <div><div class="tag">Computed offer</div><div class="money" id="inspPreview" style="font-size:20px">—</div>
              <div class="tag" id="inspMissing" style="color:#f7c76a"></div></div>
            <button class="btn primary" id="inspSubmit" onclick="submitInspection('${esc(o.code)}')" disabled>Send final offer</button>
          </div>
          <div class="two" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <label class="field"><span>Override amount (optional)</span><input id="overrideAmt" placeholder="e.g. 30500" inputmode="decimal"></label>
            <label class="field"><span>Override reason (required if overriding)</span><input id="overrideWhy" placeholder="e.g. aftermarket screen found"></label>
          </div>
          <label class="field"><span>Inspector notes</span><textarea id="inspNotes" rows="2"></textarea></label>
        </div>` : ''}

        ${o.status === 'accepted' ? `
        <div class="sec-title">Payment</div>
        <div class="card panel">
          <div class="spread" style="flex-wrap:wrap">
            <div class="row">
              <label class="field" style="margin:0"><span>Method</span>
                <select id="payMethod"><option value="cash">Cash</option>
                  <option value="bank_transfer">Bank transfer</option><option value="cheque">Cheque</option></select></label>
              <label class="field" style="margin:0"><span>Reference</span><input id="payRef" placeholder="txn id"></label>
            </div>
            <button class="btn primary" onclick="payOrder('${esc(o.code)}')">Mark paid &amp; add to stock</button>
          </div>
        </div>` : ''}
      </div>

      <aside>
        <div class="card panel">
          <div class="lab tag" style="text-transform:uppercase;letter-spacing:.06em;font-weight:700">Offers</div>
          ${d.offers.length ? d.offers.map((f) => `
            <div style="padding:9px 0;border-bottom:1px solid rgba(30,43,56,.6)">
              <div class="spread"><b class="money">${esc(f.amount.formatted)}</b>
                <span class="badge ${f.status === 'accepted' ? 'ok' : f.status === 'pending' ? 'info' : ''}">${esc(f.status)}</span></div>
              <div class="tag">${esc(f.created_at)} ${f.overridden_by ? '· overridden: ' + esc(f.override_reason || '') : ''}</div>
            </div>`).join('') : '<div class="muted" style="padding:10px 0;font-size:13px">No offer yet.</div>'}
        </div>
        <div class="card panel" style="margin-top:14px">
          <div class="lab tag" style="text-transform:uppercase;letter-spacing:.06em;font-weight:700">Timeline</div>
          <ul class="tl" style="margin-top:10px">${d.events.map((e, i) => `
            <li class="${i < d.events.length - 1 ? 'done' : 'now'}"><b>${esc(e.status.replace(/_/g, ' '))}</b>
              <small>${esc(e.note || '')} · ${esc(e.actor_name)} · ${esc(e.at)}</small></li>`).join('')}</ul>
        </div>
        <div class="card panel" style="margin-top:14px">
          <div class="tag" style="text-transform:uppercase;letter-spacing:.06em;font-weight:700">Data certificate</div>
          ${d.order.sanitised_at
            ? `<div class="tag" style="margin-top:8px">${esc(d.order.sanitisation_ref || '')}</div>
               <div class="tag">${esc(d.order.sanitised_at)}</div>
               <a class="btn sm" style="margin-top:10px" target="_blank"
                  href="/doc/sanitisation/${encodeURIComponent(d.order.code)}">Print certificate</a>`
            : `<p class="tag" style="margin-top:8px">Not issued yet. Issue it once the device is in custody and the
                 erasure has actually been run.</p>
               <button class="btn sm" style="margin-top:10px" onclick="sanitiseOrder('${esc(d.order.code)}')"
                 ${['paid','completed'].includes(d.order.status) ? '' : 'disabled'}>Issue certificate</button>`}
        </div>
        ${d.payment ? `<div class="card panel" style="margin-top:14px">
          <div class="tag" style="text-transform:uppercase;letter-spacing:.06em;font-weight:700">Payment</div>
          <div class="money" style="font-size:20px;margin-top:6px">${esc((d.payment.amount_minor / 100).toFixed(2))}</div>
          <div class="tag">${esc(d.payment.method)} · ${esc(d.payment.status)} · ${esc(d.payment.receipt_no || '')}</div>
          ${d.payment.receipt_no ? `<a class="btn sm" style="margin-top:10px" target="_blank"
             href="/doc/receipt/${encodeURIComponent(d.payment.receipt_no)}">Print purchase receipt</a>` : ''}
        </div>` : ''}
      </aside>
    </div>`;

  // inspection wiring
  if (canInspect) {
    const findings = {};
    let lastQuote = null;
    const refresh = async () => {
      if (Object.keys(findings).length === 0) return;
      const q = await api('/api/quote', { method: 'POST', body: { variantId: o.variant_id, category: o.category, answers: findings } });
      lastQuote = q;
      const missing = q.missingAnswers.length;
      $('inspPreview').textContent = q.complete ? q.estimate.formatted : q.range.text;
      $('inspPreview').title = q.complete ? '' : `Record ${missing} more item(s)`;
      const btn = $('inspSubmit');
      btn.disabled = !q.complete && !$('overrideAmt').value.trim();
      btn.title = q.complete ? '' : `${missing} item(s) still to record`;
      const hint = $('inspMissing');
      if (hint) hint.textContent = q.complete ? '' : `${missing} item(s) not recorded yet — all must be answered before an offer is sent`;
    };
    const ovInput = $('overrideAmt');
    if (ovInput) ovInput.addEventListener('input', () => { if (lastQuote) { $('inspSubmit').disabled = false; } });
    document.querySelectorAll('[data-insp]').forEach((el) => {
      el.addEventListener('click', () => {
        const [q, opt] = el.dataset.insp.split('=');
        findings[q] = opt;
        el.parentElement.querySelectorAll('.chip').forEach((x) => x.classList.toggle('sel', x === el));
        refresh();
      });
    });
  }
}

async function submitInspection(code) {
  const findings = {};
  document.querySelectorAll('[data-group]').forEach((g) => {
    const sel = g.querySelector('.chip.sel');
    if (sel) findings[g.dataset.group] = sel.dataset.o;
  });
  const body = {
    findings,
    imeiVerified: $('imeiOk') ? $('imeiOk').checked : false,
    notes: $('inspNotes') ? $('inspNotes').value.trim() : '',
  };
  const ov = $('overrideAmt').value.trim();
  if (ov) {
    body.overrideAmount = Number(ov);
    body.overrideReason = $('overrideWhy').value.trim();
    if (!body.overrideReason) return toast('Override needs a reason — it is written to the audit log', true);
    // an explicit override is a sign-off, so a partial checklist is allowed (and recorded as such)
    body.allowPartial = true;
    body.partialReason = body.overrideReason;
  }
  try {
    await api(`/api/admin/orders/${encodeURIComponent(code)}/inspection`, { method: 'POST', body });
    toast('Final offer sent to customer');
    render();
  } catch (e) { toast(e.message, true); }
}

async function sanitiseOrder(code) {
  if (!confirm('Confirm the erasure has been completed for ' + code + '. This issues the customer certificate.')) return;
  try {
    const r = await api(`/api/admin/orders/${encodeURIComponent(code)}/sanitise`, { method: 'POST', body: {} });
    toast('Certificate issued: ' + r.ref);
    render();
  } catch (e) { toast(e.message, true); }
}

async function payOrder(code) {
  const method = $('payMethod').value;
  const txnRef = $('payRef').value.trim();
  if (!confirm(`Pay ${code} by ${method.toUpperCase()} and move the device into stock?`)) return;
  try {
    const r = await api(`/api/admin/orders/${encodeURIComponent(code)}/payment`, { method: 'POST', body: { method, txnRef } });
    toast(`Paid. Receipt ${r.receiptNo} · stock ${r.stockId}`);
    render();
  } catch (e) { toast(e.message, true); }
}

// ---------- inventory ----------
async function inventoryList() {
  const rows = await api('/api/admin/inventory');
  $('view').innerHTML = `
    <div class="card tbl-wrap"><table>
      <thead><tr><th>Stock</th><th>Device</th><th>IMEI</th><th>Grade</th><th>Cost</th><th>Listed</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map((i) => `
        <tr><td class="mono">${esc(i.stockId)}</td><td>${esc(i.device)}</td><td class="mono tag">${esc(i.imei || '—')}</td>
          <td>${esc(i.grade || '—')}</td><td class="money">${esc(i.cost.formatted)}</td>
          <td class="money">${esc(i.listed ? i.listed.formatted : '—')}</td>
          <td><span class="badge ${i.status === 'sold' ? 'ok' : i.status === 'repair' ? 'warn' : 'info'}">${esc(i.status)}</span></td>
          <td><button class="btn sm" onclick="openItem('${esc(i.stockId)}')">Open</button></td></tr>`).join('') ||
        '<tr><td colspan="8" class="muted" style="padding:20px">No stock yet — pay a customer to create the first unit.</td></tr>'}</tbody></table></div>`;
}
function openItem(id) { OPEN_STOCK = id; TAB = 'inventory'; render(); }
function closeItem() { OPEN_STOCK = null; render(); }

async function itemDetail(stockId) {
  const i = await api('/api/admin/inventory/' + encodeURIComponent(stockId));
  $('view').innerHTML = `
    <div class="row" style="margin-bottom:14px"><button class="btn sm ghost" onclick="closeItem()">← All stock</button></div>
    <div class="detail">
      <div>
        <div class="card panel">
          <div class="spread"><div><div class="mono dim" style="font-size:12.5px">${esc(i.stockId)}</div>
            <h2 style="font-size:20px;margin-top:4px">${esc(i.device)}</h2></div>
            <span class="badge ${i.status === 'sold' ? 'ok' : 'info'}">${esc(i.status)}</span></div>
          <hr>
          <dl class="kv">
            <dt>IMEI</dt><dd class="mono">${esc(i.imei || '—')}</dd>
            <dt>Grade</dt><dd>${esc(i.grade || '—')}</dd>
            <dt>Purchase cost</dt><dd class="money">${esc(i.cost.formatted)}</dd>
            <dt>Repair cost</dt><dd class="money">${esc(i.repairCost.formatted)}</dd>
            <dt>Total cost</dt><dd class="money">${esc(i.totalCost.formatted)}</dd>
            <dt>Listed price</dt><dd class="money">${esc(i.listedPrice ? i.listedPrice.formatted : '—')}</dd>
            <dt>Expected profit</dt><dd class="money" style="color:#7ee2a4">${esc(i.expectedProfit ? i.expectedProfit.formatted : '—')}</dd>
          </dl>
        </div>

        ${i.sale ? `
        <div class="sec-title">Sold</div>
        <div class="card panel"><dl class="kv">
          <dt>Invoice</dt><dd class="mono">${esc(i.sale.invoiceNo)}</dd>
          <dt>Sale price (gross)</dt><dd class="money">${esc(i.sale.price.formatted)}</dd>
          <dt>VAT @ ${esc(i.sale.vatRate)}%</dt><dd class="money">${esc(i.sale.vat.formatted)}</dd>
          <dt>Net revenue</dt><dd class="money">${esc(i.sale.netRevenue.formatted)}</dd>
          <dt>Fees</dt><dd class="money">${esc(i.sale.fees.formatted)}</dd>
          <dt>Gross profit</dt><dd class="money" style="color:#7ee2a4">${esc(i.sale.profit.formatted)}</dd>
          <dt>Paid by</dt><dd>${esc(i.sale.paymentMethod || 'cash')}</dd>
          <dt>Sold at</dt><dd>${esc(i.sale.soldAt)}</dd>
        </dl>
        <a class="btn sm" target="_blank" href="/doc/invoice/${encodeURIComponent(i.sale.invoiceNo)}">Print tax invoice</a>
        </div>` : `
        <div class="sec-title">Repair</div>
        <div class="card panel">
          ${i.repairs.length ? i.repairs.map((r) => `<div style="padding:8px 0;border-bottom:1px solid rgba(30,43,56,.6)">
            <div class="spread"><b>${esc(r.description || 'Repair')}</b><span class="badge">${esc(r.status)}</span></div>
            ${r.items.map((x) => `<div class="spread tag"><span>${esc(x.part)}</span><span>${esc(x.cost.formatted)}</span></div>`).join('')}</div>`).join('') : ''}
          <div class="row" style="margin-top:12px;flex-wrap:wrap">
            <input id="rpDesc" placeholder="Work description" style="flex:2;min-width:180px">
            <input id="rpPart" placeholder="Part (e.g. Screen)" style="flex:1;min-width:130px">
            <input id="rpCost" placeholder="Cost" inputmode="decimal" style="width:110px">
            <button class="btn sm" onclick="addRepair('${esc(i.stockId)}')">Add repair</button>
          </div>
        </div>
        <div class="sec-title">Price for resale &amp; sell</div>
        <div class="card panel">
          <div class="row" style="flex-wrap:wrap;margin-bottom:12px">
            <input id="listPrice" placeholder="Listed price" inputmode="decimal" style="width:150px"
              value="${i.listedPrice ? (i.listedPrice.minor / 100) : ''}">
            <button class="btn sm" onclick="setList('${esc(i.stockId)}')">Save listing</button>
          </div>
          <div class="row" style="flex-wrap:wrap">
            <input id="salePrice" placeholder="Sale price (VAT incl.)" inputmode="decimal" style="width:140px">
            <input id="buyerName" placeholder="Buyer name" style="width:160px">
            <input id="buyerPhone" placeholder="Buyer phone" style="width:140px">
            <input id="buyerTrn" placeholder="Buyer TRN (B2B)" style="width:160px">
            <select id="saleChannel" style="width:auto"><option>store</option><option>online</option><option>dealer</option></select>
            <select id="saleMethod" style="width:auto"><option value="cash">Cash</option>
              <option value="card">Card</option><option value="bank_transfer">Bank transfer</option></select>
            <button class="btn primary sm" onclick="sell('${esc(i.stockId)}')">Record sale</button>
          </div>
        </div>`}
      </div>
      <aside><div class="card panel">
        <div class="tag" style="text-transform:uppercase;letter-spacing:.06em;font-weight:700">Unit economics</div>
        <div style="margin-top:12px">
          <div class="spread"><span class="muted">Purchase</span><span class="money">${esc(i.cost.formatted)}</span></div>
          <div class="spread"><span class="muted">Repairs</span><span class="money">${esc(i.repairCost.formatted)}</span></div>
          <div class="spread" style="border-top:1px solid var(--line);margin-top:8px;padding-top:8px">
            <b>Total cost</b><b class="money">${esc(i.totalCost.formatted)}</b></div>
          ${i.listedPrice ? `<div class="spread"><span class="muted">VAT on listed price</span>
            <span class="money">${esc(i.expectedVat.formatted)}</span></div>` : ''}
          ${i.listedPrice ? `<div class="spread"><span class="muted">Expected profit at list (net)</span>
            <b class="money" style="color:#7ee2a4">${esc(i.expectedProfit.formatted)}</b></div>` : ''}
        </div>
      </div></aside>
    </div>`;
}

async function addRepair(stockId) {
  const cost = Number($('rpCost').value);
  if (!cost) return toast('Enter the repair cost', true);
  try {
    await api(`/api/admin/inventory/${encodeURIComponent(stockId)}/repair`, { method: 'POST',
      body: { description: $('rpDesc').value.trim() || 'Repair', items: [{ part: $('rpPart').value.trim() || 'Part', cost }], complete: true } });
    toast('Repair recorded'); render();
  } catch (e) { toast(e.message, true); }
}
async function setList(stockId) {
  const p = Number($('listPrice').value);
  if (!p) return toast('Enter a listed price', true);
  try {
    await api(`/api/admin/inventory/${encodeURIComponent(stockId)}/list`, { method: 'POST', body: { listedPrice: p } });
    toast('Listing saved'); render();
  } catch (e) { toast(e.message, true); }
}
async function sell(stockId) {
  const p = Number($('salePrice').value);
  if (!p) return toast('Enter the sale price', true);
  try {
    await api(`/api/admin/inventory/${encodeURIComponent(stockId)}/sale`, { method: 'POST', body: {
      salePrice: p, buyerName: $('buyerName').value.trim(), buyerPhone: $('buyerPhone').value.trim(),
      buyerTrn: $('buyerTrn') ? $('buyerTrn').value.trim() : '',
      paymentMethod: $('saleMethod') ? $('saleMethod').value : 'cash', channel: $('saleChannel').value, fees: 0 } });
    toast('Sale recorded'); render();
  } catch (e) { toast(e.message, true); }
}

// ---------- prices ----------
async function prices() {
  const q = (prices.lastQ || '');
  const rows = await api('/api/admin/prices?q=' + encodeURIComponent(q));
  $('view').innerHTML = `
    <div class="card panel" style="margin-bottom:14px">
      <div class="pill-form">
        <input id="pq" placeholder="Search brand or model" value="${esc(q)}">
        <button class="btn sm" onclick="prices.search()">Search</button>
        <span style="flex:1"></span>
        <button class="btn sm ghost" onclick="prices.addOpen()">+ Add device</button>
      </div>
      <div id="addBox" style="margin-top:14px" class="hidden">
        <div class="row" style="flex-wrap:wrap">
          <select id="aCat" style="width:auto"><option value="mobile">Mobile</option><option value="laptop">Laptop</option></select>
          <input id="aBrand" placeholder="Brand" style="width:130px">
          <input id="aModel" placeholder="Model" style="width:170px">
          <input id="aVariant" placeholder="128GB / 8GB 256GB" style="width:160px">
          <input id="aPrice" placeholder="Base buy price" inputmode="decimal" style="width:150px">
          <button class="btn sm primary" onclick="prices.add()">Save device</button>
        </div>
      </div>
    </div>
    <div class="card tbl-wrap"><table>
      <thead><tr><th>Brand</th><th>Model</th><th>Variant</th><th>Base buy price</th><th>Source</th><th>Update to</th><th></th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr><td>${esc(r.brand)}</td><td>${esc(r.model)}</td><td>${esc(r.variant)}</td>
          <td class="money">${esc(r.display)}</td>
          <td style="max-width:280px">${r.unverified
            ? '<span class="badge warn">unverified</span>'
            : '<span class="badge ok">market</span>'}
            <div class="tag" style="margin-top:3px">${esc((r.priceSource || '').slice(0, 80))}</div></td>
          <td><input data-vid="${r.variantId}" class="pnew" placeholder="${(r.base_price_minor / 100)}" style="width:120px" inputmode="decimal"></td>
          <td><button class="btn sm" onclick="prices.save(${r.variantId})">Update</button></td></tr>`).join('')}</tbody></table></div>
    <p class="tag" style="margin-top:10px">Price changes are versioned in <span class="mono">device_prices</span> with an
      effective date and the user who made them. <b>unverified</b> means no refurbished market price was found for that
      variant — the number is our estimate, so confirm it before you buy that model.</p>`;
  prices.lastQ = q;
  prices.search = () => { prices.lastQ = $('pq').value.trim(); render(); };
  prices.addOpen = () => $('addBox').classList.toggle('hidden');
  prices.add = async () => {
    try {
      await api('/api/admin/variants', { method: 'POST', body: {
        category: $('aCat').value, brand: $('aBrand').value.trim(), model: $('aModel').value.trim(),
        variant: $('aVariant').value.trim() || 'Standard', basePrice: Number($('aPrice').value) } });
      toast('Device added'); render();
    } catch (e) { toast(e.message, true); }
  };
  prices.save = async (vid) => {
    const input = document.querySelector(`.pnew[data-vid="${vid}"]`);
    if (!input.value) return toast('Enter a new price', true);
    try {
      await api('/api/admin/prices', { method: 'POST', body: { variantId: vid, basePrice: Number(input.value), note: 'admin update' } });
      toast('Price updated'); render();
    } catch (e) { toast(e.message, true); }
  };
}

// ---------- reports ----------
async function reports() {
  const today = new Date().toISOString().slice(0, 10);
  const from = reports.from || today.slice(0, 8) + '01';
  const to = reports.to || today;
  const r = await api(`/api/admin/reports?from=${from}&to=${to}`);
  const v = await api(`/api/admin/reports/vat?from=${from}&to=${to}`);
  reports.from = from; reports.to = to;
  $('view').innerHTML = `
    <div class="card panel" style="margin-bottom:14px"><div class="pill-form">
      <label class="tag">From</label><input id="rFrom" type="date" value="${from}">
      <label class="tag">To</label><input id="rTo" type="date" value="${to}">
      <button class="btn sm" onclick="reports.run()">Run</button></div></div>
    <div class="kpis">
      <div class="card kpi"><div class="lab">Purchases</div><div class="val">${esc(r.purchases.count)}</div>
        <div class="foot">${esc(r.purchases.value.formatted)} paid out</div></div>
      <div class="card kpi"><div class="lab">Sales</div><div class="val blue">${esc(r.sales.count)}</div>
        <div class="foot">${esc(r.sales.value.formatted)} revenue · ${esc(r.sales.vat.formatted)} VAT</div></div>
      <div class="card kpi"><div class="lab">Gross profit</div><div class="val green">${esc(r.grossProfit.formatted)}</div>
        <div class="foot">sale − cost − repairs</div></div>
    </div>
    <div class="sec-title">VAT summary (output tax)</div>
    <div class="card panel">
      <div class="kpis" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">
        <div><div class="lab">Taxable sales (gross)</div><div class="val" style="font-size:20px">${esc(v.outputVat.gross.formatted)}</div></div>
        <div><div class="lab">Sales ex-VAT</div><div class="val" style="font-size:20px">${esc(v.outputVat.net.formatted)}</div></div>
        <div><div class="lab">VAT @ ${esc(v.vatRate)}% due</div><div class="val green" style="font-size:20px">${esc(v.outputVat.vat.formatted)}</div></div>
        <div><div class="lab">Units sold</div><div class="val" style="font-size:20px">${v.outputVat.units}</div></div>
      </div>
      <div class="tag" style="margin-top:12px">${esc(v.purchases.note)} ${v.purchases.count} payout(s) totalling
        ${esc(v.purchases.value.formatted)} in this period.</div>
      <table style="margin-top:14px"><thead><tr><th>Month</th><th>Units</th><th>Gross</th><th>VAT</th></tr></thead>
        <tbody>${v.monthly.map((m) => `<tr><td>${esc(m.month)}</td><td>${m.units}</td>
          <td class="money">${esc(m.gross.formatted)}</td><td class="money">${esc(m.vat.formatted)}</td></tr>`).join('') ||
          '<tr><td colspan="4" class="muted" style="padding:14px">No sales in this period.</td></tr>'}</tbody></table>
      <div class="notice" style="margin-top:12px">Use the invoice links in Inventory as the source documents for this
        return. Cash payouts carry no input VAT, so they cannot be offset here.</div>
    </div>
    <div class="sec-title">Top sellers</div>
    <div class="card tbl-wrap"><table><thead><tr><th>Device</th><th>Units</th><th>Revenue</th></tr></thead>
      <tbody>${r.topSellers.map((t) => `<tr><td>${esc(t.label)}</td><td>${t.units}</td><td class="money">${esc(t.revenue.formatted)}</td></tr>`).join('') ||
        '<tr><td colspan="3" class="muted" style="padding:18px">No sales in this period.</td></tr>'}</tbody></table></div>`;
  reports.run = () => { reports.from = $('rFrom').value; reports.to = $('rTo').value; render(); };
}

// ---------- settings ----------
async function settings() {
  const s = await api('/api/admin/settings');
  const audit = await api('/api/admin/audit?limit=8');
  const cur = CFG.currencies.map((c) => `<option value="${c.code}" ${c.code === s.base_currency ? 'selected' : ''}>${c.code} — ${esc(c.name)} (${esc(c.symbol)})</option>`).join('');
  const signinCard = ME && ME.role === 'super_admin' ? `
    <div class="sec-title">Sign-in</div>
    <div class="card panel">
      <h3 style="font-size:16px">Your account</h3>
      <p class="muted" style="font-size:13.5px;margin:6px 0 14px">
        Signed in as <b>${esc(ME.email)}</b> &middot; ${esc(String(ME.role).replace(/_/g, ' '))}.
        The password is stored hashed, so the panel cannot display it &mdash; change it under <b>Users</b>.</p>
      <label class="field" style="margin:0"><span>Sign-in note &mdash; super admins only</span>
        <textarea id="sSignin" rows="3"
          placeholder="Login details, who to call, anything the next person needs">${esc(s.signin_note || '')}</textarea></label>
      <button class="btn primary" style="margin-top:14px" onclick="saveSignin()">Save note</button>
      <p class="muted" style="font-size:12.5px;margin:10px 0 16px;line-height:1.6">
        Never printed on the sign-in page. Only super admins can read it &mdash; the API does not serve it to any other role.
      </p>
    </div>` : '';

  $('view').innerHTML = signinCard + `
    <div class="card panel">
      <h3 style="font-size:16px">Currency</h3>
      <p class="muted" style="font-size:13.5px;margin:6px 0 16px">
        Admin-owned. Change the currency the platform quotes and pays in. New quotes, orders and payments use it.
        Historical records keep the currency they were booked in.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;align-items:end">
        <label class="field" style="margin:0"><span>Base currency</span>
          <select id="curSel">${cur}</select></label>
        <label class="field" style="margin:0"><span>Conversion rate (optional)</span>
          <input id="curRate" placeholder="1 ${esc(s.base_currency)} = ? new"></label>
        <label class="field" style="margin:0"><span>Reason (audited)</span>
          <input id="curWhy" placeholder="e.g. moving to UAE market"></label>
        <label class="row" style="gap:8px;font-size:13.5px;margin:0 0 11px"><input type="checkbox" id="curConvert" style="width:auto">
          Convert existing device prices</label>
        <button class="btn primary" style="height:40px" onclick="saveCurrency()">Apply currency</button>
      </div>
      <div class="notice" style="margin-top:14px">
        Leaving “convert existing prices” unticked keeps every current device price in ${esc(s.base_currency)} — quotes would
        then need an FX rate and fail loudly rather than guess. Ticking it rewrites the price master and option adjustments at
        your rate and keeps full price history.
      </div>
    </div>

    <div class="sec-title">Platform policies</div>
    <div class="card panel">
      <div class="row" style="flex-wrap:wrap">
        <label class="field" style="margin:0;min-width:200px"><span>Company name</span><input id="sCompany" value="${esc(s.company_name)}"></label>
        <label class="field" style="margin:0;min-width:220px"><span>Legal name (on invoices)</span><input id="sLegal" value="${esc(s.company_legal_name)}"></label>
        <label class="field" style="margin:0;width:190px"><span>TRN</span><input id="sTrn" value="${esc(s.trn)}" placeholder="100xxxxxxxxxxx3"></label>
        <label class="field" style="margin:0;min-width:240px"><span>Registered address</span><input id="sAddr" value="${esc(s.company_address)}"></label>
        <label class="field" style="margin:0;width:150px"><span>Estimate band (±%)</span><input id="sRange" value="${Number(s.range_pct_bp) / 100}" inputmode="decimal"></label>
        <label class="field" style="margin:0;width:150px"><span>Rounding step</span><input id="sStep" value="${esc(s.rounding_step)}" inputmode="numeric"></label>
        <label class="field" style="margin:0;width:170px"><span>Floor (% of base)</span><input id="sFloor" value="${Number(s.min_floor_pct_bp) / 100}" inputmode="decimal"></label>
        <label class="field" style="margin:0;width:150px"><span>Quote valid (hours)</span><input id="sValid" value="${esc(s.quote_valid_hours)}" inputmode="numeric"></label>
        <label class="field" style="margin:0;width:150px"><span>VAT rate (%)</span><input id="sVat" value="${Number(s.vat_rate_bp) / 100}" inputmode="decimal"></label>
      </div>
      <div class="row" style="flex-wrap:wrap;gap:18px;margin-top:6px">
        <label class="row" style="gap:8px;font-size:13.5px"><input type="checkbox" id="sCash" ${s.allow_cash_payment === 'true' ? 'checked' : ''} style="width:auto"> Allow cash payment</label>
        <label class="row" style="gap:8px;font-size:13.5px"><input type="checkbox" id="sImei" ${s.imei_required === 'true' ? 'checked' : ''} style="width:auto"> IMEI required</label>
        <label class="row" style="gap:8px;font-size:13.5px"><input type="checkbox" id="sKyc" ${s.kyc_required === 'true' ? 'checked' : ''} style="width:auto"> KYC required</label>
        <label class="row" style="gap:8px;font-size:13.5px"><input type="checkbox" id="sLock" ${s.currency_locked === 'true' ? 'checked' : ''} style="width:auto"> Lock currency changes</label>
      </div>
      <button class="btn primary" style="margin-top:16px" onclick="savePolicies()">Save policies</button>
    </div>

    <div class="sec-title">Recent audit entries</div>
    <div class="card tbl-wrap"><table><thead><tr><th>When</th><th>Actor</th><th>Entity</th><th>Change</th><th>Reason</th></tr></thead>
      <tbody>${audit.map((a) => `<tr><td class="tag">${esc(a.at)}</td><td>${esc(a.actor_name)}</td>
        <td class="mono tag">${esc(a.entity)}#${esc(a.entity_id)}</td>
        <td><span class="dim">${esc(a.old_value || '—')}</span> → <b>${esc(a.new_value || '—')}</b></td>
        <td class="tag">${esc(a.reason || '')}</td></tr>`).join('')}</tbody></table></div>`;
}

async function saveCurrency() {
  const code = $('curSel').value;
  const convert = $('curConvert').checked;
  const rate = $('curRate').value ? Number($('curRate').value) : undefined;
  if (convert && !rate) return toast('Conversion needs a rate', true);
  if (!confirm(`Switch platform currency to ${code}${convert ? ' and convert all device prices at ' + rate : ''}?`)) return;
  try {
    const r = await api('/api/admin/currency', { method: 'POST', body: { code, convertPrices: convert, rate, reason: $('curWhy').value.trim() } });
    CFG = await api('/api/config');
    $('curBadge').textContent = 'Prices in ' + CFG.currency;
    toast(`Currency now ${r.currency}${r.pricesConverted ? ` · ${r.pricesConverted} prices converted` : ''}`);
    render();
  } catch (e) { toast(e.message, true); }
}

async function saveSignin() {
  try {
    await api('/api/admin/settings', { method: 'POST', body: { signin_note: $('sSignin').value } });
    toast('Sign-in note saved');
  } catch (e) { toast(e.message, true); }
}

async function savePolicies() {
  try {
    await api('/api/admin/settings', { method: 'POST', body: {
      company_name: $('sCompany').value.trim(),
      company_legal_name: $('sLegal').value.trim(),
      trn: $('sTrn').value.trim(),
      company_address: $('sAddr').value.trim(),
      range_pct_bp: Math.round(Number($('sRange').value) * 100),
      rounding_step: $('sStep').value.trim(),
      min_floor_pct_bp: Math.round(Number($('sFloor').value) * 100),
      quote_valid_hours: $('sValid').value.trim(),
      vat_rate_bp: Math.round(Number($('sVat').value) * 100),
      allow_cash_payment: $('sCash').checked ? 'true' : 'false',
      imei_required: $('sImei').checked ? 'true' : 'false',
      kyc_required: $('sKyc').checked ? 'true' : 'false',
      currency_locked: $('sLock').checked ? 'true' : 'false',
    } });
    toast('Policies saved'); render();
  } catch (e) { toast(e.message, true); }
}

// ---------- users ----------
const ROLES = [
  ['super_admin', 'Super admin — everything'],
  ['ops_manager', 'Ops manager — orders and inspections'],
  ['branch_manager', 'Branch manager — own branch'],
  ['inspector', 'Inspector — inspection only'],
  ['finance', 'Finance — payments and reports'],
  ['sales', 'Sales — resale inventory'],
];

async function users() {
  const list = await api('/api/admin/users');
  const selfId = ME && ME.id;

  const rows = list.map((u) => `
    <tr>
      <td><b>${esc(u.name)}</b>${u.id === selfId ? ' <span class="badge info">you</span>' : ''}</td>
      <td class="dim">${esc(u.email)}</td>
      <td>
        <select onchange="changeRole(${u.id}, this.value)" ${u.id === selfId ? 'disabled title="You cannot change your own role"' : ''}>
          ${ROLES.map(([v, l]) => `<option value="${v}" ${u.role === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
        </select>
      </td>
      <td>${u.active ? '<span class="badge ok">active</span>' : '<span class="badge warn">disabled</span>'}</td>
      <td>
        <div style="display:flex;gap:6px;align-items:center;white-space:nowrap">
          <input id="pw_${u.id}" type="password" placeholder="new password"
                 style="flex:1;min-width:104px;max-width:170px;margin:0">
          <button class="btn sm" style="flex:none" onclick="resetPw(${u.id})">Set</button>
          <button class="btn sm ghost" style="flex:none" onclick="toggleUser(${u.id}, ${u.active ? 0 : 1})" ${u.id === selfId ? 'disabled' : ''}>
            ${u.active ? 'Disable' : 'Enable'}
          </button>
        </div>
      </td>
    </tr>`).join('');

  $('view').innerHTML = `
    <div class="card panel">
      <h2 style="font-size:16px;margin-bottom:6px">Add a staff account</h2>
      <p class="muted" style="font-size:13.5px;margin-bottom:14px">
        New accounts start with the password <b>123123</b>. Set a real one before handing the login over.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;align-items:end">
        <label class="field" style="margin:0"><span>Name</span><input id="uName" placeholder="Rahul Inspector"></label>
        <label class="field" style="margin:0"><span>Email</span><input id="uEmail" placeholder="name@indubaicity.com"></label>
        <label class="field" style="margin:0"><span>Role</span>
          <select id="uRole">${ROLES.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
        </label>
        <label class="field" style="margin:0"><span>Password</span><input id="uPass" value="123123"></label>
        <button class="btn" style="height:42px" onclick="addUser()">Create account</button>
      </div>
      <div id="uErr" class="err" style="margin-top:10px"></div>
    </div>

    <div class="card tbl-wrap" style="margin-top:18px">
      <table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th style="min-width:300px">Password / access</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <p class="muted" style="font-size:13px;margin-top:14px">
      Disabling an account blocks sign-in immediately. Every change here is written to the audit log with who did it,
      when, and the old and new value — the password itself is never recorded.</p>`;
}

async function addUser() {
  const err = $('uErr');
  err.textContent = '';
  const body = {
    name: $('uName').value.trim(),
    email: $('uEmail').value.trim(),
    role: $('uRole').value,
    password: $('uPass').value || '123123',
  };
  if (!body.name || !body.email) { err.textContent = 'Name and email are required.'; return; }
  try {
    await api('/api/admin/users', { method: 'POST', body });
    toast('Account created');
    render();
  } catch (e) { err.textContent = e.message; }
}

async function resetPw(id) {
  const input = $('pw_' + id);
  const password = (input.value || '').trim();
  if (password.length < 6) { toast('Password must be at least 6 characters', true); return; }
  try {
    await api('/api/admin/users/' + id, { method: 'PATCH', body: { password, reason: 'reset from Users panel' } });
    input.value = '';
    toast('Password changed');
  } catch (e) { toast(e.message, true); }
}

async function toggleUser(id, active) {
  try {
    await api('/api/admin/users/' + id, { method: 'PATCH',
      body: { active: !!active, reason: active ? 'enabled from Users panel' : 'disabled from Users panel' } });
    toast(active ? 'Account enabled' : 'Account disabled');
    render();
  } catch (e) { toast(e.message, true); }
}

async function changeRole(id, role) {
  try {
    await api('/api/admin/users/' + id, { method: 'PATCH', body: { role, reason: 'role changed from Users panel' } });
    toast('Role updated');
    render();
  } catch (e) { toast(e.message, true); render(); }
}

// ---------- audit ----------
async function auditLog() {
  const rows = await api('/api/admin/audit?limit=200');
  $('view').innerHTML = `
    <div class="card tbl-wrap"><table>
      <thead><tr><th>When</th><th>Actor</th><th>Role</th><th>Entity</th><th>Action</th><th>Field</th><th>Old</th><th>New</th><th>Reason</th></tr></thead>
      <tbody>${rows.map((a) => `<tr>
        <td class="tag">${esc(a.at)}</td><td>${esc(a.actor_name || a.actor_id || 'system')}</td>
        <td class="tag">${esc(a.ip || '')}</td>
        <td class="mono tag">${esc(a.entity)}#${esc(a.entity_id)}</td>
        <td>${esc(a.action)}</td><td class="tag">${esc(a.field || '')}</td>
        <td class="dim">${esc(a.old_value || '')}</td><td><b>${esc(a.new_value || '')}</b></td>
        <td class="tag">${esc(a.reason || '')}</td></tr>`).join('')}</tbody></table></div>`;
}

boot();
