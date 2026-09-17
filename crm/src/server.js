import { existsSync } from 'node:fs';
import { openDb, DEFAULT_DB_PATH } from './db.js';
import { createApp } from './app.js';
import { seed } from './seed.js';

const port = Number(process.env.PORT || 3000);
const fresh = !existsSync(DEFAULT_DB_PATH);
const db = openDb(DEFAULT_DB_PATH);
if (fresh) {
  const counts = seed(db);
  console.log('No database found; seeded a new one:', counts);
}
createApp(db).listen(port, () => console.log(`Yellow Pages CRM listening on http://localhost:${port}`));
