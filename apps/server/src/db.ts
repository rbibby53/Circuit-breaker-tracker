import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { FOREIGN_KEYS_OFF, MIGRATIONS } from './migrations';

export type DB = Database.Database;

export function openDatabase(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db: DB): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  let current = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  for (const [i, sql] of MIGRATIONS.entries()) {
    const version = i + 1;
    if (version <= current) continue;
    // Foreign keys can only be switched off outside a transaction.
    const keysOff = sql.trimStart().startsWith(FOREIGN_KEYS_OFF);
    const keysWereOn = db.pragma('foreign_keys', { simple: true }) === 1;
    if (keysOff) db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(sql);
        if (keysOff && (db.pragma('foreign_key_check') as unknown[]).length) {
          throw new Error(`Database upgrade ${version} would break links between records.`);
        }
        db.prepare('UPDATE schema_version SET version = ?').run(version);
      })();
    } finally {
      if (keysOff && keysWereOn) db.pragma('foreign_keys = ON');
    }
    current = version;
  }
}

export const now = (): string => new Date().toISOString();
