'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'buyback.db');

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// Lightweight forward migration: add columns that newer code expects without losing data.
function ensureColumn(table, column, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}

// ---------- helpers ----------
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const run = (sql, ...a) => db.prepare(sql).run(...a);
const uid = (n = 16) => crypto.randomBytes(n).toString('hex');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const h = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `scrypt$${salt}$${h}`;
}
function verifyPassword(password, stored) {
  const [scheme, salt, h] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !h) return false;
  const test = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(test, 'hex'), Buffer.from(h, 'hex'));
}

// ---------- settings ----------
const SETTING_DEFAULTS = {
  company_name: 'in Dubai City',            // trade name, as it appears on the logo
  company_legal_name: 'QAMAR ALNAJAH Audio-Visual, Recording Equipment & Accessories Trading L.L.C S.O.C',
  company_legal_name_ar: '',
  trade_licence: '',             // Dubai DED trade licence number
  domain: 'indubaicity.com',     // printed on documents
  jurisdiction: 'Dubai',
  company_address: 'Shop No. 8, Nad Al Hamar, Dubai, United Arab Emirates',
  trn: '105531719000003',        // UAE TRN - printed on every tax invoice
  base_currency: 'AED',        // ADMIN-OWNED: the currency the platform quotes/pays in
  currency_locked: 'false',    // true = block changes to base_currency
  range_pct_bp: '500',         // +/- 5% displayed estimate band
  rounding_step: '10',         // round quotes to nearest 10 major units (AED)
  min_floor_pct_bp: '1500',    // never quote below 15% of base price
  quote_valid_hours: '48',
  imei_required: 'true',
  kyc_required: 'true',
  allow_cash_payment: 'true',  // normal trade practice in UAE; one switch to turn off
  erasure_standard: 'NIST SP 800-88 Rev.2 (Purge)',
  erasure_tool: '',            // name the certified tool you actually use, e.g. Blancco Mobile Diagnostics and Erasure
  recycling_partner: '',       // licensed UAE e-waste partner for devices we do not buy
  buy_markdown_bp: '1500',     // buy price = market refurb price minus this. 1500 = pay 85% of market
  vat_rate_bp: '500',          // 5% UAE VAT on resale invoices; set 0 if not VAT-registered
  support_phone: '+971 56 163 8612',
  support_email: 'connect@indubaicity.com',
};

