// End-to-end smoke test against the running server. Run: node scripts/e2e.mjs
// UAE launch: AED pricing, UAE payment rails, 5% VAT on resale.
const BASE = process.env.BASE || 'http://localhost:8099';
let fails = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
};
async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const goodPhone = {
  screen: 'minor', body: 'excellent', battery: '90plus', camera: 'working',
  speaker: 'working', faceid: 'working', charging: 'working', water: 'no', repairs: 'never',
};

// 1. platform config: AED is the base currency
const cfg = await call('/api/config');
ok(cfg.status === 200 && cfg.data.currency === 'AED', 'config returns AED as base currency', cfg.data.currency);
ok(cfg.data.currencyMeta.symbol === 'AED', 'AED symbol resolved', cfg.data.currencyMeta.symbol);
ok(cfg.data.branches.every((b) => /Abu Dhabi|Dubai|Sharjah/.test(b.city)), 'branches are UAE',
  cfg.data.branches.map((b) => b.city).join(','));

// 2. quote: iPhone 15 128GB AED 1,650 + AED 80 for excellent body
const cat = await call('/api/catalog?category=mobile');
const apple = cat.data.find((b) => b.name === 'Apple');
const ip15 = apple.models.find((m) => m.name === 'iPhone 15');
const v128 = ip15.variants.find((v) => v.variant === '128GB');
const q = await call('/api/quote', { method: 'POST', body: { variantId: v128.id, category: 'mobile', answers: goodPhone } });
ok(q.status === 200, 'quote returns 200');
ok(q.data.basePrice.formatted === 'AED1,330', 'base price AED1,330 (85% of refurb market)', q.data.basePrice.formatted);
ok(q.data.delta.formatted === 'AED80', 'body-excellent adjustment AED80', q.data.delta.formatted);
ok(q.data.estimate.formatted === 'AED1,410', 'estimate AED1,410', q.data.estimate.formatted);
ok(q.data.range.low.minor < q.data.range.high.minor, 'range is a band', q.data.range.text);
ok(q.data.complete === true, 'quote complete');

// 3. damage lowers the price, floor still respected
const bad = { ...goodPhone, screen: 'cracked', water: 'yes', faceid: 'not_working', battery: 'below80' };
const q2 = await call('/api/quote', { method: 'POST', body: { variantId: v128.id, category: 'mobile', answers: bad } });
ok(q2.data.estimate.minor < q.data.estimate.minor, 'damaged device quotes lower', q2.data.estimate.formatted);
const floorMinor = Math.round(q.data.basePrice.minor * 0.15);
ok(q2.data.estimate.minor >= floorMinor - 1, 'never quotes below the 15% floor', q2.data.estimate.formatted);

// 4. partial answers are flagged, not guessed
const q3 = await call('/api/quote', { method: 'POST', body: { variantId: v128.id, category: 'mobile', answers: { screen: 'minor' } } });
ok(q3.data.complete === false && q3.data.missingAnswers.length === 8, 'partial answers flagged', 'missing=' + q3.data.missingAnswers.length);

// 5. order creation + UAE fraud guards
const imei = '356' + String(Date.now()).slice(-12);
const orderBody = {
  variantId: v128.id, category: 'mobile', answers: goodPhone,
  customer: { name: 'Biju Test', phone: '+971 50 111 2233', email: 'biju@example.ae', address: 'Al Danah, Abu Dhabi', pincode: '00000' },
  device: { imei, serial: 'F2LX1234', photos: [] },
  kyc: { idType: 'emirates_id', idNumber: '784-1990-1234567-1' },
  pickupType: 'home', pickup: { date: '2026-11-02', slot: '10:00 - 13:00', branchId: 1 },
  ownershipDeclared: true, dataHandling: 'reuse',
};
const ord = await call('/api/orders', { method: 'POST', body: orderBody });
ok(ord.status === 200 && /^BB-\d{6}-\d{4}$/.test(ord.data.code), 'order created', ord.data.code);
const code = ord.data.code;

