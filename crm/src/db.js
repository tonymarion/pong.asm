import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB_PATH = process.env.CRM_DB_PATH || join(here, '..', 'data', 'crm.db');

/** Open (and migrate) a database. Pass ':memory:' for tests. */
export function openDb(path = DEFAULT_DB_PATH) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  return db;
}

const txDepth = new WeakMap();

/** Small query helpers so route code stays readable. */
export function q(db) {
  return {
    all: (sql, ...params) => db.prepare(sql).all(...params),
    get: (sql, ...params) => db.prepare(sql).get(...params),
    run: (sql, ...params) => db.prepare(sql).run(...params),
    /** Run fn inside a transaction (nestable via savepoints); rolls back on throw. */
    tx(fn) {
      const depth = txDepth.get(db) ?? 0;
      const nested = depth > 0;
      const name = `sp${depth}`;
      db.exec(nested ? `SAVEPOINT ${name}` : 'BEGIN');
      txDepth.set(db, depth + 1);
      try {
        const out = fn();
        db.exec(nested ? `RELEASE ${name}` : 'COMMIT');
        return out;
      } catch (e) {
        db.exec(nested ? `ROLLBACK TO ${name}; RELEASE ${name}` : 'ROLLBACK');
        throw e;
      } finally {
        txDepth.set(db, depth);
      }
    },
  };
}