ensureColumn('sales', 'vat_minor', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('sales', 'vat_rate_bp', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('sales', 'buyer_trn', 'TEXT');
ensureColumn('sales', 'payment_method', "TEXT NOT NULL DEFAULT 'cash'");
ensureColumn('buyback_orders', 'data_handling', "TEXT NOT NULL DEFAULT 'reuse'");
ensureColumn('buyback_orders', 'sanitised_at', 'TEXT');
ensureColumn('buyback_orders', 'sanitisation_ref', 'TEXT');

function getSetting(key, fallback = null) {
  const row = one('SELECT value FROM settings WHERE key = ?', key);
  if (row) return row.value;
  return key in SETTING_DEFAULTS ? SETTING_DEFAULTS[key] : fallback;
}
function setSetting(key, value, actor = 'system', reason = null) {
  const old = getSetting(key);
  run(`INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    String(key), String(value), now());
  if (String(old) !== String(value)) {
    audit('settings', key, 'update', key, old, value, reason, null, actor);
  }
  return getSetting(key);
}
function getSettings() {
  const out = { ...SETTING_DEFAULTS };
  for (const r of all('SELECT key, value FROM settings')) out[r.key] = r.value;
  return out;
}

function audit(entity, entityId, action, field, oldValue, newValue, reason, actorId, actorName, ip = null) {
  run(`INSERT INTO audit_logs (entity, entity_id, action, field, old_value, new_value, reason, actor_id, actor_name, ip)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    String(entity), String(entityId), String(action), field ?? null,
    oldValue === undefined || oldValue === null ? null : String(oldValue),
    newValue === undefined || newValue === null ? null : String(newValue),
    reason ?? null, actorId ?? null, actorName ?? 'system', ip);
}

// ---------- seed ----------
const SEED_MOBILE_QUESTIONS = [
  ['screen', 'Screen condition', 'display', [
    ['perfect', 'Perfect', 0, null],
    ['minor', 'Minor scratches', 0, null],
    ['heavy', 'Heavy scratches', -8000, null],
    ['cracked', 'Cracked', -30000, 'D'],
  ]],
  ['body', 'Body condition', 'body', [
    ['excellent', 'Excellent', 8000, 'A'],
    ['minor', 'Minor scratches', 0, 'B'],
    ['dents', 'Dents', -6000, 'C'],
    ['damaged', 'Damaged', -15000, 'D'],
  ]],
  ['battery', 'Battery health', 'battery', [
    ['90plus', '90% and above', 0, null],
    ['85to89', '85-89%', -2000, null],
    ['80to84', '80-84%', -4000, null],
    ['below80', 'Below 80%', -8000, null],
  ]],
  ['camera', 'Camera', 'function', [
    ['working', 'Working', 0, null],
    ['not_working', 'Not working', -12000, 'C'],
  ]],
  ['speaker', 'Speaker', 'function', [
    ['working', 'Working', 0, null],
    ['not_working', 'Not working', -4000, null],
  ]],
  ['faceid', 'Face ID / Fingerprint', 'function', [
    ['working', 'Working', 0, null],
    ['not_working', 'Not working', -20000, 'C'],
  ]],
  ['charging', 'Charging port', 'function', [
    ['working', 'Working', 0, null],
    ['not_working', 'Not working', -8000, null],
  ]],
  ['water', 'Water damage', 'history', [
    ['no', 'No', 0, null],
    ['yes', 'Yes', -35000, 'D'],
    ['unknown', "Don't know", -12000, null],
  ]],
  ['repairs', 'Repair history', 'history', [
    ['never', 'Never repaired', 0, null],
    ['repaired', 'Repaired', -12000, null],
    ['unknown', "Don't know", -8000, null],
  ]],
];

const SEED_LAPTOP_QUESTIONS = [
  ['screen', 'Display condition', 'display', [
    ['perfect', 'Perfect', 0, null],
    ['minor', 'Minor scratches', -8000, null],
    ['heavy', 'Heavy scratches', -25000, null],
    ['cracked', 'Cracked / lines', -50000, 'D'],
  ]],
  ['keyboard', 'Keyboard', 'function', [
    ['working', 'Fully working', 0, null],
    ['some_keys', 'Some keys dead', -6000, 'C'],
    ['not_working', 'Not working', -12000, 'C'],
  ]],
  ['battery', 'Battery health', 'battery', [
    ['80plus', '80% and above', 0, null],
    ['60to79', '60-79%', -10000, null],
    ['below60', 'Below 60%', -20000, 'C'],
  ]],
  ['ports', 'Ports (USB/HDMI)', 'function', [
    ['working', 'All working', 0, null],
    ['partial', 'Some not working', -6000, null],
    ['not_working', 'Not working', -12000, 'C'],
  ]],
  ['hinge', 'Hinges', 'body', [
    ['solid', 'Solid', 0, null],
    ['loose', 'Loose', -8000, null],
    ['broken', 'Broken', -20000, 'D'],
  ]],
  ['body', 'Body condition', 'body', [
    ['excellent', 'Excellent', 4000, 'A'],
    ['minor', 'Minor scratches', 0, 'B'],
    ['dents', 'Dents / bent', -12000, 'C'],
    ['damaged', 'Damaged', -30000, 'D'],
  ]],
  ['charger', 'Charger', 'accessory', [
    ['original', 'Original charger', 0, null],
    ['third_party', 'Third party', -4000, null],
    ['none', 'No charger', -12000, null],
  ]],
  ['os', 'OS activation', 'function', [
    ['activated', 'Activated / no lock', 0, null],
    ['locked', 'Activation locked', -8000, 'C'],
  ]],
];

const SEED_DEVICES = [
// [category, brand, model, variant, baseBuyPriceAED]
  ['mobile', 'Apple', 'iPhone 15', '128GB', 1330],
  ['mobile', 'Apple', 'iPhone 15', '256GB', 1480],
  ['mobile', 'Apple', 'iPhone 14', '128GB', 1040],
  ['mobile', 'Apple', 'iPhone 14', '256GB', 1400],
  ['mobile', 'Apple', 'iPhone 13', '128GB', 820],
  ['mobile', 'Apple', 'iPhone 13', '256GB', 1150],
  ['mobile', 'Apple', 'iPhone 12', '128GB', 690],
  ['mobile', 'Samsung', 'Galaxy S24', '256GB', 1150],
  ['mobile', 'Samsung', 'Galaxy S23', '256GB', 1010],
  ['mobile', 'Samsung', 'Galaxy A54', '128GB', 710],
  ['mobile', 'OnePlus', 'OnePlus 12', '256GB', 1550],
  ['mobile', 'OnePlus', 'Nord 3', '128GB', 750],
  ['mobile', 'Xiaomi', 'Xiaomi 14', '256GB', 1400],
  ['mobile', 'Xiaomi', 'Redmi Note 13 Pro', '128GB', 640],
  ['mobile', 'Vivo', 'X100', '256GB', 1500],
  ['mobile', 'Vivo', 'V29', '128GB', 700],
  ['mobile', 'Oppo', 'Reno 11', '128GB', 760],
  ['mobile', 'Oppo', 'F25 Pro', '128GB', 380],
  ['mobile', 'Realme', 'Realme 12 Pro', '128GB', 600],
  ['mobile', 'Realme', 'Narzo 60', '128GB', 320],
  ['mobile', 'Google', 'Pixel 8', '128GB', 890],
  ['mobile', 'Google', 'Pixel 7a', '128GB', 640],
  ['mobile', 'Motorola', 'Edge 40', '256GB', 700],
  ['mobile', 'Nothing', 'Phone (2)', '256GB', 1090],
  ['mobile', 'Honor', 'Magic 6 Lite', '256GB', 650],
  ['laptop', 'Apple', 'MacBook Air M2', '8GB / 256GB', 2530],
  ['laptop', 'Apple', 'MacBook Pro 14 M3', '16GB / 512GB', 4400],
  ['laptop', 'Dell', 'XPS 13', '16GB / 512GB', 1510],
  ['laptop', 'Dell', 'Inspiron 15', '8GB / 512GB', 980],
  ['laptop', 'HP', 'Pavilion 15', '8GB / 512GB', 1610],
  ['laptop', 'Lenovo', 'ThinkPad E14', '8GB / 512GB', 850],
  ['laptop', 'Lenovo', 'IdeaPad Slim 3', '8GB / 512GB', 800],
  ['laptop', 'Asus', 'Vivobook 15', '8GB / 512GB', 610],
  ['laptop', 'Acer', 'Aspire 5', '8GB / 512GB', 2250],
];

function seed() {
  if (one('SELECT COUNT(*) c FROM users').c > 0) return;

  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) setSetting(key, value, 'seed');

  const cur = [
    ['INR', 'Indian Rupee', '\u20b9', 2], ['AED', 'UAE Dirham', 'AED', 2],
    ['SAR', 'Saudi Riyal', 'SAR', 2], ['QAR', 'Qatari Riyal', 'QAR', 2],
    ['KWD', 'Kuwaiti Dinar', 'KWD', 3], ['USD', 'US Dollar', '$', 2],
    ['EUR', 'Euro', '\u20ac', 2], ['GBP', 'Pound Sterling', '\u00a3', 2],
    ['JPY', 'Japanese Yen', '\u00a5', 0],
  ];
  for (const [code, name, sym, dec] of cur) {
    run('INSERT OR IGNORE INTO currencies (code,name,symbol,decimals) VALUES (?,?,?,?)', code, name, sym, dec);
  }

  const branches = [
    ['AUH', 'Abu Dhabi — Al Danah', 'Abu Dhabi'], ['AUH2', 'Abu Dhabi — Mussafah', 'Abu Dhabi'],
    ['DXB', 'Dubai — Deira', 'Dubai'], ['DXB2', 'Dubai — Al Barsha', 'Dubai'],
    ['SHJ', 'Sharjah — Al Nahda', 'Sharjah'],
  ];
  for (const [code, name, city] of branches) {
    run('INSERT OR IGNORE INTO branches (code,name,city) VALUES (?,?,?)', code, name, city);
  }
  const branchId = (code) => one('SELECT id FROM branches WHERE code = ?', code).id;

  const staff = [
    ['Super Admin', 'admin@indubaicity.com', 'super_admin', 'AUH', 'admin123'],
    ['Ops Manager', 'ops@indubaicity.com', 'ops_manager', 'AUH', 'ops12345'],
    ['Rahul Inspector', 'inspector@indubaicity.com', 'inspector', 'AUH', 'insp1234'],
    ['Priya Finance', 'finance@indubaicity.com', 'finance', 'AUH', 'fin12345'],
  ];
  for (const [name, email, role, br, pw] of staff) {
    run('INSERT INTO users (name,email,role,branch_id,password_hash) VALUES (?,?,?,?,?)',
      name, email, role, branchId(br), hashPassword(pw));
  }

  // questions — per category so the same code can carry different adjustments
  for (const [category, set] of [['mobile', SEED_MOBILE_QUESTIONS], ['laptop', SEED_LAPTOP_QUESTIONS]]) {
    let sort = 0;
    for (const [code, label, section, options] of set) {
      const q = run('INSERT INTO questions (code,category,label,section,sort) VALUES (?,?,?,?,?)',
        code, category, label, section, sort++);
      const qid = Number(q.lastInsertRowid);
      let os = 0;
      for (const [ocode, olabel, amountMinor, grade] of options) {
        run(`INSERT INTO question_options (question_id,code,label,adj_kind,adj_value,grade,sort)
             VALUES (?,?,?,?,?,?,?)`,
          qid, ocode, olabel, 'flat', Math.round(amountMinor), grade, os++);
      }
    }
  }

  for (const [category, brand, model, variant, price] of SEED_DEVICES) {
    const bs = slug(brand);
    let b = one('SELECT id FROM device_brands WHERE category = ? AND slug = ?', category, bs);
    if (!b) {
      const r = run('INSERT INTO device_brands (category,name,slug) VALUES (?,?,?)', category, brand, bs);
      b = { id: Number(r.lastInsertRowid) };
    }
    const ms = slug(model);
    let m = one('SELECT id FROM device_models WHERE brand_id = ? AND slug = ?', b.id, ms);
    if (!m) {
      const r = run('INSERT INTO device_models (brand_id,name,slug) VALUES (?,?,?)', b.id, model, ms);
      m = { id: Number(r.lastInsertRowid) };
    }
    const v = run('INSERT INTO device_variants (model_id,variant,base_price_minor,currency) VALUES (?,?,?,?)',
      m.id, variant, Math.round(price * 100), getSetting('base_currency'));
    run(`INSERT INTO device_prices (variant_id,base_price_minor,currency,effective_from,note)
         VALUES (?,?,?,?,?)`, Number(v.lastInsertRowid), Math.round(price * 100), getSetting('base_currency'), now(), 'seed');
  }
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

seed();

module.exports = {
  db, one, all, run, now, uid, audit,
  hashPassword, verifyPassword, getSetting, setSetting, getSettings, slug, DB_FILE,
  SETTING_DEFAULTS,
};
