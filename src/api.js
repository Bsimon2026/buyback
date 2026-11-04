'use strict';
const { all, one, run, now, audit, verifyPassword, hashPassword, getSetting, getSettings, setSetting, slug } = require('./db');
const { siteConfigFor } = require('./sites');
const money = require('./money');
const { valuate, questionsFor, variantWithModel } = require('./pricing');
const docs = require('./docs');

const ROLES_ALL = ['super_admin', 'ops_manager', 'branch_manager', 'inspector', 'finance', 'sales'];
const canOps = ['super_admin', 'ops_manager', 'branch_manager'];
const canInspect = ['super_admin', 'ops_manager', 'branch_manager', 'inspector'];
const canFinance = ['super_admin', 'finance', 'ops_manager'];
const canSell = ['super_admin', 'ops_manager', 'branch_manager', 'sales'];

function httpError(status, message, detail) {
  const e = new Error(message); e.status = status; if (detail) e.detail = detail; return e;
}
const base = () => getSetting('base_currency');

function nextOrderCode() {
  const d = new Date();
  const stamp = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const n = one(`SELECT COUNT(*) c FROM buyback_orders WHERE code LIKE ?`, `BB-${stamp}-%`).c + 1;
  return `BB-${stamp}-${String(n).padStart(4, '0')}`;
}
function nextStockId(category) {
  const prefix = category === 'laptop' ? 'LAP' : 'MOB';
  const n = one(`SELECT COUNT(*) c FROM inventory WHERE stock_id LIKE ?`, `${prefix}%`).c + 1;
  return `${prefix}${String(n).padStart(6, '0')}`;
}
function nextReceiptNo() {
  const d = new Date();
  const stamp = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0');
  const n = one(`SELECT COUNT(*) c FROM payments WHERE receipt_no IS NOT NULL`).c + 1;
  return `RCPT-${stamp}-${String(n).padStart(5, '0')}`;
}
function event(orderId, status, note, actor) {
  run('INSERT INTO order_events (order_id,status,note,actor_id,actor_name) VALUES (?,?,?,?,?)',
    orderId, status, note || null, actor ? actor.id : null, actor ? actor.name : 'customer');
  run(`UPDATE buyback_orders SET status = ?, updated_at = datetime('now') WHERE id = ?`, status, orderId);
}

// ---------- public ----------
function publicConfig() {
  const s = getSettings();
  const code = s.base_currency;
  return {
    company: s.company_name,
    currency: code,
    currencyMeta: money.CURRENCIES[code] || { symbol: code, decimals: 2 },
    rangePct: Number(s.range_pct_bp) / 100,
    quoteValidHours: Number(s.quote_valid_hours),
    allowCashPayment: s.allow_cash_payment === 'true',
    data: { standard: s.erasure_standard, tool: s.erasure_tool || '' },
    legal: { name: s.company_legal_name, nameAr: s.company_legal_name_ar || '', trn: s.trn,
      address: s.company_address, tradeLicence: s.trade_licence || '', domain: s.domain || '', jurisdiction: s.jurisdiction || 'Dubai' },
    support: { phone: s.support_phone, email: s.support_email },
    branches: all('SELECT id, code, name, city FROM branches WHERE active = 1 ORDER BY id'),
    currencies: Object.entries(money.CURRENCIES).map(([c, m]) => ({ code: c, name: m.name, symbol: m.symbol, decimals: m.decimals })),
  };
}

function catalog(category) {
  const brands = all('SELECT * FROM device_brands WHERE category = ? ORDER BY name', category);
  return brands.map((b) => ({
    id: b.id, name: b.name,
    models: all('SELECT * FROM device_models WHERE brand_id = ? ORDER BY name', b.id).map((m) => ({
      id: m.id, name: m.name,
      variants: all('SELECT id, variant, base_price_minor, currency FROM device_variants WHERE model_id = ? AND active = 1 ORDER BY id', m.id)
        .map((v) => ({ id: v.id, variant: v.variant, basePrice: money.money(v.base_price_minor, v.currency) })),
    })),
  }));
}

