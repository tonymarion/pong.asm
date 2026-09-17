import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';

const TODAY = '2026-09-17';
let server, base, db;

before(async () => {
  db = openDb(':memory:');
  seed(db, { today: TODAY });
  server = createApp(db, { today: () => TODAY }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); });

const get = (p) => fetch(base + p);
const json = async (p) => (await get(p)).json();
const post = (p, body, asJson = false) => fetch(base + p, {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': asJson ? 'application/json' : 'application/x-www-form-urlencoded' },
  body: asJson ? JSON.stringify(body) : form(body),
});
function form(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) for (const item of [].concat(v)) p.append(k, item);
  return p.toString();
}

test('seed produces a populated, internally consistent dataset', () => {
  const c = (sql) => db.prepare(sql).get().c;
  assert.ok(c('SELECT COUNT(*) c FROM accounts') >= 60);
  assert.ok(c('SELECT COUNT(*) c FROM orders') >= 50);
  assert.ok(c('SELECT COUNT(*) c FROM invoices') >= 500);
  assert.equal(c('SELECT COUNT(*) c FROM orders WHERE total_monthly_cents = 0'), 0, 'every order has priced lines');
  assert.equal(c("SELECT COUNT(*) c FROM invoices WHERE paid_cents > total_cents"), 0, 'no overpaid invoices');
  assert.equal(c("SELECT COUNT(*) c FROM invoices WHERE status = 'paid' AND paid_cents < total_cents"), 0);
  assert.equal(c("SELECT COUNT(*) c FROM editions WHERE status = 'canvass'"), 2);
});

test('every page renders', async () => {
  const pages = ['/', '/accounts', '/accounts?q=plumb', '/accounts/new', '/accounts/1', '/directories', '/directories/1', '/editions/1', '/products',
    '/orders', '/orders/new', '/orders/1', '/invoices', '/invoices?overdue=1', '/invoices/1', '/payments', '/collections', '/opportunities',
    '/cases', '/cases/new', '/cases/1', '/tasks', '/reports', '/reports/aging', '/reports/renewals', '/reports/renewals?edition=3', '/reports/copy-readiness', '/reports/revenue'];
  for (const p of pages) {
    const res = await get(p);
    assert.equal(res.status, 200, `${p} -> ${res.status}`);
    assert.match(await res.text(), /<\/html>/, `${p} rendered fully`);
  }
  assert.equal((await get('/accounts/999999')).status, 404);
  assert.equal((await get('/api/accounts/999999')).status, 404);
});

test('api returns accounts, editions, rate cards and reports', async () => {
  const accounts = await json('/api/accounts?status=active');
  assert.ok(accounts.length > 10);
  assert.ok(accounts.every((a) => a.status === 'active'));
  const detail = await json(`/api/accounts/${accounts[0].id}`);
  assert.equal(detail.account.id, accounts[0].id);
  assert.ok(Array.isArray(detail.contacts) && Array.isArray(detail.orders));
  const editions = await json('/api/editions');
  const rc = await json(`/api/editions/${editions[0].id}/rate-card`);
  assert.equal(rc.length, 14);
  const aging = await json('/api/reports/aging');
  assert.ok(aging.totals.total > 0);
  assert.equal(aging.rows.reduce((s, r) => s + r.total, 0), aging.totals.total);
});

