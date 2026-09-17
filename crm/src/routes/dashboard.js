import { Router } from 'express';
import { agingReport } from '../services/billing.js';
import { addDays } from '../lib/format.js';

const r = Router();

r.get('/', (req, res) => {
  const { q: h, today } = req;
  const kpis = {
    activeAccounts: h.get("SELECT COUNT(*) c FROM accounts WHERE status = 'active'").c,
    prospects: h.get("SELECT COUNT(*) c FROM accounts WHERE status = 'prospect'").c,
    openOrders: h.get("SELECT COUNT(*) c FROM orders WHERE status IN ('draft','pending_approval','approved','in_production')").c,
    monthlyBilling: h.get("SELECT COALESCE(SUM(total_monthly_cents),0) m FROM orders o JOIN editions e ON e.id = o.edition_id WHERE o.status = 'published' AND e.status = 'published'").m,
    arTotal: agingReport(req.db, today).totals,
    openCases: h.get("SELECT COUNT(*) c FROM cases WHERE status IN ('open','in_progress')").c,
    tasksDue: h.get("SELECT COUNT(*) c FROM tasks WHERE status = 'open' AND due_date <= ?", today).c,
  };
  const editions = h.all(
    `SELECT e.*, d.name AS directory_name, d.code,
            (SELECT COUNT(*) FROM orders o WHERE o.edition_id = e.id AND o.status NOT IN ('cancelled')) AS order_count,
            (SELECT COUNT(*) FROM order_lines ol JOIN orders o ON o.id = ol.order_id WHERE o.edition_id = e.id AND o.status NOT IN ('cancelled','draft') AND ol.ad_copy_status <> 'approved') AS lines_pending_copy
       FROM editions e JOIN directories d ON d.id = e.directory_id
      WHERE e.status IN ('canvass','closed','in_production') ORDER BY e.close_date`,
  );
  const pipeline = h.all(
    `SELECT stage, COUNT(*) c, COALESCE(SUM(est_monthly_cents),0) m FROM opportunities
      WHERE edition_id IN (SELECT id FROM editions WHERE status = 'canvass') GROUP BY stage`,
  );
  const tasks = h.all(
    `SELECT t.*, a.name AS account_name, u.name AS user_name FROM tasks t LEFT JOIN accounts a ON a.id = t.account_id LEFT JOIN users u ON u.id = t.assigned_user_id
      WHERE t.status = 'open' AND t.due_date <= ? ORDER BY t.due_date LIMIT 10`, addDays(today, 7),
  );
  const activities = h.all(
    `SELECT ac.*, a.name AS account_name, u.name AS user_name FROM activities ac JOIN accounts a ON a.id = ac.account_id LEFT JOIN users u ON u.id = ac.user_id
      ORDER BY ac.occurred_at DESC LIMIT 8`,
  );
  res.render('dashboard', { title: 'Dashboard', kpis, editions, pipeline, tasks, activities });
});

export default r;