const dup = await call('/api/orders', { method: 'POST', body: orderBody });
ok(dup.status === 409, 'duplicate IMEI rejected', dup.data.error || '');
const noOwn = await call('/api/orders', { method: 'POST', body: { ...orderBody, ownershipDeclared: false, device: { imei: '111111111111111' } } });
ok(noOwn.status === 400, 'ownership declaration enforced', noOwn.data.error || '');
const noImei = await call('/api/orders', { method: 'POST', body: { ...orderBody, device: { imei: '' } } });
ok(noImei.status === 400, 'IMEI required for phones', noImei.data.error || '');

// 6. tracking
const trk = await call('/api/orders/' + code);
ok(trk.status === 200 && (trk.data.timeline || []).length >= 2, 'tracking shows timeline', 'events=' + (trk.data.timeline || []).length);
ok(String(trk.data.device.imei).startsWith('****'), 'IMEI masked to customer', trk.data.device.imei);

// 7. auth + role guards
const badLogin = await call('/api/auth/login', { method: 'POST', body: { email: 'admin@indubaicity.com', password: 'nope' } });
ok(badLogin.status === 401, 'wrong password rejected');
const login = await call('/api/auth/login', { method: 'POST', body: { email: 'admin@indubaicity.com', password: 'admin123' } });
ok(login.status === 200 && login.data.token, 'super admin login');
const token = login.data.token;
const inspToken = (await call('/api/auth/login', { method: 'POST', body: { email: 'inspector@indubaicity.com', password: 'insp1234' } })).data.token;
ok((await call('/api/admin/prices', { token: inspToken })).status === 403, 'inspector cannot read price master');
ok((await call('/api/admin/settings', { token: inspToken })).status === 200, 'inspector can read settings');
const inspCurrency = await call('/api/admin/currency', { method: 'POST', token: inspToken, body: { code: 'USD' } });
ok(inspCurrency.status === 403, 'inspector cannot change currency', inspCurrency.data.error || '');

// 8. inspection: worse than declared
const worse = { screen: 'heavy', body: 'dents', battery: '85to89', camera: 'working',
  speaker: 'working', faceid: 'working', charging: 'working', water: 'no', repairs: 'never' };
const insp = await call(`/api/admin/orders/${code}/inspection`, { method: 'POST', token: inspToken,
  body: { findings: worse, imeiVerified: true, notes: 'Heavy scratches confirmed' } });
ok(insp.status === 200, 'inspection recorded', insp.data.error || '');
const offered = insp.data.inspection.offers[0];
ok(offered && offered.status === 'pending', 'final offer created', offered && offered.amount.formatted);
ok(offered.amount.minor === 117000, 'offer recomputed from actual findings (AED1,170)', offered.amount.formatted);
ok(offered.amount.minor < q.data.estimate.minor, 'actual condition lowers the offer');
ok(insp.data.inspection.order.status === 'offer_generated', 'order moved to offer_generated');

// 9. payment before acceptance refused
const earlyPay = await call(`/api/admin/orders/${code}/payment`, { method: 'POST', token, body: { method: 'bank_transfer' } });
ok(earlyPay.status === 409, 'cannot pay before customer accepts', earlyPay.data.error || '');

// 10. customer accepts
const acc = await call(`/api/orders/${code}/accept`, { method: 'POST' });
ok(acc.status === 200 && acc.data.status === 'accepted', 'customer accepted offer', acc.data.status);

// 11. cash policy toggle: off means refused, on means allowed
await call('/api/admin/settings', { method: 'POST', token, body: { allow_cash_payment: 'false' } });
const cashOff = await call(`/api/admin/orders/${code}/payment`, { method: 'POST', token, body: { method: 'cash' } });
ok(cashOff.status === 400 && /method must be/.test(cashOff.data.error || ''), 'cash refused when the policy is off', cashOff.data.error || '');
await call('/api/admin/settings', { method: 'POST', token, body: { allow_cash_payment: 'true' } });
const methods = await call('/api/admin/payment-methods', { token });
ok(methods.data.includes('bank_transfer') && methods.data.includes('cash') && !methods.data.includes('upi'),
  'payment rails are UAE rails', methods.data.join(','));
const oldRail = await call(`/api/admin/orders/${code}/payment`, { method: 'POST', token, body: { method: 'upi' } });
ok(oldRail.status === 400, 'Indian rails (UPI) refused', oldRail.data.error || '');

// 12. pay by bank transfer → stock
// the launch model is cash, so the primary path is paid in cash
const pay = await call(`/api/admin/orders/${code}/payment`, { method: 'POST', token,
  body: { method: 'cash', txnRef: 'CASH-0001' } });
