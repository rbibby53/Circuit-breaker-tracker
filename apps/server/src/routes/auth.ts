import {
  acceptInviteSchema,
  changePasswordSchema,
  loginSchema,
  resetPasswordSchema,
  setupSchema,
  type AuthConfig,
} from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit';
import type { Config } from '../config';
import { requireAuth } from '../context';
import { now, type DB } from '../db';
import { conflict, forbidden, gone, notFound, parse } from '../errors';
import { applyInvite, inviteInfo, usableInvite } from '../invites';
import { finishOidc, startOidc, type OidcClaims, type OidcState } from '../oidc';
import { hashPassword, verifyPassword } from '../passwords';
import { countUsers, findUserByLogin, getUser, type UserRow } from '../repo';
import { clearSessionCookie, createSession, destroySession, destroyUserSessions } from '../sessions';
import { hashToken, isExpired } from '../tokens';
import { createUser, meResponse, uniqueUsername } from '../users';

const strictLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export function authRoutes(app: FastifyInstance, db: DB, config: Config): void {
  app.get('/api/auth/config', async (): Promise<AuthConfig> => ({
    needsSetup: countUsers(db) === 0,
    version: config.version,
    oidc: { enabled: !!config.oidc, label: config.oidc?.label ?? '' },
  }));

  app.post('/api/setup', { config: strictLimit }, async (req, reply) => {
    const body = parse(setupSchema, req.body);
    if (countUsers(db) > 0) throw conflict('Setup has already been completed.');
    const passwordHash = await hashPassword(body.password);
    // Re-check inside a transaction: two setup requests could race across the await above.
    const admin = db.transaction(() => {
      if (countUsers(db) > 0) throw conflict('Setup has already been completed.');
      const r = db
        .prepare(
          'INSERT INTO users (username, display_name, password_hash, is_admin, created_at) VALUES (?, ?, ?, 1, ?)',
        )
        .run(body.username, body.displayName, passwordHash, now());
      return getUser(db, Number(r.lastInsertRowid))!;
    })();
    audit(db, null, {
      action: 'setup',
      entity: 'user',
      entityId: admin.id,
      summary: `Created first admin ${admin.username}`,
    });
    createSession(db, config, reply, admin.id, req.headers['user-agent']);
    return { ok: true };
  });

  app.post('/api/auth/login', { config: strictLimit }, async (req, reply) => {
    const { username, password } = parse(loginSchema, req.body);
    const user = findUserByLogin(db, username);
    const ok = await verifyPassword(user?.password_hash, password);
    if (!user || !ok) throw forbidden('Wrong username or password.');
    if (user.disabled) throw forbidden('This account is disabled.');
    createSession(db, config, reply, user.id, req.headers['user-agent']);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.auth) destroySession(db, req.auth.sessionId);
    clearSessionCookie(config, reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => meResponse(db, requireAuth(req)));

  app.patch('/api/me', async (req) => {
    const auth = requireAuth(req);
    const body = parse(acceptInviteSchema.pick({ displayName: true }), req.body);
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(body.displayName, auth.realUser.id);
    return { ok: true };
  });

  app.post('/api/me/password', { config: strictLimit }, async (req) => {
    const auth = requireAuth(req);
    const body = parse(changePasswordSchema, req.body);
    const me = auth.realUser;
    if (me.password_hash && !(await verifyPassword(me.password_hash, body.currentPassword ?? ''))) {
      throw forbidden('Your current password is wrong.');
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(body.newPassword), me.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(me.id, auth.sessionId);
    audit(db, auth, { action: 'user.password', entity: 'user', entityId: me.id, summary: 'Changed own password' });
    return { ok: true };
  });

  // ---- Invites (public) -------------------------------------------------------------

  app.get('/api/invites/:token', async (req) => {
    const { token } = req.params as { token: string };
    const { invite, access } = usableInvite(db, token);
    return inviteInfo(db, invite, access);
  });

  app.post('/api/invites/:token/accept', { config: strictLimit }, async (req, reply) => {
    const { token } = req.params as { token: string };
    const { invite, access } = usableInvite(db, token);
    if (
      req.auth &&
      !req.auth.readOnly &&
      (req.body === undefined || req.body === null || Object.keys(req.body as object).length === 0)
    ) {
      // Already signed in: add the access to this account.
      applyInvite(db, invite, access, req.auth.realUser.id, req.auth);
      return { ok: true };
    }
    const body = parse(acceptInviteSchema, req.body);
    const user = await createUser(db, body);
    applyInvite(db, invite, access, user.id, null);
    audit(db, null, {
      action: 'user.create',
      entity: 'user',
      entityId: user.id,
      summary: `${user.username} joined by invite`,
    });
    createSession(db, config, reply, user.id, req.headers['user-agent']);
    return { ok: true };
  });

  // ---- Password reset links (public) ------------------------------------------------

  const usableReset = (token: string) => {
    const row = db.prepare('SELECT * FROM reset_tokens WHERE token_hash = ?').get(hashToken(token)) as
      { id: number; user_id: number; expires_at: string; used_at: string | null } | undefined;
    if (!row) throw notFound('This reset link is not valid.');
    if (row.used_at) throw gone('This reset link has already been used.');
    if (isExpired(row.expires_at)) throw gone('This reset link has expired.');
    const user = getUser(db, row.user_id);
    if (!user || user.disabled) throw gone('This account is not active.');
    return { row, user };
  };

  app.get('/api/reset/:token', async (req) => {
    const { user, row } = usableReset((req.params as { token: string }).token);
    return { username: user.username, displayName: user.display_name, expiresAt: row.expires_at };
  });

  app.post('/api/reset/:token', { config: strictLimit }, async (req, reply) => {
    const { user, row } = usableReset((req.params as { token: string }).token);
    const { password } = parse(resetPasswordSchema, req.body);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), user.id);
    db.prepare('UPDATE reset_tokens SET used_at = ? WHERE id = ?').run(now(), row.id);
    destroyUserSessions(db, user.id);
    audit(db, null, {
      action: 'user.reset',
      entity: 'user',
      entityId: user.id,
      summary: `${user.username} set a new password from a reset link`,
    });
    createSession(db, config, reply, user.id, req.headers['user-agent']);
    return { ok: true };
  });

  // ---- OIDC (Microsoft Entra ID or any OIDC provider) -------------------------------

  app.get('/api/auth/oidc/start', async (req, reply) => {
    if (!config.oidc) throw notFound('Single sign-on is not configured.');
    const q = req.query as { invite?: string; link?: string };
    let linkUserId: number | undefined;
    if (q.link) {
      const auth = requireAuth(req);
      if (auth.readOnly) throw forbidden('Exit view-as first.');
      linkUserId = auth.realUser.id;
    }
    const url = await startOidc(db, config, { inviteToken: q.invite, linkUserId });
    return reply.redirect(url);
  });

  app.get('/api/auth/oidc/callback', async (req, reply) => {
    if (!config.oidc) throw notFound('Single sign-on is not configured.');
    const callbackUrl = new URL(req.url, config.publicUrl!);
    try {
      const { claims, state } = await finishOidc(db, config, callbackUrl);
      const result = await completeOidcLogin(db, claims, state);
      createSession(db, config, reply, result.userId, req.headers['user-agent']);
      return reply.redirect(result.redirect);
    } catch (err) {
      req.log.warn({ err }, 'OIDC sign-in failed');
      const message = err instanceof Error ? err.message : 'Sign-in failed.';
      return reply.redirect(`/login?error=${encodeURIComponent(message)}`);
    }
  });
}

