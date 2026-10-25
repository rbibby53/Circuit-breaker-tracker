import type { DB } from './db';

const DAY_MS = 86_400_000;
/** Used or expired one-time links are kept this long for the record, then removed. */
const KEEP_USED_LINKS_DAYS = 30;
const OIDC_STATE_MS = 10 * 60_000;

/** Remove expired sessions, abandoned sign-in attempts, old one-time links and long-expired API tokens. */
export function purgeExpired(
  db: DB,
  now = Date.now(),
): { sessions: number; states: number; challenges: number; invites: number; resets: number; tokens: number } {
  const iso = (ms: number) => new Date(ms).toISOString();
  const cutoff = iso(now - KEEP_USED_LINKS_DAYS * DAY_MS);
  return db.transaction(() => ({
    sessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(iso(now)).changes,
    states: db.prepare('DELETE FROM oidc_states WHERE created_at <= ?').run(iso(now - OIDC_STATE_MS)).changes,
    challenges: db.prepare('DELETE FROM login_challenges WHERE expires_at <= ?').run(iso(now)).changes,
    invites: db
      .prepare('DELETE FROM invites WHERE expires_at <= ? OR (used_at IS NOT NULL AND used_at <= ?)')
      .run(cutoff, cutoff).changes,
    resets: db
      .prepare('DELETE FROM reset_tokens WHERE expires_at <= ? OR (used_at IS NOT NULL AND used_at <= ?)')
      .run(cutoff, cutoff).changes,
    // Kept a while after expiring, so the owner sees why their script stopped.
    tokens: db.prepare('DELETE FROM api_tokens WHERE expires_at <= ?').run(cutoff).changes,
  }))();
}
