import type { MeResponse } from '@cbt/core';
import { now, type DB } from './db';
import { conflict } from './errors';
import { hashPassword } from './passwords';
import { toSummary, type UserRow } from './repo';
import type { AuthState } from './sessions';

export async function createUser(
  db: DB,
  input: { username: string; displayName: string; password?: string; email?: string | null; isAdmin?: boolean },
): Promise<UserRow> {
  const taken = db.prepare('SELECT 1 FROM users WHERE username = ?').get(input.username);
  if (taken) throw conflict('That username is taken.');
  if (input.email && db.prepare('SELECT 1 FROM users WHERE email = ?').get(input.email)) {
    throw conflict('That email is already used by another account.');
  }
  const passwordHash = input.password ? await hashPassword(input.password) : null;
  const r = db
    .prepare(
      'INSERT INTO users (username, display_name, email, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(input.username, input.displayName, input.email ?? null, passwordHash, input.isAdmin ? 1 : 0, now());
  return db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid) as UserRow;
}

/** Turn an SSO username or email into a free local username. */
export function uniqueUsername(db: DB, base: string): string {
  const clean = base.replace(/[^A-Za-z0-9._@-]/g, '').slice(0, 56) || 'user';
  let candidate = clean.length >= 2 ? clean : `${clean}user`;
  for (let i = 2; db.prepare('SELECT 1 FROM users WHERE username = ?').get(candidate); i++) {
    candidate = `${clean}${i}`;
  }
  return candidate;
}

export function meResponse(db: DB, auth: AuthState): MeResponse {
  const identities = db
    .prepare('SELECT provider, email FROM user_identities WHERE user_id = ?')
    .all(auth.realUser.id) as { provider: string; email: string | null }[];
  return {
    user: toSummary(auth.user),
    realUser: toSummary(auth.realUser),
    viewingAs: auth.readOnly,
    hasPassword: !!auth.realUser.password_hash,
    identities,
  };
}

export function adminCount(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND disabled = 0').get() as { n: number }).n;
}
