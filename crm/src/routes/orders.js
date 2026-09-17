import { Router } from 'express';
import { generateInvoicesForOrder, recomputeOrderTotals, nextNumber } from '../services/billing.js';

const r = Router();

const TRANSITIONS = {
  draft: ['pending_approval', 'cancelled'],
  pending_approval: ['approved', 'draft', 'cancelled'],
  approved: ['in_production', 'cancelled'],
  in_production: ['published', 'cancelled'],
  published: [],
  cancelled: [],
};
export { TRANSITIONS };

r.get('/', (req, res) => {
  const { q: h } = req;
  const f = { status: req.query.status ?? '', edition: req.query.edition ?? '', rep: req.query.rep ?? '' };
  const where = [];
  const params = [];
  if (f.status) { where.push('o.status = ?'); params.push(f.status); }
  if (f.edition) { where.push('o.edition_id = ?'); params.push(Number(f.edition)); }
  if (f.rep) { where.push('o.rep_user_id = ?'); params.push(Number(f.rep)); }
  const orders = h.all(
    `SELECT o.*, a.name AS account_name, e.edition_year, d.name AS directory_name, u.name AS rep_name
       FROM orders o JOIN accounts a ON a.id = o.account_id JOIN editions e ON e.id = o.edition_id
       JOIN directories d ON d.id = e.directory_id LEFT JOIN users u ON u.id = o.rep_user_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.created_at DESC LIMIT 500`, ...params);
  res.render('orders/index', {
    title: 'Orders', orders, filters: f,
    editions: h.all('SELECT e.id, e.edition_year, e.status, d.name FROM editions e JOIN directories d ON d.id = e.directory_id ORDER BY d.name, e.edition_year DESC'),
    reps: h.all("SELECT * FROM users WHERE role IN ('sales_rep','sales_manager') ORDER BY name"),
  });
});

r.get('/new', (req, res) => {
  const { q: h } = req;
  const accountId = req.query.account ? Number(req.query.account) : null;
  res.render('orders/new', {
    title: 'New order',
    account: accountId ? h.get('SELECT * FROM accounts WHERE id = ?', accountId) : null,
    accounts: h.all("SELECT id, name, account_number FROM accounts WHERE status <> 'inactive' ORDER BY name"),
    editions: h.all("SELECT e.id, e.edition_year, e.status, d.name FROM editions e JOIN directories d ON d.id = e.directory_id WHERE e.status IN ('planning','canvass') ORDER BY d.name, e.edition_year"),
    reps: h.all("SELECT * FROM users WHERE role IN ('sales_rep','sales_manager') ORDER BY name"),
    products: h.all('SELECT * FROM products WHERE active = 1 ORDER BY category, base_monthly_cents'),
    headings: h.all('SELECT * FROM headings ORDER BY name'),
  });
});

