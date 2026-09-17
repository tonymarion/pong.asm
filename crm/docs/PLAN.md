# Yellow Pages CRM — Functional Plan

This document describes the functionality a CRM needs for a legacy yellow pages
publisher: a company that sells advertising and listings in printed directories
(and their digital counterparts) and bills advertisers for them over the life of
each book.

It is organised as:

1. How the business works (the vocabulary the CRM has to speak)
2. Functional modules and what each must do
3. Data model
4. Key workflows
5. Roles and permissions
6. Reporting
7. Integrations (later)
8. Delivery phases — what is built now vs. later

---

## 1. How the business works

| Term | Meaning |
|---|---|
| **Directory** ("book") | A print directory covering one geographic market, e.g. *Greater Springfield*. |
| **Edition** | One yearly issue of a directory. Each edition has a **canvass** period (selling window), a **close date** (last day to sell / final ad copy), a **publish date** (distribution), and a 12‑month life. |
| **Heading** | The classified category a listing appears under (*Plumbers*, *Attorneys – Personal Injury*). Advertisers buy placement under one or more headings. |
| **Product** | What is sold: listings (bold, extra line, trademark), in‑column ads (space listings), display ads (¼, ½, full page; colour), covers/tabs, and digital equivalents (online listing, priority placement). |
| **Rate card** | Price for each product in a specific edition. Larger markets cost more. |
| **Advertiser / Account** | The business customer. May have several locations and phone numbers; each phone can carry its own listing. |
| **Order / Contract** | A signed agreement for a set of products in one edition, with a monthly (or annual) charge. It is the unit of revenue. |
| **Renewal** | Every advertiser is re‑canvassed for each new edition. The existing order is the starting point; the rep tries to keep or upsell it. Renewal rate is the key sales metric. |
| **Ad copy / Proof** | Artwork for each ad must be received, proofed and approved before the close date. |
| **Invoice** | Monthly bill for the advertiser's active contracts (usually 12 equal installments beginning at publish). |
| **Adjustment** | Credit or debit against an account: ad errors (wrong phone number printed = big credit), goodwill, cancellation, write‑off. |
| **Case** | A service issue: ad error claim, billing dispute, cancellation request, copy change. |
| **Territory** | Geographic sales assignment; reps own accounts within a territory. |

The CRM must join three things that legacy publishers often keep in separate
systems: **sales** (canvass and renewals), **production** (headings, copy,
close dates) and **billing** (installments, AR, credits).

---

## 2. Functional modules

### 2.1 Accounts & Contacts
- Account record: name, DBA, account number, status (prospect / active / inactive / collections), industry, phones, website, billing address, payment terms, credit hold flag, assigned rep, territory.
- Multiple **locations** per account (each with its own address and phone; listings attach to a location).
- Multiple **contacts** per account; flags for *primary* and *authorized signer*.
- 360° view: open orders, listings by edition, invoices and balance, payments, activities, tasks, cases, opportunities.
- Search by name, phone, account number, city, heading.
- Duplicate detection on phone number and name+zip (later).

### 2.2 Directories, Editions, Headings & Products
- Directory master list with market, region, distribution quantity.
- Edition calendar with status lifecycle: *planning → canvass → closed → in production → published → expired*.
- Heading catalogue (code + name) that reps pick from when building an order.
- Product catalogue with category (listing / in‑column / display / digital), size description and default rate.
- Edition rate cards overriding default product rates.

### 2.3 Sales & Renewals
- **Opportunities** pipeline per edition: stage (prospecting → contacted → proposal → negotiation → closed won/lost), estimated monthly value, expected close, source (renewal / new / referral).
- **Renewal canvass**: when an edition enters canvass, generate a renewal opportunity for every account with an order in the prior edition, pre‑loaded with last year's products. Reps work these first.
- **Order builder**: choose edition, add lines (product × heading × location), compute monthly and contract totals from the rate card.
- Order status workflow: *draft → pending approval → approved → in production → published → cancelled*.
- Contract capture: signer contact, signed date, billing frequency.
- Rep dashboard: my accounts, my open opportunities, my tasks, close dates approaching.

### 2.4 Production / Ad Copy
- Per order line: ad copy status (*pending → artwork received → proof sent → approved*) and listing text.
- Close‑date checklist: lines not yet approved for an edition nearing close.
- Export of approved listings/ads per edition for the composition/print system (later).

### 2.5 Billing & Accounts Receivable
- **Invoice generation**: when an order is approved (or the edition publishes), create the installment schedule — 12 monthly invoices from the publish date, or a single annual invoice.
- Invoice statuses: open / partial / paid / overdue / void / credited.
- **Payments**: record by method (check, ACH, card, cash) with reference; apply to an invoice; partial payments supported.
- **Adjustments**: credits and debits with reason codes and approver.
- **Aging**: current / 30 / 60 / 90 / 120+ buckets per account.
- **Collections**: dunning stages, credit hold, collections notes; accounts in *collections* status are blocked from new orders without override.
- Statements per account (later).

