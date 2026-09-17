import { Router } from 'express';

const r = Router();

r.get('/directories', (req, res) => {
  const { q: h } = req;
  const directories = h.all(
    `SELECT d.*,
            (SELECT COUNT(*) FROM editions e WHERE e.directory_id = d.id) AS edition_count,
            (SELECT e.edition_year FROM editions e WHERE e.directory_id = d.id AND e.status = 'published' ORDER BY edition_year DESC LIMIT 1) AS current_year,
            (SELECT COUNT(*) FROM orders o JOIN editions e ON e.id = o.edition_id WHERE e.directory_id = d.id AND e.status = 'published' AND o.status = 'published') AS advertisers,
            (SELECT COALESCE(SUM(o.total_monthly_cents),0) FROM orders o JOIN editions e ON e.id = o.edition_id WHERE e.directory_id = d.id AND e.status = 'published' AND o.status = 'published') AS monthly_cents
       FROM directories d ORDER BY d.name`,
  );
  res.render('directories/index', { title: 'Directories', directories });
});

r.get('/directories/:id', (req, res) => {
  const { q: h } = req;
  const directory = h.get('SELECT * FROM directories WHERE id = ?', req.params.id);
  if (!directory) return res.status(404).render('error', { title: 'Not found', message: 'Directory not found' });
  const editions = h.all(
    `SELECT e.*,
            (SELECT COUNT(*) FROM orders o WHERE o.edition_id = e.id AND o.status <> 'cancelled') AS order_count,
            (SELECT COALESCE(SUM(o.total_monthly_cents),0) FROM orders o WHERE o.edition_id = e.id AND o.status IN ('approved','in_production','published')) AS monthly_cents
       FROM editions e WHERE e.directory_id = ? ORDER BY edition_year DESC`, req.params.id);
  res.render('directories/show', { title: directory.name, directory, editions });
});

r.get('/editions/:id', (req, res) => {
  const { q: h } = req;
  const edition = h.get('SELECT e.*, d.name AS directory_name, d.code, d.market FROM editions e JOIN directories d ON d.id = e.directory_id WHERE e.id = ?', req.params.id);
  if (!edition) return res.status(404).render('error', { title: 'Not found', message: 'Edition not found' });
  const orders = h.all(
    `SELECT o.*, a.name AS account_name, u.name AS rep_name,
            (SELECT COUNT(*) FROM order_lines ol WHERE ol.order_id = o.id) AS line_count,
            (SELECT COUNT(*) FROM order_lines ol WHERE ol.order_id = o.id AND ol.ad_copy_status <> 'approved') AS lines_pending
       FROM orders o JOIN accounts a ON a.id = o.account_id LEFT JOIN users u ON u.id = o.rep_user_id
      WHERE o.edition_id = ? ORDER BY o.status, a.name`, req.params.id);
  const rateCard = h.all('SELECT rc.*, p.code, p.name, p.category, p.size_desc, p.base_monthly_cents FROM rate_cards rc JOIN products p ON p.id = rc.product_id WHERE rc.edition_id = ? ORDER BY p.category, rc.monthly_cents', req.params.id);
  const byStatus = h.all('SELECT status, COUNT(*) c, COALESCE(SUM(total_monthly_cents),0) m FROM orders WHERE edition_id = ? GROUP BY status', req.params.id);
  const opps = h.all('SELECT stage, COUNT(*) c, COALESCE(SUM(est_monthly_cents),0) m FROM opportunities WHERE edition_id = ? GROUP BY stage', req.params.id);
  res.render('directories/edition', { title: `${edition.directory_name} ${edition.edition_year}`, edition, orders, rateCard, byStatus, opps });
});

r.post('/editions/:id/status', (req, res) => {
  const { q: h } = req;
  h.run('UPDATE editions SET status = ? WHERE id = ?', req.body.status, req.params.id);
  res.redirect(`/editions/${req.params.id}?flash=Edition+status+updated`);
});

r.get('/products', (req, res) => {
  const { q: h } = req;
  res.render('directories/products', {
    title: 'Products & headings',
    products: h.all('SELECT * FROM products ORDER BY category, base_monthly_cents'),
    headings: h.all('SELECT h.*, (SELECT COUNT(*) FROM order_lines ol WHERE ol.heading_id = h.id) AS line_count FROM headings h ORDER BY name'),
  });
});

export default r;
