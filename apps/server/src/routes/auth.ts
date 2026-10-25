import {
  acceptInviteSchema,
  inAnyGroup,
  inGroup,
  parseGroupList,
  updateMeSchema,
  changePasswordSchema,
  loginSchema,
  resetPasswordSchema,
  setupSchema,
  type AuthConfig,
  type SessionInfo,
  withParentGroups,
} from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit';
import type { Config } from '../config';
import { requireAuth } from '../context';
import { now, type DB } from '../db';
import { conflict, forbidden, gone, idParam, notFound, parse } from '../errors';
import { applyInvite, inviteInfo, usableInvite } from '../invites';
import { finishOidc, startOidc, type OidcClaims, type OidcState } from '../oidc';
import { hashPassword, verifyPassword } from '../passwords';
import { countUsers, findUserByLogin, getUser, type UserRow } from '../repo';
import { deviceName } from '../device';
import { clearSessionCookie, createSession, destroySession, destroyUserSessions, type SessionRow } from '../sessions';
import { hashToken, isExpired } from '../tokens';
import { adminCount, createUser, meResponse, uniqueUsername } from '../users';
import { logger } from '../log';
import { startTotpChallenge } from './totp';

const strictLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

export function authRoutes(app: FastifyInstance, db: DB, config: Config): void {
  app.get('/api/auth/config', async (): Promise<AuthConfig> => ({
    needsSetup: countUsers(db) === 0,
    version: config.version,
    appName: config.settings.get('appName'),
    localLogin: config.settings.get('allowLocalLogin'),
    panelDefaults: {
      spaces: config.settings.get('defaultSpaces'),
      mainAmps: config.settings.get('defaultMainAmps'),
      voltage: config.settings.get('defaultVoltage'),
    },
    paperSize: config.settings.get('paperSize'),
    publicPanels: config.settings.get('publicPanels'),
    gravatar: config.settings.get('gravatar'),
    apiTokens: config.settings.get('allowApiTokens'),
    oidc: { enabled: !!config.oidc, label: config.oidc?.label ?? '', provider: config.oidc?.provider ?? '' },
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
    createSession(db, config, reply, admin.id, req.headers['user-agent'], 'first-run setup');
    return { ok: true };
  });

  app.post('/api/auth/login', { config: strictLimit }, async (req, reply) => {
    const { username, password } = parse(loginSchema, req.body);
    const user = findUserByLogin(db, username);
    const ok = await verifyPassword(user?.password_hash, password);
    // The reason goes on the request's log line; the person only sees the generic message.
    const refuse = (why: string, message: string) => {
      req.failure = `Sign-in refused for ${JSON.stringify(username)}: ${why}`;
      return forbidden(message);
    };
    if (!user) throw refuse('no such account', 'Wrong username or password.');
    if (!ok)
      throw refuse(user.password_hash ? 'wrong password' : 'account has no password', 'Wrong username or password.');
    if (user.disabled) throw refuse('account is disabled', 'This account is disabled.');
    // Admins can always use their password, so turning this off can never lock everyone out.
    if (!config.settings.get('allowLocalLogin') && !user.is_admin) {
      throw refuse(
        'password sign-in is turned off',
        'Password sign-in is turned off here. Use the single sign-on button.',
      );
    }
    // With two-step sign-in on, the session only starts once a code is checked.
    if (user.totp_enabled_at) {
      req.log.debug(`Password accepted for ${user.username}; waiting for their two-step code`);
      return { totpRequired: true, challenge: startTotpChallenge(db, user.id) };
    }
    createSession(db, config, reply, user.id, req.headers['user-agent'], 'password');
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.auth) {
      destroySession(db, req.auth.sessionId);
      req.log.info(`Signed out: ${req.auth.realUser.username}`);
    }
    clearSessionCookie(config, reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => meResponse(db, requireAuth(req)));

  app.patch('/api/me', async (req) => {
    const auth = requireAuth(req);
    const body = parse(updateMeSchema, req.body);
    const me = auth.realUser;
    if (body.displayName !== undefined) {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(body.displayName, me.id);
    }
    if (body.email !== undefined) {
      const email = body.email || null;
      const taken = email && db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, me.id);
      if (taken) throw conflict('Someone else already uses that email address.');
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, me.id);
    }
    return { ok: true };
  });

  // ---- Where you're signed in -------------------------------------------------------

  app.get('/api/me/sessions', async (req): Promise<SessionInfo[]> => {
    const auth = requireAuth(req);
    const rows = db
      .prepare('SELECT rowid, * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC')
      .all(auth.realUser.id, now()) as SessionRow[];
    return rows.map((r) => ({
      id: r.rowid,
      current: r.id === auth.sessionId,
      device: deviceName(r.user_agent),
      method: r.method,
      ip: r.ip,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      expiresAt: r.expires_at,
    }));
  });

  app.delete('/api/me/sessions/:id', async (req, reply) => {
    const auth = requireAuth(req);
    const rowid = idParam((req.params as { id: string }).id);
    const row = db
      .prepare('SELECT rowid, * FROM sessions WHERE rowid = ? AND user_id = ?')
      .get(rowid, auth.realUser.id) as SessionRow | undefined;
    if (!row) throw notFound('That sign-in has already ended.');
    destroySession(db, row.id);
    if (row.id === auth.sessionId) clearSessionCookie(config, reply);
    req.log.info(`Signed out: ${auth.realUser.username} ended their session on ${deviceName(row.user_agent)}`);
    return { ok: true };
  });

  app.post('/api/me/sessions/sign-out-others', async (req) => {
    const auth = requireAuth(req);
    const n = db
      .prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
      .run(auth.realUser.id, auth.sessionId).changes;
    req.log.info(`Signed out: ${auth.realUser.username} ended ${n} other session${n === 1 ? '' : 's'}`);
    return { ok: true, signedOut: n };
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
    if (!config.settings.get('allowLocalLogin')) {
      throw forbidden('Password accounts are turned off here. Accept the invite with single sign-on.');
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
    createSession(db, config, reply, user.id, req.headers['user-agent'], 'new account from an invite');
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
    // A reset link does not get around two-step sign-in: they sign in with the new password and a code.
    if (user.totp_enabled_at) return { ok: true, signIn: true };
    createSession(db, config, reply, user.id, req.headers['user-agent'], 'password reset link');
    return { ok: true };
  });

  // ---- OIDC (Microsoft Entra ID, Authentik or any OIDC provider) --------------------

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
      const result = await completeOidcLogin(db, claims, state, ssoRules(config));
      const provider = config.oidc.provider;
      createSession(
        db,
        config,
        reply,
        result.userId,
        req.headers['user-agent'],
        state.linkUserId ? `${provider}, linking it to their account` : provider,
      );
      return reply.redirect(result.redirect);
    } catch (err) {
      req.log.warn(
        `${config.oidc.provider} sign-in failed from ${req.ip}: ${err instanceof Error ? err.message : String(err)}`,
      );
      const message = err instanceof Error ? err.message : 'Sign-in failed.';
      return reply.redirect(`/login?error=${encodeURIComponent(message)}`);
    }
  });
}

