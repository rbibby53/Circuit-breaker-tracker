import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, createLocation, invite, setupAdmin, testApp } from './helpers';

interface Received {
  from: string;
  to: string[];
  user: string | null;
  raw: string;
}

/** A local mail server that keeps what it is sent. Refuses mail to anyone at refused.example. */
let smtp: SMTPServer;
let port: number;
const inbox: Received[] = [];

beforeAll(async () => {
  smtp = new SMTPServer({
    disabledCommands: ['STARTTLS'],
    authOptional: true,
    allowInsecureAuth: true,
    logger: false,
    onAuth(auth, _session, cb) {
      if (auth.username === 'relay-user' && auth.password === 'relay-pass') return cb(null, { user: auth.username });
      return cb(new Error('Invalid username or password'));
    },
    onRcptTo(address, _session, cb) {
      if (address.address.endsWith('@refused.example')) return cb(new Error('Mailbox unavailable'));
      return cb();
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => {
        inbox.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
          to: session.envelope.rcptTo.map((r) => r.address),
          user: (session.user as string | undefined) ?? null,
          raw: Buffer.concat(chunks).toString('utf8'),
        });
        cb();
      });
    },
  });
  await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  port = (smtp.server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => smtp.close(() => resolve())));

beforeEach(() => {
  inbox.length = 0;
});

const PUBLIC_URL = 'https://plant.example.edu';
const mailEnv = (extra: Record<string, string> = {}) => ({
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: String(port),
  SMTP_SECURITY: 'none',
  SMTP_FROM: 'Breakers <breakers@example.edu>',
  PUBLIC_URL,
  ...extra,
});

/** The text of a message with quoted-printable line breaks and escapes undone. */
function body(m: Received): string {
  const bytes: number[] = [];
  const s = m.raw.replace(/=\r?\n/g, '');
  for (let i = 0; i < s.length; i++) {
    const hex = s[i] === '=' ? /^[0-9A-F]{2}/.exec(s.slice(i + 1, i + 3)) : null;
    if (hex) {
      bytes.push(parseInt(hex[0], 16));
      i += 2;
    } else bytes.push(...Buffer.from(s[i]!, 'utf8'));
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Wait for messages sent in the background. */
async function waitForMail(n: number): Promise<Received[]> {
  for (let i = 0; i < 100 && inbox.length < n; i++) await new Promise((r) => setTimeout(r, 20));
  return inbox;
}

/** Nothing more arrives (for sends that should not happen). */
const settle = () => new Promise((r) => setTimeout(r, 200));

async function withPerson(app: FastifyInstance, email: string | null) {
  const admin = await setupAdmin(app);
  const co = await createLocation(admin, null, 'company', 'KSU');
  const site = await createLocation(admin, co, 'site', 'Kennesaw');
  const person = await invite(app, admin, site, 'editor', 'pat');
  const users = (await admin.get('/api/users')).body as { id: number; username: string }[];
  const id = users.find((u) => u.username === 'pat')!.id;
  if (email) expect((await admin.patch(`/api/users/${id}`, { email })).status).toBe(200);
  inbox.length = 0;
  return { admin, site, person, id };
}

describe('email settings', () => {
  it('are off without an SMTP server, and say what is missing once one is set', async () => {
    const off = await testApp();
    expect((await new Client(off.app).get('/api/auth/config')).body).toMatchObject({
      email: false,
      passwordResetEmail: false,
    });

    const { app } = await testApp({ SMTP_HOST: '127.0.0.1' });
    const admin = await setupAdmin(app);
    expect((await admin.get('/api/admin/settings')).body.email).toEqual({
      enabled: false,
      problem: expect.stringMatching(/Send as/),
    });
    const noUrl = await testApp({ ...mailEnv(), PUBLIC_URL: '' });
    const a2 = await setupAdmin(noUrl.app);
    expect((await a2.get('/api/admin/settings')).body.email.problem).toMatch(/public address/);
  });

  it('turn email and "Forgot your password?" on when complete', async () => {
    const { app } = await testApp(mailEnv());
    expect((await new Client(app).get('/api/auth/config')).body).toMatchObject({
      email: true,
      passwordResetEmail: true,
    });
    const quiet = await testApp(mailEnv({ SELF_SERVICE_RESET: 'false' }));
    expect((await new Client(quiet.app).get('/api/auth/config')).body).toMatchObject({
      email: true,
      passwordResetEmail: false,
    });
  });

  it('send a test email to the admin, or to a typed address', async () => {
    const { app } = await testApp(mailEnv());
    const admin = await setupAdmin(app);
    expect((await admin.post('/api/admin/email-test', {})).status).toBe(400);
    const r = await admin.post('/api/admin/email-test', { to: 'facilities@example.edu' });
    expect(r.body).toEqual({ ok: true, to: 'facilities@example.edu' });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ from: 'breakers@example.edu', to: ['facilities@example.edu'] });
    expect(inbox[0]!.raw).toMatch(/^Subject: Test email from Circuit Breaker Tracker/m);
    expect(inbox[0]!.raw).toMatch(/^From: Breakers <breakers@example\.edu>/m);
  });

  it('report what the mail server said when it refuses', async () => {
    const { app } = await testApp(mailEnv());
    const admin = await setupAdmin(app);
    const r = await admin.post('/api/admin/email-test', { to: 'someone@refused.example' });
    expect(r.body).toEqual({
      ok: false,
      message: expect.stringMatching(/The mail server said: .*Mailbox unavailable/),
    });
  });

  it('sign in to the mail server when a username is set', async () => {
    const { app } = await testApp(mailEnv({ SMTP_USERNAME: 'relay-user', SMTP_PASSWORD: 'relay-pass' }));
    const admin = await setupAdmin(app);
    expect((await admin.post('/api/admin/email-test', { to: 'a@example.edu' })).body.ok).toBe(true);
    expect(inbox[0]!.user).toBe('relay-user');

    const wrong = await testApp(mailEnv({ SMTP_USERNAME: 'relay-user', SMTP_PASSWORD: 'nope' }));
    const a2 = await setupAdmin(wrong.app);
    expect((await a2.post('/api/admin/email-test', { to: 'a@example.edu' })).body).toMatchObject({ ok: false });
  });

  it('are only for admins', async () => {
    const { app } = await testApp(mailEnv());
    const { person } = await withPerson(app, null);
    expect((await person.post('/api/admin/email-test', { to: 'a@example.edu' })).status).toBe(403);
    expect(inbox).toHaveLength(0);
  });
});

