-- ============================================================
-- BuyBack Platform — schema (SQLite, PostgreSQL-friendly naming)
--
-- MONEY RULE: every *_minor column is an INTEGER count of the
-- currency's smallest unit (paise/fils/cents). The row's own
-- `currency` column says which currency that integer means.
-- The active display currency is an ADMIN SETTING and never
-- rewrites historical rows.
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------- platform settings (admin-owned) ----------
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS currencies (
  code     TEXT PRIMARY KEY,       -- ISO-4217
  name     TEXT NOT NULL,
  symbol   TEXT NOT NULL,
  decimals INTEGER NOT NULL DEFAULT 2,
  active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS fx_rates (
  id INTEGER PRIMARY KEY,
  base_code TEXT NOT NULL,
  quote_code TEXT NOT NULL,
  rate REAL NOT NULL,              -- 1 base = rate quote
  as_of TEXT NOT NULL
);

-- ---------- org ----------
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  city TEXT,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  role TEXT NOT NULL,              -- super_admin|ops_manager|branch_manager|inspector|pickup_exec|finance|sales
  branch_id INTEGER REFERENCES branches(id),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- ---------- device master + price history ----------
CREATE TABLE IF NOT EXISTS device_brands (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,          -- mobile|laptop
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  logo_ref TEXT,
  UNIQUE(category, slug)
);

CREATE TABLE IF NOT EXISTS device_models (
  id INTEGER PRIMARY KEY,
  brand_id INTEGER NOT NULL REFERENCES device_brands(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  launch_year INTEGER,
  UNIQUE(brand_id, slug)
);

CREATE TABLE IF NOT EXISTS device_variants (
  id INTEGER PRIMARY KEY,
  model_id INTEGER NOT NULL REFERENCES device_models(id),
  variant TEXT NOT NULL,           -- 128GB / 8GB+256GB / i5 16GB 512GB
  base_price_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(model_id, variant)
);

-- historical purchase prices; effective_from makes price changes auditable
CREATE TABLE IF NOT EXISTS device_prices (
  id INTEGER PRIMARY KEY,
  variant_id INTEGER NOT NULL REFERENCES device_variants(id),
  base_price_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  note TEXT
);

-- ---------- leads: mobile captured during valuation, before an order exists ----------
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  phone TEXT NOT NULL,
  name TEXT,
  device TEXT,
  variant_id INTEGER,
  first_quote_minor INTEGER,
  currency TEXT,
  source TEXT,
  created_at TEXT NOT NULL,
  ip TEXT
);

-- ---------- email one-time codes (valuation gate) ----------
CREATE TABLE IF NOT EXISTS email_verifications (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT,
  phone TEXT,
  code_hash TEXT NOT NULL,
  token TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  verified_at TEXT,
  used_at TEXT,
  ip TEXT
);

-- ---------- condition questions (drive both estimate + inspection) ----------
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'both',   -- mobile|laptop|both
  label TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT 'general',
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE(code, category)
);

CREATE TABLE IF NOT EXISTS question_options (
  id INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES questions(id),
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  adj_kind TEXT NOT NULL DEFAULT 'flat',   -- flat|pct
  adj_value INTEGER NOT NULL DEFAULT 0,    -- flat: minor units OF adj_currency | pct: basis points (negative = deduction)
  currency TEXT NOT NULL DEFAULT 'AED',    -- the currency adj_value is expressed in; converted to the display
                                           -- currency at quote time, never rewritten (a rewrite drifts on round-trip)
  grade TEXT,                              -- optional inventory grade hint (A/B/C/D)
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE(question_id, code)
);

