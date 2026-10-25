// Personal API tokens: how a script reads what its owner can see, without a browser.

import type { ApiTokenInfo } from '@cbt/core';
import type { FastifyRequest } from 'fastify';
import { now, type DB } from './db';
import { getUser } from './repo';
import type { AuthState } from './sessions';
import { daysFromNow, hashToken, isExpired, newToken } from './tokens';

/** Marks our tokens, so other Authorization headers pass by and secret scanners can spot a leak. */
const PREFIX = 'cbt_';
export const MAX_TOKENS_PER_USER = 25;
const USED_INTERVAL_MS = 60_000;

/**
 * What a token may read: the records, never accounts, people or administration. It lists what
 * is allowed, so a page added later stays out of reach until it is added here.
 */
const READABLE =
  /^\/api\/(auth\/me|locations|panels|equipment|generators|meters|power-devices|transfer-switches|feed-options|impact|reports|search|tags|verifications|activity)(\/|$)/;
/** Who has access to a place, and its invite links. */
const UNREADABLE = /^\/api\/locations\/[^/]+\/(access|invites)(\/|$)/;

/** Dot segments and encoded slashes. No route uses them, so they are refused rather than left to the router. */
const ODD = /(^|\/)\.\.?(\/|$)|%2e|%2f|%5c|\\/i;

export const tokenCanRead = (path: string): boolean => READABLE.test(path) && !UNREADABLE.test(path) && !ODD.test(path);

export interface ApiTokenRow {
  id: number;
  user_id: number;
  name: string;
  token_hash: string;
  hint: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
}

/**
 * The token from "Authorization: Bearer cbt_…", or null. Any other Authorization header is left
 * alone: a reverse proxy may send its own (HTTP Basic, or its own bearer token) with browser requests.
 */
export function bearerToken(req: FastifyRequest): string | null {
  const m = /^Bearer\s+(cbt_\S+)\s*$/i.exec(req.headers.authorization ?? '');
  return m ? m[1]! : null;
}

export function createApiToken(
  db: DB,
  userId: number,
  name: string,
  days: number | null,
): { token: string; row: ApiTokenRow } {
  const token = PREFIX + newToken().token;
  const r = db
    .prepare(
      'INSERT INTO api_tokens (user_id, name, token_hash, hint, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(userId, name, hashToken(token), token.slice(-4), now(), days === null ? null : daysFromNow(days));
  return { token, row: db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(r.lastInsertRowid) as ApiTokenRow };
}

/** Resolve a token into its owner's access, read-only. Null when it is wrong, expired or revoked. */
export function loadTokenAuth(db: DB, req: FastifyRequest, token: string): AuthState | null {
  const row = db.prepare('SELECT * FROM api_tokens WHERE token_hash = ?').get(hashToken(token)) as
    ApiTokenRow | undefined;
  if (!row || (row.expires_at && isExpired(row.expires_at))) return null;
  const user = getUser(db, row.user_id);
  if (!user || user.disabled) return null;
  if (
    !row.last_used_at ||
    row.last_used_ip !== req.ip ||
    Date.now() - Date.parse(row.last_used_at) > USED_INTERVAL_MS
  ) {
    db.prepare('UPDATE api_tokens SET last_used_at = ?, last_used_ip = ? WHERE id = ?').run(now(), req.ip, row.id);
  }
  return { sessionId: '', realUser: user, user, readOnly: true, apiToken: { id: row.id, name: row.name } };
}

export const tokenInfo = (row: ApiTokenRow): ApiTokenInfo => ({
  id: row.id,
  name: row.name,
  hint: row.hint,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  expired: !!row.expires_at && isExpired(row.expires_at),
  lastUsedAt: row.last_used_at,
  lastUsedIp: row.last_used_ip,
});
