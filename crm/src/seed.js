/**
 * Deterministic seed data for the Yellow Pages CRM.
 * Run: npm run seed   (deletes and recreates the database)
 *
 * Dates are generated relative to "today" (override with SEED_TODAY=YYYY-MM-DD)
 * so dashboards show live-looking close dates, overdue invoices, and tasks.
 */
import { rmSync } from 'node:fs';
import { openDb, q, DEFAULT_DB_PATH } from './db.js';
import { addDays, addMonths, isoDate } from './lib/format.js';
import { generateInvoicesForOrder, applyPayment, applyAdjustment, recomputeOrderTotals, nextNumber } from './services/billing.js';

// ---------- deterministic PRNG ----------
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20240917);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const chance = (p) => rand() < p;

// ---------- reference data ----------
const TERRITORIES = [
  ['North Metro', 'Northeast'], ['South Metro', 'Northeast'], ['River Valley', 'Midwest'], ['Coastal', 'Southeast'],
];

const USERS = [
  ['Dana Whitfield', 'dana.whitfield@example.com', 'sales_manager', 1],
  ['Marcus Bell', 'marcus.bell@example.com', 'sales_rep', 1],
  ['Priya Natarajan', 'priya.natarajan@example.com', 'sales_rep', 2],
  ['Luis Ortega', 'luis.ortega@example.com', 'sales_rep', 3],
  ['Hannah Kim', 'hannah.kim@example.com', 'sales_rep', 4],
  ['Tom Reilly', 'tom.reilly@example.com', 'sales_rep', 2],
  ['Grace Okafor', 'grace.okafor@example.com', 'customer_service', null],
  ['Ben Sandoval', 'ben.sandoval@example.com', 'billing', null],
  ['Ruth Adler', 'ruth.adler@example.com', 'production', null],
  ['Sys Admin', 'admin@example.com', 'admin', null],
];

// code, name, market, state, region, distribution, publish month (1-12), rate multiplier, territory
const DIRECTORIES = [
  ['SPR', 'Greater Springfield', 'Springfield', 'IL', 'Midwest', 185000, 3, 1.0, 3],
  ['RVF', 'River Valley & Falls', 'Riverton', 'IL', 'Midwest', 62000, 6, 0.6, 3],
  ['NMT', 'North Metro', 'Northfield', 'NJ', 'Northeast', 240000, 9, 1.4, 1],
  ['SMT', 'South Metro', 'Southgate', 'NJ', 'Northeast', 210000, 11, 1.3, 2],
  ['CST', 'Coastal Counties', 'Port Ellis', 'FL', 'Southeast', 140000, 1, 0.9, 4],
  ['BAY', 'Bayshore', 'Bayshore', 'FL', 'Southeast', 95000, 5, 0.75, 4],
];

const HEADINGS = [
  'Accountants', 'Air Conditioning Contractors', 'Attorneys', 'Attorneys - Personal Injury', 'Auto Body Repair',
  'Auto Dealers - New', 'Auto Dealers - Used', 'Bail Bonds', 'Bakeries', 'Banks', 'Carpet Cleaning', 'Chiropractors',
  'Churches', 'Cleaning Services', 'Dentists', 'Electricians', 'Florists', 'Funeral Homes', 'Furniture Stores',
  'Glass - Auto', 'Hardware Stores', 'Heating Contractors', 'Insurance', 'Landscaping', 'Locksmiths', 'Moving Companies',
  'Optometrists', 'Painting Contractors', 'Pest Control', 'Pharmacies', 'Physicians', 'Pizza', 'Plumbing Contractors',
  'Real Estate', 'Restaurants', 'Roofing Contractors', 'Storage - Self Service', 'Tire Dealers', 'Towing', 'Veterinarians',
];

