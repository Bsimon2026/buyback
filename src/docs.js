'use strict';
// Printable documents: the cash payout receipt and the 5% VAT tax invoice.
// Server-rendered HTML so they print cleanly and need no build step.
const money = require('./money');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** '2026-10-30 21:02:58' -> '30 Oct 2026, 21:02' */
function fmtDate(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return String(v);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}, ${m[4]}:${m[5]}`;
}

const CSS = `
  *{box-sizing:border-box}
  body{font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#111;margin:0;background:#fff;
       font-size:13px;line-height:1.45}
  .sheet{max-width:760px;margin:24px auto;padding:34px 38px;border:1px solid #e3e3e3}
  .head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;
        border-bottom:2px solid #111;padding-bottom:16px}
  .rtl-doc{text-align:left;font-size:13.5px;line-height:1.7;margin-top:2px}
  .brand{font-size:19px;font-weight:800;letter-spacing:-.02em;margin-bottom:2px}
  .small{font-size:12px;color:#444}
  .kicker{font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:#777;margin-bottom:5px}
  .doc-type{font-size:15px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
  .doc-no{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;margin-top:4px}
  .doc-right{text-align:right;min-width:200px}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:20px 0 6px}
  .meta .box{border:1px solid #e3e3e3;border-radius:6px;padding:12px 14px}
  .meta b{font-weight:700}
  table{width:100%;border-collapse:collapse;margin-top:14px}
  th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:#666;
     border-bottom:1px solid #ccc;padding:8px 6px}
  td{padding:9px 6px;border-bottom:1px solid #eee;vertical-align:top}
  td.r,th.r{text-align:right}
  .totals{margin-top:14px;margin-left:auto;width:320px}
  .totals div{display:flex;justify-content:space-between;padding:6px 0}
  .totals .grand{border-top:2px solid #111;font-weight:800;font-size:15px;margin-top:4px;padding-top:9px}
  .note{margin-top:22px;font-size:11.5px;color:#555;border-top:1px dashed #ccc;padding-top:12px}
  .sign{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:40px}
  .sign div{border-top:1px solid #999;padding-top:6px;font-size:11px;color:#666}
  .stamp{display:inline-block;border:1.5px solid #166534;color:#166534;border-radius:6px;padding:5px 10px;
     font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;margin-top:12px}
  .print-btn{position:fixed;top:14px;right:14px;background:#111;color:#fff;border:0;border-radius:8px;
     padding:10px 16px;font-size:13px;font-weight:600;cursor:pointer}
  @media print{.print-btn{display:none}.sheet{border:0;margin:0;padding:0}}
`;

const shell = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title><style>${CSS}</style></head><body>
<button class="print-btn" onclick="window.print()">Print / Save PDF</button>
<div class="sheet">${body}</div></body></html>`;

/** Seller identity, printed once at the top. */
function sellerHead(settings, docType, docNo, dateText) {
  return `<div class="head">
    <div>
      <div class="kicker">Supplier — registered name</div>
      <div class="brand" style="font-size:15px;line-height:1.35;max-width:34ch">${esc(settings.company_legal_name || settings.company_name)}</div>
      <div class="small" style="margin-top:4px">trading as ${esc(settings.company_name || '')}${settings.domain ? ' &middot; ' + esc(settings.domain) : ''}</div>
      ${settings.company_legal_name_ar ? `<div class="small rtl-doc" dir="rtl" lang="ar">${esc(settings.company_legal_name_ar)}</div>` : ''}
      <div class="small" style="margin-top:4px">${esc(settings.company_address || '')}</div>
      <div class="small">TRN: <b>${esc(settings.trn || 'NOT SET')}</b>${settings.trade_licence ? ' &middot; Licence ' + esc(settings.trade_licence) : ''}</div>
      <div class="small">${[settings.support_phone, settings.support_email].filter(Boolean).map(esc).join(' &middot; ')}</div>
    </div>
    <div class="doc-right">
      <div class="doc-type">${esc(docType)}</div>
      <div class="doc-no">${esc(docNo)}</div>
      <div class="small" style="margin-top:6px">${esc(dateText)}</div>
    </div>
  </div>`;
}

/** Cash (or bank) payout receipt: we buy the device from the customer. No VAT on a consumer purchase. */
function purchaseReceipt({ order, payment, inspection, settings }) {
  const c = payment.currency;
  const amount = money.fmt(payment.amount_minor, c);
  const method = String(payment.method).replace(/_/g, ' ');
  const rows = [
    ['Device', order.variant_label],
    ['IMEI', order.imei || '—'],
    ['Serial', order.serial || '—'],
    ['Condition grade', inspection ? (inspection.grade || '—') : '—'],
    ['Order', order.code],
    ['Payment method', method.toUpperCase()],
    ['Reference', payment.txn_ref || '—'],
  ];
  return shell('Purchase receipt ' + payment.receipt_no, `
    ${sellerHead(settings, 'Purchase receipt', payment.receipt_no, fmtDate(payment.paid_at || payment.created_at))}

    <div class="meta">
      <div class="box">
        <div class="kicker">Device purchased from</div>
        <div><b>${esc(order.customer_name)}</b></div>
        <div class="small">${esc(order.phone)}${order.email ? ' · ' + esc(order.email) : ''}</div>
        <div class="small">${esc(order.address || '')}</div>
        <div class="small">ID verified on collection</div>
      </div>
      <div class="box">
        <div class="kicker">Collected at</div>
        <div class="small">${esc(order.pickup_type === 'store' ? 'Store visit' : 'Home pickup')}
          ${esc(order.pickup_date || '')} ${esc(order.pickup_slot || '')}</div>
        <div class="small" style="margin-top:6px">Purchased into stock on payment</div>
      </div>
    </div>

    <table>
      <thead><tr><th>Description</th><th class="r">Details</th></tr></thead>
      <tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`).join('')}</tbody>
    </table>

    <div class="totals">
      <div><span>Device price</span><span>${esc(amount)}</span></div>
      <div><span>VAT on purchase</span><span>${esc(money.fmt(0, c))}</span></div>
      <div class="grand"><span>Paid to customer</span><span>${esc(amount)}</span></div>
    </div>
    <div><span class="stamp">${esc(method)} paid</span></div>

    <div class="note">
      This is a receipt for a purchase of second-hand goods from a private individual. No VAT is charged on this
      purchase. The seller confirms the device is their own property, is not stolen or blocked, and carries no
      activation lock or financing obligation. The device was inspected and its condition recorded at the time of
      purchase (grade ${esc(inspection ? inspection.grade || '—' : '—')}).
      ${inspection && inspection.notes ? '<br>Inspector notes: ' + esc(inspection.notes) : ''}
    </div>

    <div class="sign"><div>Customer signature</div><div>For ${esc(settings.company_legal_name || settings.company_name)}</div></div>
  `);
}

/** Tax invoice for the resale: 5% VAT shown as a breakdown of the VAT-inclusive price. */
function saleInvoice({ sale, item, order, settings, branch }) {
  const c = sale.currency;
  const gross = sale.sale_price_minor;
  const vat = sale.vat_minor || 0;
  const net = gross - vat;
  const rate = (sale.vat_rate_bp || 0) / 100;
  return shell('Tax invoice ' + sale.invoice_no, `
    ${sellerHead(settings, 'Tax invoice', sale.invoice_no, fmtDate(sale.sold_at))}

    <div class="meta">
      <div class="box">
        <div class="kicker">Billed to</div>
        <div><b>${esc(sale.buyer_name || 'Walk-in customer')}</b></div>
        <div class="small">${esc(sale.buyer_phone || '')}</div>
        <div class="small">Buyer TRN: ${esc(sale.buyer_trn || '— (consumer)')}</div>
      </div>
      <div class="box">
        <div class="kicker">Sale details</div>
        <div class="small">Branch: ${esc(branch ? branch.name : '—')}</div>
        <div class="small">Stock: ${esc(item.stock_id)}</div>
        <div class="small">Channel: ${esc(sale.channel || '—')}</div>
        <div class="small">${order ? 'Bought from order ' + esc(order.code) : ''}</div>
      </div>
    </div>

    <table>
      <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Amount ex-VAT</th>
        <th class="r">VAT ${esc(rate)}%</th><th class="r">Total</th></tr></thead>
      <tbody><tr>
        <td>${esc(item.variant_label)}<br>
          <span style="color:#666">IMEI ${esc(item.imei || '—')}${item.serial ? ' · S/N ' + esc(item.serial) : ''} · Grade ${esc(item.grade || '—')}<br>
          Second-hand device, sold as seen</span></td>
        <td class="r">1</td>
        <td class="r">${esc(money.fmt(net, c))}</td>
        <td class="r">${esc(money.fmt(vat, c))}</td>
        <td class="r">${esc(money.fmt(gross, c))}</td>
      </tr></tbody>
    </table>

    <div class="totals">
      <div><span>Total ex-VAT</span><span>${esc(money.fmt(net, c))}</span></div>
      <div><span>VAT ${esc(rate)}%</span><span>${esc(money.fmt(vat, c))}</span></div>
      <div class="grand"><span>Total payable</span><span>${esc(money.fmt(gross, c))}</span></div>
    </div>

    <div class="note">
      Prices are inclusive of UAE VAT at ${esc(rate)}%. Goods are second-hand and sold in their condition at the time of
      sale, with no warranty beyond that stated separately.
    </div>

    <div class="sign"><div>Received by</div><div>For ${esc(settings.company_legal_name || settings.company_name)}</div></div>
  `);
}


/** Certificate of data sanitisation — the document that makes the environmental claim credible. */
function sanitisationCertificate({ order, inspection, payment, settings }) {
  const cur = order.currency || 'AED';
  const method = order.data_handling === 'destroy'
    ? 'Physical destruction of storage media'
    : 'Certified erasure of all user-addressable storage';
  const standard = settings.erasure_standard || 'NIST SP 800-88 Rev.2 (Purge)';
  const tool = settings.erasure_tool || '';
  const rows = [
    ['Device', order.variant_label],
    ['IMEI', order.imei || '—'],
    ['Serial number', order.serial || '—'],
    ['Condition grade', inspection ? (inspection.grade || '—') : '—'],
    ['Custody reference', order.code],
    ['Payment reference', payment ? payment.receipt_no : '—'],
    ['Data treatment', order.data_handling === 'destroy' ? 'Destroy — media physically destroyed' : 'Reuse — device erased and resold'],
    ['Method', method],
    ['Standard applied', standard],
    ...(tool ? [['Tool / version', tool]] : []),
    ['Verification', 'Erasure log checked for completion; device inspected for residual user data before release'],
    ['Sanitised on', order.sanitised_at || '—'],
    ['Certificate number', order.sanitisation_ref || '—'],
  ];
  return shell('Certificate of data sanitisation ' + (order.sanitisation_ref || ''), `
    ${sellerHead(settings, 'Certificate of data sanitisation', order.sanitisation_ref || '', fmtDate(order.sanitised_at))}

    <div class="meta">
      <div class="box">
        <div class="kicker">Issued to</div>
        <div><b>${esc(order.customer_name)}</b></div>
        <div class="small">${esc(order.phone)}${order.email ? ' · ' + esc(order.email) : ''}</div>
        <div class="small">${esc(order.address || '')}</div>
      </div>
      <div class="box">
        <div class="kicker">Statement</div>
        <div class="small">All data on the storage media of this device was rendered unrecoverable using the
          method and standard listed below, before the device left our custody.</div>
      </div>
    </div>

    <table>
      <thead><tr><th>Detail</th><th class="r">Record</th></tr></thead>
      <tbody>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`).join('')}</tbody>
    </table>

    <div class="note">
      ${order.data_handling === 'destroy'
        ? 'The storage media was physically destroyed, so recovery of any data from it is not possible by any means.'
        : 'The device was erased to the standard above and then resold or refurbished. Where the storage media could not be erased successfully, it was destroyed instead and this certificate records that outcome.'}
      ${tool ? '<br>Erasure performed with ' + esc(tool) + '.' : ''}
      <br>This certificate covers the device identified by the IMEI / serial number above only, and is issued from our
      order record ${esc(order.code)}. Retention of this document is recommended for your own records.
    </div>

    <div class="sign"><div>Your signature</div><div>Data handling operator — ${esc(settings.company_legal_name || settings.company_name)}</div></div>
  `);
}

module.exports = { purchaseReceipt, saleInvoice, sanitisationCertificate, esc, fmtDate };
