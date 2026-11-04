'use strict';
/* Customer site — vanilla, no build step. */
let cfg = null, catalog = [], questions = [], quote = null;
const state = { category: 'mobile', brand: null, model: null, variant: null, answers: {}, details: null, quote: null };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'content-type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function go(screen) {
  for (const s of ['home', 'select', 'contact', 'condition', 'details', 'price', 'done', 'track']) {
    const el = $('scr-' + s);
    if (el) el.classList.toggle('hidden', s !== screen);
  }
  if (screen === 'details') {
    syncDeviceFields();
    // the number was captured in step 2 — show it, don't ask for it twice
    if ($('fPhone') && state.phone) $('fPhone').value = state.phone;
  }
  if (screen !== 'home') window.scrollTo({ top: 0, behavior: 'smooth' });
  else window.scrollTo({ top: 0, behavior: 'auto' });
}

function scrollToQuote() {
  go('home');
  const q = $('quote');
  if (q) setTimeout(() => q.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
}

/** IMEI is a phone concept; laptops are identified by serial number. */
function syncDeviceFields() {
  const mobile = state.category === 'mobile';
  $('imeiWrap').style.display = mobile ? '' : 'none';
  const serialLabel = $('fSerial').parentElement.querySelector('span');
  if (serialLabel) serialLabel.textContent = mobile ? 'Serial number' : 'Serial number *';
}

function toast(msg, isErr) {
  const d = document.createElement('div');
  d.className = 'toast' + (isErr ? ' err' : '');
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 3400);
}

// ---------- boot ----------
(async function init() {
  $('yr').textContent = new Date().getFullYear();
  try {
    cfg = await api('/api/config');
    const pill = $('curPill');
    if (pill) pill.textContent = `Prices in ${cfg.currency}`;
    if ($('navPhone')) $('navPhone').textContent = cfg.support.phone;
    if ($('support')) $('support').innerHTML = `${esc(cfg.support.phone)}<br>${esc(cfg.support.email)}`;
    if ($('toolName') && cfg.data && cfg.data.tool) $('toolName').textContent = cfg.data.tool;
    if ($('footLegal') && cfg.legal) {
      const L = cfg.legal;
      if ($('footEntity')) $('footEntity').textContent = L.name;
      $('footLegal').innerHTML = [
        `<b>${esc(L.name)}</b>`,
        L.tradeLicence ? `Trade licence ${esc(L.tradeLicence)}` : '',
        `TRN ${esc(L.trn)}`,
        esc(L.address),
      ].filter(Boolean).join('<br>');
    }
    const b = $('fBranch');
    if (b) b.innerHTML = cfg.branches.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
    const d = new Date(); d.setDate(d.getDate() + 1);
    if ($('fDate')) { $('fDate').value = d.toISOString().slice(0, 10); $('fDate').min = new Date().toISOString().slice(0, 10); }
    renderBranches();
    await loadHeroPicker('mobile');
  } catch (e) {
    toast('Could not load the platform: ' + e.message, true);
  }
})();

function renderBranches() {
  const el = $('branchGrid');
  if (!el || !cfg) return;
  el.innerHTML = cfg.branches.map((b) => `
    <div class="br-row">
      <span class="nm">${esc(b.name.replace(' — ', ' · '))}</span>
      <span class="city">${esc(b.city || '')}</span>
      <span class="open">Open today</span>
    </div>`).join('');
}

// ---------- hero instant quote ----------
let heroCat = 'mobile', heroCatalog = [];
async function loadHeroPicker(category) {
  heroCat = category;
  document.querySelectorAll('#hqTabs button').forEach((b) => b.classList.toggle('on', b.dataset.cat === category));
  heroCatalog = await api('/api/catalog?category=' + category);
  $('hqBrand').innerHTML = `<option value="">Select brand</option>` +
    heroCatalog.map((b, i) => `<option value="${i}">${esc(b.name)}</option>`).join('');
  $('hqModel').innerHTML = `<option value="">Choose a model</option>`;
  $('hqVariant').classList.add('hidden');
  if ($('hqVariantWrap')) $('hqVariantWrap').classList.add('hidden');
  renderFeatured();
}

