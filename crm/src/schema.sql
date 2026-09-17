PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS territories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('sales_rep','sales_manager','customer_service','billing','production','admin')),
  territory_id INTEGER REFERENCES territories(id),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  account_number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  dba TEXT,
  status TEXT NOT NULL DEFAULT 'prospect' CHECK (status IN ('prospect','active','inactive','collections')),
  industry TEXT,
  phone TEXT,
  website TEXT,
  billing_street TEXT,
  billing_city TEXT,
  billing_state TEXT,
  billing_zip TEXT,
  payment_terms TEXT NOT NULL DEFAULT 'net30',
  credit_hold INTEGER NOT NULL DEFAULT 0,
  territory_id INTEGER REFERENCES territories(id),
  owner_user_id INTEGER REFERENCES users(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_accounts_name ON accounts(name);
CREATE INDEX IF NOT EXISTS idx_accounts_phone ON accounts(phone);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  phone TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  is_authorized_signer INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_contacts_account ON contacts(account_id);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  street TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  phone TEXT
);
CREATE INDEX IF NOT EXISTS idx_locations_account ON locations(account_id);

CREATE TABLE IF NOT EXISTS directories (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  market TEXT NOT NULL,
  state TEXT NOT NULL,
  region TEXT NOT NULL,
  distribution_qty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS editions (
  id INTEGER PRIMARY KEY,
  directory_id INTEGER NOT NULL REFERENCES directories(id),
  edition_year INTEGER NOT NULL,
  canvass_start TEXT NOT NULL,
  close_date TEXT NOT NULL,
  publish_date TEXT NOT NULL,
  expires_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','canvass','closed','in_production','published','expired')),
  UNIQUE (directory_id, edition_year)
);

CREATE TABLE IF NOT EXISTS headings (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('listing','in_column','display','digital')),
  size_desc TEXT,
  base_monthly_cents INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS rate_cards (
  id INTEGER PRIMARY KEY,
  edition_id INTEGER NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  monthly_cents INTEGER NOT NULL,
  UNIQUE (edition_id, product_id)
);

CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  edition_id INTEGER NOT NULL REFERENCES editions(id),
  rep_user_id INTEGER REFERENCES users(id),
  stage TEXT NOT NULL DEFAULT 'prospecting' CHECK (stage IN ('prospecting','contacted','proposal','negotiation','closed_won','closed_lost')),
  source TEXT NOT NULL DEFAULT 'new' CHECK (source IN ('renewal','new','referral')),
  est_monthly_cents INTEGER NOT NULL DEFAULT 0,
  expected_close TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_opps_edition ON opportunities(edition_id);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  edition_id INTEGER NOT NULL REFERENCES editions(id),
  rep_user_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','in_production','published','cancelled')),
  order_type TEXT NOT NULL DEFAULT 'new' CHECK (order_type IN ('new','renewal','upsell')),
  billing_frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_frequency IN ('monthly','annual')),
  months INTEGER NOT NULL DEFAULT 12,
  signed_at TEXT,
  signer_contact_id INTEGER REFERENCES contacts(id),
  total_monthly_cents INTEGER NOT NULL DEFAULT 0,
  total_contract_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_account ON orders(account_id);
CREATE INDEX IF NOT EXISTS idx_orders_edition ON orders(edition_id);

CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  heading_id INTEGER REFERENCES headings(id),
  location_id INTEGER REFERENCES locations(id),
  qty INTEGER NOT NULL DEFAULT 1,
  monthly_rate_cents INTEGER NOT NULL,
  listing_text TEXT,
  ad_copy_status TEXT NOT NULL DEFAULT 'pending' CHECK (ad_copy_status IN ('pending','artwork_received','proof_sent','approved')),
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_id);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  order_id INTEGER REFERENCES orders(id),
  edition_id INTEGER REFERENCES editions(id),
  installment_no INTEGER,
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','partial','paid','void','credited'))
);
CREATE INDEX IF NOT EXISTS idx_invoices_account ON invoices(account_id);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(due_date);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  order_line_id INTEGER REFERENCES order_lines(id),
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  invoice_id INTEGER REFERENCES invoices(id),
  payment_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('check','ach','card','cash')),
  reference TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_account ON payments(account_id);

CREATE TABLE IF NOT EXISTS adjustments (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  invoice_id INTEGER REFERENCES invoices(id),
  order_line_id INTEGER REFERENCES order_lines(id),
  adj_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, -- negative = credit to customer, positive = debit
  reason TEXT NOT NULL CHECK (reason IN ('ad_error','goodwill','cancellation','write_off','late_fee','other')),
  approved_by_user_id INTEGER REFERENCES users(id),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id),
  user_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('call','email','meeting','note','proof','collections')),
  subject TEXT NOT NULL,
  body TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activities_account ON activities(account_id);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  assigned_user_id INTEGER REFERENCES users(id),
  title TEXT NOT NULL,
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  related_type TEXT,
  related_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cases (
  id INTEGER PRIMARY KEY,
  case_number TEXT NOT NULL UNIQUE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  order_line_id INTEGER REFERENCES order_lines(id),
  invoice_id INTEGER REFERENCES invoices(id),
  owner_user_id INTEGER REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('ad_error','billing_dispute','cancellation_request','copy_change','other')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  subject TEXT NOT NULL,
  description TEXT,
  resolution TEXT,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);
