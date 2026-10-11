import {
  canResetUser,
  canSeeUser,
  confirmPasswordSchema,
  totpCodeSchema,
  totpLoginSchema,
  type TotpSetup,
} from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { audit } from '../audit';
import type { Config } from '../config';
import { actorOf, requireAuth } from '../context';
import { now, type DB } from '../db';
import { assertCheck, badRequest, forbidden, idParam, notFound, parse } from '../errors';
import { verifyPassword } from '../passwords';
import { AccessData, getUser, toActor, type UserRow } from '../repo';
import { createSession } from '../sessions';
import { hashToken, isExpired, newToken } from '../tokens';
import { newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, otpauthUrl, verifyTotp } from '../totp';

/** How long the second step of a sign-in may take, and how many codes may be tried. */
const CHALLENGE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

interface ChallengeRow {
  id: string;
  user_id: number;
  expires_at: string;
  attempts: number;
}

/** Start the second step of a password sign-in. Returns the token the browser sends back. */
export function startTotpChallenge(db: DB, userId: number): string {
  const { token, hash } = newToken();
  db.prepare('INSERT INTO login_challenges (id, user_id, expires_at) VALUES (?, ?, ?)').run(
    hash,
    userId,
    new Date(Date.now() + CHALLENGE_MS).toISOString(),
  );
  return token;
}

function storeRecoveryCodes(db: DB, userId: number): string[] {
  const { codes, hashes } = newRecoveryCodes();
  db.prepare('DELETE FROM totp_recovery_codes WHERE user_id = ?').run(userId);
  const insert = db.prepare('INSERT INTO totp_recovery_codes (user_id, code_hash) VALUES (?, ?)');
  for (const h of hashes) insert.run(userId, h);
  return codes;
}

function turnOff(db: DB, userId: number): void {
  db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?').run(
    userId,
  );
  db.prepare('DELETE FROM totp_recovery_codes WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM login_challenges WHERE user_id = ?').run(userId);
}

/** Check a 6-digit app code, or else a recovery code (used up on success). */
function checkCode(db: DB, user: UserRow, code: string): 'app' | 'recovery' | null {
  if (user.totp_secret && /^\d{6}$/.test(code)) {
    const step = verifyTotp(user.totp_secret, code, user.totp_last_step);
    if (step === null) return null;
    db.prepare('UPDATE users SET totp_last_step = ? WHERE id = ?').run(step, user.id);
    return 'app';
  }
  const used = db
    .prepare('UPDATE totp_recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL')
    .run(now(), user.id, hashToken(normalizeRecoveryCode(code)));
  return used.changes > 0 ? 'recovery' : null;
}

