'use strict';
// Price engine. One engine drives the customer estimate and the inspector's final offer,
// so a declared answer and a confirmed answer are scored identically.
const { all, one, getSetting } = require('./db');
const money = require('./money');

const GRADE_ORDER = ['A', 'B', 'C', 'D'];

function questionsFor(category) {
  const qs = all('SELECT * FROM questions WHERE category = ? ORDER BY sort, id', category);
  return qs.map((q) => ({
    id: q.id,
    code: q.code,
    label: q.label,
    section: q.section,
    options: all('SELECT * FROM question_options WHERE question_id = ? ORDER BY sort, id', q.id)
      .map((o) => ({ id: o.id, code: o.code, label: o.label, adj_kind: o.adj_kind, adj_value: o.adj_value, grade: o.grade })),
  }));
}

function variantWithModel(variantId) {
  return one(`SELECT v.*, m.name AS model, m.id AS model_id, b.name AS brand, b.category
              FROM device_variants v
              JOIN device_models m ON m.id = v.model_id
              JOIN device_brands b ON b.id = m.brand_id
              WHERE v.id = ?`, variantId);
}

/** Convert minor amount from one currency to the display currency.
 *  Returns {minor, currency, rate} or throws a 409-style object when no rate exists. */
function toDisplay(minor, fromCode, baseCurrency) {
  if (!baseCurrency || fromCode === baseCurrency) return { minor, rate: 1 };
  const row = one(`SELECT rate FROM fx_rates WHERE base_code = ? AND quote_code = ?
                   ORDER BY as_of DESC, id DESC LIMIT 1`, baseCurrency, fromCode);
  if (!row) {
    const err = new Error(
      `No FX rate from ${fromCode} to ${baseCurrency}. Admin must set one at /api/admin/fx or convert prices.`);
    err.status = 409;
    err.detail = { from: fromCode, to: baseCurrency };
    throw err;
  }
  return { minor: money.convert(minor, fromCode, baseCurrency, row.rate), rate: row.rate };
}

/**
 * Core valuation.
 * @param {number} variantId
 * @param {string} category  'mobile'|'laptop'
 * @param {Object} answers   { questionCode: optionCode }
 * @param {Object} [opts]    { overrideBaseMinor, overrideCurrency, reason }
 */
function valuate(variantId, category, answers = {}, opts = {}) {
  const v = variantWithModel(variantId);
  if (!v) { const e = new Error('Unknown device variant'); e.status = 404; throw e; }

  const settings = { base: getSetting('base_currency'), rangePct: Number(getSetting('range_pct_bp')),
    step: Number(getSetting('rounding_step')), floorPct: Number(getSetting('min_floor_pct_bp')) };
  const cat = category || v.category;

  const baseMinor = opts.overrideBaseMinor != null ? Number(opts.overrideBaseMinor) : v.base_price_minor;
  const baseCur = opts.overrideCurrency || v.currency;
  const conv = toDisplay(baseMinor, baseCur, settings.base);
  const baseDisp = conv.minor;

  const qs = questionsFor(cat);
  const adjustments = [];
  let delta = 0;
  let worstGrade = null;
  const missing = [];

  for (const q of qs) {
    const chosen = answers[q.code];
    if (chosen === undefined || chosen === null || chosen === '') { missing.push(q.code); continue; }
    const opt = q.options.find((o) => o.code === chosen);
    if (!opt) { const e = new Error(`Invalid option "${chosen}" for question "${q.code}"`); e.status = 400; throw e; }
    // percentage deductions are rounded to whole dirhams — a customer should never read "-AED76.80"
    let amount = opt.adj_kind === 'pct'
      ? money.roundToStep(Math.round(baseDisp * (opt.adj_value / 10000)), settings.base, 1)
      : opt.adj_value;
    // a flat adjustment is money in the currency it was entered in — convert it, never rewrite it
    if (opt.adj_kind === 'flat') amount = toDisplay(opt.adj_value, opt.currency || baseCur, settings.base).minor;
    delta += amount;
    if (opt.grade && GRADE_ORDER.indexOf(opt.grade) > GRADE_ORDER.indexOf(worstGrade || 'A')) worstGrade = opt.grade;
    adjustments.push({
      question: q.code, questionLabel: q.label, section: q.section,
      option: opt.code, optionLabel: opt.label,
      deltaMinor: amount, delta: money.fmt(amount, settings.base),
    });
  }

  const floorMinor = Math.round(baseDisp * (settings.floorPct / 10000));
  let estimate = baseDisp + delta;
  if (estimate < floorMinor) estimate = floorMinor;
  estimate = money.roundToStep(estimate, settings.base, settings.step);

  const band = Math.round(estimate * (settings.rangePct / 10000));
  let low = money.roundToStep(estimate - band, settings.base, settings.step);
  let high = money.roundToStep(estimate + band, settings.base, settings.step);
  const floorRounded = money.roundToStep(floorMinor, settings.base, settings.step);
  if (low < floorRounded) low = floorRounded;
  if (low > estimate) low = estimate;

  return {
    device: { variantId: v.id, brand: v.brand, model: v.model, variant: v.variant, category: v.category,
      label: `${v.brand} ${v.model} ${v.variant}` },
    basePrice: money.money(baseDisp, settings.base),
    basePriceSource: { minor: v.base_price_minor, currency: v.currency, fxRate: conv.rate },
    adjustments,
    missingAnswers: missing,
    complete: missing.length === 0,
    delta: money.money(delta, settings.base),
    estimate: money.money(estimate, settings.base),
    range: { low: money.money(low, settings.base), high: money.money(high, settings.base),
      text: `${money.fmt(low, settings.base)} \u2013 ${money.fmt(high, settings.base)}` },
    grade: worstGrade || 'A',
    currency: settings.base,
    disclaimer: 'Final price is confirmed after physical inspection.',
  };
}

module.exports = { valuate, questionsFor, variantWithModel, toDisplay, GRADE_ORDER };