### 2.6 Service & Activity
- **Activities**: calls, emails, meetings, notes, proof events, collections contacts — logged against account/contact by user.
- **Tasks**: assigned, due date, priority, link to account/order/case.
- **Cases**: type, priority, status, owner, resolution; ad‑error cases can spawn an adjustment.

### 2.7 Reporting & Dashboards
See §6.

### 2.8 Administration
- Users, roles, territories.
- Directory / edition / heading / product / rate‑card maintenance.
- Audit log of changes to orders, invoices and adjustments (later).

---

## 3. Data model

Core tables (all implemented in `src/schema.sql`):

```
users            territories
accounts ──< contacts
         ──< locations
         ──< opportunities >── editions >── directories
         ──< orders >── editions
                 └──< order_lines >── products, headings, locations
         ──< invoices ──< invoice_lines >── order_lines
         ──< payments >── invoices
         ──< adjustments >── invoices / order_lines
         ──< activities >── contacts, users
         ──< tasks >── users
         ──< cases >── order_lines / invoices
rate_cards >── editions, products
```

Key rules:
- An **order** belongs to exactly one account and one edition.
- An **order line** carries the rate at time of sale (`monthly_rate`) so later rate‑card changes never alter a contract.
- **Invoices** reference the order that produced them; `amount_paid` is maintained from payments and adjustments.
- Money is stored as integer **cents**.

---

## 4. Key workflows

1. **Renewal canvass** – Edition enters canvass → renewal opportunities generated → rep contacts advertiser → order built from prior edition → signed → approved → ad copy collected → proof approved before close date → edition publishes → installment invoices issue monthly → payments applied → account is up for renewal again next year.
2. **New business** – Lead/prospect account created → opportunity → order → (same as above).
3. **Ad error claim** – Case opened (type *ad_error*) → investigated → adjustment credit approved → applied to open invoices → case resolved.
4. **Collections** – Invoice passes 30/60/90 days → dunning activities logged → credit hold at 90 → collections status at 120 → write‑off adjustment if uncollectible.
5. **Cancellation** – Case (type *cancellation_request*) → if before close: order cancelled, no billing; if after publish: contract stands (legacy directory contracts are non‑cancellable once printed), case documents the outcome.

---

## 5. Roles

| Role | Can |
|---|---|
| Sales rep | Manage own accounts/opportunities/orders (draft & submit), log activities, see own AR |
| Sales manager | Everything reps can do for their territory, approve orders, reassign accounts |
| Customer service | Cases, activities, copy status, contact updates |
| Billing / AR | Invoices, payments, adjustments, collections, credit hold |
| Production | Edition status, copy status, exports |
| Admin | Users, catalogue, rate cards |

Authentication and enforcement are **Phase 2**; the scaffold has users as data only.

---

## 6. Reporting

- **Sales**: pipeline by edition and rep; renewal rate (accounts renewed ÷ accounts eligible); new vs. renewal revenue; average contract value; upsell/downsell by account.
- **Production**: lines missing approved copy by edition; days to close.
- **Billing**: AR aging by account and territory; collections queue; revenue by directory/edition/product; cash received by period; adjustment volume by reason.
- **Service**: open cases by type/age; ad‑error credits as % of revenue.

---

## 7. Integrations (later)

- Print composition export (approved listings/ads per edition).
- Payment gateway for card/ACH.
- Email/SMS for proofs, invoices, dunning letters.
- Accounting GL export (revenue recognition per installment).
- Digital listing syndication (IYP, search engines).

---

## 8. Delivery phases

### Phase 1 — this scaffold (built)
- SQLite schema for all core entities.
- Deterministic **seed data**: directories, editions, headings, products, rate cards, reps, ~60 accounts with contacts/locations, orders with lines, invoice schedules, payments, adjustments, activities, tasks, cases, opportunities.
- Web UI (server‑rendered): dashboard, accounts (list/detail), directories & editions, orders, invoices, payments, cases, reports (AR aging, renewals, close‑date readiness).
- JSON API for the same entities.
- Billing service: generate installment invoices for an order; apply payments; compute aging.
- Tests for billing rules and API smoke.

### Phase 2
- Authentication, roles, audit log.
- Order builder UI with rate‑card lookup; order approval workflow.
- Renewal opportunity generation when an edition enters canvass.
- Dunning automation and statements.
- Commission calculation per rep.

### Phase 3
- Integrations listed in §7.
- Digital product bundles and performance reporting.
- Duplicate detection and data quality tooling.