test('full order lifecycle: create account, draft order, approve, invoice, pay, credit', async () => {
  let res = await post('/accounts', { name: 'Lifecycle Roofing', status: 'active', phone: '555-0199', billing_street: '1 Main', billing_city: 'Springfield', billing_state: 'IL', territory_id: 3, owner_user_id: 4, contact_first_name: 'Ann', contact_last_name: 'Lee' });
  assert.equal(res.status, 302);
  const accountId = Number(res.headers.get('location').match(/\/accounts\/(\d+)/)[1]);

  const edition = (await json('/api/editions')).find((e) => e.status === 'canvass');
  res = await post('/orders', { account_id: accountId, edition_id: edition.id, order_type: 'new', product_id: [1, 13], heading_id: [36, 36] });
  assert.equal(res.status, 302);
  const orderId = Number(res.headers.get('location').match(/\/orders\/(\d+)/)[1]);
  let order = await json(`/api/orders/${orderId}`);
  assert.equal(order.order.status, 'draft');
  assert.equal(order.lines.length, 2);
  assert.ok(order.lines.every((l) => l.location_id), 'lines attach to the account location');
  const rc = await json(`/api/editions/${edition.id}/rate-card`);
  assert.equal(order.lines[0].monthly_rate_cents, rc.find((r) => r.product_id === 1).monthly_cents, 'rate comes from the edition rate card');
  assert.equal(order.order.total_contract_cents, order.order.total_monthly_cents * 12);

  assert.equal((await post(`/orders/${orderId}/status`, { status: 'approved' })).status, 400, 'draft cannot jump to approved');
  assert.equal((await post(`/orders/${orderId}/invoices`, {})).status, 400, 'draft cannot be invoiced');
  await post(`/orders/${orderId}/status`, { status: 'pending_approval' });
  await post(`/orders/${orderId}/status`, { status: 'approved' });
  order = await json(`/api/orders/${orderId}`);
  assert.equal(order.order.status, 'approved');
  assert.equal(order.order.signed_at, TODAY);

  res = await post(`/api/orders/${orderId}/invoices`, {}, true);
  assert.equal(res.status, 201);
  const invoices = await res.json();
  assert.equal(invoices.length, 12);
  assert.equal(invoices[0].issue_date, edition.publish_date);

  res = await post(`/api/invoices/${invoices[0].id}/payments`, { amount_cents: 1000, method: 'check', reference: '#1' }, true);
  assert.equal(res.status, 201);
  res = await post(`/api/invoices/${invoices[0].id}/adjustments`, { amount_cents: -500, reason: 'goodwill' }, true);
  assert.equal(res.status, 201);
  const inv = await json(`/api/invoices/${invoices[0].id}`);
  assert.equal(inv.invoice.paid_cents, 1500);
  assert.ok(inv.invoice.total_cents > 1500);
  assert.equal(inv.invoice.status, 'partial');
  assert.equal(inv.payments.length, 1);

  assert.equal((await post(`/invoices/${invoices[0].id}/void`, {})).status, 400, 'cannot void a paid invoice');

  await post(`/accounts/${accountId}/status`, { status: 'active', credit_hold: '1' });
  assert.equal((await post('/orders', { account_id: accountId, edition_id: edition.id, product_id: 1 })).status, 400, 'credit hold blocks new orders');

  await post(`/accounts/${accountId}/activities`, { type: 'call', subject: 'Welcome call', user_id: 4 });
  await post(`/accounts/${accountId}/tasks`, { title: 'Collect artwork', due_date: TODAY, assigned_user_id: 4 });
  res = await post('/cases', { account_id: accountId, type: 'copy_change', subject: 'Update hours' });
  const caseId = Number(res.headers.get('location').match(/\/cases\/(\d+)/)[1]);
  await post(`/cases/${caseId}/status`, { status: 'resolved', resolution: 'Hours updated' });
  const detail = await json(`/api/accounts/${accountId}`);
  assert.equal(detail.activities.length, 1);
  assert.equal(detail.tasks.length, 1);
  assert.equal(detail.cases[0].status, 'resolved');
  assert.ok(detail.cases[0].resolved_at);
});

test('cancelling an order voids its unpaid invoices', async () => {
  const order = (await json('/api/orders?status=approved'))[0];
  assert.ok(order, 'seed has an approved order');
  await post(`/orders/${order.id}/status`, { status: 'cancelled' });
  const invoices = await json(`/api/invoices?account=${order.account_id}`);
  const forOrder = invoices.filter((i) => i.order_id === order.id);
  assert.ok(forOrder.every((i) => i.paid_cents > 0 || i.status === 'void'));
});