function createOrder(body, ip) {
  const variantId = Number(body.variantId);
  if (!variantId) throw httpError(400, 'variantId is required');
  const v = variantWithModel(variantId);
  if (!v) throw httpError(404, 'Unknown device variant');

  const customer = body.customer || {};
  if (!customer.name || !customer.phone) throw httpError(400, 'customer.name and customer.phone are required');
  if (getSetting('kyc_required') === 'true' && !(body.kyc && body.kyc.idNumber)) {
    throw httpError(400, 'KYC id number is required');
  }
  if (getSetting('ownership_declared') === 'x') { /* noop */ }
  if (body.ownershipDeclared !== true) throw httpError(400, 'Device ownership declaration is required');

  const dataHandling = ['reuse', 'destroy'].includes(String(body.dataHandling || '').toLowerCase())
    ? String(body.dataHandling).toLowerCase() : 'reuse';
  const device = body.device || {};
  const imei = (device.imei || '').replace(/\D/g, '') || null;
  if (getSetting('imei_required') === 'true' && v.category === 'mobile' && (!imei || imei.length < 14)) {
    throw httpError(400, 'A valid IMEI (14-16 digits) is required for phones');
  }
  if (getSetting('imei_required') === 'true' && v.category === 'laptop' && !String(device.serial || '').trim()) {
    throw httpError(400, 'A serial number is required for laptops');
  }
  if (imei) {
    const dupStock = one('SELECT stock_id FROM inventory WHERE imei = ?', imei);
    if (dupStock) throw httpError(409, `IMEI already purchased into stock ${dupStock.stock_id}`);
    const dupOrder = one(`SELECT code, status FROM buyback_orders WHERE imei = ? AND status NOT IN ('cancelled','rejected','returned')`, imei);
    if (dupOrder) throw httpError(409, `IMEI already on order ${dupOrder.code} (${dupOrder.status})`);
  }

  const val = valuate(variantId, v.category, body.answers || {});
  const orderCode = nextOrderCode();
  const r = run(`INSERT INTO buyback_orders
    (code,category,variant_id,variant_label,brand,model,declared_json,est_low_minor,est_high_minor,currency,
     customer_name,phone,email,address,pincode,imei,serial,photos_json,ownership_declared,data_handling,pickup_type,pickup_date,pickup_slot,branch_id,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    orderCode, v.category, v.id, val.device.label, v.brand, v.model, JSON.stringify(body.answers || {}),
    val.range.low.minor, val.range.high.minor, val.currency,
    customer.name, customer.phone, customer.email || null, customer.address || null, customer.pincode || null,
    imei, device.serial || null, JSON.stringify(device.photos || []), 1, dataHandling,
    body.pickupType === 'store' ? 'store' : 'home',
    body.pickup && body.pickup.date ? body.pickup.date : null,
    body.pickup && body.pickup.slot ? body.pickup.slot : null,
    body.pickup && body.pickup.branchId ? Number(body.pickup.branchId) : null,
    'created');
  const orderId = Number(r.lastInsertRowid);

  if (body.kyc && body.kyc.idNumber) {
    run('INSERT INTO kyc_records (order_id,id_type,id_number,doc_ref,status) VALUES (?,?,?,?,?)',
      orderId, body.kyc.idType || 'national_id', body.kyc.idNumber, body.kyc.docRef || null, 'pending');
  }
  event(orderId, 'created', `Estimate ${val.range.text}`, null);
  event(orderId, body.pickupType === 'store' ? 'pickup_scheduled' : 'pickup_scheduled',
    body.pickupType === 'store' ? 'Store visit requested' : `Home pickup ${body.pickup && body.pickup.date || 'TBD'}`, null);
  run('INSERT INTO notifications (order_id,channel,template,status) VALUES (?,?,?,?)', orderId, 'sms', 'order_confirmed', 'queued');
  audit('buyback_orders', orderCode, 'create', null, null, val.range.text, null, null, 'customer', ip);
  return { code: orderCode, id: orderId, estimate: val };
}

function publicOrder(code) {
  const o = one('SELECT * FROM buyback_orders WHERE code = ?', code);
  if (!o) throw httpError(404, 'Order not found');
  const cur = o.currency;
  const insp = one('SELECT * FROM inspections WHERE order_id = ? ORDER BY id DESC LIMIT 1', o.id);
  const offer = one('SELECT * FROM offers WHERE order_id = ? ORDER BY id DESC LIMIT 1', o.id);
  const pay = one('SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1', o.id);
  const ev = all('SELECT status, note, at FROM order_events WHERE order_id = ? ORDER BY id', o.id);
  const answers = JSON.parse(o.declared_json || '{}');
  const qs = questionsFor(o.category);
  const answerLabels = qs.filter((q) => answers[q.code])
    .map((q) => ({ question: q.label, answer: (q.options.find((x) => x.code === answers[q.code]) || {}).label || answers[q.code] }));

  return {
    code: o.code, status: o.status, category: o.category,
    device: { label: o.variant_label, brand: o.brand, model: o.model, imei: o.imei ? '****' + o.imei.slice(-4) : null },
    dataHandling: o.data_handling || 'reuse',
    sanitised: !!o.sanitised_at,
    estimate: { low: money.money(o.est_low_minor, cur), high: money.money(o.est_high_minor, cur) },
    answers: answerLabels,
    pickup: { type: o.pickup_type, date: o.pickup_date, slot: o.pickup_slot },
    inspection: insp ? { findingsTotal: money.money(insp.delta_minor, cur), notes: insp.notes, at: insp.created_at } : null,
    offer: offer ? {
      amount: money.money(offer.amount_minor, offer.currency), status: offer.status,
      overridden: !!offer.overridden_by, reason: offer.override_reason, at: offer.created_at,
    } : null,
    payment: pay ? { method: pay.method, status: pay.status, amount: money.money(pay.amount_minor, pay.currency),
      receiptNo: pay.receipt_no, txnRef: pay.txn_ref } : null,
    timeline: ev,
    createdAt: o.created_at,
  };
}

function acceptOffer(code, ip) {
  const o = one('SELECT * FROM buyback_orders WHERE code = ?', code);
  if (!o) throw httpError(404, 'Order not found');
  if (o.status !== 'offer_generated') throw httpError(409, `Order is ${o.status}, no open offer to accept`);
  const offer = one(`SELECT * FROM offers WHERE order_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`, o.id);
  if (!offer) throw httpError(409, 'No pending offer');
  run(`UPDATE offers SET status = 'accepted', responded_at = datetime('now') WHERE id = ?`, offer.id);
  event(o.id, 'accepted', `Customer accepted ${money.fmt(offer.amount_minor, offer.currency)}`, null);
  audit('offers', String(offer.id), 'accept', 'status', 'pending', 'accepted', null, null, 'customer', ip);
  return publicOrder(code);
}

function rejectOffer(code, reason, ip) {
  const o = one('SELECT * FROM buyback_orders WHERE code = ?', code);
  if (!o) throw httpError(404, 'Order not found');
  if (o.status !== 'offer_generated') throw httpError(409, `Order is ${o.status}, no open offer to reject`);
  const offer = one(`SELECT * FROM offers WHERE order_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`, o.id);
  if (offer) run(`UPDATE offers SET status = 'rejected', responded_at = datetime('now') WHERE id = ?`, offer.id);
  event(o.id, 'rejected', reason || 'Customer rejected the final offer - device return initiated', null);
  return publicOrder(code);
}

// ---------- admin ----------
function dashboard() {
  const today = `date('now')`;
  const purchases = one(`SELECT COUNT(*) c, COALESCE(SUM(o.final_offer_minor),0) v FROM buyback_orders b
    JOIN inspections o ON o.order_id = b.id
    WHERE b.status = 'completed' AND date(b.updated_at) = ${today} AND o.id = (SELECT MAX(id) FROM inspections WHERE order_id = b.id)`);
  const sales = one(`SELECT COUNT(*) c, COALESCE(SUM(sale_price_minor),0) v, COALESCE(SUM(vat_minor),0) vat FROM sales WHERE date(sold_at) = ${today}`);
  const profit = one(`SELECT COALESCE(SUM(s.sale_price_minor - COALESCE(s.vat_minor,0) - s.fees_minor - i.cost_minor -
      COALESCE((SELECT SUM(ri.cost_minor) FROM repair_items ri JOIN repairs r ON r.id = ri.repair_id WHERE r.inventory_id = i.id),0)),0) p
    FROM sales s JOIN inventory i ON i.id = s.inventory_id WHERE date(s.sold_at) = ${today}`);
  const cur = base();
  const pending = {
    inspections: one(`SELECT COUNT(*) c FROM buyback_orders WHERE status IN ('collected','inspection')`).c,
    payments: one(`SELECT COUNT(*) c FROM buyback_orders WHERE status = 'accepted'`).c,
    pickups: one(`SELECT COUNT(*) c FROM buyback_orders WHERE status = 'pickup_scheduled'`).c,
    offers: one(`SELECT COUNT(*) c FROM buyback_orders WHERE status = 'offer_generated'`).c,
  };
  const stock = one(`SELECT COUNT(*) c, COALESCE(SUM(cost_minor),0) v FROM inventory WHERE status != 'sold'`);
  const allTime = one(`SELECT COALESCE(SUM(s.sale_price_minor - COALESCE(s.vat_minor,0) - s.fees_minor - i.cost_minor -
      COALESCE((SELECT SUM(ri.cost_minor) FROM repair_items ri JOIN repairs r ON r.id = ri.repair_id WHERE r.inventory_id = i.id),0)),0) p
    FROM sales s JOIN inventory i ON i.id = s.inventory_id`);
  return {
    currency: cur,
    today: {
      purchased: purchases.c, purchaseValue: money.money(purchases.v, cur),
      sold: sales.c, salesValue: money.money(sales.v, cur),
      vatCollected: money.money(sales.vat, cur),
      grossProfit: money.money(profit.p, cur),
    },
    allTimeGrossProfit: money.money(allTime.p, cur),
    pending,
    stock: { units: stock.c, costValue: money.money(stock.v, cur) },
  };
}

function listOrders(q) {
  const where = [];
  const args = [];
  if (q.status) { where.push('status = ?'); args.push(q.status); }
  if (q.category) { where.push('category = ?'); args.push(q.category); }
  if (q.q) { where.push('(code LIKE ? OR customer_name LIKE ? OR phone LIKE ? OR imei LIKE ?)');
    args.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  const lim = Math.min(Number(q.limit) || 50, 200);
  const rows = all(`SELECT * FROM buyback_orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                    ORDER BY id DESC LIMIT ${lim}`, ...args);
  return rows.map((o) => ({
    code: o.code, status: o.status, category: o.category, device: o.variant_label,
    customer: o.customer_name, phone: o.phone, imei: o.imei,
    estimate: `${money.fmt(o.est_low_minor, o.currency)} - ${money.fmt(o.est_high_minor, o.currency)}`,
    createdAt: o.created_at,
  }));
}

function adminOrder(code) {
  const o = one('SELECT * FROM buyback_orders WHERE code = ?', code);
  if (!o) throw httpError(404, 'Order not found');
  const insp = all('SELECT * FROM inspections WHERE order_id = ? ORDER BY id DESC', o.id);
  const offers = all('SELECT * FROM offers WHERE order_id = ? ORDER BY id DESC', o.id);
  const cur = o.currency;
  return {
    order: { ...o, declared: JSON.parse(o.declared_json || '{}'), photos: JSON.parse(o.photos_json || '[]') },
    estimate: { low: money.money(o.est_low_minor, cur), high: money.money(o.est_high_minor, cur) },
    inspections: insp.map((i) => ({ ...i, findings: JSON.parse(i.findings_json || '{}'),
      suggested: money.money(i.suggested_offer_minor, cur), final: money.money(i.final_offer_minor, cur),
      delta: money.money(i.delta_minor, cur) })),
    offers: offers.map((f) => ({ ...f, amount: money.money(f.amount_minor, f.currency) })),
    events: all('SELECT status, note, actor_name, at FROM order_events WHERE order_id = ? ORDER BY id', o.id),
    kyc: all('SELECT * FROM kyc_records WHERE order_id = ? ORDER BY id DESC', o.id),
    payment: one('SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1', o.id),
  };
}

function submitInspection(code, body, actor, ip) {
  const o = one('SELECT * FROM buyback_orders WHERE code = ?', code);
  if (!o) throw httpError(404, 'Order not found');
  if (['completed', 'cancelled', 'rejected'].includes(o.status)) throw httpError(409, `Order is ${o.status}`);
  if (!o.variant_id) throw httpError(400, 'Order has no device variant');

  const findings = body.findings || {};
  const val = valuate(o.variant_id, o.category, findings);
  // A partial inspection silently scores missing items as "no deduction" — that overpays.
  // Refuse it unless someone signs off explicitly.
  if (val.missingAnswers.length > 0 && !(body.allowPartial && body.partialReason)) {
    throw httpError(400, `Inspection incomplete: ${val.missingAnswers.length} item(s) not recorded (${val.missingAnswers.join(', ')}). ` +
      'Record every item, because an unanswered item is scored as no deduction and inflates the offer.');
  }

  let finalMinor = val.estimate.minor;
  let overrideReason = null;
  if (body.overrideAmount != null) {
    finalMinor = money.toMinor(body.overrideAmount, val.currency);
    overrideReason = body.overrideReason;
    if (!overrideReason) throw httpError(400, 'An override reason is required when changing the computed offer');
  }
  const grade = body.grade || val.grade;

  const r = run(`INSERT INTO inspections
    (order_id,inspector_id,findings_json,delta_minor,suggested_offer_minor,final_offer_minor,currency,grade,notes,photos_json,imei_verified)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    o.id, actor.id, JSON.stringify(findings), val.delta.minor, val.estimate.minor, finalMinor,
    val.currency, grade, body.notes || null, JSON.stringify(body.photos || []), body.imeiVerified ? 1 : 0);
  const inspId = Number(r.lastInsertRowid);

  for (const [qcode, ocode] of Object.entries(findings)) {
    run('INSERT INTO inspection_items (inspection_id,question_code,option_code) VALUES (?,?,?)', inspId, qcode, ocode);
  }
  run(`UPDATE offers SET status = 'superseded' WHERE order_id = ? AND status = 'pending'`, o.id);
  run(`INSERT INTO offers (order_id,inspection_id,amount_minor,currency,status,overridden_by,override_reason)
       VALUES (?,?,?,?,?,?,?)`, o.id, inspId, finalMinor, val.currency, 'pending',
    body.overrideAmount != null ? actor.id : null, overrideReason);

  if (body.imei && body.imei !== o.imei) {
    run('UPDATE buyback_orders SET imei = ? WHERE id = ?', body.imei, o.id);
    audit('buyback_orders', o.code, 'update', 'imei', o.imei, body.imei, 'IMEI corrected at inspection', actor.id, actor.name, ip);
  }
  event(o.id, 'offer_generated', `Final offer ${money.fmt(finalMinor, val.currency)}`, actor);
  audit('inspections', String(inspId), 'create', 'final_offer_minor', val.estimate.minor, finalMinor, overrideReason, actor.id, actor.name, ip);
  run('INSERT INTO notifications (order_id,channel,template,status) VALUES (?,?,?,?)', o.id, 'sms', 'offer_ready', 'queued');
  return { ok: true, inspection: adminOrder(code) };
}

