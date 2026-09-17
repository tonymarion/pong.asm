# Yellow Pages CRM

A CRM for a directory publisher that sells and bills advertising in printed
yellow pages books (and their online counterparts). It joins **sales**
(canvass, renewals, pipeline), **production** (headings, editions, close dates,
ad copy) and **billing** (installment invoices, payments, credits, aging,
collections) in one place.

The functional plan lives in [`docs/PLAN.md`](docs/PLAN.md).

## Run it

Requires Node 22.13+ (uses the built-in SQLite driver; no native modules).

```sh
cd crm
npm install
npm run seed     # creates data/crm.db with deterministic sample data
npm start        # http://localhost:3000
```

`npm start` seeds automatically if no database exists. `npm run dev` restarts on
file changes. `npm test` runs the billing and HTTP tests against an in-memory
database.

Set `SEED_TODAY=2026-09-17 npm run seed` to pin the "today" that seed dates are
generated around (edition statuses, overdue invoices, tasks due).

## What is in the scaffold

| Area | Pages | Notes |
|---|---|---|
| Dashboard | `/` | KPIs, editions in flight, renewal pipeline, tasks due, recent activity |
| Accounts | `/accounts`, `/accounts/:id`, `/accounts/new` | 360° view: contacts, locations, orders, open invoices, payments, adjustments, activity log, tasks, cases, opportunities. Status + credit hold. |
| Pipeline | `/opportunities` | Kanban by stage for editions in canvass; change stage inline |
| Orders | `/orders`, `/orders/:id`, `/orders/new` | Order builder (rate pulled from edition rate card), status workflow draft → pending approval → approved → in production → published, ad‑copy status per line, installment schedule |
| Directories | `/directories`, `/directories/:id`, `/editions/:id`, `/products` | Edition calendar and status, rate card per edition, orders in the edition, product and heading catalogue |
| Billing | `/invoices`, `/invoices/:id`, `/payments`, `/collections` | Record payments and adjustments, void, overdue filter, dunning queue by stage |
| Cases | `/cases`, `/cases/:id`, `/cases/new` | Ad errors, billing disputes, cancellation requests, copy changes |
| Tasks | `/tasks` | Open/done with overdue highlighting |
| Reports | `/reports/*` | AR aging (with as‑of date), renewal rate + not‑yet‑renewed list, copy readiness by edition, revenue by directory/product/rep |
| API | `/api/*` | JSON for accounts, editions, rate cards, orders, invoices, payments, adjustments, reports |

### Billing rules implemented

- Approved orders bill as `months` monthly installments starting on the
  edition's publish date, or as one annual invoice. Due dates follow the
  account's payment terms (net15/30/45, due on receipt).
- `invoices.paid_cents` holds everything that settles the invoice: payments and
  credits. Balance = `total_cents - paid_cents`. Debits raise `total_cents`.
- "Overdue" is derived at query time; aging buckets are current / 1–30 / 31–60
  / 61–90 / 91–120 / 120+.
- Cancelling an order voids its unpaid invoices. Invoices with payments cannot
  be voided (issue a credit instead).
- Accounts on credit hold cannot receive new orders.

## Layout

```
crm/
  docs/PLAN.md          functional plan
  src/schema.sql        SQLite schema
  src/db.js             open/migrate + tiny query helper with nestable transactions
  src/seed.js           deterministic seed data
  src/services/billing.js  installments, payments, adjustments, aging
  src/app.js            Express app (createApp(db)) — routes + views
  src/routes/*.js       page routes and /api
  src/views/**/*.ejs    server-rendered pages
  public/style.css
  test/*.test.js        node:test suites
```

## Next (see the plan's phases)

Authentication and roles, renewal opportunity generation when an edition enters
canvass, dunning automation and statements, commissions, print export, payment
gateway, email.
