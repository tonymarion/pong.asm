/** JSON API. Mirrors the pages so other tools (or a future SPA) can use the same data. */
import { Router } from 'express';
import { accountListQuery, loadAccount } from './accounts.js';
import { loadOrder, TRANSITIONS } from './orders.js';
import { renewalReport } from './reports.js';
import { agingReport, applyPayment, applyAdjustment, generateInvoicesForOrder, openInvoices } from '../services/billing.js';

const r = Router();
const notFound = (res, what) => res.status(404).json({ error: `${what} not found` });

r.get('/accounts', (req, res) => res.json(accountListQuery(req.q, { search: req.query.q ?? '', status: req.query.status ?? '', rep: req.query.rep ?? '', territory: req.query.territory ?? '' })));
r.get('/accounts/:id', (req, res) => { const d = loadAccount(req, req.params.id); return d ? res.json(d) : notFound(res, 'account'); });
r.get('/accounts/:id/balance', (req, res) => {
  const inv = openInvoices(req.db, req.query.as_of || req.today, Number(req.params.id));
  res.json({ account_id: Number(req.params.id), balance_cents: inv.reduce((s, i) => s + i.balance_cents, 0), invoices: inv });
});

r.get('/directories', (req, res) => res.json(req.q.all('SELECT * FROM directories ORDER BY name')));
r.get('/editions', (req, res) => res.json(req.q.all('SELECT e.*, d.name AS directory_name, d.code FROM editions e JOIN directories d ON d.id = e.directory_id ORDER BY e.close_date')));
r.get('/editions/:id/rate-card', (req, res) => res.json(req.q.all('SELECT rc.product_id, p.code, p.name, p.category, rc.monthly_cents FROM rate_cards rc JOIN products p ON p.id = rc.product_id WHERE rc.edition_id = ? ORDER BY p.category', req.params.id)));
r.get('/headings', (req, res) => res.json(req.q.all('SELECT * FROM headings ORDER BY name')));
r.get('/products', (req, res) => res.json(req.q.all('SELECT * FROM products ORDER BY category, base_monthly_cents')));
r.get('/users', (req, res) => res.json(req.q.all('SELECT id, name, email, role, territory_id FROM users ORDER BY name')));

r.get('/orders', (req, res) => {
  const where = [], params = [];
  if (req.query.status) { where.push('o.status = ?'); params.push(req.query.status); }
  if (req.query.edition) { where.push('o.edition_id = ?'); params.push(Number(req.query.edition)); }
  if (req.query.account) { where.push('o.account_id = ?'); params.push(Number(req.query.account)); }
  res.json(req.q.all(`SELECT o.*, a.name AS account_name FROM orders o JOIN accounts a ON a.id = o.account_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 1000`, ...params));
});
r.get('/orders/:id', (req, res) => { const d = loadOrder(req.q, req.params.id); return d ? res.json({ ...d, transitions: TRANSITIONS[d.order.status] }) : notFound(res, 'order'); });
r.post('/orders/:id/invoices', (req, res) => res.status(201).json(generateInvoicesForOrder(req.db, Number(req.params.id))));

r.get('/invoices', (req, res) => {
  const where = ['1=1'], params = [];
  if (req.query.status) { where.push('status = ?'); params.push(req.query.status); }
  if (req.query.account) { where.push('account_id = ?'); params.push(Number(req.query.account)); }
  res.json(req.q.all(`SELECT * FROM invoices WHERE ${where.join(' AND ')} ORDER BY due_date DESC LIMIT 1000`, ...params));
});
r.get('/invoices/:id', (req, res) => {
  const invoice = req.q.get('SELECT * FROM invoices WHERE id = ?', req.params.id);
  if (!invoice) return notFound(res, 'invoice');
  res.json({ invoice, lines: req.q.all('SELECT * FROM invoice_lines WHERE invoice_id = ?', invoice.id), payments: req.q.all('SELECT * FROM payments WHERE invoice_id = ?', invoice.id) });
});
r.post('/invoices/:id/payments', (req, res) => {
  const inv = req.q.get('SELECT * FROM invoices WHERE id = ?', req.params.id);
  if (!inv) return notFound(res, 'invoice');
  const { amount_cents, method, payment_date, reference, notes } = req.body;
  res.status(201).json(applyPayment(req.db, { accountId: inv.account_id, invoiceId: inv.id, amountCents: Number(amount_cents), method, paymentDate: payment_date || req.today, reference, notes }));
});
r.post('/invoices/:id/adjustments', (req, res) => {
  const inv = req.q.get('SELECT * FROM invoices WHERE id = ?', req.params.id);
  if (!inv) return notFound(res, 'invoice');
  const { amount_cents, reason, adj_date, approved_by_user_id, notes } = req.body;
  res.status(201).json(applyAdjustment(req.db, { accountId: inv.account_id, invoiceId: inv.id, amountCents: Number(amount_cents), reason, adjDate: adj_date || req.today, approvedByUserId: approved_by_user_id ?? null, notes }));
});

r.get('/opportunities', (req, res) => res.json(req.q.all('SELECT * FROM opportunities ORDER BY expected_close')));
r.get('/cases', (req, res) => res.json(req.q.all('SELECT * FROM cases ORDER BY opened_at DESC')));
r.get('/tasks', (req, res) => res.json(req.q.all('SELECT * FROM tasks ORDER BY due_date')));

r.get('/reports/aging', (req, res) => res.json(agingReport(req.db, req.query.as_of || req.today)));
r.get('/reports/renewals', (req, res) => res.json(renewalReport(req.q)));

export default r;
