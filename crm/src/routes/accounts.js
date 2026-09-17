import { Router } from 'express';
import { openInvoices } from '../services/billing.js';

const r = Router();

export function accountListQuery(h, { search = '', status = '', rep = '', territory = '' }) {
  const where = [];
  const params = [];
  if (search) {
    where.push('(a.name LIKE ? OR a.account_number LIKE ? OR a.phone LIKE ? OR a.billing_city LIKE ? OR a.industry LIKE ?)');
    for (let i = 0; i < 5; i++) params.push(`%${search}%`);
  }
  if (status) { where.push('a.status = ?'); params.push(status); }
  if (rep) { where.push('a.owner_user_id = ?'); params.push(Number(rep)); }
  if (territory) { where.push('a.territory_id = ?'); params.push(Number(territory)); }
  return h.all(
    `SELECT a.*, u.name AS rep_name, t.name AS territory_name,
            (SELECT COALESCE(SUM(total_cents - paid_cents),0) FROM invoices i WHERE i.account_id = a.id AND i.status NOT IN ('paid','void') AND i.issue_date <= date('now')) AS balance_cents,
            (SELECT COUNT(*) FROM orders o WHERE o.account_id = a.id AND o.status NOT IN ('cancelled')) AS order_count
       FROM accounts a LEFT JOIN users u ON u.id = a.owner_user_id LEFT JOIN territories t ON t.id = a.territory_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY a.name LIMIT 500`,
    ...params,
  );
}

r.get('/', (req, res) => {
  const { q: h } = req;
  const filters = { search: req.query.q ?? '', status: req.query.status ?? '', rep: req.query.rep ?? '', territory: req.query.territory ?? '' };
  const accounts = accountListQuery(h, filters);
  res.render('accounts/index', {
    title: 'Accounts', accounts, filters,
    reps: h.all("SELECT * FROM users WHERE role IN ('sales_rep','sales_manager') ORDER BY name"),
    territories: h.all('SELECT * FROM territories ORDER BY name'),
  });
});

r.get('/new', (req, res) => {
  const { q: h } = req;
  res.render('accounts/new', {
    title: 'New account',
    reps: h.all("SELECT * FROM users WHERE role IN ('sales_rep','sales_manager') ORDER BY name"),
    territories: h.all('SELECT * FROM territories ORDER BY name'),
    headings: h.all('SELECT * FROM headings ORDER BY name'),
  });
});