/**
 * The email an SSO sign-in vouches for. Entra ID often leaves out the `email` claim and sends
 * the address as `preferred_username` (the sign-in name), so that is used when it is an email.
 */
export function ssoEmail(claims: Pick<OidcClaims, 'email' | 'preferredUsername'>): string | null {
  const isEmail = (v: string | null | undefined): v is string => !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
  const email = isEmail(claims.email)
    ? claims.email
    : isEmail(claims.preferredUsername)
      ? claims.preferredUsername
      : null;
  return email ? email.trim().toLowerCase() : null;
}

/** Give an account the SSO email when it has none yet and nobody else uses it. Never overwrites. */
function fillEmail(db: DB, userId: number, email: string | null): void {
  if (!email) return;
  db.prepare(
    'UPDATE users SET email = ? WHERE id = ? AND email IS NULL AND NOT EXISTS (SELECT 1 FROM users WHERE email = ?)',
  ).run(email, userId, email);
}

/** How single sign-on groups are used, from the settings. */
export interface SsoRules {
  provider: string;
  adminGroups: string[];
  allowedGroups: string[];
  createAccounts: boolean;
}

const NO_GROUP_RULES: SsoRules = {
  provider: 'single sign-on',
  adminGroups: [],
  allowedGroups: [],
  createAccounts: false,
};

export function ssoRules(config: Config): SsoRules {
  const s = config.settings;
  return {
    provider: config.oidc?.provider ?? 'single sign-on',
    adminGroups: parseGroupList(s.get('oidcAdminGroups')),
    allowedGroups: parseGroupList(s.get('oidcAllowedGroups')),
    createAccounts: s.get('oidcCreateAccounts'),
  };
}

/** Whether these groups would give someone any access: an admin group or a group with access. */
function groupsGiveAccess(db: DB, groups: readonly string[], rules: SsoRules): boolean {
  if (inAnyGroup(groups, rules.adminGroups)) return true;
  const mapped = db.prepare('SELECT DISTINCT group_name FROM sso_group_grants').all() as { group_name: string }[];
  return mapped.some((m) => inGroup(groups, m.group_name));
}

/**
 * Record someone's groups from this sign-in (group access is worked out from them), and make
 * them an admin or not when admin groups are set. Admin rights given by hand are left alone,
 * and the last admin is never removed.
 */
