// Currency-aware money helpers. All amounts are integer minor units.
'use strict';

const CURRENCIES = {
  INR: { name: 'Indian Rupee',      symbol: '\u20b9', decimals: 2 },
  AED: { name: 'UAE Dirham',        symbol: 'AED',    decimals: 2 },
  SAR: { name: 'Saudi Riyal',       symbol: 'SAR',    decimals: 2 },
  QAR: { name: 'Qatari Riyal',      symbol: 'QAR',    decimals: 2 },
  KWD: { name: 'Kuwaiti Dinar',     symbol: 'KWD',    decimals: 3 },
  USD: { name: 'US Dollar',         symbol: '$',      decimals: 2 },
  EUR: { name: 'Euro',              symbol: '\u20ac', decimals: 2 },
  GBP: { name: 'Pound Sterling',    symbol: '\u00a3', decimals: 2 },
  JPY: { name: 'Japanese Yen',      symbol: '\u00a5', decimals: 0 },
};

function decimalsOf(code) {
  const c = CURRENCIES[code];
  return c ? c.decimals : 2;
}

function factor(code) {
  return Math.pow(10, decimalsOf(code));
}

/** 35000.5 (major) -> minor int for the given currency */
function toMinor(major, code) {
  return Math.round(Number(major) * factor(code));
}

function toMajor(minor, code) {
  return Number(minor) / factor(code);
}

/** Human string, e.g. 3100000 paise in INR -> "₹31,000.00" (decimals trimmed when zero) */
function fmt(minor, code) {
  if (minor === null || minor === undefined) return '';
  const d = decimalsOf(code);
  const major = Number(minor) / Math.pow(10, d);
  const neg = major < 0;
  const abs = Math.abs(major);
  const fixed = abs.toFixed(d);
  const [intPart, decPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const tail = decPart && Number(decPart) !== 0 ? '.' + decPart : '';
  const sym = (CURRENCIES[code] && CURRENCIES[code].symbol) || code + ' ';
  return (neg ? '-' : '') + sym + grouped + tail;
}

/** Round a minor amount to the nearest `step` MAJOR units (e.g. step 100 -> nearest ₹100) */
function roundToStep(minor, code, stepMajor) {
  const step = Math.max(1, Math.round(Number(stepMajor) || 1)) * factor(code);
  return Math.round(minor / step) * step;
}

/** Convert an integer amount between currencies at a given rate (1 from = rate to) */
function convert(minor, fromCode, toCode, rate) {
  const major = toMajor(minor, fromCode);
  return toMinor(major * Number(rate), toCode);
}

function money(minor, code) {
  return { minor: Math.round(minor), currency: code, formatted: fmt(minor, code) };
}

module.exports = { CURRENCIES, decimalsOf, factor, toMinor, toMajor, fmt, roundToStep, convert, money };