ok(pay.status === 200 && pay.data.receiptNo, 'payment recorded', pay.data.receiptNo + ' / ' + pay.data.stockId);
ok(pay.data.order.order.status === 'completed', 'order completed after payment');
const stockId = pay.data.stockId;

// 13. inventory economics with VAT: cost + repairs, list, sell
const item0 = await call('/api/admin/inventory/' + stockId, { token });
const costMinor = item0.data.cost.minor;
ok(costMinor === 117000, 'stock cost equals the paid offer', item0.data.cost.formatted);
const rep = await call(`/api/admin/inventory/${stockId}/repair`, { method: 'POST', token,
  body: { description: 'Screen replacement', items: [{ part: 'Screen', cost: 300 }, { part: 'Battery', cost: 120 }], complete: true } });
ok(rep.data.repairCost.minor === 42000, 'repair cost summed', rep.data.repairCost.formatted);
const totalCost = costMinor + 42000;
ok(rep.data.totalCost.minor === totalCost, 'total cost = purchase + repairs', rep.data.totalCost.formatted);

const listed = await call(`/api/admin/inventory/${stockId}/list`, { method: 'POST', token, body: { listedPrice: 2050 } });
const listVat = Math.round(205000 * 500 / 10500);
ok(listed.data.expectedVat.minor === listVat, 'VAT contained in the listed price', listed.data.expectedVat.formatted);
ok(listed.data.expectedProfit.minor === 205000 - listVat - totalCost,
  'expected profit is net of VAT', listed.data.expectedProfit.formatted);

const salePrice = 2099, fees = 20;
const sale = await call(`/api/admin/inventory/${stockId}/sale`, { method: 'POST', token,
  body: { salePrice, fees, buyerName: 'Walk-in', channel: 'store' } });
const saleVat = Math.round(salePrice * 100 * 500 / 10500);
ok(sale.data.status === 'sold', 'item marked sold');
ok(sale.data.sale.vat.minor === saleVat, 'sale records VAT at 5%', sale.data.sale.vat.formatted);
const expectedProfit = salePrice * 100 - saleVat - fees * 100 - totalCost;
ok(sale.data.sale.profit.minor === expectedProfit, 'gross profit = gross − VAT − fees − cost − repairs',
  sale.data.sale.profit.formatted);
const resell = await call(`/api/admin/inventory/${stockId}/sale`, { method: 'POST', token, body: { salePrice: 100 } });
ok(resell.status === 409, 'cannot sell the same unit twice', resell.data.error || '');

// 13b. paperwork: payout receipt and 5% tax invoice
await call('/api/admin/settings', { method: 'POST', token,
  body: { trn: '100123456700003', company_legal_name: 'Test Trading L.L.C', company_address: 'Al Danah, Abu Dhabi' } });
const receiptRes = await fetch(`${BASE}/doc/receipt/${pay.data.receiptNo}`);
const receiptHtml = await receiptRes.text();
ok(receiptRes.status === 200 && /PURCHASE RECEIPT/i.test(receiptHtml), 'purchase receipt renders');
ok(receiptHtml.includes('AED1,170') && /CASH|BANK TRANSFER/i.test(receiptHtml), 'receipt shows amount and method');
ok(/No VAT is charged on this\s+purchase/i.test(receiptHtml), 'receipt states no VAT on a consumer purchase');
const invRes = await fetch(`${BASE}/doc/invoice/${sale.data.sale.invoiceNo}`);
const invHtml = await invRes.text();
ok(invRes.status === 200 && /TAX INVOICE/i.test(invHtml), 'tax invoice renders');
ok(invHtml.includes('100123456700003'), 'invoice prints the seller TRN');
ok(/VAT 5%/.test(invHtml) && invHtml.includes('AED99.95') && invHtml.includes('AED1,999.05'), 'invoice splits net 1,999.05 + VAT 99.95');
const saleMethodDefault = sale.data.sale.paymentMethod;
ok(saleMethodDefault === 'cash', 'sale defaults to cash when no method is given', String(saleMethodDefault));
const cashRep = await call('/api/admin/reports/cash', { token });
ok(cashRep.data.cashOut.minor === 117000, 'cash report shows the cash payout for the day', cashRep.data.cashOut.formatted);
ok(cashRep.data.netCash.minor === cashRep.data.cashIn.minor - cashRep.data.cashOut.minor, 'net cash = in − out',
  cashRep.data.netCash.formatted);
