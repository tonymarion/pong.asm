import { openDb, q } from '../src/db.js';

/** Minimal fixture: one account with a rate-carded edition and an approved 2-line order. */
export function fixture({ terms = 'net30', frequency = 'monthly', status = 'approved' } = {}) {
  const db = openDb(':memory:');
  const h = q(db);
  h.run("INSERT INTO territories (id, name, region) VALUES (1, 'T', 'R')");
  h.run("INSERT INTO users (id, name, email, role, territory_id) VALUES (1, 'Rep', 'rep@x', 'sales_rep', 1)");
  h.run("INSERT INTO accounts (id, account_number, name, status, payment_terms, territory_id, owner_user_id) VALUES (1, 'A-1', 'Acme Plumbing', 'active', ?, 1, 1)", terms);
  h.run("INSERT INTO locations (id, account_id, name, phone) VALUES (1, 1, 'Main', '555-0100')");
  h.run("INSERT INTO directories (id, code, name, market, state, region) VALUES (1, 'SPR', 'Springfield', 'Springfield', 'IL', 'Midwest')");
  h.run("INSERT INTO editions (id, directory_id, edition_year, canvass_start, close_date, publish_date, expires_date, status) VALUES (1, 1, 2026, '2025-09-01', '2026-01-01', '2026-03-15', '2027-03-14', 'published')");
  h.run("INSERT INTO headings (id, code, name) VALUES (1, '1000', 'Plumbing Contractors')");
  h.run("INSERT INTO products (id, code, name, category, base_monthly_cents) VALUES (1, 'DSP-QP', 'Quarter Page', 'display', 42000)");
  h.run("INSERT INTO products (id, code, name, category, base_monthly_cents) VALUES (2, 'DIG-IYP', 'Online Listing', 'digital', 3900)");
  h.run('INSERT INTO rate_cards (edition_id, product_id, monthly_cents) VALUES (1, 1, 40000), (1, 2, 3500)');
  h.run("INSERT INTO orders (id, order_number, account_id, edition_id, rep_user_id, status, billing_frequency, months) VALUES (1, 'ORD-1', 1, 1, 1, ?, ?, 12)", status, frequency);
  h.run('INSERT INTO order_lines (order_id, product_id, heading_id, location_id, qty, monthly_rate_cents) VALUES (1, 1, 1, 1, 1, 40000), (1, 2, 1, 1, 1, 3500)');
  h.run('UPDATE orders SET total_monthly_cents = 43500, total_contract_cents = 522000 WHERE id = 1');
  return { db, h };
}
