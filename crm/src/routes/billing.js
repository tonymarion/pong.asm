import { Router } from 'express';
import { applyPayment, applyAdjustment, openInvoices } from '../services/billing.js';

const r = Router();

r.get('/invoices', (req, res) => {
  const { q: h, today } = req;
  const f = { status: req.query.status ?? '', overdue: req.query.overdue ?? '', q: req.query.q ?? '' };
  const where = ['i.issue_date <= ?'];
  const params = [today];
  if (f.status) { where.push('i.status = ?'); params.push(f.status); }
  if (f.overdue) { where.push("i.status IN ('open','partial','credited') AND i.due_date < ? AND i.total_cents > i.paid_cents"); params.push(today); }
  if (f.q) { where.push('(a.name LIKE ? OR i.invoice_number LIKE ?)'); params.push(`%${f.q}%`, `%${f.q}%`); }
  const invoices = h.all(
    `SELECT i.*, a.name AS account_name, (i.total_cents - i.paid_cents) AS balance_cents
       FROM invoices i JOIN accounts a ON a.id = i.account_id WHERE ${where.join(' AND ')} ORDER BY i.due_date DESC LIMIT 500`, ...params);
  res.render('billing/invoices', { title: 'Invoices', invoices, filters: f });
});

r.get('/invoices/:id', (req, res) => {
  const { q: h, today } = req;
  const invoice = h.get(
    `SELECT i.*, a.name AS account_name, a.account_number, a.payment_terms, o.order_number, e.edition_year, d.name AS directory_name
       FROM invoices i JOIN accounts a ON a.id = i.account_id LEFT JOIN orders o ON o.id = i.order_id
       LEFT JOIN editions e ON e.id = i.edition_id LEFT JOIN directories d ON d.id = e.directory_id WHERE i.id = ?`, req.params.id);
  if (!invoice) return res.status(404).render('error', { title: 'Not found', message: 'Invoice not found' });
  res.render('billing/invoice', {
    title: invoice.invoice_number, invoice,
    lines: h.all('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY id', invoice.id),
    payments: h.all('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date', invoice.id),
    adjustments: h.all('SELECT ad.*, u.name AS approver FROM adjustments ad LEFT JOIN users u ON u.id = ad.approved_by_user_id WHERE ad.invoice_id = ? ORDER BY adj_date', invoice.id),
    users: h.all("SELECT * FROM users WHERE role IN ('billing','sales_manager','admin') ORDER BY name"),
    daysPastDue: Math.round((new Date(today) - new Date(invoice.due_date)) / 86400000),
  });
});

r.post('/invoices/:id/payments', (req, res) => {
  const { q: h } = req;
  const inv = h.get('SELECT * FROM invoices WHERE id = ?', req.params.id);
  const amountCents = Math.round(Number(req.body.amount) * 100);
  applyPayment(req.db, { accountId: inv.account_id, invoiceId: inv.id, amountCents, method: req.body.method, paymentDate: req.body.payment_date || req.today, reference: req.body.reference || null, notes: req.body.notes || null });
  res.redirect(`/invoices/${inv.id}?flash=Payment+applied`);
});

r.post('/invoices/:id/adjustments', (req, res) => {
  const { q: h } = req;
  const inv = h.get('SELECT * FROM invoices WHERE id = ?', req.params.id);
  const amountCents = Math.round(Number(req.body.amount) * 100) * (req.body.direction === 'debit' ? 1 : -1);
  applyAdjustment(req.db, { accountId: inv.account_id, invoiceId: inv.id, amountCents, reason: req.body.reason, adjDate: req.body.adj_date || req.today, approvedByUserId: req.body.approved_by_user_id ? Number(req.body.approved_by_user_id) : null, notes: req.body.notes || null });
  res.redirect(`/invoices/${inv.id}?flash=Adjustment+recorded`);
});

r.post('/invoices/:id/void', (req, res) => {
  const { q: h } = req;
  const inv = h.get('SELECT * FROM invoices WHERE id = ?', req.params.id);
  if (inv.paid_cents > 0) throw new Error('Cannot void an invoice with payments applied; issue a credit instead');
  h.run("UPDATE invoices SET status = 'void' WHERE id = ?", inv.id);
  res.redirect(`/invoices/${inv.id}?flash=Invoice+voided`);
});

r.get('/payments', (req, res) => {
  const { q: h } = req;
  const payments = h.all(
    `SELECT p.*, a.name AS account_name, i.invoice_number FROM payments p JOIN accounts a ON a.id = p.account_id LEFT JOIN invoices i ON i.id = p.invoice_id
      ORDER BY p.payment_date DESC LIMIT 300`);
  const byMonth = h.all("SELECT substr(payment_date,1,7) AS month, COUNT(*) c, SUM(amount_cents) m FROM payments GROUP BY month ORDER BY month DESC LIMIT 12");
  res.render('billing/payments', { title: 'Payments', payments, byMonth });
});

r.get('/collections', (req, res) => {
  const { today } = req;
  const overdue = openInvoices(req.db, today).filter((i) => i.days_past_due > 30);
  const byAccount = new Map();
  for (const i of overdue) {
    const row = byAccount.get(i.account_id) ?? { account_id: i.account_id, account_name: i.account_name, account_number: i.account_number, count: 0, balance: 0, oldest: 0 };
    row.count++; row.balance += i.balance_cents; row.oldest = Math.max(row.oldest, i.days_past_due);
    byAccount.set(i.account_id, row);
  }
  const rows = [...byAccount.values()].map((r) => ({ ...r, stage: r.oldest > 120 ? 'Collections / write-off review' : r.oldest > 90 ? 'Credit hold' : r.oldest > 60 ? 'Dunning 2' : 'Dunning 1' })).sort((a, b) => b.oldest - a.oldest);
  res.render('billing/collections', { title: 'Collections queue', rows });
});

export default r;