describe('emailed invites', () => {
  it('send the link to the address given, under the public address', async () => {
    const { app } = await testApp(mailEnv({ PUBLIC_URL: 'https://plant.example.edu/breakers' }));
    const admin = await setupAdmin(app);
    const site = await createLocation(admin, await createLocation(admin, null, 'company', 'KSU'), 'site', 'Kennesaw');
    const r = await admin.post(`/api/locations/${site}/invites`, { role: 'editor', email: 'New.Tech@Example.edu' });
    expect(r.status).toBe(200);
    expect(r.body.url).toMatch(/^https:\/\/plant\.example\.edu\/breakers\/invite\/[A-Za-z0-9_-]+$/);
    expect(r.body.emailedTo).toBe('new.tech@example.edu');
    expect(r.body.emailError).toBeUndefined();

    expect(inbox).toHaveLength(1);
    const m = inbox[0]!;
    expect(m.to).toEqual(['new.tech@example.edu']);
    expect(m.raw).toMatch(/^Subject: Admin invited you to Circuit Breaker Tracker/m);
    const text = body(m);
    expect(text).toContain(r.body.url);
    expect(text).toContain('as an Editor for KSU › Kennesaw');

    // Listed under the address it went to.
    const pending = (await admin.get(`/api/locations/${site}/invites`)).body;
    expect(pending[0].note).toBe('new.tech@example.edu');
  });

  it('still return the link when sending fails', async () => {
    const { app } = await testApp(mailEnv());
    const admin = await setupAdmin(app);
    const co = await createLocation(admin, null, 'company', 'KSU');
    const r = await admin.post(`/api/locations/${co}/invites`, { role: 'viewer', email: 'x@refused.example' });
    expect(r.status).toBe(200);
    expect(r.body.url).toMatch(/\/invite\//);
    expect(r.body.emailedTo).toBeUndefined();
    expect(r.body.emailError).toMatch(/Mailbox unavailable/);
  });

  it('are refused, with nothing created, when email is not set up', async () => {
    const { app } = await testApp();
    const admin = await setupAdmin(app);
    const co = await createLocation(admin, null, 'company', 'KSU');
    const r = await admin.post(`/api/locations/${co}/invites`, { role: 'viewer', email: 'a@example.edu' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Email is not set up/);
    expect((await admin.get(`/api/locations/${co}/invites`)).body).toEqual([]);
  });

  it('keep working as plain links without an address', async () => {
    const { app } = await testApp(mailEnv());
    const admin = await setupAdmin(app);
    const co = await createLocation(admin, null, 'company', 'KSU');
    const r = await admin.post(`/api/locations/${co}/invites`, { role: 'viewer' });
    expect(r.body).toEqual({ url: expect.stringContaining('/invite/'), expiresAt: expect.any(String) });
    await settle();
    expect(inbox).toHaveLength(0);
  });
});

describe('emailed reset links from a manager', () => {
  it('go to the person’s own address', async () => {
    const { app } = await testApp(mailEnv());
    const { admin, id } = await withPerson(app, 'pat@example.edu');
    const r = await admin.post(`/api/users/${id}/reset-link`, { email: true });
    expect(r.status).toBe(200);
    expect(r.body.emailedTo).toBe('pat@example.edu');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.to).toEqual(['pat@example.edu']);
    expect(body(inbox[0]!)).toContain(r.body.url);
    expect(body(inbox[0]!)).toContain('Admin sent you a link');
  });

  it('are refused for someone with no address, and copied links still work', async () => {
    const { app } = await testApp(mailEnv());
    const { admin, id } = await withPerson(app, null);
    const r = await admin.post(`/api/users/${id}/reset-link`, { email: true });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/no email address/);
    const copied = await admin.post(`/api/users/${id}/reset-link`);
    expect(copied.status).toBe(200);
    expect(copied.body.emailedTo).toBeUndefined();
    expect(inbox).toHaveLength(0);
  });
});