export function applySsoGroups(db: DB, userId: number, groups: string[] | null, rules: SsoRules): void {
  const user = getUser(db, userId)!;
  const list = groups ?? [];
  const before = user.sso_groups;
  db.prepare('UPDATE users SET sso_groups = ?, sso_groups_at = ? WHERE id = ?').run(
    JSON.stringify(list),
    now(),
    userId,
  );
  if (before !== JSON.stringify(list)) {
    logger()?.info(`${user.username}'s groups from ${rules.provider}: ${list.length ? list.join(', ') : 'none'}`);
  }
  if (groups === null && (rules.adminGroups.length || rules.allowedGroups.length)) {
    logger()?.warn(
      `${rules.provider} sent no groups for ${user.username}. Check the groups claim setting and that the provider includes it.`,
    );
  }
  if (!rules.adminGroups.length) return;
  const isAdminByGroup = inAnyGroup(list, rules.adminGroups);
  if (isAdminByGroup && !user.is_admin) {
    db.prepare('UPDATE users SET is_admin = 1, admin_from_sso = 1 WHERE id = ?').run(userId);
    audit(db, null, {
      action: 'user.admin',
      entity: 'user',
      entityId: userId,
      summary: `${user.display_name} became an admin through their ${rules.provider} groups`,
    });
  } else if (!isAdminByGroup && user.is_admin && user.admin_from_sso) {
    if (adminCount(db) <= 1) {
      logger()?.warn(`${user.username} left the admin groups but is the only admin, so they stay an admin.`);
      return;
    }
    db.prepare('UPDATE users SET is_admin = 0, admin_from_sso = 0 WHERE id = ?').run(userId);
    audit(db, null, {
      action: 'user.admin',
      entity: 'user',
      entityId: userId,
      summary: `${user.display_name} is no longer an admin: not in an admin group in ${rules.provider}`,
    });
  }
}

/**
 * Decide what an SSO sign-in means: an existing linked account, linking to the signed-in
 * user, a new account created from an invite, or (when groups give access) a new account
 * from groups. Identities are matched by issuer and subject, never by email.
 */
export async function completeOidcLogin(
  db: DB,
  claims: OidcClaims,
  state: OidcState,
  rules: SsoRules = NO_GROUP_RULES,
): Promise<{ userId: number; redirect: string }> {
  // Nested groups sent as paths count for every group above them.
  claims = { ...claims, groups: claims.groups && withParentGroups(claims.groups) };
  const linked = db
    .prepare('SELECT user_id FROM user_identities WHERE issuer = ? AND subject = ?')
    .get(claims.issuer, claims.subject) as { user_id: number } | undefined;
  const email = ssoEmail(claims);
  const groups = claims.groups ?? [];
  const provider = rules.provider === 'single sign-on' ? 'single sign-on' : rules.provider;

  if (rules.allowedGroups.length && !inAnyGroup(groups, rules.allowedGroups)) {
    throw new Error(`Your ${provider} account is not in a group that may use this app. Ask an admin to add you.`);
  }

  if (state.linkUserId) {
    if (linked && linked.user_id !== state.linkUserId) {
      throw new Error(`That ${provider} account is already linked to another user.`);
    }
    if (!linked) {
      db.prepare(
        'INSERT INTO user_identities (user_id, provider, issuer, subject, email, linked_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(state.linkUserId, 'oidc', claims.issuer, claims.subject, email, now());
      audit(db, null, {
        action: 'user.link',
        entity: 'user',
        entityId: state.linkUserId,
        summary: 'Linked a single sign-on account',
      });
    }
    fillEmail(db, state.linkUserId, email);
    applySsoGroups(db, state.linkUserId, claims.groups, rules);
    return { userId: state.linkUserId, redirect: '/account?linked=1' };
  }

  let user: UserRow | undefined = linked ? getUser(db, linked.user_id) : undefined;
  if (user?.disabled) throw new Error('This account is disabled.');

  if (state.inviteToken) {
    const { invite, access } = usableInvite(db, state.inviteToken);
    if (!user) user = await createSsoUser(db, claims, email, (name) => `${name} joined by invite with single sign-on`);
    applyInvite(db, invite, access, user.id, null);
    applySsoGroups(db, user.id, claims.groups, rules);
    return { userId: user.id, redirect: '/' };
  }

  if (!user) {
    if (rules.createAccounts && groupsGiveAccess(db, groups, rules)) {
      user = await createSsoUser(db, claims, email, (name) => `${name} joined with their ${provider} groups`);
    } else {
      throw new Error('No account is linked to that sign-in yet. Ask for an invite link.');
    }
  }
  // People who signed in before their email was picked up get it now.
  fillEmail(db, user.id, email);
  applySsoGroups(db, user.id, claims.groups, rules);
  return { userId: user.id, redirect: '/' };
}

/** A new account for an SSO identity, linked to it. */
async function createSsoUser(
  db: DB,
  claims: OidcClaims,
  email: string | null,
  summary: (username: string) => string,
): Promise<UserRow> {
  const base = claims.preferredUsername ?? claims.email ?? `sso-${claims.subject.slice(0, 8)}`;
  const user = await createUser(db, {
    username: uniqueUsername(db, base),
    displayName: claims.name ?? claims.preferredUsername ?? claims.email ?? 'New user',
    email: null,
  });
  fillEmail(db, user.id, email);
  db.prepare(
    'INSERT INTO user_identities (user_id, provider, issuer, subject, email, linked_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(user.id, 'oidc', claims.issuer, claims.subject, email, now());
  audit(db, null, {
    action: 'user.create',
    entity: 'user',
    entityId: user.id,
    summary: summary(user.username),
  });
  return user;
}
