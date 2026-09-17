import { Router } from 'express';
import { agingReport, AGING_BUCKETS } from '../services/billing.js';

const r = Router();

r.get('/', (req, res) => res.render('reports/index', { title: 'Reports' }));

r.get('/aging', (req, res) => {
  const asOf = req.query.as_of || req.today;
  res.render('reports/aging', { title: 'AR aging', asOf, ...agingReport(req.db, asOf), buckets: AGING_BUCKETS });
});

/** Renewal rate: accounts with an order in the prior edition vs. those with one in the next edition of the same directory. */
export function renewalReport(h) {
  return h.all(
    `SELECT d.name AS directory_name, n.id AS edition_id, n.edition_year, n.status, n.close_date,
            COUNT(DISTINCT po.account_id) AS eligible,
            COUNT(DISTINCT CASE WHEN no.id IS NOT NULL THEN po.account_id END) AS renewed,
            COALESCE(SUM(CASE WHEN no.id IS NOT NULL THEN no.total_monthly_cents END),0) AS renewed_monthly,
            COALESCE(SUM(po.total_monthly_cents),0) AS prior_monthly
       FROM editions n JOIN directories d ON d.id = n.directory_id
       JOIN editions p ON p.directory_id = n.directory_id AND p.edition_year = n.edition_year - 1
       JOIN orders po ON po.edition_id = p.id AND po.status IN ('published','in_production','approved')
       LEFT JOIN orders no ON no.edition_id = n.id AND no.account_id = po.account_id AND no.status <> 'cancelled'
      WHERE n.status <> 'expired'
      GROUP BY n.id ORDER BY n.close_date`);
}

r.get('/renewals', (req, res) => {
  const { q: h } = req;
  const rows = renewalReport(h);
  const editionId = req.query.edition ? Number(req.query.edition) : null;
  const notRenewed = editionId ? h.all(
    `SELECT a.id, a.name, a.phone, u.name AS rep_name, po.total_monthly_cents, po.order_number,
            (SELECT stage FROM opportunities op WHERE op.account_id = a.id AND op.edition_id = n.id ORDER BY op.id DESC LIMIT 1) AS opp_stage
       FROM editions n JOIN editions p ON p.directory_id = n.directory_id AND p.edition_year = n.edition_year - 1
       JOIN orders po ON po.edition_id = p.id AND po.status IN ('published','in_production','approved')
       JOIN accounts a ON a.id = po.account_id LEFT JOIN users u ON u.id = a.owner_user_id
      WHERE n.id = ? AND NOT EXISTS (SELECT 1 FROM orders no WHERE no.edition_id = n.id AND no.account_id = a.id AND no.status <> 'cancelled')
      ORDER BY po.total_monthly_cents DESC`, editionId) : [];
  res.render('reports/renewals', { title: 'Renewals', rows, editionId, notRenewed });
});

r.get('/copy-readiness', (req, res) => {
  const { q: h } = req;
  const editions = h.all(
    `SELECT e.id, e.edition_year, e.close_date, e.status, d.name AS directory_name,
            SUM(CASE WHEN ol.ad_copy_status = 'approved' THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN ol.ad_copy_status = 'proof_sent' THEN 1 ELSE 0 END) AS proof_sent,
            SUM(CASE WHEN ol.ad_copy_status = 'artwork_received' THEN 1 ELSE 0 END) AS artwork_received,
            SUM(CASE WHEN ol.ad_copy_status = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM editions e JOIN directories d ON d.id = e.directory_id JOIN orders o ON o.edition_id = e.id AND o.status IN ('approved','in_production','pending_approval')
       JOIN order_lines ol ON ol.order_id = o.id
      WHERE e.status IN ('canvass','closed','in_production') GROUP BY e.id ORDER BY e.close_date`);
  const lines = h.all(
    `SELECT ol.id, ol.ad_copy_status, o.id AS order_id, o.order_number, a.name AS account_name, p.name AS product_name, hd.name AS heading_name, e.close_date, d.name AS directory_name, e.edition_year
       FROM order_lines ol JOIN orders o ON o.id = ol.order_id JOIN accounts a ON a.id = o.account_id JOIN products p ON p.id = ol.product_id
       LEFT JOIN headings hd ON hd.id = ol.heading_id JOIN editions e ON e.id = o.edition_id JOIN directories d ON d.id = e.directory_id
      WHERE e.status IN ('canvass','closed','in_production') AND o.status IN ('approved','in_production','pending_approval') AND ol.ad_copy_status <> 'approved'
      ORDER BY e.close_date, a.name`);
  res.render('reports/copy_readiness', { title: 'Copy readiness', editions, lines });
});

r.get('/revenue', (req, res) => {
  const { q: h } = req;
  const byDirectory = h.all(
    `SELECT d.name AS directory_name, e.edition_year, e.status, COUNT(o.id) AS orders, COALESCE(SUM(o.total_monthly_cents),0) AS monthly, COALESCE(SUM(o.total_contract_cents),0) AS contract
       FROM editions e JOIN directories d ON d.id = e.directory_id LEFT JOIN orders o ON o.edition_id = e.id AND o.status IN ('approved','in_production','published')
      GROUP BY e.id ORDER BY d.name, e.edition_year DESC`);
  const byProduct = h.all(
    `SELECT p.category, p.name, COUNT(ol.id) AS lines, COALESCE(SUM(ol.qty * ol.monthly_rate_cents),0) AS monthly
       FROM products p LEFT JOIN order_lines ol ON ol.product_id = p.id LEFT JOIN orders o ON o.id = ol.order_id AND o.status = 'published'
       LEFT JOIN editions e ON e.id = o.edition_id AND e.status = 'published'
      WHERE e.id IS NOT NULL GROUP BY p.id ORDER BY monthly DESC`);
  const byRep = h.all(
    `SELECT u.name AS rep_name, COUNT(o.id) AS orders, COALESCE(SUM(o.total_monthly_cents),0) AS monthly,
            SUM(CASE WHEN o.order_type = 'new' THEN 1 ELSE 0 END) AS new_orders, SUM(CASE WHEN o.order_type <> 'new' THEN 1 ELSE 0 END) AS renewal_orders
       FROM users u LEFT JOIN orders o ON o.rep_user_id = u.id AND o.status IN ('approved','in_production','published')
      WHERE u.role = 'sales_rep' GROUP BY u.id ORDER BY monthly DESC`);
  const adjustments = h.all('SELECT reason, COUNT(*) c, SUM(amount_cents) total FROM adjustments GROUP BY reason ORDER BY total');
  res.render('reports/revenue', { title: 'Revenue', byDirectory, byProduct, byRep, adjustments });
});

export default r;
