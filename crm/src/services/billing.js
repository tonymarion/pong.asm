/**
 * Billing rules for directory advertising contracts.
 *
 * - An approved order is billed as N monthly installments (order.months, default 12)
 *   starting on the edition publish date, or as a single annual invoice.
 * - Invoice.paid_cents holds everything that settles the invoice: payments AND
 *   credits (negative adjustments). Balance = total_cents - paid_cents.
 * - "overdue" is derived (balance > 0 and due_date < as-of date), not stored.
 */
import { q } from '../db.js';
import { addDays, addMonths, daysBetween } from '../lib/format.js';

const TERMS_DAYS = { net15: 15, net30: 30, net45: 45, due_on_receipt: 0 };

export function termsDays(terms) {
  return TERMS_DAYS[terms] ?? 30;
}

export function nextNumber(db, table, column, prefix) {
  const row = q(db).get(`SELECT COALESCE(MAX(id), 0) + 1 AS n FROM ${table}`);
  return `${prefix}-${String(row.n).padStart(6, '0')}`;
}

/** Recompute order totals from its lines. */
export function recomputeOrderTotals(db, orderId) {
  const h = q(db);
  const sums = h.get(
    'SELECT COALESCE(SUM(qty * monthly_rate_cents), 0) AS monthly FROM order_lines WHERE order_id = ?',
    orderId,
  );
  const order = h.get('SELECT months FROM orders WHERE id = ?', orderId);
  h.run(
    'UPDATE orders SET total_monthly_cents = ?, total_contract_cents = ? WHERE id = ?',
    sums.monthly,
    sums.monthly * order.months,
    orderId,
  );
  return { monthly: sums.monthly, contract: sums.monthly * order.months };
}

/**
 * Create the installment schedule for an order. Idempotent: returns existing
 * invoices if the order already has any.
 */
export function generateInvoicesForOrder(db, orderId) {
  const h = q(db);
  const existing = h.all('SELECT * FROM invoices WHERE order_id = ? ORDER BY installment_no', orderId);
  if (existing.length) return existing;

  const order = h.get(
    `SELECT o.*, e.publish_date, a.payment_terms
       FROM orders o JOIN editions e ON e.id = o.edition_id JOIN accounts a ON a.id = o.account_id
      WHERE o.id = ?`,
    orderId,
  );
  if (!order) throw new Error(`order ${orderId} not found`);
  if (order.status === 'draft' || order.status === 'pending_approval' || order.status === 'cancelled') {
    throw new Error(`order ${order.order_number} is ${order.status}; only approved orders can be invoiced`);
  }
  const lines = h.all(
    `SELECT ol.*, p.name AS product_name, hd.name AS heading_name
       FROM order_lines ol JOIN products p ON p.id = ol.product_id
       LEFT JOIN headings hd ON hd.id = ol.heading_id
      WHERE ol.order_id = ?`,
    orderId,
  );
  if (!lines.length) throw new Error(`order ${order.order_number} has no lines`);

  const installments = order.billing_frequency === 'annual' ? 1 : order.months;
  const multiplier = order.billing_frequency === 'annual' ? order.months : 1;
  const days = termsDays(order.payment_terms);

  return h.tx(() => {
    const created = [];
    for (let i = 0; i < installments; i++) {
      const issue = addMonths(order.publish_date, i);
      const subtotal = lines.reduce((s, l) => s + l.qty * l.monthly_rate_cents * multiplier, 0);
      const number = nextNumber(db, 'invoices', 'invoice_number', 'INV');
      const res = h.run(
        `INSERT INTO invoices (invoice_number, account_id, order_id, edition_id, installment_no, issue_date, due_date,
                               period_start, period_end, subtotal_cents, tax_cents, total_cents, paid_cents, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 'open')`,
        number, order.account_id, order.id, order.edition_id, i + 1, issue, addDays(issue, days),
        issue, addDays(addMonths(issue, multiplier), -1), subtotal, subtotal,
      );
      const invoiceId = Number(res.lastInsertRowid);
      for (const l of lines) {
        const desc = `${l.product_name}${l.heading_name ? ' – ' + l.heading_name : ''} (${installments === 1 ? 'annual' : `installment ${i + 1}/${installments}`})`;
        h.run(
          'INSERT INTO invoice_lines (invoice_id, order_line_id, description, amount_cents) VALUES (?, ?, ?, ?)',
          invoiceId, l.id, desc, l.qty * l.monthly_rate_cents * multiplier,
        );
      }
      created.push(h.get('SELECT * FROM invoices WHERE id = ?', invoiceId));
    }
    return created;
  });
}

export function refreshInvoiceStatus(db, invoiceId) {
  const h = q(db);
  const inv = h.get('SELECT * FROM invoices WHERE id = ?', invoiceId);
  if (!inv || inv.status === 'void') return inv;
  let status = 'open';
  if (inv.paid_cents >= inv.total_cents) status = 'paid';
  else if (inv.paid_cents > 0) status = 'partial';
  if (inv.status === 'credited' && status !== 'paid') status = 'credited';
  h.run('UPDATE invoices SET status = ? WHERE id = ?', status, invoiceId);
  return { ...inv, status };
}