// code, name, category, size, base monthly cents
const PRODUCTS = [
  ['LST-BOLD', 'Bold Listing', 'listing', '1 line, bold type', 1200],
  ['LST-XLINE', 'Extra Line', 'listing', 'Additional listing line', 600],
  ['LST-TM', 'Trademark Listing', 'listing', 'Logo listing under heading', 2500],
  ['LST-ALT', 'Alternate Call Listing', 'listing', 'Second number after hours', 900],
  ['IC-HS', 'In-Column Half Space', 'in_column', '1/2 in. in-column', 4500],
  ['IC-1', 'In-Column 1 inch', 'in_column', '1 in. in-column', 7500],
  ['IC-2', 'In-Column 2 inch', 'in_column', '2 in. in-column', 13500],
  ['DSP-QP', 'Display Quarter Page', 'display', '1/4 page display', 42000],
  ['DSP-HP', 'Display Half Page', 'display', '1/2 page display', 78000],
  ['DSP-FP', 'Display Full Page', 'display', 'Full page display', 145000],
  ['DSP-COLOR', 'Spot Color Add-On', 'display', 'Adds spot color to display ad', 18000],
  ['COV-BACK', 'Back Cover', 'display', 'Outside back cover', 390000],
  ['DIG-IYP', 'Online Listing (IYP)', 'digital', 'Enhanced internet yellow pages profile', 3900],
  ['DIG-PRI', 'Online Priority Placement', 'digital', 'Top of category online', 9900],
];

const FIRST = ['James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda', 'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Carlos', 'Maria', 'Ahmed', 'Wei', 'Fatima', 'Nikolai', 'Aisha', 'Diego', 'Yuki', 'Olga'];
const LAST = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Nguyen', 'Patel', 'Kowalski', 'Schmidt', 'Rossi', 'Haddad'];
const STREETS = ['Main St', 'Oak Ave', 'Maple Dr', 'Commerce Blvd', 'Industrial Pkwy', 'Route 9', 'Mill Rd', 'Lakeview Ter', 'Front St', 'Pine St', 'Harbor Way', 'Union Ave'];
const TITLES = ['Owner', 'General Manager', 'Office Manager', 'Marketing Director', 'Bookkeeper', 'Partner', 'President'];

// Business name patterns keyed by heading
const NAME_PATTERNS = {
  'Accountants': ['{L} & Associates CPA', '{L} Tax & Accounting'],
  'Air Conditioning Contractors': ['{L} Heating & Cooling', 'Comfort Zone A/C', '{City} Air Systems'],
  'Attorneys': ['{L} & {L2} Law Offices', 'Law Office of {F} {L}'],
  'Attorneys - Personal Injury': ['{L} Injury Law', '{L} & {L2} Trial Lawyers'],
  'Auto Body Repair': ['{L} Collision Center', '{City} Auto Body'],
  'Auto Dealers - New': ['{L} Motors', '{City} Ford'],
  'Auto Dealers - Used': ['{L} Pre-Owned Autos', 'Budget Cars of {City}'],
  'Bail Bonds': ['{L} Bail Bonds', 'AAA Freedom Bail Bonds'],
  'Bakeries': ['{L} Bakery', 'Sweet Crumbs Bakery'],
  'Banks': ['{City} Savings Bank', 'First {City} Bank'],
  'Carpet Cleaning': ['{L} Carpet Care', 'Fresh Start Carpet Cleaning'],
  'Chiropractors': ['{L} Chiropractic', '{City} Spine & Wellness'],
  'Churches': ['{City} Community Church', 'St. {F} Parish'],
  'Cleaning Services': ['{L} Cleaning Co.', 'Spotless Commercial Cleaning'],
  'Dentists': ['{L} Family Dentistry', '{City} Dental Group'],
  'Electricians': ['{L} Electric', 'Bright Line Electrical'],
  'Florists': ['{L} Florist', '{City} Flower Shop'],
  'Funeral Homes': ['{L} Funeral Home', '{L} & Sons Funeral Chapel'],
  'Furniture Stores': ['{L} Furniture', '{City} Home Furnishings'],
  'Glass - Auto': ['{L} Auto Glass', 'ClearView Glass'],
  'Hardware Stores': ['{L} Hardware', '{City} True Value'],
  'Heating Contractors': ['{L} Heating & Air', 'Warm Home Heating'],
  'Insurance': ['{L} Insurance Agency', '{F} {L} - State Farm'],
  'Landscaping': ['{L} Landscaping', 'Green Acres Lawn & Garden'],
  'Locksmiths': ['{L} Lock & Key', '24 Hour Locksmith of {City}'],
  'Moving Companies': ['{L} Moving & Storage', 'Two Guys Moving'],
  'Optometrists': ['{L} Eye Care', '{City} Vision Center'],
  'Painting Contractors': ['{L} Painting', 'Fresh Coat Painters'],
  'Pest Control': ['{L} Pest Control', 'Bug Busters Exterminating'],
  'Pharmacies': ['{L} Pharmacy', '{City} Drug'],
  'Physicians': ['{L} Medical Associates', '{City} Family Practice'],
  'Pizza': ["{L}'s Pizza", '{City} Pizza Co.'],
  'Plumbing Contractors': ['{L} Plumbing', 'Rapid Rooter Plumbing'],
  'Real Estate': ['{L} Realty', '{City} Homes Real Estate'],
  'Restaurants': ["{L}'s Diner", 'The {City} Grill'],
  'Roofing Contractors': ['{L} Roofing', 'TopShield Roofing'],
  'Storage - Self Service': ['{City} Self Storage', '{L} Storage Center'],
  'Tire Dealers': ['{L} Tire & Auto', '{City} Tire Center'],
  'Towing': ['{L} Towing', '24/7 Towing of {City}'],
  'Veterinarians': ['{L} Animal Hospital', '{City} Veterinary Clinic'],
};

