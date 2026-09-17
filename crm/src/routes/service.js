import { Router } from 'express';

const r = Router();

r.get('/opportunities', (req, res) => {
  const { q: h } = req;
  const editionId = req.query.edition ? Number(req.query.edition) : null;
  const editions = h.all("SELECT e.id, e.edition_year, e.status, e.close_date, d.name FROM editions e JOIN directories d ON d.id = e.directory_id WHERE e.status IN ('canvass','planning','closed') ORDER BY e.close_date");
  const where = editionId ? 'WHERE op.edition_id = ?' : "WHERE e.status IN ('canvass','planning','closed')";
  const opps = h.all(
    `SELECT op.*, a.name AS account_name, a.status AS account_status, u.name AS rep_name, e.edition_year, e.close_date, d.name AS directory_name
       FROM opportunities op JOIN accounts a ON a.id = op.account_id LEFT JOIN users u ON u.id = op.rep_user_id
       JOIN editions e ON e.id = op.edition_id JOIN directories d ON d.id = e.directory_id ${where} ORDER BY op.expected_close`, ...(editionId ? [editionId] : []));
  const stages = ['prospecting', 'contacted', 'proposal', 'negotiation', 'closed_won', 'closed_lost'];
  const byStage = Object.fromEntries(stages.map((s) => [s, opps.filter((o) => o.stage === s)]));
  res.render('service/opportunities', { title: 'Pipeline', editions, editionId, byStage, stages });
});

r.post('/opportunities/:id/stage', (req, res) => {
  const { q: h } = req;
  h.run('UPDATE opportunities SET stage = ? WHERE id = ?', req.body.stage, req.params.id);
  res.redirect((req.get('referer') || '/opportunities').split('?')[0] + '?flash=Stage+updated');
});

r.get('/cases', (req, res) => {
  const { q: h } = req;
  const status = req.query.status ?? '';
  const cases = h.all(
    `SELECT c.*, a.name AS account_name, u.name AS owner_name FROM cases c JOIN accounts a ON a.id = c.account_id LEFT JOIN users u ON u.id = c.owner_user_id
      ${status ? 'WHERE c.status = ?' : ''} ORDER BY CASE c.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, c.opened_at DESC`, ...(status ? [status] : []));
  res.render('service/cases', { title: 'Cases', cases, status });
});

r.get('/cases/new', (req, res) => {
  const { q: h } = req;
  res.render('service/case_new', {
    title: 'New case',
    accountId: req.query.account ? Number(req.query.account) : null,
    accounts: h.all('SELECT id, name, account_number FROM accounts ORDER BY name'),
    users: h.all('SELECT * FROM users WHERE active = 1 ORDER BY name'),
  });
});

r.post('/cases', (req, res) => {
  const { q: h } = req;
  const b = req.body;
  const n = h.get('SELECT COALESCE(MAX(id),0) + 1 AS n FROM cases').n;
  const result = h.run('INSERT INTO cases (case_number, account_id, owner_user_id, type, priority, status, subject, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    `CS-${String(n).padStart(5, '0')}`, Number(b.account_id), b.owner_user_id ? Number(b.owner_user_id) : null, b.type, b.priority || 'normal', 'open', b.subject, b.description || null);
  res.redirect(`/cases/${Number(result.lastInsertRowid)}?flash=Case+opened`);
});

r.get('/cases/:id', (req, res) => {
  const { q: h } = req;
  const c = h.get(
    `SELECT c.*, a.name AS account_name, u.name AS owner_name, i.invoice_number, ol.order_id, p.name AS product_name
       FROM cases c JOIN accounts a ON a.id = c.account_id LEFT JOIN users u ON u.id = c.owner_user_id LEFT JOIN invoices i ON i.id = c.invoice_id
       LEFT JOIN order_lines ol ON ol.id = c.order_line_id LEFT JOIN products p ON p.id = ol.product_id WHERE c.id = ?`, req.params.id);
  if (!c) return res.status(404).render('error', { title: 'Not found', message: 'Case not found' });
  res.render('service/case', { title: c.case_number, c, users: h.all('SELECT * FROM users WHERE active = 1 ORDER BY name') });
});

r.post('/cases/:id/status', (req, res) => {
  const { q: h } = req;
  const status = req.body.status;
  const resolved = status === 'resolved' || status === 'closed';
  h.run('UPDATE cases SET status = ?, resolution = COALESCE(?, resolution), owner_user_id = COALESCE(?, owner_user_id), resolved_at = CASE WHEN ? THEN COALESCE(resolved_at, ?) ELSE NULL END WHERE id = ?',
    status, req.body.resolution || null, req.body.owner_user_id ? Number(req.body.owner_user_id) : null, resolved ? 1 : 0, req.today + ' 12:00:00', req.params.id);
  res.redirect(`/cases/${req.params.id}?flash=Case+updated`);
});

r.get('/tasks', (req, res) => {
  const { q: h, today } = req;
  const tasks = h.all(
    `SELECT t.*, a.name AS account_name, u.name AS user_name FROM tasks t LEFT JOIN accounts a ON a.id = t.account_id LEFT JOIN users u ON u.id = t.assigned_user_id
      ORDER BY t.status, t.due_date`);
  res.render('service/tasks', { title: 'Tasks', tasks, today });
});

r.post('/tasks/:id/done', (req, res) => {
  req.q.run("UPDATE tasks SET status = 'done' WHERE id = ?", req.params.id);
  res.redirect((req.get('referer') || '/tasks').split('?')[0] + '?flash=Task+completed');
});

export default r;