/** Record a payment and apply it to an invoice (or leave unapplied if no invoice). */
export function applyPayment(db, { accountId, invoiceId = null, amountCents, method, paymentDate, reference = null, notes = null }) {
  if (!(amountCents > 0)) throw new Error('payment amount must be positive');
  const h = q(db);
  return h.tx(() => {
    if (invoiceId) {
      const inv = h.get('SELECT * FROM invoices WHERE id = ?', invoiceId);
      if (!inv) throw new Error(`invoice ${invoiceId} not found`);
      if (inv.account_id !== accountId) throw new Error('invoice belongs to a different account');
      if (inv.status === 'void') throw new Error('cannot pay a void invoice');
    }
    const res = h.run(
      'INSERT INTO payments (account_id, invoice_id, payment_date, amount_cents, method, reference, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      accountId, invoiceId, paymentDate, amountCents, method, reference, notes,
    );
    if (invoiceId) {
      h.run('UPDATE invoices SET paid_cents = paid_cents + ? WHERE id = ?', amountCents, invoiceId);
      refreshInvoiceStatus(db, invoiceId);
    }
    return h.get('SELECT * FROM payments WHERE id = ?', Number(res.lastInsertRowid));
  });
}

/** Record an adjustment. Negative amount = credit to the customer. */
export function applyAdjustment(db, { accountId, invoiceId = null, orderLineId = null, amountCents, reason, adjDate, approvedByUserId = null, notes = null }) {
  if (!amountCents) throw new Error('adjustment amount must be non-zero');
  const h = q(db);
  return h.tx(() => {
    const res = h.run(
      `INSERT INTO adjustments (account_id, invoice_id, order_line_id, adj_date, amount_cents, reason, approved_by_user_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      accountId, invoiceId, orderLineId, adjDate, amountCents, reason, approvedByUserId, notes,
    );
    if (invoiceId) {
      // A credit settles part of the invoice; a debit increases what is owed.
      if (amountCents < 0) {
        h.run("UPDATE invoices SET paid_cents = paid_cents + ?, status = CASE WHEN status = 'open' THEN 'credited' ELSE status END WHERE id = ?", -amountCents, invoiceId);
      } else {
        h.run('UPDATE invoices SET total_cents = total_cents + ? WHERE id = ?', amountCents, invoiceId);
      }
      refreshInvoiceStatus(db, invoiceId);
    }
    return h.get('SELECT * FROM adjustments WHERE id = ?', Number(res.lastInsertRowid));
  });
}

export const AGING_BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd91_120', 'd120_plus'];

export function bucketFor(daysPastDue) {
  if (daysPastDue <= 0) return 'current';
  if (daysPastDue <= 30) return 'd1_30';
  if (daysPastDue <= 60) return 'd31_60';
  if (daysPastDue <= 90) return 'd61_90';
  if (daysPastDue <= 120) return 'd91_120';
  return 'd120_plus';
}

/** Open invoices with balance, days past due and bucket. Optional account filter. */
export function openInvoices(db, asOf, accountId = null) {
  const h = q(db);
  const rows = h.all(
    `SELECT i.*, a.name AS account_name, a.account_number, (i.total_cents - i.paid_cents) AS balance_cents
       FROM invoices i JOIN accounts a ON a.id = i.account_id
      WHERE i.status NOT IN ('paid','void') AND i.issue_date <= ? AND (i.total_cents - i.paid_cents) > 0
        ${accountId ? 'AND i.account_id = ?' : ''}
      ORDER BY i.due_date`,
    ...(accountId ? [asOf, accountId] : [asOf]),
  );
  return rows.map((r) => {
    const days = daysBetween(r.due_date, asOf);
    return { ...r, days_past_due: days, bucket: bucketFor(days), overdue: days > 0 };
  });
}

/** AR aging grouped by account. */
export function agingReport(db, asOf) {
  const byAccount = new Map();
  for (const inv of openInvoices(db, asOf)) {
    let row = byAccount.get(inv.account_id);
    if (!row) {
      row = { account_id: inv.account_id, account_name: inv.account_name, account_number: inv.account_number, total: 0 };
      for (const b of AGING_BUCKETS) row[b] = 0;
      byAccount.set(inv.account_id, row);
    }
    row[inv.bucket] += inv.balance_cents;
    row.total += inv.balance_cents;
  }
  const rows = [...byAccount.values()].sort((a, b) => b.total - a.total);
  const totals = { total: 0 };
  for (const b of AGING_BUCKETS) totals[b] = 0;
  for (const r of rows) {
    totals.total += r.total;
    for (const b of AGING_BUCKETS) totals[b] += r[b];
  }
  return { rows, totals };
}

export function accountBalance(db, accountId, asOf) {
  return openInvoices(db, asOf, accountId).reduce((s, i) => s + i.balance_cents, 0);
}