-- ---------- buyback orders ----------
CREATE TABLE IF NOT EXISTS buyback_orders (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,               -- BB-261030-0001
  category TEXT NOT NULL,
  variant_id INTEGER REFERENCES device_variants(id),
  variant_label TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  declared_json TEXT NOT NULL DEFAULT '{}',
  est_low_minor INTEGER NOT NULL DEFAULT 0,
  est_high_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  pincode TEXT,
  imei TEXT,
  serial TEXT,
  photos_json TEXT NOT NULL DEFAULT '[]',
  ownership_declared INTEGER NOT NULL DEFAULT 0,
  data_handling TEXT NOT NULL DEFAULT 'reuse',   -- reuse (erase + resell) | destroy (storage shredded)
  sanitised_at TEXT,
  sanitisation_ref TEXT,
  pickup_type TEXT NOT NULL DEFAULT 'home',  -- home|store
  pickup_date TEXT,
  pickup_slot TEXT,
  branch_id INTEGER REFERENCES branches(id),
  assigned_to INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'created',
  -- created|pickup_scheduled|collected|inspection|offer_generated|accepted
  -- |rejected|payment_processing|paid|completed|returned|cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_orders_status ON buyback_orders(status);
CREATE INDEX IF NOT EXISTS ix_orders_imei ON buyback_orders(imei);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES buyback_orders(id),
  status TEXT NOT NULL,
  note TEXT,
  actor_id INTEGER,
  actor_name TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kyc_records (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES buyback_orders(id),
  id_type TEXT,
  id_number TEXT,
  doc_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|verified|rejected
  verified_by INTEGER REFERENCES users(id),
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inspections (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES buyback_orders(id),
  inspector_id INTEGER REFERENCES users(id),
  findings_json TEXT NOT NULL DEFAULT '{}',
  delta_minor INTEGER NOT NULL DEFAULT 0,
  suggested_offer_minor INTEGER NOT NULL DEFAULT 0,
  final_offer_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  grade TEXT,
  notes TEXT,
  photos_json TEXT NOT NULL DEFAULT '[]',
  imei_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inspection_items (
  id INTEGER PRIMARY KEY,
  inspection_id INTEGER NOT NULL REFERENCES inspections(id),
  question_code TEXT NOT NULL,
  option_code TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES buyback_orders(id),
  inspection_id INTEGER REFERENCES inspections(id),
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|accepted|rejected|superseded
  overridden_by INTEGER REFERENCES users(id),
  override_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT
);

-- ---------- money out ----------
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES buyback_orders(id),
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  method TEXT NOT NULL,                    -- upi|bank|imps|neft|cash
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|processing|paid|failed
  txn_ref TEXT,
  receipt_no TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);

-- ---------- inventory / repair / resale ----------
CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY,
  stock_id TEXT UNIQUE NOT NULL,           -- MOB000125 / LAP000042
  order_id INTEGER REFERENCES buyback_orders(id),
  variant_id INTEGER REFERENCES device_variants(id),
  variant_label TEXT NOT NULL,
  imei TEXT,
  serial TEXT,
  grade TEXT,
  cost_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  listed_price_minor INTEGER,
  status TEXT NOT NULL DEFAULT 'in_stock', -- in_stock|qc|repair|ready|sold|returned
  branch_id INTEGER REFERENCES branches(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_imei ON inventory(imei) WHERE imei IS NOT NULL;

CREATE TABLE IF NOT EXISTS repairs (
  id INTEGER PRIMARY KEY,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open',     -- open|done|cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS repair_items (
  id INTEGER PRIMARY KEY,
  repair_id INTEGER NOT NULL REFERENCES repairs(id),
  part TEXT NOT NULL,
  cost_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  vendor TEXT
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY,
  invoice_no TEXT UNIQUE,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id),
  sale_price_minor INTEGER NOT NULL,      -- gross price charged to the buyer (VAT-inclusive)
  vat_minor INTEGER NOT NULL DEFAULT 0,   -- VAT contained in sale_price_minor
  vat_rate_bp INTEGER NOT NULL DEFAULT 0, -- rate applied at the time of sale (history, not a live lookup)
  fees_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  buyer_name TEXT,
  buyer_phone TEXT,
  buyer_trn TEXT,                          -- required on a B2B tax invoice
  payment_method TEXT NOT NULL DEFAULT 'cash', -- cash|card|bank_transfer - drives the daily cash position
  channel TEXT,                            -- store|online|dealer
  branch_id INTEGER REFERENCES branches(id),
  sold_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY,
  branch_id INTEGER REFERENCES branches(id),
  category TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  note TEXT,
  spent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- growth + comms ----------
CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL DEFAULT 'flat',       -- flat|pct
  value INTEGER NOT NULL,                  -- minor units or basis points
  min_price_minor INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT, ends_at TEXT,
  max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY,
  referrer_phone TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  referee_order_id INTEGER REFERENCES buyback_orders(id),
  reward_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  order_id INTEGER REFERENCES buyback_orders(id),
  channel TEXT NOT NULL,                   -- sms|email|push|whatsapp
  template TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- audit trail (fraud control, day 1) ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  actor_id INTEGER,
  actor_name TEXT,
  ip TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_logs(entity, entity_id);

-- ---------- pledge / finance module (schema only, legally gated) ----------
CREATE TABLE IF NOT EXISTS pledge_customers (
  id INTEGER PRIMARY KEY, name TEXT, phone TEXT, kyc_status TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pledge_devices (
  id INTEGER PRIMARY KEY, pledge_customer_id INTEGER, imei TEXT, variant_label TEXT, device_photo_ref TEXT
);
CREATE TABLE IF NOT EXISTS pledge_contracts (
  id INTEGER PRIMARY KEY, contract_no TEXT UNIQUE, pledge_customer_id INTEGER, pledge_device_id INTEGER,
  principal_minor INTEGER, currency TEXT, charges_minor INTEGER DEFAULT 0,
  disbursed_at TEXT, due_at TEXT, status TEXT DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS pledge_payments (
  id INTEGER PRIMARY KEY, pledge_contract_id INTEGER, amount_minor INTEGER, currency TEXT,
  paid_at TEXT, mode TEXT, ref TEXT
);
CREATE TABLE IF NOT EXISTS pledge_closures (
  id INTEGER PRIMARY KEY, pledge_contract_id INTEGER, closed_at TEXT, outcome TEXT, note TEXT
);
