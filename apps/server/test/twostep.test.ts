import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../src/db';
import { hotp, stepAt } from '../src/totp';
import { Client, PASSWORD, createLocation, invite, setupAdmin, testApp } from './helpers';

let app: FastifyInstance;
let db: DB;

beforeEach(async () => {
  ({ app, db } = await testApp());
});

const secretOf = (username: string) =>
  (db.prepare('SELECT totp_secret FROM users WHERE username = ?').get(username) as { totp_secret: string }).totp_secret;

/** A valid code for a given time step offset, so tests never reuse a step. */
const codeFor = (username: string, offset = 0) => hotp(secretOf(username), stepAt(Date.now()) + offset);

async function turnOn(c: Client, username = 'admin') {
  const setup = await c.post('/api/me/totp/setup');
  expect(setup.status).toBe(200);
  expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
  expect(setup.body.qrSvg).toMatch(/^<svg/);
  const r = await c.post('/api/me/totp/enable', { code: codeFor(username, -1) });
  expect(r.status).toBe(200);
  return r.body.recoveryCodes as string[];
}

async function passwordStep(username = 'admin') {
  const c = new Client(app);
  const r = await c.post('/api/auth/login', { username, password: PASSWORD });
  return { c, r };
}

describe('two-step sign-in', () => {
  it('asks for a code after the password, and only then signs in', async () => {
    const admin = await setupAdmin(app);
    const codes = await turnOn(admin);
    expect(codes).toHaveLength(10);
    expect((await admin.get('/api/auth/me')).body).toMatchObject({ totp: true, recoveryCodesLeft: 10 });

    const { c, r } = await passwordStep();
    expect(r.body).toEqual({ totpRequired: true, challenge: expect.any(String) });
    expect((await c.get('/api/auth/me')).status).toBe(401);

    const ok = await c.post('/api/auth/login/totp', { challenge: r.body.challenge, code: codeFor('admin') });
    expect(ok.status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(200);
    // The challenge is used up.
    const again = await c.post('/api/auth/login/totp', { challenge: r.body.challenge, code: codeFor('admin', 1) });
    expect(again.status).toBe(403);
  });

  it('refuses a code that was already used, and gives up after five wrong ones', async () => {
    const admin = await setupAdmin(app);
    await turnOn(admin);
    const used = codeFor('admin', -1); // the step used when turning it on
    const { c, r } = await passwordStep();
    const replay = await c.post('/api/auth/login/totp', { challenge: r.body.challenge, code: used });
    expect(replay.status).toBe(403);
    for (let i = 0; i < 3; i++) await c.post('/api/auth/login/totp', { challenge: r.body.challenge, code: '000000' });
    const last = await c.post('/api/auth/login/totp', { challenge: r.body.challenge, code: '000000' });
    expect(last.body.message).toMatch(/Too many wrong codes/);
    const after = await c.post('/api/auth/login/totp', { challenge: r.body.challenge, code: codeFor('admin') });
    expect(after.body.message).toMatch(/password again/);
  });

  it('accepts each recovery code once', async () => {
    const admin = await setupAdmin(app);
    const codes = await turnOn(admin);
    const first = await passwordStep();
    const typed = codes[0]!.toUpperCase().replace(/-/g, ' ');
    expect(
      (await first.c.post('/api/auth/login/totp', { challenge: first.r.body.challenge, code: typed })).status,
    ).toBe(200);
    expect((await first.c.get('/api/auth/me')).body.recoveryCodesLeft).toBe(9);
    const second = await passwordStep();
    expect(
      (await second.c.post('/api/auth/login/totp', { challenge: second.r.body.challenge, code: codes[0] })).status,
    ).toBe(403);
  });

  it('needs the password to turn it off or make new codes', async () => {
    const admin = await setupAdmin(app);
    await turnOn(admin);
    expect((await admin.post('/api/me/totp/disable', { password: 'wrong password!' })).status).toBe(403);
    const fresh = await admin.post('/api/me/totp/recovery-codes', { password: PASSWORD });
    expect(fresh.body.recoveryCodes).toHaveLength(10);
    expect((await admin.post('/api/me/totp/disable', { password: PASSWORD })).status).toBe(200);
    const { r } = await passwordStep();
    expect(r.body).toEqual({ ok: true });
  });

  it('lets whoever may send a reset link turn it off for someone who lost their phone', async () => {
    const admin = await setupAdmin(app);
    const co = await createLocation(admin, null, 'company', 'Co');
    const site = await createLocation(admin, co, 'site', 'Site');
    const worker = await invite(app, admin, site, 'editor', 'worker');
    await turnOn(worker, 'worker');
    const other = await invite(app, admin, co, 'viewer', 'other');
    const workerId = (await admin.get('/api/users')).body.find((u: any) => u.username === 'worker').id;

    expect((await admin.get('/api/users')).body.find((u: any) => u.username === 'worker').totp).toBe(true);
    expect((await other.req('DELETE', `/api/users/${workerId}/totp`)).status).toBe(404);
    expect((await admin.del(`/api/users/${workerId}/totp`)).status).toBe(200);
    expect((await passwordStep('worker')).r.body).toEqual({ ok: true });
  });

  it('is only for password sign-in, and a reset link does not get around it', async () => {
    const admin = await setupAdmin(app);
    const co = await createLocation(admin, null, 'company', 'Co');
    const worker = await invite(app, admin, co, 'viewer', 'worker');
    await turnOn(worker, 'worker');
    const workerId = (await admin.get('/api/users')).body.find((u: any) => u.username === 'worker').id;
    const link = await admin.post(`/api/users/${workerId}/reset-link`);
    const token = String(link.body.url).split('/reset/')[1];
    const anon = new Client(app);
    const reset = await anon.post(`/api/reset/${token}`, { password: 'a brand new password' });
    expect(reset.body).toEqual({ ok: true, signIn: true });
    expect((await anon.get('/api/auth/me')).status).toBe(401);
  });
});
