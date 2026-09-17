import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { q } from './db.js';
import { money, titleCase, isoDate } from './lib/format.js';
import dashboard from './routes/dashboard.js';
import accounts from './routes/accounts.js';
import catalog from './routes/catalog.js';
import orders from './routes/orders.js';
import billing from './routes/billing.js';
import service from './routes/service.js';
import reports from './routes/reports.js';
import api from './routes/api.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Build the Express app around an open database. `today` is overridable for tests. */
export function createApp(db, { today = () => isoDate(new Date()) } = {}) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', join(here, 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use('/static', express.static(join(here, '..', 'public')));

  app.use((req, res, next) => {
    req.db = db;
    req.q = q(db);
    req.today = today();
    res.locals.money = money;
    res.locals.titleCase = titleCase;
    res.locals.today = req.today;
    res.locals.path = req.path;
    res.locals.flash = req.query.flash ?? null;
    next();
  });

  app.use('/', dashboard);
  app.use('/accounts', accounts);
  app.use('/', catalog);
  app.use('/orders', orders);
  app.use('/', billing);
  app.use('/', service);
  app.use('/reports', reports);
  app.use('/api', api);

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
    res.status(404).render('error', { title: 'Not found', message: `No page at ${req.path}` });
  });
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status ?? 400;
    if (req.path.startsWith('/api/')) return res.status(status).json({ error: err.message });
    res.status(status).render('error', { title: 'Error', message: err.message });
  });
  return app;
}
