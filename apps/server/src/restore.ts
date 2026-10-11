import fs from 'node:fs';
import type { BackupSummary } from '@cbt/core';
import Database from 'better-sqlite3';
import { migrate, type DB } from './db';
import { badRequest } from './errors';
import { MIGRATIONS } from './migrations';

const REQUIRED_TABLES = ['users', 'locations', 'grants', 'panels', 'breakers'];

/** Check that a file is a usable backup of this app and describe what is in it. */
export function inspectBackup(file: string): BackupSummary {
  let src: Database.Database;
  try {
    src = new Database(file, { readonly: true, fileMustExist: true });
    src.prepare('SELECT 1 FROM sqlite_master LIMIT 1').get();
  } catch {
    throw badRequest('That file is not a database backup. Use a .db file downloaded from Settings → Backup.');
  }
  try {
    const tables = new Set(
      (src.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
        (t) => t.name,
      ),
    );
    if (!tables.has('schema_version') || REQUIRED_TABLES.some((t) => !tables.has(t))) {
      throw badRequest('That database is not a Circuit Breaker Tracker backup.');
    }
    const integrity = src.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw badRequest('That backup is damaged and cannot be restored.');
    const schemaVersion = (src.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined)
      ?.version;
    if (!schemaVersion) throw badRequest('That backup is empty.');
    if (schemaVersion > MIGRATIONS.length) {
      throw badRequest('That backup is from a newer version of the app. Update the app first, then restore it.');
    }
    const count = (t: string) => (src.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    const last = tables.has('audit_log')
      ? (src.prepare('SELECT MAX(at) AS at FROM audit_log').get() as { at: string | null }).at
      : null;
    return {
      schemaVersion,
      bytes: fs.statSync(file).size,
      counts: {
        users: count('users'),
        locations: count('locations'),
        panels: count('panels'),
        breakers: count('breakers'),
      },
      lastChange: last,
    };
  } finally {
    src.close();
  }
}

/**
 * Replace everything in `db` with the contents of the backup at `file`, in one transaction.
 * The backup is first brought up to the current schema. Sessions are not restored, so
 * everyone signs in again and no sign-in from the backup's time comes back to life.
 */
export function restoreFrom(db: DB, file: string): void {
  const src = new Database(file);
  try {
    migrate(src);
  } finally {
    src.close();
  }

  const tables = (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_version'",
      )
      .all() as { name: string }[]
  ).map((t) => t.name);
  const skip = new Set(['sessions', 'oidc_states', 'login_challenges']);

  db.pragma('foreign_keys = OFF');
  db.prepare('ATTACH DATABASE ? AS src').run(file);
  try {
    db.transaction(() => {
      for (const t of tables) {
        db.prepare(`DELETE FROM main."${t}"`).run();
        if (skip.has(t)) continue;
        const cols = (db.prepare(`SELECT name FROM pragma_table_info(?, 'main')`).all(t) as { name: string }[])
          .map((c) => `"${c.name}"`)
          .join(', ');
        db.prepare(`INSERT INTO main."${t}" (${cols}) SELECT ${cols} FROM src."${t}"`).run();
      }
      const broken = db.pragma('foreign_key_check') as unknown[];
      if (broken.length) throw badRequest('That backup has broken links between records and cannot be restored.');
    })();
  } finally {
    db.prepare('DETACH DATABASE src').run();
    db.pragma('foreign_keys = ON');
  }
}