/* Marketing surfaces only advertise models whose buy price came from researched market data.
   The rest stay quotable in the flow, but we don't headline an unverified number. */
const FEATURED = ['iPhone 17 Pro Max', 'iPhone 17 Pro', 'iPhone 17', 'iPhone 16 Pro', 'iPhone 16', 'iPhone 15 Pro', 'Galaxy S24', 'MacBook Air M2'];

function collectPrices(brands) {
  const out = [];
  for (const b of brands) for (const m of b.models) for (const v of m.variants) out.push({ ...v, model: m.name, brand: b.name, category: b._cat || 'mobile' });
  return out;
}

/* The price list is one pool, filtered by a chip in the landing markup.
   Filtering happens in place so the rows can carry their own transitions. */
let priceFilterCat = 'all';
let featuredPool = [];

function paintPrices() {
  const grid = $('priceGrid');
  if (!grid) return;
  const list = featuredPool.filter((f) => priceFilterCat === 'all' || f.category === priceFilterCat);
  grid.innerHTML = list.length ? list.map((f) => `
    <button class="l-row">
      <span class="name">${esc(f.brand)} ${esc(f.model)}</span>
      <span class="var">${esc(f.variant)}</span>
      <span class="amt">${esc(f.basePrice.formatted)}</span>
      <span class="go">Quote &rarr;</span>
    </button>`).join('')
    : `<p class="ledger-note">No devices in this list right now — ask us for a quote on any model.</p>`;
  grid.querySelectorAll('.l-row').forEach((el, i) => {
    el.addEventListener('click', () => startFromPrice(list[i]));
  });
}

window.applyPriceFilter = function (f) {
  priceFilterCat = f === 'mobile' || f === 'laptop' ? f : 'all';
  paintPrices();
};

async function renderFeatured() {
  const grid = $('priceGrid'), tape = $('tapeRows');
  if (!grid) return;
  const [mob, lap] = await Promise.all([api('/api/catalog?category=mobile'), api('/api/catalog?category=laptop')]);
  mob.forEach((b) => { b._cat = 'mobile'; });
  lap.forEach((b) => { b._cat = 'laptop'; });
  const all = collectPrices([...mob, ...lap]);

  const pool = [];
  for (const name of FEATURED) {
    const match = all.find((x) => x.model === name);
    if (match) pool.push(match);
  }
  if (!pool.length) pool.push(...all.sort((a, b) => b.basePrice.minor - a.basePrice.minor).slice(0, 8));

  const biggest = (arr) => arr.reduce((a, b) => (!a || b.basePrice.minor > a.basePrice.minor ? b : a), null);
  const topPhone = biggest(pool.filter((p) => p.category === 'mobile')) || biggest(pool);
  const topAny = biggest(pool);
  if ($('heroPaid') && topPhone) $('heroPaid').textContent = topPhone.basePrice.formatted;
  if ($('cashFigure') && topAny) $('cashFigure').textContent = topAny.basePrice.formatted;

  if (tape) {
    tape.innerHTML = pool.slice(0, 5).map((f) => `
      <div class="tape-row">
        <span class="dev">${esc(f.model)}<span>${esc(f.variant)}</span></span>
        <span class="val">${esc(f.basePrice.formatted)}</span>
      </div>`).join('');
  }
  featuredPool = [...pool, ...all.filter((x) => !pool.includes(x))
    .sort((a, b) => b.basePrice.minor - a.basePrice.minor)].slice(0, 12);
  paintPrices();
  renderFeatured.pool = pool;
}

async function startFromPrice(f) {
  if (!f) return;
  await startFlow(f.category);
  state.brand = catalog.find((b) => b.name === f.brand) || null;
  if (!state.brand) return renderBrands();
  state.model = state.brand.models.find((m) => m.name === f.model) || null;
  if (!state.model) return renderModels();
  state.variant = state.model.variants.find((v) => v.id === f.id) || state.model.variants[0];
  openCondition();
}