/**
 * Decide what an SSO sign-in means: an existing linked account, linking to the signed-in
 * user, or a new account created from an invite. Identities are matched by issuer and
 * subject, never by email.
 */
export async function completeOidcLogin(
  db: DB,
  claims: OidcClaims,
  state: OidcState,
): Promise<{ userId: number; redirect: string }> {
  const linked = db
    .prepare('SELECT user_id FROM user_identities WHERE issuer = ? AND subject = ?')
    .get(claims.issuer, claims.subject) as { user_id: number } | undefined;

  if (state.linkUserId) {
    if (linked && linked.user_id !== state.linkUserId) {
      throw new Error('That Microsoft account is already linked to another user.');
    }
    if (!linked) {
      db.prepare(
        'INSERT INTO user_identities (user_id, provider, issuer, subject, email, linked_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(state.linkUserId, 'oidc', claims.issuer, claims.subject, claims.email, now());
      audit(db, null, {
        action: 'user.link',
        entity: 'user',
        entityId: state.linkUserId,
        summary: 'Linked a single sign-on account',
      });
    }
    return { userId: state.linkUserId, redirect: '/account?linked=1' };
  }

  let user: UserRow | undefined = linked ? getUser(db, linked.user_id) : undefined;
  if (user?.disabled) throw new Error('This account is disabled.');

  if (state.inviteToken) {
    const { invite, access } = usableInvite(db, state.inviteToken);
    if (!user) {
      const base = claims.preferredUsername ?? claims.email ?? `sso-${claims.subject.slice(0, 8)}`;
      const emailFree = claims.email && !db.prepare('SELECT 1 FROM users WHERE email = ?').get(claims.email);
      user = await createUser(db, {
        username: uniqueUsername(db, base),
        displayName: claims.name ?? claims.preferredUsername ?? claims.email ?? 'New user',
        email: emailFree ? claims.email : null,
      });
      db.prepare(
        'INSERT INTO user_identities (user_id, provider, issuer, subject, email, linked_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(user.id, 'oidc', claims.issuer, claims.subject, claims.email, now());
      audit(db, null, {
        action: 'user.create',
        entity: 'user',
        entityId: user.id,
        summary: `${user.username} joined by invite with single sign-on`,
      });
    }
    applyInvite(db, invite, access, user.id, null);
    return { userId: user.id, redirect: '/' };
  }

  if (!user) {
    throw new Error('No account is linked to that sign-in yet. Ask for an invite link.');
  }
  return { userId: user.id, redirect: '/' };
}
