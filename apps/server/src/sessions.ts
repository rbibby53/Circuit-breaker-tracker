import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config';
import { now, type DB } from './db';
import { getUser, type UserRow } from './repo';
import { daysFromNow, hashToken, isExpired, newToken } from './tokens';

export const SESSION_COOKIE = 'cbt_session';

export interface AuthState {
  sessionId: string;
  /** The person who signed in. */
  realUser: UserRow;
  /** The user whose permissions apply: the viewed user while viewing as someone. */
  user: UserRow;
  /** True while viewing as someone else; every write is refused. */
  readOnly: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthState | null;
  }
}

interface SessionRow {
  id: string;
  user_id: number;
  acting_as_user_id: number | null;
  expires_at: string;
}

export function createSession(db: DB, config: Config, reply: FastifyReply, userId: number, userAgent?: string): void {
  const { token, hash } = newToken();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)').run(
    hash,
    userId,
    now(),
    daysFromNow(config.sessionDays),
    userAgent?.slice(0, 300) ?? null,
  );
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: config.sessionDays * 86_400,
  });
}

export function clearSessionCookie(config: Config, reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure });
}

export function destroySession(db: DB, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function destroyUserSessions(db: DB, userId: number): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

const SEEN_INTERVAL_MS = 60_000;

/** Resolve the session cookie into an AuthState, or null. */
export function loadAuth(db: DB, req: FastifyRequest): AuthState | null {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const id = hashToken(token);
  const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  if (!s) return null;
  if (isExpired(s.expires_at)) {
    destroySession(db, id);
    return null;
  }
  const realUser = getUser(db, s.user_id);
  if (!realUser || realUser.disabled) return null;

  if (!realUser.last_seen_at || Date.now() - Date.parse(realUser.last_seen_at) > SEEN_INTERVAL_MS) {
    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now(), realUser.id);
  }

  let user = realUser;
  if (s.acting_as_user_id && realUser.is_admin) {
    const acting = getUser(db, s.acting_as_user_id);
    if (acting) user = acting;
  }
  return { sessionId: id, realUser, user, readOnly: user.id !== realUser.id };
}