describe('"Forgot your password?"', () => {
  const forgot = (app: FastifyInstance, login: string, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/forgot',
      headers: { 'x-cbt-csrf': '1', ...headers },
      payload: { login },
    });

  it('emails a working link to the account’s address, by username or email', async () => {
    const { app } = await testApp(mailEnv());
    await withPerson(app, 'pat@example.edu');
    // A forged Host header must not end up in the link.
    const r = await forgot(app, 'PAT@example.edu', { host: 'evil.example' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    const [m] = await waitForMail(1);
    expect(m!.to).toEqual(['pat@example.edu']);
    const text = body(m!);
    expect(text).toContain('Someone, hopefully you, asked to reset the password');
    const url = /https:\/\/plant\.example\.edu\/reset\/[A-Za-z0-9_-]+/.exec(text)?.[0];
    expect(url).toBeDefined();
    expect(text).not.toContain('evil.example');

    const token = url!.split('/reset/')[1];
    expect((await app.inject({ url: `/api/reset/${token}` })).json()).toMatchObject({ username: 'pat' });
    const set = await app.inject({
      method: 'POST',
      url: `/api/reset/${token}`,
      headers: { 'x-cbt-csrf': '1' },
      payload: { password: 'a brand new password' },
    });
    expect(set.statusCode).toBe(200);
  });

  it('answers the same, and sends nothing, for unknown or unsuitable accounts', async () => {
    const { app } = await testApp(mailEnv());
    await withPerson(app, null);
    for (const login of ['nobody', 'nobody@example.edu', 'pat']) {
      const r = await forgot(app, login);
      expect(r.statusCode, login).toBe(200);
      expect(r.json()).toEqual({ ok: true });
    }
    await settle();
    expect(inbox).toHaveLength(0);
  });

  it('sends at most one link per account every few minutes', async () => {
    const { app } = await testApp(mailEnv());
    await withPerson(app, 'pat@example.edu');
    await forgot(app, 'pat');
    await waitForMail(1);
    expect((await forgot(app, 'pat')).json()).toEqual({ ok: true });
    await settle();
    expect(inbox).toHaveLength(1);
  });

  it('is limited per address', async () => {
    const { app } = await testApp(mailEnv());
    await setupAdmin(app);
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await forgot(app, `nobody${i}`)).statusCode);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('is not there when turned off or when email is not set up', async () => {
    for (const env of [mailEnv({ SELF_SERVICE_RESET: 'false' }), {}]) {
      const { app } = await testApp(env);
      await withPerson(app, 'pat@example.edu');
      expect((await forgot(app, 'pat')).statusCode).toBe(404);
    }
    await settle();
    expect(inbox).toHaveLength(0);
  });

  it('does not reach accounts that cannot use a password', async () => {
    const { app } = await testApp(mailEnv());
    const { admin } = await withPerson(app, 'pat@example.edu');
    expect((await admin.patch('/api/admin/settings', { allowLocalLogin: false })).status).toBe(200);
    expect((await forgot(app, 'pat')).json()).toEqual({ ok: true });
    await settle();
    expect(inbox).toHaveLength(0);
  });
});
