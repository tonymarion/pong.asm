import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.js';
import { generateInvoicesForOrder, applyPayment, applyAdjustment, agingReport, openInvoices, bucketFor, recomputeOrderTotals } from '../src/services/billing.js';
import { addMonths } from '../src/lib/format.js';

test('monthly order produces 12 installments from the publish date with net-30 due dates', () => {
  const { db } = fixture();
  const invoices = generateInvoicesForOrder(db, 1);
  assert.equal(invoices.length, 12);
  assert.equal(invoices[0].issue_date, '2026-03-15');
  assert.equal(invoices[0].due_date, '2026-04-14');
  assert.equal(invoices[11].issue_date, '2027-02-15');
  assert.equal(invoices[0].total_cents, 43500);
  assert.equal(invoices.reduce((s, i) => s + i.total_cents, 0), 522000);
  assert.deepEqual(invoices.map((i) => i.installment_no), [...Array(12).keys()].map((n) => n + 1));
});

test('annual billing produces one invoice for the full contract', () => {
  const { db } = fixture({ frequency: 'annual', terms: 'net15' });
  const invoices = generateInvoicesForOrder(db, 1);
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].total_cents, 522000);
  assert.equal(invoices[0].due_date, '2026-03-30');
});

test('invoice generation is idempotent and refuses unapproved orders', () => {
  const { db } = fixture();
  generateInvoicesForOrder(db, 1);
  assert.equal(generateInvoicesForOrder(db, 1).length, 12);
  const draft = fixture({ status: 'draft' });
  assert.throws(() => generateInvoicesForOrder(draft.db, 1), /only approved orders/);
});

test('payments move an invoice through partial to paid and reject bad input', () => {
  const { db, h } = fixture();
  const [inv] = generateInvoicesForOrder(db, 1);
  applyPayment(db, { accountId: 1, invoiceId: inv.id, amountCents: 20000, method: 'check', paymentDate: '2026-04-01', reference: '#100' });
  assert.equal(h.get('SELECT status, paid_cents FROM invoices WHERE id = ?', inv.id).status, 'partial');
  applyPayment(db, { accountId: 1, invoiceId: inv.id, amountCents: 23500, method: 'ach', paymentDate: '2026-04-10' });
  const after = h.get('SELECT status, paid_cents FROM invoices WHERE id = ?', inv.id);
  assert.equal(after.status, 'paid');
  assert.equal(after.paid_cents, 43500);
  assert.throws(() => applyPayment(db, { accountId: 1, invoiceId: inv.id, amountCents: 0, method: 'cash', paymentDate: '2026-04-10' }), /positive/);
  assert.throws(() => applyPayment(db, { accountId: 2, invoiceId: inv.id, amountCents: 100, method: 'cash', paymentDate: '2026-04-10' }), /different account/);
});

test('a credit settles part of the invoice; a debit increases the total', () => {
  const { db, h } = fixture();
  const [inv] = generateInvoicesForOrder(db, 1);
  applyAdjustment(db, { accountId: 1, invoiceId: inv.id, amountCents: -21750, reason: 'ad_error', adjDate: '2026-04-01', approvedByUserId: 1 });
  let row = h.get('SELECT * FROM invoices WHERE id = ?', inv.id);
  assert.equal(row.paid_cents, 21750);
  assert.equal(row.status, 'credited');
  applyAdjustment(db, { accountId: 1, invoiceId: inv.id, amountCents: 2500, reason: 'late_fee', adjDate: '2026-05-01' });
  row = h.get('SELECT * FROM invoices WHERE id = ?', inv.id);
  assert.equal(row.total_cents, 46000);
  assert.equal(row.total_cents - row.paid_cents, 24250);
  applyPayment(db, { accountId: 1, invoiceId: inv.id, amountCents: 24250, method: 'card', paymentDate: '2026-05-02' });
  assert.equal(h.get('SELECT status FROM invoices WHERE id = ?', inv.id).status, 'paid');
});

test('aging buckets and report totals', () => {
  assert.equal(bucketFor(-5), 'current');
  assert.equal(bucketFor(0), 'current');
  assert.equal(bucketFor(1), 'd1_30');
  assert.equal(bucketFor(30), 'd1_30');
  assert.equal(bucketFor(31), 'd31_60');
  assert.equal(bucketFor(90), 'd61_90');
  assert.equal(bucketFor(91), 'd91_120');
  assert.equal(bucketFor(121), 'd120_plus');

  const { db } = fixture();
  generateInvoicesForOrder(db, 1);
  // As of 2026-07-01: issued Mar 15, Apr 15, May 15, Jun 15 (due Apr 14, May 15, Jun 14, Jul 15).
  const open = openInvoices(db, '2026-07-01');
  assert.equal(open.length, 4);
  assert.deepEqual(open.map((i) => i.bucket), ['d61_90', 'd31_60', 'd1_30', 'current']);
  const report = agingReport(db, '2026-07-01');
  assert.equal(report.rows.length, 1);
  assert.equal(report.totals.total, 4 * 43500);
  assert.equal(report.totals.d61_90, 43500);
  assert.equal(report.totals.current, 43500);
});

test('order totals are recomputed from lines', () => {
  const { db, h } = fixture();
  h.run('INSERT INTO order_lines (order_id, product_id, heading_id, qty, monthly_rate_cents) VALUES (1, 2, 1, 2, 1000)');
  const t = recomputeOrderTotals(db, 1);
  assert.equal(t.monthly, 45500);
  assert.equal(t.contract, 546000);
});

test('addMonths clamps to month end', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-03-15', 12), '2027-03-15');
});