export function totpRoutes(app: FastifyInstance, db: DB, config: Config): void {
  const strictLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  /** Second step of a password sign-in. */
  app.post('/api/auth/login/totp', { config: strictLimit }, async (req, reply) => {
    const body = parse(totpLoginSchema, req.body);
    const challenge = db.prepare('SELECT * FROM login_challenges WHERE id = ?').get(hashToken(body.challenge)) as
      ChallengeRow | undefined;
    if (!challenge || isExpired(challenge.expires_at)) {
      throw forbidden('That sign-in took too long. Enter your password again.');
    }
    const user = getUser(db, challenge.user_id);
    if (!user || user.disabled || !user.totp_enabled_at) {
      db.prepare('DELETE FROM login_challenges WHERE id = ?').run(challenge.id);
      throw forbidden('Enter your password again.');
    }
    const kind = checkCode(db, user, body.code);
    if (!kind) {
      req.failure = `Wrong two-step code for ${user.username} (attempt ${challenge.attempts + 1} of ${MAX_ATTEMPTS})`;
      if (challenge.attempts + 1 >= MAX_ATTEMPTS) {
        db.prepare('DELETE FROM login_challenges WHERE id = ?').run(challenge.id);
        throw forbidden('Too many wrong codes. Enter your password again.');
      }
      db.prepare('UPDATE login_challenges SET attempts = attempts + 1 WHERE id = ?').run(challenge.id);
      throw forbidden('That code did not work. Check the time on your phone and try the newest code.');
    }
    db.prepare('DELETE FROM login_challenges WHERE id = ?').run(challenge.id);
    createSession(
      db,
      config,
      reply,
      user.id,
      req.headers['user-agent'],
      kind === 'recovery' ? 'password and a recovery code' : 'password and two-step code',
    );
    if (kind === 'recovery') {
      audit(
        db,
        { sessionId: '', realUser: user, user, readOnly: false },
        { action: 'user.totp_recovery', entity: 'user', entityId: user.id, summary: 'Signed in with a recovery code' },
      );
    }
    return { ok: true };
  });

  /** Start setting up: a new secret, shown as a QR code. Not active until a code confirms it. */
  app.post('/api/me/totp/setup', async (req): Promise<TotpSetup> => {
    const auth = requireAuth(req);
    const me = auth.realUser;
    if (!me.password_hash) {
      throw badRequest('Two-step sign-in protects password sign-in. Your single sign-on account has its own.');
    }
    if (me.totp_enabled_at) throw badRequest('Two-step sign-in is already on.');
    const secret = newTotpSecret();
    db.prepare('UPDATE users SET totp_secret = ?, totp_last_step = NULL WHERE id = ?').run(secret, me.id);
    const url = otpauthUrl(secret, me.username, config.settings.get('appName'));
    const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return { secret, otpauthUrl: url, qrSvg };
  });

  /** Confirm setup with a code from the app. Returns recovery codes, shown once. */
  app.post('/api/me/totp/enable', { config: strictLimit }, async (req) => {
    const auth = requireAuth(req);
    const me = getUser(db, auth.realUser.id)!;
    const { code } = parse(totpCodeSchema, req.body);
    if (me.totp_enabled_at) throw badRequest('Two-step sign-in is already on.');
    if (!me.totp_secret) throw badRequest('Start the setup first.');
    const step = verifyTotp(me.totp_secret, code, null);
    if (step === null)
      throw badRequest('That code did not work. Check the time on your phone and try the newest code.');
    const recoveryCodes = db.transaction(() => {
      db.prepare('UPDATE users SET totp_enabled_at = ?, totp_last_step = ? WHERE id = ?').run(now(), step, me.id);
      return storeRecoveryCodes(db, me.id);
    })();
    audit(db, auth, { action: 'user.totp_on', entity: 'user', entityId: me.id, summary: 'Turned on two-step sign-in' });
    return { recoveryCodes };
  });

  const requirePassword = async (user: UserRow, password: string) => {
    if (!(await verifyPassword(user.password_hash, password))) throw forbidden('Your password is wrong.');
  };

  app.post('/api/me/totp/recovery-codes', { config: strictLimit }, async (req) => {
    const auth = requireAuth(req);
    const me = auth.realUser;
    await requirePassword(me, parse(confirmPasswordSchema, req.body).password);
    if (!me.totp_enabled_at) throw badRequest('Two-step sign-in is off.');
    const recoveryCodes = storeRecoveryCodes(db, me.id);
    audit(db, auth, {
      action: 'user.totp_codes',
      entity: 'user',
      entityId: me.id,
      summary: 'Made new recovery codes',
    });
    return { recoveryCodes };
  });

  app.post('/api/me/totp/disable', { config: strictLimit }, async (req) => {
    const auth = requireAuth(req);
    const me = auth.realUser;
    await requirePassword(me, parse(confirmPasswordSchema, req.body).password);
    turnOff(db, me.id);
    audit(db, auth, {
      action: 'user.totp_off',
      entity: 'user',
      entityId: me.id,
      summary: 'Turned off two-step sign-in',
    });
    return { ok: true };
  });

  /** For someone who lost their phone: the same people who may send them a reset link. */
  app.delete('/api/users/:id/totp', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const id = idParam((req.params as { id: string }).id);
    const access = new AccessData(db);
    const user = getUser(db, id);
    if (!user) throw notFound();
    const theirs = access.grants.filter((g) => g.userId === id);
    if (!actor.isAdmin && !canSeeUser(actor, theirs, access.nodes, access.grants)) throw notFound();
    assertCheck(canResetUser(actor, toActor(user), theirs, access.nodes, access.grants));
    turnOff(db, id);
    audit(db, auth, {
      action: 'user.totp_off',
      entity: 'user',
      entityId: id,
      summary: `Turned off two-step sign-in for ${user.display_name}`,
    });
    return { ok: true };
  });
}