r.post('/', (req, res) => {
  const { q: h } = req;
  const b = req.body;
  const accountId = Number(b.account_id), editionId = Number(b.edition_id);
  if (!accountId || !editionId) throw new Error('Account and edition are required');
  const account = h.get('SELECT * FROM accounts WHERE id = ?', accountId);
  if (account.credit_hold) throw new Error(`${account.name} is on credit hold; release the hold before creating orders`);
  const id = h.tx(() => {
    const number = nextNumber(req.db, 'orders', 'order_number', 'ORD');
    const res1 = h.run(
      `INSERT INTO orders (order_number, account_id, edition_id, rep_user_id, status, order_type, billing_frequency, months, notes)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      number, accountId, editionId, b.rep_user_id ? Number(b.rep_user_id) : account.owner_user_id, b.order_type || 'new', b.billing_frequency || 'monthly', Number(b.months || 12), b.notes || null);
    const orderId = Number(res1.lastInsertRowid);
    const productIds = [].concat(b.product_id ?? []);
    const headingIds = [].concat(b.heading_id ?? []);
    const location = h.get('SELECT id FROM locations WHERE account_id = ? ORDER BY id LIMIT 1', accountId);
    productIds.forEach((pid, i) => {
      if (!pid) return;
      const rate = h.get('SELECT monthly_cents FROM rate_cards WHERE edition_id = ? AND product_id = ?', editionId, Number(pid))
        ?? h.get('SELECT base_monthly_cents AS monthly_cents FROM products WHERE id = ?', Number(pid));
      h.run('INSERT INTO order_lines (order_id, product_id, heading_id, location_id, qty, monthly_rate_cents, listing_text) VALUES (?, ?, ?, ?, 1, ?, ?)',
        orderId, Number(pid), headingIds[i] ? Number(headingIds[i]) : null, location?.id ?? null, rate.monthly_cents, account.name);
    });
    recomputeOrderTotals(req.db, orderId);
    return orderId;
  });
  res.redirect(`/orders/${id}?flash=Order+created`);
});

export function loadOrder(h, id) {
  const order = h.get(
    `SELECT o.*, a.name AS account_name, a.account_number, a.payment_terms, e.edition_year, e.publish_date, e.close_date, e.status AS edition_status,
            d.name AS directory_name, u.name AS rep_name, c.first_name AS signer_first, c.last_name AS signer_last
       FROM orders o JOIN accounts a ON a.id = o.account_id JOIN editions e ON e.id = o.edition_id JOIN directories d ON d.id = e.directory_id
       LEFT JOIN users u ON u.id = o.rep_user_id LEFT JOIN contacts c ON c.id = o.signer_contact_id WHERE o.id = ?`, id);
  if (!order) return null;
  return {
    order,
    lines: h.all(
      `SELECT ol.*, p.code, p.name AS product_name, p.category, hd.name AS heading_name, l.name AS location_name, l.phone AS location_phone
         FROM order_lines ol JOIN products p ON p.id = ol.product_id LEFT JOIN headings hd ON hd.id = ol.heading_id LEFT JOIN locations l ON l.id = ol.location_id
        WHERE ol.order_id = ? ORDER BY ol.id`, id),
    invoices: h.all('SELECT * FROM invoices WHERE order_id = ? ORDER BY installment_no', id),
  };
}

r.get('/:id', (req, res) => {
  const data = loadOrder(req.q, req.params.id);
  if (!data) return res.status(404).render('error', { title: 'Not found', message: 'Order not found' });
  res.render('orders/show', { title: data.order.order_number, ...data, transitions: TRANSITIONS[data.order.status] });
});

r.post('/:id/status', (req, res) => {
  const { q: h } = req;
  const order = h.get('SELECT * FROM orders WHERE id = ?', req.params.id);
  const next = req.body.status;
  if (!TRANSITIONS[order.status].includes(next)) throw new Error(`Cannot move order from ${order.status} to ${next}`);
  if (next === 'pending_approval' && !h.get('SELECT 1 FROM order_lines WHERE order_id = ?', order.id)) throw new Error('Add at least one line before submitting');
  h.run('UPDATE orders SET status = ?, signed_at = COALESCE(signed_at, CASE WHEN ? = ? THEN ? END) WHERE id = ?', next, next, 'pending_approval', req.today, order.id);
  if (next === 'cancelled') h.run("UPDATE invoices SET status = 'void' WHERE order_id = ? AND paid_cents = 0", order.id);
  res.redirect(`/orders/${order.id}?flash=Order+${next.replace(/_/g, '+')}`);
});

r.post('/:id/lines/:lineId/copy', (req, res) => {
  const { q: h } = req;
  h.run('UPDATE order_lines SET ad_copy_status = ? WHERE id = ? AND order_id = ?', req.body.ad_copy_status, req.params.lineId, req.params.id);
  res.redirect(`/orders/${req.params.id}?flash=Copy+status+updated`);
});

r.post('/:id/invoices', (req, res) => {
  const created = generateInvoicesForOrder(req.db, Number(req.params.id));
  res.redirect(`/orders/${req.params.id}?flash=${created.length}+invoices+scheduled`);
});

export default r;