function onBrandPick() {
  const bi = $('hqBrand').value;
  if (bi === '') { $('hqModel').innerHTML = `<option value="">Choose a model</option>`; $('hqVariant').classList.add('hidden'); return; }
  const brand = heroCatalog[Number(bi)];
  $('hqModel').innerHTML = `<option value="">Choose a model</option>` +
    brand.models.map((m, i) => `<option value="${i}">${esc(m.name)}</option>`).join('');
  $('hqVariant').classList.add('hidden');
}
function onModelPick() {
  const bi = $('hqBrand').value, mi = $('hqModel').value;
  if (bi === '' || mi === '') return;
  const model = heroCatalog[Number(bi)].models[Number(mi)];
  const wrap = $('hqVariantWrap');
  if (model.variants.length === 1) {
    $('hqVariant').classList.add('hidden');
    if (wrap) wrap.classList.add('hidden');
    $('hqVariant').innerHTML = `<option value="0">${esc(model.variants[0].variant)}</option>`;
  } else {
    $('hqVariant').classList.remove('hidden');
    if (wrap) wrap.classList.remove('hidden');
    $('hqVariant').innerHTML = model.variants.map((v, i) => `<option value="${i}">${esc(v.variant)}</option>`).join('');
  }
}
async function heroQuote() {
  const bi = $('hqBrand').value, mi = $('hqModel').value;
  if (bi === '' || mi === '') { toast('Pick a brand and model first', true); return; }
  const brand = heroCatalog[Number(bi)];
  const model = brand.models[Number(mi)];
  const vi = Number($('hqVariant').value || 0);
  const variant = model.variants[vi] || model.variants[0];
  await startFlow(heroCat);
  state.brand = catalog.find((b) => b.id === brand.id) || null;
  state.model = state.brand && state.brand.models.find((m) => m.id === model.id);
  state.variant = variant;
  openCondition();
}

// ---------- step 1: device ----------
async function startFlow(category) {
  state.category = category;
  state.brand = null; state.model = null; state.variant = null; state.answers = {}; quote = null;
  catalog = await api('/api/catalog?category=' + category);
  renderBrands();
  go('select');
}

function renderBrands() {
  $('selTitle').textContent = state.category === 'laptop' ? 'Choose your laptop brand' : 'Choose your phone brand';
  $('estAmount1').textContent = '—';
  $('estSub1').textContent = 'Select your device to see a price';
  $('selectBody').innerHTML = `<div class="pick-list">` + catalog.map((b) => `
    <button class="pick" data-brand="${b.id}">
      <span class="t">${esc(b.name)}<small>${b.models.length} model${b.models.length > 1 ? 's' : ''}</small></span>
      <span class="arr">&rarr;</span>
    </button>`).join('') + `</div>`;
  $('selectBody').querySelectorAll('[data-brand]').forEach((el) => {
    el.addEventListener('click', () => {
      state.brand = catalog.find((b) => b.id === Number(el.dataset.brand));
      state.model = null; state.variant = null;
      renderModels();
    });
  });
}

function renderModels() {
  $('selTitle').textContent = `${state.brand.name} — pick your model`;
  $('selectBody').innerHTML = `
    <div style="margin-bottom:12px"><button class="btn btn-out btn-sm" data-back>&larr; All brands</button></div>
    <div class="pick-list">` + state.brand.models.map((m) => `
      <button class="pick" data-model="${m.id}">
        <span class="t">${esc(m.name)}<small>${m.variants.length} variant${m.variants.length > 1 ? 's' : ''}</small></span>
        <span class="arr">&rarr;</span>
      </button>`).join('') + `</div>`;
  $('selectBody').querySelector('[data-back]').addEventListener('click', renderBrands);
  $('selectBody').querySelectorAll('[data-model]').forEach((el) => {
    el.addEventListener('click', () => {
      state.model = state.brand.models.find((m) => m.id === Number(el.dataset.model));
      state.variant = null;
      renderVariants();
    });
  });
}

function renderVariants() {
  $('selTitle').textContent = `${state.model.name} — storage`;
  $('selectBody').innerHTML = `
    <div style="margin-bottom:12px"><button class="btn btn-out btn-sm" data-back>&larr; All models</button></div>
    <div class="pick-list">` + state.model.variants.map((v) => `
      <button class="pick" data-variant="${v.id}">
        <span class="t">${esc(v.variant)}</span>
        <span class="p">up to ${esc(v.basePrice.formatted)} &rarr;</span>
      </button>`).join('') + `</div>`;
  $('selectBody').querySelector('[data-back]').addEventListener('click', renderModels);
  $('selectBody').querySelectorAll('[data-variant]').forEach((el) => {
    el.addEventListener('click', () => {
      state.variant = state.model.variants.find((v) => v.id === Number(el.dataset.variant));
      openContact();
    });
  });
}