ok(Array.isArray(cashRep.data.salesByMethod) && cashRep.data.salesByMethod.length >= 1, 'sales split by payment method');

const vatRep = await call('/api/admin/reports/vat?from=2000-01-01&to=2999-12-31', { token });
ok(vatRep.data.outputVat.vat.minor === saleVat, 'VAT report total matches the sale', vatRep.data.outputVat.vat.formatted);
ok(vatRep.data.outputVat.gross.minor === salePrice * 100, 'VAT report gross equals the sale price');
ok(vatRep.data.purchases.count >= 1 && /no input VAT/i.test(vatRep.data.purchases.note), 'purchases listed with no input VAT');
ok(vatRep.data.monthly.length === 1, 'monthly VAT breakdown present', vatRep.data.monthly[0].month);


// 14. dashboard reflects the trade including VAT collected
const dash = await call('/api/admin/dashboard', { token });
ok(dash.data.today.purchased >= 1 && dash.data.today.sold >= 1, 'dashboard counts trade',
  `bought=${dash.data.today.purchased} sold=${dash.data.today.sold} profit=${dash.data.today.grossProfit.formatted}`);
ok(dash.data.today.vatCollected.minor === saleVat, 'dashboard shows VAT collected', dash.data.today.vatCollected.formatted);

// 15. price master update, versioned and audited
const before = await call('/api/admin/prices?q=iPhone 15', { token });
const target = before.data.find((r) => r.variant === '128GB');
await call('/api/admin/prices', { method: 'POST', token, body: { variantId: target.variantId, basePrice: 1150, note: 'market up' } });
const after = await call('/api/quote', { method: 'POST', body: { variantId: target.variantId, category: 'mobile', answers: goodPhone } });
ok(after.data.basePrice.minor === 115000, 'new base price live in quotes', after.data.basePrice.formatted);
const audit = await call('/api/admin/audit?limit=100', { token });
const priceAudit = audit.data.find((a) => a.entity === 'device_variants' && a.action === 'price');
ok(!!priceAudit && String(priceAudit.old_value) === '133000', 'price change audited with old value', priceAudit && priceAudit.new_value);

// 16. currency stays admin-owned: AED -> USD and back, history preserved
const cur = await call('/api/admin/currency', { method: 'POST', token,
  body: { code: 'USD', convertPrices: true, rate: 0.2723, reason: 'test switch' } });
ok(cur.status === 200 && cur.data.currency === 'USD', 'currency switched to USD', cur.data.pricesConverted + ' prices converted');
ok((await call('/api/config')).data.currency === 'USD', 'public config follows new currency');
const qUsd = await call('/api/quote', { method: 'POST', body: { variantId: target.variantId, category: 'mobile', answers: goodPhone } });
ok(qUsd.data.currency === 'USD' && /^\$/.test(qUsd.data.basePrice.formatted), 'quotes now in USD', qUsd.data.basePrice.formatted);
const oldOrder = await call('/api/orders/' + code);
ok(oldOrder.data.estimate.low.currency === 'AED', 'historical order keeps AED', oldOrder.data.estimate.low.currency);
const back = await call('/api/admin/currency', { method: 'POST', token,
  body: { code: 'AED', convertPrices: true, rate: 3.6725, reason: 'restore AED' } });
ok(back.data.currency === 'AED', 'currency restored to AED');
const qBack = await call('/api/quote', { method: 'POST', body: { variantId: target.variantId, category: 'mobile', answers: goodPhone } });
ok(qBack.data.basePrice.minor > 113000 && qBack.data.basePrice.minor < 117000,
  'price survived the round trip inside a rounding tolerance', qBack.data.basePrice.formatted);

// 17. locked currency refuses change
await call('/api/admin/settings', { method: 'POST', token, body: { currency_locked: 'true' } });
const locked = await call('/api/admin/currency', { method: 'POST', token, body: { code: 'USD', convertPrices: false } });
ok(locked.status === 409, 'locked currency refuses change', locked.data.error || '');
await call('/api/admin/settings', { method: 'POST', token, body: { currency_locked: 'false' } });