r.post('/', (req, res) => {
  const { q: h } = req;
  const b = req.body;
  if (!b.name) throw new Error('Account name is required');
  const n = h.get('SELECT COALESCE(MAX(id),0) + 1 AS n FROM accounts').n;
  const result = h.run(
    `INSERT INTO accounts (account_number, name, dba, status, industry, phone, website, billing_street, billing_city, billing_state, billing_zip, payment_terms, territory_id, owner_user_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    `A-${String(10000 + n * 13).padStart(6, '0')}`, b.name, b.dba || null, b.status || 'prospect', b.industry || null, b.phone || null, b.website || null,
    b.billing_street || null, b.billing_city || null, b.billing_state || null, b.billing_zip || null, b.payment_terms || 'net30',
    b.territory_id ? Number(b.territory_id) : null, b.owner_user_id ? Number(b.owner_user_id) : null, b.notes || null,
  );
  const id = Number(result.lastInsertRowid);
  h.run('INSERT INTO locations (account_id, name, street, city, state, zip, phone) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, 'Main', b.billing_street || null, b.billing_city || null, b.billing_state || null, b.billing_zip || null, b.phone || null);
  if (b.contact_first_name) {
    h.run('INSERT INTO contacts (account_id, first_name, last_name, title, email, phone, is_primary, is_authorized_signer) VALUES (?, ?, ?, ?, ?, ?, 1, 1)',
      id, b.contact_first_name, b.contact_last_name || '', b.contact_title || null, b.contact_email || null, b.contact_phone || null);
  }
  res.redirect(`/accounts/${id}?flash=Account+created`);
});

export function loadAccount(req, id) {
  const { q: h, today } = req;
  const account = h.get(
    `SELECT a.*, u.name AS rep_name, t.name AS territory_name FROM accounts a
       LEFT JOIN users u ON u.id = a.owner_user_id LEFT JOIN territories t ON t.id = a.territory_id WHERE a.id = ?`, id);
  if (!account) return null;
  return {
    account,
    contacts: h.all('SELECT * FROM contacts WHERE account_id = ? ORDER BY is_primary DESC, last_name', id),
    locations: h.all('SELECT * FROM locations WHERE account_id = ? ORDER BY id', id),
    orders: h.all(
      `SELECT o.*, e.edition_year, d.name AS directory_name, u.name AS rep_name FROM orders o
         JOIN editions e ON e.id = o.edition_id JOIN directories d ON d.id = e.directory_id LEFT JOIN users u ON u.id = o.rep_user_id
        WHERE o.account_id = ? ORDER BY e.edition_year DESC, o.id DESC`, id),
    openInvoices: openInvoices(req.db, today, Number(id)),
    invoices: h.all('SELECT * FROM invoices WHERE account_id = ? ORDER BY issue_date DESC LIMIT 50', id),
    payments: h.all('SELECT p.*, i.invoice_number FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.account_id = ? ORDER BY payment_date DESC LIMIT 20', id),
    adjustments: h.all('SELECT ad.*, i.invoice_number, u.name AS approver FROM adjustments ad LEFT JOIN invoices i ON i.id = ad.invoice_id LEFT JOIN users u ON u.id = ad.approved_by_user_id WHERE ad.account_id = ? ORDER BY adj_date DESC', id),
    activities: h.all('SELECT ac.*, u.name AS user_name, c.first_name, c.last_name FROM activities ac LEFT JOIN users u ON u.id = ac.user_id LEFT JOIN contacts c ON c.id = ac.contact_id WHERE ac.account_id = ? ORDER BY occurred_at DESC LIMIT 30', id),
    tasks: h.all('SELECT t.*, u.name AS user_name FROM tasks t LEFT JOIN users u ON u.id = t.assigned_user_id WHERE t.account_id = ? ORDER BY status, due_date', id),
    cases: h.all('SELECT * FROM cases WHERE account_id = ? ORDER BY opened_at DESC', id),
    opportunities: h.all('SELECT op.*, e.edition_year, d.name AS directory_name FROM opportunities op JOIN editions e ON e.id = op.edition_id JOIN directories d ON d.id = e.directory_id WHERE op.account_id = ? ORDER BY op.created_at DESC', id),
  };
}

r.get('/:id', (req, res) => {
  const data = loadAccount(req, req.params.id);
  if (!data) return res.status(404).render('error', { title: 'Not found', message: 'Account not found' });
  const { q: h } = req;
  const balance = data.openInvoices.reduce((s, i) => s + i.balance_cents, 0);
  res.render('accounts/show', {
    title: data.account.name, ...data, balance,
    users: h.all('SELECT * FROM users WHERE active = 1 ORDER BY name'),
  });
});

r.post('/:id/activities', (req, res) => {
  const { q: h } = req;
  const b = req.body;
  h.run('INSERT INTO activities (account_id, contact_id, user_id, type, subject, body, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    Number(req.params.id), b.contact_id ? Number(b.contact_id) : null, b.user_id ? Number(b.user_id) : null, b.type, b.subject, b.body || null,
    (b.occurred_at || req.today) + ' 12:00:00');
  res.redirect(`/accounts/${req.params.id}?flash=Activity+logged#activities`);
});

r.post('/:id/tasks', (req, res) => {
  const { q: h } = req;
  const b = req.body;
  h.run('INSERT INTO tasks (account_id, assigned_user_id, title, due_date, priority) VALUES (?, ?, ?, ?, ?)',
    Number(req.params.id), b.assigned_user_id ? Number(b.assigned_user_id) : null, b.title, b.due_date || null, b.priority || 'normal');
  res.redirect(`/accounts/${req.params.id}?flash=Task+added#tasks`);
});

r.post('/:id/contacts', (req, res) => {
  const { q: h } = req;
  const b = req.body;
  h.run('INSERT INTO contacts (account_id, first_name, last_name, title, email, phone, is_primary, is_authorized_signer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    Number(req.params.id), b.first_name, b.last_name, b.title || null, b.email || null, b.phone || null, b.is_primary ? 1 : 0, b.is_authorized_signer ? 1 : 0);
  res.redirect(`/accounts/${req.params.id}?flash=Contact+added#contacts`);
});

r.post('/:id/status', (req, res) => {
  const { q: h } = req;
  const status = req.body.status;
  h.run('UPDATE accounts SET status = ?, credit_hold = ? WHERE id = ?', status, req.body.credit_hold ? 1 : 0, Number(req.params.id));
  res.redirect(`/accounts/${req.params.id}?flash=Status+updated`);
});

export default r;