function payOrder(code, body, actor, ip) {
  const o = one('SELECT * FROM buyback_orders WHERE code = ?', code);
  if (!o) throw httpError(404, 'Order not found');
  if (o.status !== 'accepted') throw httpError(409, `Order must be in 'accepted' before payment (currently ${o.status})`);
  const method = String(body.method || '').toLowerCase();
  const allowed = ['bank_transfer', 'cheque'];
  if (getSetting('allow_cash_payment') === 'true') allowed.push('cash');
  if (!allowed.includes(method)) throw httpError(400, `Payment method must be one of: ${allowed.join(', ')}`);
  const offer = one(`SELECT * FROM offers WHERE order_id = ? AND status = 'accepted' ORDER BY id DESC LIMIT 1`, o.id);
  if (!offer) throw httpError(409, 'No accepted offer to pay');

  const receiptNo = nextReceiptNo();
  const r = run(`INSERT INTO payments (order_id,amount_minor,currency,method,status,txn_ref,receipt_no,paid_at)
                 VALUES (?,?,?,?,?,?,?,datetime('now'))`,
    o.id, offer.amount_minor, offer.currency, method, 'paid', body.txnRef || null, receiptNo);
  const payId = Number(r.lastInsertRowid);
  event(o.id, 'payment_processing', `Payment initiated via ${method.toUpperCase()}`, actor);
  event(o.id, 'paid', `${money.fmt(offer.amount_minor, offer.currency)} paid - receipt ${receiptNo}`, actor);

  // purchased device becomes inventory immediately
  const stockId = nextStockId(o.category);
  const insp = one('SELECT * FROM inspections WHERE order_id = ? ORDER BY id DESC LIMIT 1', o.id);
  const ir = run(`INSERT INTO inventory (stock_id,order_id,variant_id,variant_label,imei,serial,grade,cost_minor,currency,status,branch_id)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    stockId, o.id, o.variant_id, o.variant_label, o.imei, o.serial, insp ? insp.grade : null,
    offer.amount_minor, offer.currency, 'in_stock', o.branch_id);
  event(o.id, 'completed', `Purchased into stock ${stockId}`, actor);
  audit('payments', String(payId), 'create', 'status', 'pending', 'paid', null, actor.id, actor.name, ip);
  run('INSERT INTO notifications (order_id,channel,template,status) VALUES (?,?,?,?)', o.id, 'sms', 'payment_done', 'queued');
  run('INSERT INTO notifications (order_id,channel,template,status) VALUES (?,?,?,?)', o.id, 'email', 'receipt', 'queued');
  return { ok: true, paymentId: payId, receiptNo, stockId, order: adminOrder(code) };
}

function inventoryView(stockId) {
  const i = one('SELECT * FROM inventory WHERE stock_id = ?', stockId);
  if (!i) throw httpError(404, 'Stock item not found');
  const repairs = all('SELECT * FROM repairs WHERE inventory_id = ? ORDER BY id', i.id);
  const items = all(`SELECT ri.* FROM repair_items ri JOIN repairs r ON r.id = ri.repair_id WHERE r.inventory_id = ?`, i.id);
  const repairCost = items.reduce((s, x) => s + x.cost_minor, 0);
  const sale = one('SELECT * FROM sales WHERE inventory_id = ? ORDER BY id DESC LIMIT 1', i.id);
  const cur = i.currency;
  const totalCost = i.cost_minor + repairCost;
  const vatRateBp = Number(getSetting('vat_rate_bp') || 0);
  const vatOn = (grossMinor) => Math.round((grossMinor * vatRateBp) / (10000 + vatRateBp));
  return {
    stockId: i.stock_id, status: i.status, device: i.variant_label, imei: i.imei, grade: i.grade,
    cost: money.money(i.cost_minor, cur), repairCost: money.money(repairCost, cur),
    totalCost: money.money(totalCost, cur),
    vatRate: vatRateBp / 100,
    listedPrice: i.listed_price_minor ? money.money(i.listed_price_minor, cur) : null,
    expectedProfit: i.listed_price_minor
      ? money.money(i.listed_price_minor - vatOn(i.listed_price_minor) - totalCost, cur)
      : null,
    expectedVat: i.listed_price_minor ? money.money(vatOn(i.listed_price_minor), cur) : null,
    repairs: repairs.map((r) => ({ id: r.id, status: r.status, description: r.description,
      items: items.filter((x) => x.repair_id === r.id).map((x) => ({ part: x.part, cost: money.money(x.cost_minor, cur) })) })),
    sale: sale ? { price: money.money(sale.sale_price_minor, cur), fees: money.money(sale.fees_minor, cur),
      vat: money.money(sale.vat_minor || 0, cur), vatRate: (sale.vat_rate_bp || 0) / 100,
      paymentMethod: sale.payment_method || 'cash', buyerTrn: sale.buyer_trn || null,
      netRevenue: money.money(sale.sale_price_minor - (sale.vat_minor || 0), cur),
      soldAt: sale.sold_at, invoiceNo: sale.invoice_no,
      profit: money.money(sale.sale_price_minor - (sale.vat_minor || 0) - sale.fees_minor - totalCost, cur) } : null,
  };
}

function recordSale(stockId, body, actor, ip) {
  const i = one('SELECT * FROM inventory WHERE stock_id = ?', stockId);
  if (!i) throw httpError(404, 'Stock item not found');
  if (i.status === 'sold') throw httpError(409, 'Item already sold');
  if (body.salePrice == null) throw httpError(400, 'salePrice is required');
  const saleMinor = money.toMinor(body.salePrice, i.currency);
  const feesMinor = body.fees ? money.toMinor(body.fees, i.currency) : 0;
  // UAE retail prices are VAT-inclusive: VAT is the portion contained in the gross price.
  const vatRateBp = Number(getSetting('vat_rate_bp') || 0);
  const vatMinor = Math.round((saleMinor * vatRateBp) / (10000 + vatRateBp));
  const d = new Date();
  const invoiceNo = `INV-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}-${String(one('SELECT COUNT(*) c FROM sales').c + 1).padStart(5, '0')}`;
  const saleMethod = ['cash', 'card', 'bank_transfer'].includes(String(body.paymentMethod || '').toLowerCase())
    ? String(body.paymentMethod).toLowerCase() : 'cash';
  run(`INSERT INTO sales (invoice_no,inventory_id,sale_price_minor,vat_minor,vat_rate_bp,fees_minor,currency,
       buyer_name,buyer_phone,buyer_trn,payment_method,channel,branch_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, invoiceNo, i.id, saleMinor, vatMinor, vatRateBp, feesMinor, i.currency,
    body.buyerName || null, body.buyerPhone || null, body.buyerTrn || null, saleMethod, body.channel || 'store', i.branch_id);
  run(`UPDATE inventory SET status = 'sold' WHERE id = ?`, i.id);
  audit('inventory', i.stock_id, 'sale', 'status', i.status, 'sold', `Invoice ${invoiceNo}`, actor.id, actor.name, ip);
  return inventoryView(stockId);
}