// ---------- step 2: mobile number, then a first price ----------
async function openContact() {
  const label = `${state.brand.name} ${state.model.name} ${state.variant.variant}`;
  $('cErr').textContent = '';
  $('firstPrice').classList.add('hidden');
  $('cPhoneBtn').disabled = false;
  $('cPhone').value = state.phone || '';
  // representative photo until real model photography is scraped in
  const shot = $('modelShot');
  if (shot) {
    shot.src = state.model.image || '/assets/img/iphone15.jpg';
    shot.alt = label;
  }
  $('fpRange').dataset.device = label;
  go('contact');
  setTimeout(() => { const el = $('cPhone'); if (el) el.focus(); }, 220);
}

const phoneDigits = (v) => String(v || '').replace(/[^0-9]/g, '');

async function submitPhone() {
  const err = $('cErr');
  err.textContent = '';
  const digits = phoneDigits($('cPhone').value);
  if (digits.length < 9 || digits.length > 15) {
    err.textContent = 'Enter a valid mobile number, for example +971 50 123 4567.'; return;
  }
  state.phone = '+' + digits;
  $('cPhoneBtn').disabled = true;
  try {
    const qs = await api('/api/questions?category=' + state.category);
    // the first price is the top of the range: every question answered at its best
    const best = {};
    qs.forEach((q) => { best[q.code] = q.options[0].code; });
    const top = await api('/api/quote', { method: 'POST',
      body: { variantId: state.variant.id, category: state.category, answers: best } });

    // a lead, not an order — the customer has not committed to anything yet
    try {
      await api('/api/leads', { method: 'POST', body: { phone: state.phone, variantId: state.variant.id,
        device: `${state.brand.name} ${state.model.name} ${state.variant.variant}`,
        firstQuoteMinor: top.estimate.minor, source: location.hostname } });
    } catch (e) { /* never block a price on lead capture */ }

    if ($('fpDevice')) $('fpDevice').textContent = `${state.brand.name} ${state.model.name} ${state.variant.variant}`;
    $('fpRange').textContent = top.range.text;
    $('firstPrice').classList.remove('hidden');
    $('cPhoneBtn').classList.add('hidden');
    setTimeout(() => $('firstPrice').scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
  } catch (e) {
    err.textContent = e.message;
    $('cPhoneBtn').disabled = false;
  }
}

function backToSelect() {
  if (state.model) renderVariants(); else if (state.brand) renderModels(); else renderBrands();
  go('select');
}
function resetFlow() { state.brand = null; state.model = null; state.variant = null; state.answers = {}; quote = null; renderBrands(); go('select'); }

// ---------- step 3: condition, three short pages ----------
const QPAGES = [
  { title: 'Appearance', sub: 'Screen, body and edges', sections: ['display', 'body', 'cosmetic'] },
  { title: 'How it works', sub: 'Battery and function', sections: ['battery', 'function'] },
  { title: 'Paperwork', sub: 'Repairs and what comes with it', sections: ['history', 'extras'] },
];
let qPage = 0;

async function openCondition() {
  questions = await api('/api/questions?category=' + state.category);
  state.answers = state.answers || {};
  qPage = 0;
  $('condDevice').textContent = `${state.brand.name} ${state.model.name} ${state.variant.variant}`;
  renderQuestionPage();
  go('condition');
}

function pageQuestions() {
  const sections = QPAGES[qPage].sections;
  return questions.filter((q) => sections.includes(q.section));
}

function renderQuestionPage() {
  const qs = pageQuestions();
  $('qStep').textContent = `Step ${qPage + 1} of ${QPAGES.length} · ${QPAGES[qPage].title}`;
  if ($('qBar')) $('qBar').style.width = Math.round(((qPage + 1) / QPAGES.length) * 100) + '%';
  $('questionBody').innerHTML = qs.map((q) => `
    <div class="q">
      <div class="qhead"><h4>${esc(q.label)}</h4></div>
      <div class="opts" data-q="${esc(q.code)}">` +
      q.options.map((o) => `<button class="opt${state.answers[q.code] === o.code ? ' sel' : ''}"
        data-q="${esc(q.code)}" data-o="${esc(o.code)}">${esc(o.label)}</button>`).join('') +
      `</div></div>`).join('');
  $('questionBody').querySelectorAll('.opt').forEach((el) => {
    el.addEventListener('click', () => {
      state.answers[el.dataset.q] = el.dataset.o;
      el.parentElement.querySelectorAll('.opt').forEach((x) => x.classList.toggle('sel', x === el));
      refreshQuote();
      updateCondNav();
    });
  });
  updateCondNav();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateCondNav() {
  const qs = pageQuestions();
  const answeredAll = qs.every((q) => state.answers[q.code]);
  const last = qPage === QPAGES.length - 1;
  const next = $('toDetails');
  if (next) {
    next.disabled = !answeredAll;
    next.textContent = last ? 'See my price' : 'Next';
  }
  if ($('qBack')) $('qBack').style.visibility = qPage === 0 ? 'hidden' : 'visible';
}

function prevQuestionPage() {
  if (qPage > 0) { qPage--; renderQuestionPage(); }
}

async function nextQuestionPage() {
  if (qPage < QPAGES.length - 1) { qPage++; renderQuestionPage(); return; }
  await refreshQuote();
  if (!quote || !quote.complete) { toast('Answer the remaining questions first', true); return; }
  renderPriceScreen(quote);
  go('price');
}

function renderEstimate() {
  // price is deliberately withheld until the details step is complete
}

let quoteSeq = 0;
async function refreshQuote() {
  const seq = ++quoteSeq;
  try {
    const q = await api('/api/quote', { method: 'POST', body: { variantId: state.variant.id, category: state.category, answers: state.answers } });
    if (seq !== quoteSeq) return;
    quote = q;
    // the pager decides when "Next" is available; the full-quote completeness check
    // would disable it on page 1 of 3 forever
  } catch (e) { console.error(e); }
}

// ---------- step 3: details ----------
function togglePickup() {
  const store = $('fPickup').value === 'store';
  $('branchWrap').style.display = store ? '' : 'none';
  $('dateWrap').style.display = store ? 'none' : '';
  $('slotWrap').style.display = store ? 'none' : '';
}

/** Final step: validate the collection details, then book. The price was already shown. */
async function confirmBooking() {
  const err = $('formErr');
  err.textContent = '';
  const phoneInput = $('fPhone');
  if (phoneInput && state.phone) phoneInput.value = state.phone;
  const body = {
    variantId: state.variant.id,
    category: state.category,
    answers: state.answers,
    customer: { name: $('fName').value.trim(), phone: state.phone || $('fPhone').value.trim(),
      email: $('fEmail').value.trim(),
      address: $('fAddr').value.trim(), pincode: $('fPin').value.trim() },
    device: { imei: $('fImei').value.replace(/\D/g, ''), serial: $('fSerial').value.trim(), photos: [] },
    kyc: { idType: $('fIdType').value, idNumber: $('fIdNum').value.trim() },
    pickupType: $('fPickup').value,
    pickup: { date: $('fPickup').value === 'store' ? null : $('fDate').value, slot: $('fSlot').value,
      branchId: $('fPickup').value === 'store' ? Number($('fBranch').value) : (cfg.branches[0] && cfg.branches[0].id) },
    ownershipDeclared: $('fOwn').checked,
    dataHandling: (document.querySelector('input[name="fHandling"]:checked') || {}).value || 'reuse',
  };
  if (!body.customer.name) { err.textContent = 'Your name is required.'; return; }
  if (!body.customer.phone) { err.textContent = 'Go back to step 2 and add your mobile number.'; return; }
  if (!body.kyc.idNumber) { err.textContent = 'ID number is required for KYC.'; return; }
  if (state.category === 'mobile' && !body.device.imei) { err.textContent = 'IMEI is required for phones.'; return; }
  if (state.category === 'laptop' && !body.device.serial) { err.textContent = 'Serial number is required for laptops.'; return; }
  if (!body.ownershipDeclared) { err.textContent = 'Please confirm the device ownership declaration.'; return; }

  state.details = body;
  $('submitBtn').disabled = true;
  try {
    await bookPickup();
  } finally {
    $('submitBtn').disabled = false;
  }
}

function renderPriceScreen(q) {
  $('priceDevice').textContent = q.device.label;
  $('priceRange').textContent = q.range.text;
  const moved = q.adjustments.filter((a) => a.deltaMinor !== 0);
  const still = q.adjustments.length - moved.length;

  const rows = moved.map((a) => {
    const cls = a.deltaMinor < 0 ? 'neg' : 'pos';
    return `<div><span class="k">${esc(a.questionLabel)} · ${esc(a.optionLabel)}</span><span class="v ${cls}">${esc(a.delta)}</span></div>`;
  }).join('');

  if ($('handlingNote') && state.details) {
    $('handlingNote').textContent = state.details.dataHandling === 'destroy'
      ? 'Data: storage will be physically destroyed, certificate issued.'
      : 'Data: certified erase, then refurbished and resold.';
  }
  $('priceBreakdown').innerHTML =
    `<div><span class="k">Base price for ${esc(q.device.model)} ${esc(q.device.variant)}</span><span class="v">${esc(q.basePrice.formatted)}</span></div>` +
    rows +
    (still ? `<div><span class="k">${still} answer${still > 1 ? 's' : ''} with no adjustment</span><span class="v">—</span></div>` : '') +
    `<div class="total"><span>Estimated, before inspection</span><b>${esc(q.range.text)}</b></div>`;
}

async function bookPickup() {
  const err = $('bookErr');
  err.textContent = '';
  if (!state.details) { err.textContent = 'Your details expired — go back and re-enter them.'; return; }
  $('bookBtn').disabled = true;
  try {
    const out = await api('/api/orders', { method: 'POST', body: state.details });
    localStorage.setItem('bb_last_order', out.code);
    $('doneCode').textContent = out.code;
    $('doneEst').textContent = `Estimated ${out.estimate.range.text} · ${state.details.pickupType === 'store' ? 'store visit' : 'home pickup'} · final value confirmed at inspection`;
    go('done');
  } catch (e) {
    err.textContent = e.message;
  } finally {
    $('bookBtn').disabled = false;
  }
}

// ---------- tracking ----------
async function trackOrder() {
  const code = ($('trackCode').value || '').trim().toUpperCase();
  $('trackErr').textContent = '';
  if (!code) { $('trackErr').textContent = 'Enter your order number.'; return; }
  try {
    const o = await api('/api/orders/' + encodeURIComponent(code));
    renderTrack(o);
    go('track');
    trackCodeCache = code;
  } catch (e) { $('trackErr').textContent = e.message; }
}
let trackCodeCache = '';

function renderTrack(o) {
  const badge = (s) => {
    const good = ['accepted', 'paid', 'completed'];
    const bad = ['rejected', 'cancelled', 'returned'];
    return `<span class="badge ${good.includes(s) ? 'ok' : bad.includes(s) ? 'bad' : 'info'}">${esc(s.replace(/_/g, ' '))}</span>`;
  };
  $('trackBody').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap">
      <div><div class="dim mono" style="font-size:12.5px">${esc(o.code)}</div>
        <h2 style="font-size:26px;margin-top:4px">${esc(o.device.label)}</h2></div>${badge(o.status)}</div>
    <div style="display:flex;gap:34px;flex-wrap:wrap;margin:18px 0 24px">
      <div><div class="dim" style="font-size:12px;letter-spacing:.08em;text-transform:uppercase">Estimated</div>
        <div style="font-weight:600">${esc(o.estimate.low.formatted)} – ${esc(o.estimate.high.formatted)}</div></div>
      <div><div class="dim" style="font-size:12px;letter-spacing:.08em;text-transform:uppercase">IMEI</div>
        <div class="mono">${esc(o.device.imei || '—')}</div></div>
      <div><div class="dim" style="font-size:12px;letter-spacing:.08em;text-transform:uppercase">Collection</div>
        <div style="text-transform:capitalize">${esc(o.pickup.type)}${o.pickup.date ? ' · ' + esc(o.pickup.date) : ''}</div></div>
    </div>
    <hr class="hair" style="margin-bottom:20px">
    <h3 style="font-size:15px;font-family:var(--sans);font-weight:600;margin-bottom:14px">Progress</h3>
    <ul class="tl">` + o.timeline.map((t, i) => {
      const cls = i < o.timeline.length - 1 ? 'done' : 'now';
      return `<li class="${cls}"><b>${esc(t.status.replace(/_/g, ' '))}</b><small>${esc(t.note || '')} · ${esc(t.at)}</small></li>`;
    }).join('') + `</ul>
    <hr class="hair" style="margin:22px 0">
    <h3 style="font-size:15px;font-family:var(--sans);font-weight:600;margin-bottom:12px">What you told us</h3>
    <div style="font-size:14px">` + o.answers.map((a) => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line)"><span class="muted">${esc(a.question)}</span><span>${esc(a.answer)}</span></div>`).join('') + `</div>`;

  const side = $('trackOffer');
  if (o.status === 'offer_generated' && o.offer) {
    side.innerHTML = `
      <div class="label">Final offer</div>
      <div class="amount">${esc(o.offer.amount.formatted)}</div>
      <div class="sub">Inspected ${esc(o.offer.at)}${o.offer.overridden ? ' · adjusted after inspection' : ''}</div>
      ${o.offer.reason ? `<div class="note">${esc(o.offer.reason)}</div>` : ''}
      <div style="display:flex;gap:10px;margin-top:18px">
        <button class="btn btn-gold" style="flex:1" onclick="respond('accept')">Accept</button>
        <button class="btn btn-onink-ghost" style="flex:1" onclick="respond('reject')">Reject</button>
      </div>
      <div class="note">Rejecting is free — we return the device.</div>`;
  } else if (o.offer) {
    side.innerHTML = `
      <div class="label">Offer</div>
      <div class="amount">${esc(o.offer.amount.formatted)}</div>
      <div class="sub">Status: ${esc(o.offer.status)}</div>
      ${o.payment ? `<hr class="hair-ink"><div class="label" style="margin-top:12px">Payment</div>
        <div style="margin-top:6px">${esc(o.payment.method.replace(/_/g, ' ').toUpperCase())} · ${esc(o.payment.status)}</div>
        ${o.payment.receiptNo ? `<div class="mono" style="font-size:12.5px;margin-top:4px">${esc(o.payment.receiptNo)}</div>` : ''}` : ''}`;
  } else {
    side.innerHTML = `<div class="label">Offer</div>
      <div class="amount" style="color:var(--on-ink-muted);font-size:22px;font-family:var(--sans);font-weight:500">Pending inspection</div>
      <div class="sub">You'll be notified the moment the device is valued.</div>`;
  }
}

async function respond(kind) {
  const code = trackCodeCache || ($('trackCode').value || '').trim().toUpperCase() || localStorage.getItem('bb_last_order');
  try {
    const o = await api(`/api/orders/${encodeURIComponent(code)}/${kind}`, { method: 'POST', body: kind === 'reject' ? { reason: 'Customer rejected at tracking page' } : {} });
    toast(kind === 'accept' ? 'Offer accepted — payment follows' : 'Offer rejected — return initiated');
    renderTrack(o);
  } catch (e) { toast(e.message, true); }
}

// ---------- wire hero controls ----------
document.addEventListener('DOMContentLoaded', () => {
  const tabs = $('hqTabs');
  if (tabs) tabs.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
    tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    await loadHeroPicker(b.dataset.cat);
  }));
  if ($('hqBrand')) $('hqBrand').addEventListener('change', onBrandPick);
  if ($('hqModel')) $('hqModel').addEventListener('change', onModelPick);
  document.querySelectorAll('.cat-card[data-cat]').forEach((el) => {
    el.addEventListener('click', () => startFlow(el.dataset.cat));
  });
  if ($('trackCode')) $('trackCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') trackOrder(); });
});