function phone(areaCode) {
  return `(${areaCode}) ${int(200, 999)}-${String(int(0, 9999)).padStart(4, '0')}`;
}

// ---------- seed ----------
export function seed(db, { today = isoDate(new Date()) } = {}) {
  const h = q(db);
  const thisYear = Number(today.slice(0, 4));

  h.tx(() => {
    for (const t of ['tasks', 'activities', 'cases', 'adjustments', 'payments', 'invoice_lines', 'invoices', 'order_lines', 'orders',
      'opportunities', 'rate_cards', 'contacts', 'locations', 'accounts', 'editions', 'directories', 'headings', 'products', 'users', 'territories']) {
      h.run(`DELETE FROM ${t}`);
    }
  });

  h.tx(() => {
    for (const [name, region] of TERRITORIES) h.run('INSERT INTO territories (name, region) VALUES (?, ?)', name, region);
    for (const [name, email, role, terr] of USERS) h.run('INSERT INTO users (name, email, role, territory_id) VALUES (?, ?, ?, ?)', name, email, role, terr);
    for (const [i, name] of HEADINGS.entries()) h.run('INSERT INTO headings (code, name) VALUES (?, ?)', String(1000 + i * 7), name);
    for (const [code, name, cat, size, cents] of PRODUCTS) h.run('INSERT INTO products (code, name, category, size_desc, base_monthly_cents) VALUES (?, ?, ?, ?, ?)', code, name, cat, size, cents);
  });

  const reps = h.all("SELECT * FROM users WHERE role = 'sales_rep'");
  const csr = h.get("SELECT * FROM users WHERE role = 'customer_service'");
  const billingUser = h.get("SELECT * FROM users WHERE role = 'billing'");
  const manager = h.get("SELECT * FROM users WHERE role = 'sales_manager'");
  const headings = h.all('SELECT * FROM headings');
  const products = h.all('SELECT * FROM products');
  const productByCode = Object.fromEntries(products.map((p) => [p.code, p]));

  // Directories + editions for last year, this year, next year.
  const editionsByDir = {};
  h.tx(() => {
    for (const [code, name, market, state, region, dist, pubMonth, mult, terr] of DIRECTORIES) {
      const res = h.run('INSERT INTO directories (code, name, market, state, region, distribution_qty) VALUES (?, ?, ?, ?, ?, ?)', code, name, market, state, region, dist);
      const dirId = Number(res.lastInsertRowid);
      editionsByDir[dirId] = { mult, terr, market, state, editions: [] };
      for (const year of [thisYear - 1, thisYear, thisYear + 1]) {
        const publish = `${year}-${String(pubMonth).padStart(2, '0')}-15`;
        const close = addDays(publish, -75);
        const canvass = addDays(publish, -200);
        const expires = addDays(addMonths(publish, 12), -1);
        let status;
        if (today >= expires) status = 'expired';
        else if (today >= publish) status = 'published';
        else if (today >= close) status = 'in_production';
        else if (today >= canvass) status = 'canvass';
        else status = 'planning';
        const er = h.run(
          'INSERT INTO editions (directory_id, edition_year, canvass_start, close_date, publish_date, expires_date, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          dirId, year, canvass, close, publish, expires, status,
        );
        const edId = Number(er.lastInsertRowid);
        editionsByDir[dirId].editions.push({ id: edId, year, canvass, close, publish, expires, status });
        for (const p of products) {
          h.run('INSERT INTO rate_cards (edition_id, product_id, monthly_cents) VALUES (?, ?, ?)', edId, p.id, Math.round((p.base_monthly_cents * mult) / 100) * 100);
        }
      }
    }
  });

  // Accounts
  const dirIds = Object.keys(editionsByDir).map(Number);
  const accounts = [];
  h.tx(() => {
    for (let i = 0; i < 64; i++) {
      const dirId = pick(dirIds);
      const dir = editionsByDir[dirId];
      const heading = pick(headings);
      const patterns = NAME_PATTERNS[heading.name] ?? ['{L} {Ind}'];
      const L = pick(LAST), L2 = pick(LAST), F = pick(FIRST);
      const name = pick(patterns).replace('{L2}', L2).replace('{L}', L).replace('{F}', F).replace('{City}', dir.market);
      const areaCode = { IL: 217, NJ: 973, FL: 941 }[dir.state];
      const statusRoll = rand();
      const status = statusRoll < 0.08 ? 'prospect' : statusRoll < 0.86 ? 'active' : statusRoll < 0.94 ? 'inactive' : 'collections';
      const repsInTerr = reps.filter((r) => r.territory_id === dir.terr);
      const rep = pick(repsInTerr.length ? repsInTerr : reps);
      const acctNumber = `A-${String(10000 + i * 13).padStart(6, '0')}`;
      const res = h.run(
        `INSERT INTO accounts (account_number, name, status, industry, phone, website, billing_street, billing_city, billing_state, billing_zip,
                               payment_terms, credit_hold, territory_id, owner_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        acctNumber, name, status, heading.name, phone(areaCode),
        chance(0.6) ? `www.${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.com` : null,
        `${int(10, 9999)} ${pick(STREETS)}`, dir.market, dir.state, String(int(10000, 99999)),
        pick(['net30', 'net30', 'net30', 'net15', 'net45']), status === 'collections' ? 1 : 0,
        dir.terr, rep.id, addDays(today, -int(30, 2500)) + ' 09:00:00',
      );
      const id = Number(res.lastInsertRowid);
      const acct = { id, name, status, dirId, heading, rep, areaCode, dir, locations: [], contacts: [] };
      accounts.push(acct);

      const nLoc = chance(0.25) ? 2 : 1;
      for (let l = 0; l < nLoc; l++) {
        const lr = h.run('INSERT INTO locations (account_id, name, street, city, state, zip, phone) VALUES (?, ?, ?, ?, ?, ?, ?)',
          id, l === 0 ? 'Main' : 'Branch', `${int(10, 9999)} ${pick(STREETS)}`, dir.market, dir.state, String(int(10000, 99999)), phone(areaCode));
        acct.locations.push(Number(lr.lastInsertRowid));
      }
      const nCon = int(1, 3);
      for (let c = 0; c < nCon; c++) {
        const fn = pick(FIRST), ln = c === 0 && chance(0.5) ? L : pick(LAST);
        const cr = h.run('INSERT INTO contacts (account_id, first_name, last_name, title, email, phone, is_primary, is_authorized_signer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          id, fn, ln, pick(TITLES), `${fn.toLowerCase()}.${ln.toLowerCase()}@example.com`, phone(areaCode), c === 0 ? 1 : 0, c === 0 ? 1 : 0);
        acct.contacts.push(Number(cr.lastInsertRowid));
      }
    }
  });

  // Orders: last-year edition (expired/published), this-year edition, and next-year renewals.
  const orders = [];
  function buildOrder(acct, edition, { orderType, status, signedDaysBefore, freq = 'monthly', linesFrom = null }) {
    const number = nextNumber(db, 'orders', 'order_number', 'ORD');
    const signedAt = status === 'draft' ? null : addDays(edition.close, -signedDaysBefore);
    const res = h.run(
      `INSERT INTO orders (order_number, account_id, edition_id, rep_user_id, status, order_type, billing_frequency, months, signed_at, signer_contact_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 12, ?, ?, ?)`,
      number, acct.id, edition.id, acct.rep.id, status, orderType, freq, signedAt, acct.contacts[0], (signedAt ?? addDays(today, -int(1, 20))) + ' 10:00:00',
    );
    const orderId = Number(res.lastInsertRowid);
    const rateFor = (p) => h.get('SELECT monthly_cents FROM rate_cards WHERE edition_id = ? AND product_id = ?', edition.id, p.id).monthly_cents;
    let lineSpecs;
    if (linesFrom) {
      lineSpecs = linesFrom.map((l) => ({ ...l }));
      if (chance(0.25)) lineSpecs.push({ code: pick(['DIG-IYP', 'DIG-PRI', 'LST-XLINE', 'DSP-COLOR']), headingId: acct.heading.id });
      if (chance(0.15) && lineSpecs.length > 1) lineSpecs.pop();
    } else {
      const tier = rand();
      const main = tier < 0.35 ? pick(['LST-BOLD', 'LST-TM', 'IC-HS']) : tier < 0.8 ? pick(['IC-1', 'IC-2', 'DSP-QP']) : pick(['DSP-HP', 'DSP-FP']);
      lineSpecs = [{ code: main, headingId: acct.heading.id }];
      if (chance(0.5)) lineSpecs.push({ code: 'DIG-IYP', headingId: acct.heading.id });
      if (chance(0.3)) lineSpecs.push({ code: 'LST-BOLD', headingId: pick(headings).id });
      if (main.startsWith('DSP') && chance(0.4)) lineSpecs.push({ code: 'DSP-COLOR', headingId: acct.heading.id });
    }
    const copyStatus = edition.status === 'published' || edition.status === 'expired' ? 'approved'
      : status === 'draft' ? 'pending' : pick(['pending', 'artwork_received', 'proof_sent', 'approved', 'approved']);
    for (const spec of lineSpecs) {
      const p = productByCode[spec.code];
      h.run('INSERT INTO order_lines (order_id, product_id, heading_id, location_id, qty, monthly_rate_cents, listing_text, ad_copy_status) VALUES (?, ?, ?, ?, 1, ?, ?, ?)',
        orderId, p.id, spec.headingId, acct.locations[0], rateFor(p), p.category === 'listing' ? acct.name : null, copyStatus);
    }
    recomputeOrderTotals(db, orderId);
    const o = { id: orderId, acct, edition, status, lineSpecs };
    orders.push(o);
    return o;
  }

  h.tx(() => {
    for (const acct of accounts) {
      if (acct.status === 'prospect') continue;
      const eds = acct.dir.editions; // [last, this, next]
      const [last, cur, next] = eds;
      let prior = null;
      if (chance(0.7)) prior = buildOrder(acct, last, { orderType: chance(0.6) ? 'renewal' : 'new', status: last.status === 'expired' ? 'published' : 'published', signedDaysBefore: int(5, 90) });
      if (acct.status === 'inactive') continue;
      let current = null;
      if (cur.status === 'published' || cur.status === 'in_production' || cur.status === 'closed') {
        current = buildOrder(acct, cur, {
          orderType: prior ? 'renewal' : 'new',
          status: cur.status === 'published' ? 'published' : 'in_production',
          signedDaysBefore: int(3, 80),
          freq: chance(0.12) ? 'annual' : 'monthly',
          linesFrom: prior?.lineSpecs,
        });
      } else if (cur.status === 'canvass') {
        if (chance(0.6)) current = buildOrder(acct, cur, { orderType: prior ? 'renewal' : 'new', status: pick(['draft', 'pending_approval', 'approved', 'approved']), signedDaysBefore: int(1, 30), linesFrom: prior?.lineSpecs });
      }
      if (next.status === 'canvass' && chance(0.45)) {
        buildOrder(acct, next, { orderType: 'renewal', status: pick(['draft', 'pending_approval', 'approved']), signedDaysBefore: int(1, 40), linesFrom: (current ?? prior)?.lineSpecs });
      }
    }
  });

  // Invoices for billable orders, then payments with realistic aging.
  h.tx(() => {
    for (const o of orders) {
      if (!['approved', 'in_production', 'published'].includes(o.status)) continue;
      if (o.edition.publish > today) continue; // nothing issued yet before publish
      const invoices = generateInvoicesForOrder(db, o.id);
      const payerProfile = o.acct.status === 'collections' ? 'bad' : rand() < 0.8 ? 'good' : 'slow';
      for (const inv of invoices) {
        if (inv.issue_date > today) continue;
        const dueAge = Math.round((new Date(today) - new Date(inv.due_date)) / 86400000);
        let pay = false, partial = false, lateDays = 0;
        if (payerProfile === 'good') { pay = dueAge > -25; lateDays = int(-20, 5); }
        else if (payerProfile === 'slow') { pay = dueAge > 35; lateDays = int(10, 45); partial = chance(0.2); }
        else { pay = dueAge > 120; lateDays = int(60, 110); }
        if (!pay) continue;
        const payDate = addDays(inv.due_date, lateDays);
        if (payDate > today) continue;
        const amount = partial ? Math.round(inv.total_cents * 0.5) : inv.total_cents;
        applyPayment(db, { accountId: o.acct.id, invoiceId: inv.id, amountCents: amount, method: pick(['check', 'check', 'ach', 'card']), paymentDate: payDate, reference: pick(['check', 'ach']) === 'check' ? `#${int(1000, 9999)}` : `ACH${int(100000, 999999)}` });
      }
    }
  });

  // Cases, adjustments, activities, tasks, opportunities
  h.tx(() => {
    const publishedOrders = orders.filter((o) => o.status === 'published');
    for (let i = 0; i < 12; i++) {
      const o = pick(publishedOrders);
      const line = h.get('SELECT * FROM order_lines WHERE order_id = ? LIMIT 1', o.id);
      const type = pick(['ad_error', 'ad_error', 'billing_dispute', 'cancellation_request', 'copy_change', 'other']);
      const status = pick(['open', 'in_progress', 'resolved', 'closed']);
      const opened = addDays(today, -int(2, 120));
      const subjects = {
        ad_error: 'Wrong phone number printed in display ad', billing_dispute: 'Customer disputes installment amount',
        cancellation_request: 'Customer requests cancellation of contract', copy_change: 'Update hours in listing text', other: 'General inquiry about directory distribution',
      };
      // Credit the oldest installment still carrying a balance (a future one if all issued installments are paid).
      const inv = h.get('SELECT id FROM invoices WHERE order_id = ? AND total_cents > paid_cents ORDER BY issue_date LIMIT 1', o.id);
      h.run(`INSERT INTO cases (case_number, account_id, order_line_id, invoice_id, owner_user_id, type, priority, status, subject, description, resolution, opened_at, resolved_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `CS-${String(i + 1).padStart(5, '0')}`, o.acct.id, line.id, type === 'billing_dispute' ? inv?.id : null, csr.id, type,
        type === 'ad_error' ? 'high' : 'normal', status, subjects[type], `Reported by customer via phone. ${subjects[type]}.`,
        status === 'resolved' || status === 'closed' ? 'Resolved with customer; credit issued where applicable.' : null,
        opened + ' 11:30:00', status === 'resolved' || status === 'closed' ? addDays(opened, int(1, 20)) + ' 15:00:00' : null);
      if (type === 'ad_error' && (status === 'resolved' || status === 'closed') && inv) {
        const invRow = h.get('SELECT * FROM invoices WHERE id = ?', inv.id);
        applyAdjustment(db, { accountId: o.acct.id, invoiceId: inv.id, orderLineId: line.id, amountCents: -Math.round(invRow.total_cents * 0.5), reason: 'ad_error', adjDate: addDays(opened, 5), approvedByUserId: manager.id, notes: 'Credit 50% of installment for printed error' });
      }
    }

    const subjectsByType = {
      call: ['Renewal call - discussed keeping half page', 'Left voicemail re: proof approval', 'Called about past-due balance', 'Intro call, prospecting new heading'],
      email: ['Sent proof PDF for approval', 'Emailed rate card for next edition', 'Sent statement of account'],
      meeting: ['On-site visit - reviewed ad performance', 'Renewal presentation with owner'],
      note: ['Owner prefers contact after 2pm', 'Considering adding second heading next year'],
      proof: ['Proof approved by customer', 'Artwork received from designer'],
      collections: ['Dunning notice 1 sent', 'Promise to pay by end of month'],
    };
    for (const acct of accounts) {
      const n = int(1, 6);
      for (let i = 0; i < n; i++) {
        const type = acct.status === 'collections' && chance(0.5) ? 'collections' : pick(['call', 'call', 'email', 'meeting', 'note', 'proof']);
        h.run('INSERT INTO activities (account_id, contact_id, user_id, type, subject, occurred_at) VALUES (?, ?, ?, ?, ?, ?)',
          acct.id, acct.contacts[0], type === 'collections' ? billingUser.id : acct.rep.id, type, pick(subjectsByType[type]), addDays(today, -int(0, 180)) + ` ${String(int(8, 17)).padStart(2, '0')}:${pick(['00', '15', '30', '45'])}:00`);
      }
      if (chance(0.45)) {
        h.run('INSERT INTO tasks (account_id, assigned_user_id, title, due_date, priority, status) VALUES (?, ?, ?, ?, ?, ?)',
          acct.id, acct.rep.id, pick(['Follow up on renewal', 'Collect ad artwork', 'Confirm proof approval', 'Schedule renewal visit', 'Verify listing phone numbers']),
          addDays(today, int(-10, 30)), pick(['normal', 'normal', 'high', 'low']), chance(0.2) ? 'done' : 'open');
      }
    }

    // Opportunities: renewal pipeline for editions in canvass, plus new-business prospects.
    for (const acct of accounts) {
      const next = acct.dir.editions.find((e) => e.status === 'canvass');
      if (!next) continue;
      const hasNextOrder = orders.some((o) => o.acct.id === acct.id && o.edition.id === next.id);
      const currentOrder = orders.filter((o) => o.acct.id === acct.id && o.edition.id !== next.id).pop();
      if (acct.status === 'prospect') {
        h.run('INSERT INTO opportunities (account_id, edition_id, rep_user_id, stage, source, est_monthly_cents, expected_close) VALUES (?, ?, ?, ?, ?, ?, ?)',
          acct.id, next.id, acct.rep.id, pick(['prospecting', 'contacted', 'proposal']), pick(['new', 'referral']), int(50, 400) * 100, addDays(next.close, -int(5, 40)));
      } else if (currentOrder && acct.status === 'active') {
        const monthly = h.get('SELECT total_monthly_cents AS m FROM orders WHERE id = ?', currentOrder.id).m;
        h.run('INSERT INTO opportunities (account_id, edition_id, rep_user_id, stage, source, est_monthly_cents, expected_close) VALUES (?, ?, ?, ?, ?, ?, ?)',
          acct.id, next.id, acct.rep.id, hasNextOrder ? 'closed_won' : pick(['prospecting', 'contacted', 'proposal', 'negotiation', 'closed_lost']), 'renewal', monthly, addDays(next.close, -int(5, 40)));
      }
    }
  });

  return {
    accounts: h.get('SELECT COUNT(*) c FROM accounts').c,
    orders: h.get('SELECT COUNT(*) c FROM orders').c,
    invoices: h.get('SELECT COUNT(*) c FROM invoices').c,
    payments: h.get('SELECT COUNT(*) c FROM payments').c,
  };
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  const path = DEFAULT_DB_PATH;
  for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
  const db = openDb(path);
  const counts = seed(db, { today: process.env.SEED_TODAY });
  db.close();
  console.log(`Seeded ${path}:`, counts);
}