// ---------- router ----------
async function handle(req, res, url, body, ip, auth) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;
  const q = Object.fromEntries(url.searchParams.entries());
  const seg = p.split('/').filter(Boolean);

  const need = (...roles) => {
    if (!auth) throw httpError(401, 'Login required');
    if (roles.length && !roles.includes(auth.role)) throw httpError(403, `Role ${auth.role} cannot do this`);
    return auth;
  };

  // --- printable documents ---
  if (seg[0] === 'doc') {
    const kind = seg[1];
    const key = decodeURIComponent(seg.slice(2).join('/') || '');
    const settings = getSettings();
    if (kind === 'receipt') {
      const pay = one('SELECT * FROM payments WHERE receipt_no = ?', key);
      if (!pay) throw httpError(404, 'Receipt not found');
      const order = one('SELECT * FROM buyback_orders WHERE id = ?', pay.order_id);
      const insp = one('SELECT * FROM inspections WHERE order_id = ? ORDER BY id DESC LIMIT 1', order.id);
      return { __html: docs.purchaseReceipt({ order, payment: pay, inspection: insp, settings }) };
    }
    if (kind === 'sanitisation') {
      const o = one('SELECT * FROM buyback_orders WHERE code = ?', key);
      if (!o) throw httpError(404, 'Order not found');
      if (!o.sanitised_at) throw httpError(409, 'No certificate yet — the device has not been sanitised');
      const insp = one('SELECT * FROM inspections WHERE order_id = ? ORDER BY id DESC LIMIT 1', o.id);
      const pay = one('SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1', o.id);
      return { __html: docs.sanitisationCertificate({ order: o, inspection: insp, payment: pay, settings }) };
    }
    if (kind === 'invoice') {
      const sale = one('SELECT * FROM sales WHERE invoice_no = ?', key);
      if (!sale) throw httpError(404, 'Invoice not found');
      const item = one('SELECT * FROM inventory WHERE id = ?', sale.inventory_id);
      const order = item && item.order_id ? one('SELECT * FROM buyback_orders WHERE id = ?', item.order_id) : null;
      const branch = sale.branch_id ? one('SELECT * FROM branches WHERE id = ?', sale.branch_id) : null;
      return { __html: docs.saleInvoice({ sale, item, order, settings, branch }) };
    }
    throw httpError(404, 'Unknown document');
  }

  // --- public ---
  if (p === '/api/health') return { ok: true, at: now() };
  if (p === '/api/config') {
    const cfg = publicConfig();
    // one database, several front doors: a domain may publish its own contact number
    const site = siteConfigFor(req.headers.host);
    if (site && site.phone) cfg.support = { ...cfg.support, phone: site.phone };
    return cfg;
  }
  if (p === '/api/catalog') return catalog(q.category === 'laptop' ? 'laptop' : 'mobile');
  if (p === '/api/questions') return questionsFor(q.category === 'laptop' ? 'laptop' : 'mobile');

  if (p === '/api/quote' && m === 'POST') {
    return valuate(Number(body.variantId), body.category, body.answers || {});
  }
  if (p === '/api/orders' && m === 'POST') return createOrder(body, ip);

  if (seg[0] === 'api' && seg[1] === 'orders' && seg[2] && !seg[3] && m === 'GET') return publicOrder(seg[2]);
  if (seg[0] === 'api' && seg[1] === 'orders' && seg[3] === 'accept' && m === 'POST') return acceptOffer(seg[2], ip);
  if (seg[0] === 'api' && seg[1] === 'orders' && seg[3] === 'reject' && m === 'POST') return rejectOffer(seg[2], body.reason, ip);

  if (p === '/api/auth/login' && m === 'POST') {
    const u = one('SELECT * FROM users WHERE email = ? AND active = 1', String(body.email || '').toLowerCase());
    if (!u || !verifyPassword(body.password || '', u.password_hash)) throw httpError(401, 'Invalid email or password');
    const token = require('node:crypto').randomBytes(24).toString('hex');
    run(`INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,datetime('now','+12 hours'))`, token, u.id);
    audit('users', String(u.id), 'login', null, null, null, null, u.id, u.name, ip);
    return { token, user: { id: u.id, name: u.name, email: u.email, role: u.role, branchId: u.branch_id } };
  }
  if (p === '/api/auth/logout' && m === 'POST') {
    if (auth) run('DELETE FROM sessions WHERE token = ?', auth.token);
    return { ok: true };
  }
  if (p === '/api/auth/me') { const a = need(); return { user: { id: a.id, name: a.name, email: a.email, role: a.role, branchId: a.branch_id } }; }

  // --- admin ---
  if (seg[0] === 'api' && seg[1] === 'admin') {
    const sub = seg[2];

    if (sub === 'dashboard') { need(...ROLES_ALL); return dashboard(); }
    if (sub === 'orders' && !seg[3]) { need(...canInspect); return listOrders(q); }
    if (sub === 'orders' && seg[3]) {
      const a = need(...canInspect);
      const code = seg[3];
      if (!seg[4] && m === 'GET') return adminOrder(code);
      if (seg[4] === 'inspection' && m === 'POST') return submitInspection(code, body, a, ip);
      if (seg[4] === 'status' && m === 'POST') {
        const o = one('SELECT * FROM buyback_orders WHERE code = ?', code);
        if (!o) throw httpError(404, 'Order not found');
        event(o.id, body.status, body.note, a);
        audit('buyback_orders', code, 'status', 'status', o.status, body.status, body.note || null, a.id, a.name, ip);
        return adminOrder(code);
      }
      if (seg[4] === 'payment' && m === 'POST') { need(...canFinance); return payOrder(code, body, a, ip); }
      if (seg[4] === 'sanitise' && m === 'POST') {
        const o = one('SELECT * FROM buyback_orders WHERE code = ?', code);
        if (!o) throw httpError(404, 'Order not found');
        if (!['paid', 'completed'].includes(o.status)) {
          throw httpError(409, `Data can only be certified after the device is paid for (order is ${o.status})`);
        }
        if (o.sanitised_at) throw httpError(409, `Already certified on ${o.sanitised_at}`);
        const ref = `SANI-${o.code.replace('BB-', '')}`;
        run("UPDATE buyback_orders SET sanitised_at = datetime('now'), sanitisation_ref = ? WHERE id = ?", ref, o.id);
        if (o.variant_id) {
          const i = one('SELECT id FROM inventory WHERE order_id = ?', o.id);
          if (i && o.data_handling === 'destroy') run("UPDATE inventory SET status = 'returned' WHERE id = ?", i.id);
        }
        audit('buyback_orders', code, 'sanitise', 'sanitisation_ref', null, ref,
          body.note || `${o.data_handling} — ${getSetting('erasure_standard')}`, a.id, a.name, ip);
        return { ok: true, ref, order: adminOrder(code) };
      }
    }
    if (sub === 'payment-methods') {
      const allowed = ['bank_transfer', 'cheque'];
      if (getSetting('allow_cash_payment') === 'true') allowed.push('cash');
      return allowed;
    }
    if (sub === 'inventory' && !seg[3]) {
      need(...canSell, ...canOps);
      const rows = all(`SELECT * FROM inventory ${q.status ? 'WHERE status = ?' : ''} ORDER BY id DESC LIMIT 200`,
        ...(q.status ? [q.status] : []));
      return rows.map((i) => ({ stockId: i.stock_id, device: i.variant_label, imei: i.imei, grade: i.grade,
        status: i.status, cost: money.money(i.cost_minor, i.currency),
        listed: i.listed_price_minor ? money.money(i.listed_price_minor, i.currency) : null }));
    }
    if (sub === 'inventory' && seg[3]) {
      const a = need(...canSell, ...canOps);
      if (m === 'GET' && !seg[4]) return inventoryView(seg[3]);
      if (seg[4] === 'repair' && m === 'POST') {
        const i = one('SELECT * FROM inventory WHERE stock_id = ?', seg[3]);
        if (!i) throw httpError(404, 'Stock item not found');
        const rr = run('INSERT INTO repairs (inventory_id,description,status) VALUES (?,?,?)', i.id, body.description || null, 'open');
        const rid = Number(rr.lastInsertRowid);
        for (const it of body.items || []) {
          run('INSERT INTO repair_items (repair_id,part,cost_minor,currency,vendor) VALUES (?,?,?,?,?)',
            rid, it.part, money.toMinor(it.cost || 0, i.currency), i.currency, it.vendor || null);
        }
        if (body.complete) run("UPDATE repairs SET status = 'done' WHERE id = ?", rid);
        run("UPDATE inventory SET status = 'repair' WHERE id = ?", i.id);
        audit('inventory', i.stock_id, 'repair', 'status', i.status, 'repair', body.description || null, a.id, a.name, ip);
        return inventoryView(seg[3]);
      }
      if (seg[4] === 'list' && m === 'POST') {
        const i = one('SELECT * FROM inventory WHERE stock_id = ?', seg[3]);
        if (!i) throw httpError(404, 'Stock item not found');
        const price = money.toMinor(body.listedPrice, i.currency);
        run("UPDATE inventory SET listed_price_minor = ?, status = 'ready' WHERE id = ?", price, i.id);
        audit('inventory', i.stock_id, 'update', 'listed_price_minor', i.listed_price_minor, price, null, a.id, a.name, ip);
        return inventoryView(seg[3]);
      }
      if (seg[4] === 'sale' && m === 'POST') return recordSale(seg[3], body, a, ip);
    }
    if (sub === 'prices' && m === 'GET') {
      need(...canOps);
      const rows = all(`SELECT v.id AS variantId, b.name AS brand, m.name AS model, v.variant,
          v.base_price_minor, v.currency, b.category,
          (SELECT note FROM device_prices p WHERE p.variant_id = v.id ORDER BY p.id DESC LIMIT 1) AS last_note
        FROM device_variants v JOIN device_models m ON m.id = v.model_id JOIN device_brands b ON b.id = m.brand_id
        ${q.q ? 'WHERE (m.name LIKE ? OR b.name LIKE ?)' : ''} ORDER BY b.category, b.name, m.name, v.id
        LIMIT 300`, ...(q.q ? [`%${q.q}%`, `%${q.q}%`] : []));
      const cur = base();
      return rows.map((r) => {
        const note = r.last_note || '';
        return { ...r, basePrice: money.money(r.base_price_minor, r.currency),
          display: money.fmt(r.base_price_minor, r.currency),
          priceSource: note,
          unverified: /no refurb price found|seeded estimate|not researched/i.test(note) };
      });
    }
    if (sub === 'prices' && m === 'POST') {
      const a = need('super_admin', 'ops_manager');
      const v = one('SELECT * FROM device_variants WHERE id = ?', Number(body.variantId));
      if (!v) throw httpError(404, 'Variant not found');
      if (body.basePrice == null) throw httpError(400, 'basePrice is required (major units)');
      const minor = money.toMinor(body.basePrice, v.currency);
      run(`INSERT INTO device_prices (variant_id,base_price_minor,currency,effective_from,created_by,note)
           VALUES (?,?,?,?,?,?)`, v.id, minor, v.currency, body.effectiveFrom || now(), a.id, body.note || null);
      run('UPDATE device_variants SET base_price_minor = ? WHERE id = ?', minor, v.id);
      audit('device_variants', String(v.id), 'price', 'base_price_minor', v.base_price_minor, minor,
        body.note || null, a.id, a.name, ip);
      return { ok: true, variantId: v.id, basePrice: money.money(minor, v.currency) };
    }
    if (sub === 'variants' && m === 'POST') {
      const a = need('super_admin', 'ops_manager');
      const category = body.category === 'laptop' ? 'laptop' : 'mobile';
      let brandId = body.brandId ? Number(body.brandId) : null;
      if (!brandId) {
        const bs = slug(body.brand || '');
        let b = one('SELECT id FROM device_brands WHERE category = ? AND slug = ?', category, bs);
        if (!b) b = { id: Number(run('INSERT INTO device_brands (category,name,slug) VALUES (?,?,?)', category, body.brand, bs).lastInsertRowid) };
        brandId = b.id;
      }
      let modelId = body.modelId ? Number(body.modelId) : null;
      if (!modelId) {
        const ms = slug(body.model || '');
        let mm = one('SELECT id FROM device_models WHERE brand_id = ? AND slug = ?', brandId, ms);
        if (!mm) mm = { id: Number(run('INSERT INTO device_models (brand_id,name,slug) VALUES (?,?,?)', brandId, body.model, ms).lastInsertRowid) };
        modelId = mm.id;
      }
      const cur = base();
      const minor = money.toMinor(body.basePrice || 0, cur);
      const r = run('INSERT INTO device_variants (model_id,variant,base_price_minor,currency) VALUES (?,?,?,?)',
        modelId, body.variant || 'Standard', minor, cur);
      const vid = Number(r.lastInsertRowid);
      run(`INSERT INTO device_prices (variant_id,base_price_minor,currency,effective_from,created_by,note)
           VALUES (?,?,?,?,?,?)`, vid, minor, cur, now(), a.id, 'created');
      audit('device_variants', String(vid), 'create', 'base_price_minor', null, minor, null, a.id, a.name, ip);
      return { ok: true, variantId: vid };
    }
    if (sub === 'questions' && m === 'GET') { need(...canOps); return questionsFor(q.category === 'laptop' ? 'laptop' : 'mobile'); }

    if (sub === 'settings' && m === 'GET') { need(...ROLES_ALL); return getSettings(); }
    if (sub === 'settings' && m === 'POST') {
      const a = need('super_admin');
      const changed = {};
      for (const [k, v] of Object.entries(body)) {
        if (k === 'base_currency') continue; // must go through /api/admin/currency
        if (!(k in require('./db').SETTING_DEFAULTS)) throw httpError(400, `Unknown setting ${k}`);
        changed[k] = setSetting(k, v, a.name);
      }
      return { ok: true, settings: getSettings(), changed };
    }
    if (sub === 'currency' && m === 'POST') {
      const a = need('super_admin');
      if (getSetting('currency_locked') === 'true') throw httpError(409, 'Currency is locked');
      const code = String(body.code || '').toUpperCase();
      if (!money.CURRENCIES[code]) throw httpError(400, `Unsupported currency ${code}`);
      const old = base();
      if (code === old) return { ok: true, currency: code, note: 'unchanged' };

      let converted = 0;
      if (body.convertPrices) {
        const rate = Number(body.rate);
        if (!rate || rate <= 0) throw httpError(400, 'A positive conversion rate is required to convert prices');
        // rate semantics: 1 OLD = rate NEW
        for (const v of all('SELECT * FROM device_variants')) {
          // Round converted buy prices to whole major units: a price list should never read AED750.03.
          const raw = money.toMinor(money.toMajor(v.base_price_minor, old) * rate, code);
          const minor = money.roundToStep(raw, code, 1);
          run('UPDATE device_variants SET base_price_minor = ?, currency = ? WHERE id = ?', minor, code, v.id);
          run(`INSERT INTO device_prices (variant_id,base_price_minor,currency,effective_from,created_by,note)
               VALUES (?,?,?,?,?,?)`, v.id, minor, code, now(), a.id, `currency conversion from ${old} @ ${rate}`);
          converted++;
        }
        // question_options are NOT rewritten: each row carries its own currency and is converted
        // at quote time. Rewriting them here rounded twice (old→new→old) and permanently drifted
        // the deductions — a AED3,000 screen deduction came back as AED3,010.
        run('INSERT INTO fx_rates (base_code,quote_code,rate,as_of) VALUES (?,?,?,?)', code, old, 1 / rate, now());
        run('INSERT INTO fx_rates (base_code,quote_code,rate,as_of) VALUES (?,?,?,?)', old, code, rate, now());
      }
      setSetting('base_currency', code, a.name, body.reason || `currency change ${old} -> ${code}`);
      audit('settings', 'base_currency', 'update', 'base_currency', old, code,
        body.reason || null, a.id, a.name, ip);
      return { ok: true, from: old, currency: code, pricesConverted: converted,
        note: converted ? 'Device prices, price history and option adjustments converted; historical orders keep their original currency.' :
          'New quotes use the new currency; existing device prices still carry their original currency and need FX or conversion.' };
    }
    if (sub === 'fx' && m === 'GET') { need(...canOps); return all('SELECT * FROM fx_rates ORDER BY id DESC LIMIT 50'); }
    if (sub === 'fx' && m === 'POST') {
      const a = need('super_admin');
      run('INSERT INTO fx_rates (base_code,quote_code,rate,as_of) VALUES (?,?,?,?)',
        String(body.base || '').toUpperCase(), String(body.quote || '').toUpperCase(), Number(body.rate), body.asOf || now());
      audit('fx_rates', `${body.base}/${body.quote}`, 'create', 'rate', null, body.rate, null, a.id, a.name, ip);
      return all('SELECT * FROM fx_rates ORDER BY id DESC LIMIT 20');
    }
    if (sub === 'audit') { need('super_admin', 'ops_manager', 'finance'); return all(`SELECT * FROM audit_logs ORDER BY id DESC LIMIT ${Math.min(Number(q.limit) || 100, 300)}`); }
    if (sub === 'branches') { need(...callableRoles()); return all('SELECT * FROM branches ORDER BY id'); }
    if (sub === 'users' && m === 'GET') { need('super_admin'); return all('SELECT id,name,email,role,branch_id,active FROM users'); }
    // Add condition questions to a live site without touching the database by hand.
    // Idempotent: a question that already exists (same code + category) is skipped, never duplicated.
    if (sub === 'questions' && m === 'POST') {
      const a = need('super_admin');
      const category = body.category || 'mobile';
      const defs = Array.isArray(body.questions) ? body.questions : [body];
      const created = [];
      for (const q of defs) {
        if (!q.code || !Array.isArray(q.options) || !q.options.length) {
          throw httpError(400, 'Each question needs a code and at least one option');
        }
        if (one('SELECT id FROM questions WHERE code = ? AND category = ?', q.code, category)) continue;
        const rq = run('INSERT INTO questions (code,category,label,section,sort) VALUES (?,?,?,?,?)',
          q.code, category, q.label, q.section || 'cosmetic', Number(q.sort) || 99);
        const qid = Number(rq.lastInsertRowid);
        q.options.forEach((o, i) => run(
          `INSERT INTO question_options (question_id,code,label,adj_kind,adj_value,currency,grade,sort) VALUES (?,?,?,?,?,?,?,?)`,
          qid, o.code, o.label, o.adjKind || 'flat', Math.round(Number(o.adjValue) || 0),
          o.currency || getSetting('base_currency'), o.grade || null, i));
        audit('questions', String(qid), 'create', 'code', null, q.code, 'added from admin', a.id, a.name, ip);
        created.push(q.code);
      }
      return { ok: true, created, skipped: defs.length - created.length };
    }
    if (sub === 'users' && m === 'POST') {
      const a = need('super_admin');
      const pw = body.password ? String(body.password) : '123123';
      if (pw.length < 6) throw httpError(400, 'Password must be at least 6 characters');
      if (one('SELECT id FROM users WHERE email = ?', String(body.email || '').toLowerCase())) {
        throw httpError(409, 'That email already has an account');
      }
      const r = run('INSERT INTO users (name,email,role,branch_id,password_hash) VALUES (?,?,?,?,?)',
        body.name, String(body.email).toLowerCase(), body.role, body.branchId || null, hashPassword(pw));
      audit('users', String(r.lastInsertRowid), 'create', 'role', null, body.role, null, a.id, a.name, ip);
      return { ok: true, id: Number(r.lastInsertRowid) };
    }
    // Staff management: rename, change role, disable, reset password. Every change is audited;
    // the password itself never reaches the audit log.
    if (sub === 'users' && seg[3] && m === 'PATCH') {
      const a = need('super_admin');
      const id = Number(seg[3]);
      const u = one('SELECT * FROM users WHERE id = ?', id);
      if (!u) throw httpError(404, 'Unknown user');
      const reason = body.reason ? String(body.reason) : null;

      if (body.name !== undefined && String(body.name).trim()) {
        run('UPDATE users SET name = ? WHERE id = ?', String(body.name).trim(), id);
        audit('users', String(id), 'update', 'name', u.name, body.name, reason, a.id, a.name, ip);
      }
      if (body.role !== undefined) {
        if (!ROLES_ALL.includes(body.role)) throw httpError(400, 'Unknown role');
        if (id === a.id && body.role !== 'super_admin') {
          throw httpError(400, 'You cannot drop your own super admin role — another admin must do it');
        }
        run('UPDATE users SET role = ? WHERE id = ?', body.role, id);
        audit('users', String(id), 'update', 'role', u.role, body.role, reason, a.id, a.name, ip);
      }
      if (body.active !== undefined) {
        const active = body.active ? 1 : 0;
        if (id === a.id && !active) throw httpError(400, 'You cannot disable your own account');
        if (!active && u.role === 'super_admin'
            && one("SELECT count(*) n FROM users WHERE role = 'super_admin' AND active = 1").n <= 1) {
          throw httpError(400, 'This is the only active super admin — promote someone else first');
        }
        run('UPDATE users SET active = ? WHERE id = ?', active, id);
        audit('users', String(id), 'update', 'active', u.active, active, reason, a.id, a.name, ip);
      }
      if (body.password) {
        const pw = String(body.password);
        if (pw.length < 6) throw httpError(400, 'Password must be at least 6 characters');
        run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(pw), id);
        audit('users', String(id), 'password_reset', null, null, null, reason, a.id, a.name, ip);
      }
      return { ok: true, user: one('SELECT id,name,email,role,branch_id,active FROM users WHERE id = ?', id) };
    }
    if (sub === 'reports' && seg[3] === 'cash') {
      need(...canFinance);
      const day = q.date || new Date().toISOString().slice(0, 10);
      const cur = base();
      const out = all(`SELECT p.method, COALESCE(b.name,'Unassigned') branch, COUNT(*) n, COALESCE(SUM(p.amount_minor),0) total
        FROM payments p LEFT JOIN buyback_orders o ON o.id = p.order_id LEFT JOIN branches b ON b.id = o.branch_id
        WHERE p.status = 'paid' AND p.method = 'cash' AND date(p.paid_at) = ?
        GROUP BY p.method, b.name ORDER BY total DESC`, day);
      const inn = all(`SELECT s.payment_method method, COALESCE(b.name,'Unassigned') branch, COUNT(*) n,
          COALESCE(SUM(s.sale_price_minor),0) total
        FROM sales s LEFT JOIN branches b ON b.id = s.branch_id
        WHERE s.payment_method = 'cash' AND date(s.sold_at) = ?
        GROUP BY s.payment_method, b.name ORDER BY total DESC`, day);
      const cashOut = out.reduce((t, r) => t + r.total, 0);
      const cashIn = inn.reduce((t, r) => t + r.total, 0);
      const salesByMethod = all(`SELECT payment_method method, COUNT(*) n, COALESCE(SUM(sale_price_minor),0) total
        FROM sales WHERE date(sold_at) = ? GROUP BY payment_method ORDER BY total DESC`, day);
      const payoutsByMethod = all(`SELECT method, COUNT(*) n, COALESCE(SUM(amount_minor),0) total
        FROM payments WHERE status = 'paid' AND date(paid_at) = ? GROUP BY method ORDER BY total DESC`, day);
      const m = (arr) => arr.map((r) => ({ ...r, total: money.money(r.total, cur) }));
      return {
        date: day, currency: cur,
        cashIn: money.money(cashIn, cur), cashOut: money.money(cashOut, cur),
        netCash: money.money(cashIn - cashOut, cur),
        inByBranch: m(inn), outByBranch: m(out),
        salesByMethod: m(salesByMethod), payoutsByMethod: m(payoutsByMethod),
        note: 'cashIn is cash received on sales, cashOut is cash paid to customers for devices. Count the drawer against netCash.',
      };
    }
    if (sub === 'reports' && seg[3] === 'vat') {
      need(...canFinance);
      const from = q.from || '2000-01-01';
      const to = q.to || '2999-12-31';
      const cur = base();
      const agg = one(`SELECT COUNT(*) c, COALESCE(SUM(sale_price_minor),0) gross, COALESCE(SUM(vat_minor),0) vat
        FROM sales WHERE date(sold_at) BETWEEN ? AND ?`, from, to);
      const monthly = all(`SELECT substr(sold_at,1,7) month, COUNT(*) units,
          COALESCE(SUM(sale_price_minor),0) gross, COALESCE(SUM(vat_minor),0) vat
        FROM sales WHERE date(sold_at) BETWEEN ? AND ? GROUP BY month ORDER BY month DESC`, from, to);
      const buys = one(`SELECT COUNT(*) c, COALESCE(SUM(amount_minor),0) v FROM payments
        WHERE status = 'paid' AND date(paid_at) BETWEEN ? AND ?`, from, to);
      return {
        from, to, currency: cur, vatRate: Number(getSetting('vat_rate_bp')) / 100,
        outputVat: { units: agg.c, gross: money.money(agg.gross, cur), vat: money.money(agg.vat, cur),
          net: money.money(agg.gross - agg.vat, cur) },
        purchases: { count: buys.c, value: money.money(buys.v, cur),
          note: 'Consumer purchases carry no input VAT, so nothing to reclaim here.' },
        monthly: monthly.map((m) => ({ month: m.month, units: m.units,
          gross: money.money(m.gross, cur), vat: money.money(m.vat, cur) })),
      };
    }
    if (sub === 'reports') {
      need(...canFinance);
      const from = q.from || '2000-01-01';
      const to = q.to || '2999-12-31';
      const cur = base();
      const purch = one(`SELECT COUNT(*) c, COALESCE(SUM(p.amount_minor),0) v FROM payments p
        WHERE p.status = 'paid' AND date(p.paid_at) BETWEEN ? AND ?`, from, to);
      const sold = one(`SELECT COUNT(*) c, COALESCE(SUM(sale_price_minor),0) v, COALESCE(SUM(vat_minor),0) vat
        FROM sales WHERE date(sold_at) BETWEEN ? AND ?`, from, to);
      const prof = one(`SELECT COALESCE(SUM(s.sale_price_minor - COALESCE(s.vat_minor,0) - s.fees_minor - i.cost_minor -
          COALESCE((SELECT SUM(ri.cost_minor) FROM repair_items ri JOIN repairs r ON r.id = ri.repair_id WHERE r.inventory_id = i.id),0)),0) p
        FROM sales s JOIN inventory i ON i.id = s.inventory_id WHERE date(s.sold_at) BETWEEN ? AND ?`, from, to);
      const byBrand = all(`SELECT i.variant_label label, COUNT(*) units, SUM(s.sale_price_minor) revenue FROM sales s
        JOIN inventory i ON i.id = s.inventory_id WHERE date(s.sold_at) BETWEEN ? AND ? GROUP BY i.variant_label ORDER BY revenue DESC LIMIT 20`, from, to);
      return {
        from, to, currency: cur,
        purchases: { count: purch.c, value: money.money(purch.v, cur) },
        sales: { count: sold.c, value: money.money(sold.v, cur), vat: money.money(sold.vat, cur) },
        grossProfit: money.money(prof.p, cur),
        topSellers: byBrand.map((b) => ({ ...b, revenue: money.money(b.revenue, cur) })),
      };
    }
    throw httpError(404, `Unknown admin endpoint ${p}`);
  }

  throw httpError(404, `Unknown endpoint ${m} ${p}`);
}

function callableRoles() { return ROLES_ALL; }

module.exports = { handle, publicConfig, dashboard };