// 18. laptop flow: its own question set, serial instead of IMEI
const catL = await call('/api/catalog?category=laptop');
const mb = catL.data.find((b) => b.name === 'Apple');
const airVar = mb.models.find((m) => m.name === 'MacBook Air M2').variants[0];
const ql = await call('/api/quote', { method: 'POST', body: { variantId: airVar.id, category: 'laptop',
  answers: { screen: 'perfect', keyboard: 'working', battery: '80plus', ports: 'working', hinge: 'solid', body: 'excellent', charger: 'original', os: 'activated' } } });
ok(ql.data.complete === true && ql.data.estimate.minor > 0, 'laptop quote works', ql.data.estimate.formatted);
const mixed = await call('/api/quote', { method: 'POST', body: { variantId: airVar.id, category: 'laptop', answers: { keyboard: 'bogus' } } });
ok(mixed.status === 400, 'invalid option rejected', mixed.data.error || '');
const noSerial = await call('/api/orders', { method: 'POST', body: {
  ...orderBody, category: 'laptop', variantId: airVar.id, answers: { screen: 'perfect' },
  device: { imei: '', serial: '', photos: [] } } });
ok(noSerial.status === 400 && /serial/i.test(noSerial.data.error || ''), 'laptop needs a serial number', noSerial.data.error || '');

// 18b. data treatment: stored per order, certified only after custody
ok((await call('/api/orders/' + code)).data.dataHandling === 'reuse', 'order records the chosen data treatment');
const certEarly = await fetch(`${BASE}/doc/sanitisation/${code}`);
ok(certEarly.status === 409, 'no certificate before the erase is recorded');
const san = await call(`/api/admin/orders/${code}/sanitise`, { method: 'POST', token, body: {} });
ok(san.status === 200 && /^SANI-/.test(san.data.ref), 'certificate issued after custody', san.data.ref);
const certHtml = await (await fetch(`${BASE}/doc/sanitisation/${code}`)).text();
ok(/CERTIFICATE OF DATA SANITISATION/i.test(certHtml), 'certificate renders');
ok(certHtml.includes('NIST SP 800-88') && /Certified erasure/i.test(certHtml),
  'certificate names the standard and the method');
ok(certHtml.includes(san.data.ref), 'certificate carries its number');
const sanAgain = await call(`/api/admin/orders/${code}/sanitise`, { method: 'POST', token, body: {} });
ok(sanAgain.status === 409, 'certificate cannot be reissued silently');

// 19. partial inspection must not produce an offer
const ord2 = await call('/api/orders', { method: 'POST', body: {
  ...orderBody,
  customer: { ...orderBody.customer, phone: '+971 50 222 3344' },
  device: { imei: '357' + String(Date.now()).slice(-12), serial: 'PART1' },
  dataHandling: 'destroy',
} });
ok(ord2.status === 200, 'second order created for partial-inspection test', ord2.data.code);
ok((await call('/api/orders/' + ord2.data.code)).data.dataHandling === 'destroy', 'destroy path stored on the order');
const sanUnpaid = await call(`/api/admin/orders/${ord2.data.code}/sanitise`, { method: 'POST', token, body: {} });
ok(sanUnpaid.status === 409, 'cannot certify a device that is not paid for', sanUnpaid.data.error || '');
const partial = await call(`/api/admin/orders/${ord2.data.code}/inspection`, { method: 'POST', token,
  body: { findings: { screen: 'heavy' }, imeiVerified: true } });
ok(partial.status === 400 && /Incomplete/i.test(partial.data.error || ''), 'partial inspection rejected', partial.data.error || '');
const overridePartial = await call(`/api/admin/orders/${ord2.data.code}/inspection`, { method: 'POST', token,
  body: { findings: { screen: 'heavy' }, allowPartial: true, partialReason: 'battery not testable',
    overrideAmount: 1200, overrideReason: 'battery not testable' } });
ok(overridePartial.status === 200, 'explicit override may sign off a partial checklist');
const ovAudit = (await call('/api/admin/audit?limit=50', { token })).data
  .find((a) => a.entity === 'inspections' && a.reason === 'battery not testable');
ok(!!ovAudit, 'override reason stored on the audit trail', ovAudit && ovAudit.new_value);

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}`);
process.exitCode = fails ? 1 : 0;
