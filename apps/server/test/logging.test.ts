import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig, withSettings } from '../src/config';
import { openDatabase } from '../src/db';
import { formatLine, LogStream } from '../src/log';
import { SettingsStore } from '../src/settings';
import { startupLines } from '../src/startup';
import { Client, PASSWORD, setupAdmin } from './helpers';

let app: FastifyInstance | undefined;
afterEach(async () => app?.close());

/** An app whose log lines are collected instead of printed. */
async function loggedApp(env: Record<string, string> = {}) {
  const lines: string[] = [];
  const stream = new LogStream('text', (s) => lines.push(...s.trimEnd().split('\n')));
  app = await buildApp(loadConfig({ DATA_DIR: '/tmp/unused', ...env }), openDatabase(':memory:'), {
    logStream: stream,
  });
  return { app, lines, stream };
}

describe('log lines', () => {
  it('formats a record as one readable line, with extra fields and an indented stack', () => {
    const line = formatLine({ level: 40, time: Date.UTC(2026, 9, 11, 14, 5, 9), msg: 'Hello there', pid: 1, count: 3 });
    expect(line).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d WARN {2}Hello there {2}count=3$/);
    const withErr = formatLine({
      level: 50,
      time: 0,
      msg: 'Boom',
      err: { message: 'bad', stack: 'Error: bad\n  at x (y.ts:1)' },
    });
    expect(withErr.split('\n')).toEqual([expect.stringMatching(/ERROR Boom$/), '    Error: bad', '    at x (y.ts:1)']);
  });

  it('passes JSON straight through when asked', () => {
    const out: string[] = [];
    new LogStream('json', (s) => out.push(s)).write('{"level":30,"msg":"x"}\n');
    expect(out).toEqual(['{"level":30,"msg":"x"}\n']);
  });
});

describe('what the server logs', () => {
  it('logs sign-ins, refused sign-ins with the reason, and changes, but not health checks', async () => {
    const { app, lines } = await loggedApp();
    const admin = await setupAdmin(app);
    await admin.post('/api/locations', { parentId: null, kind: 'company', name: 'Acme' });
    await app.inject({ method: 'GET', url: '/healthz' });
    const anon = new Client(app);
    await anon.post('/api/auth/login', { username: 'admin', password: 'not the password' });
    await anon.post('/api/auth/login', { username: 'nobody', password: PASSWORD });
    await anon.post('/api/auth/login', { username: 'admin', password: PASSWORD });
    await anon.post('/api/auth/logout');

    const text = lines.join('\n');
    expect(text).toMatch(/INFO {2}Signed in: admin \(first-run setup\) from 127\.0\.0\.1/);
    expect(text).toMatch(/INFO {2}admin: Added company Acme/);
    expect(text).toMatch(
      /WARN {2}POST \/api\/auth\/login → 403 in \d+ ms · 127\.0\.0\.1 · Sign-in refused for "admin": wrong password/,
    );
    expect(text).toMatch(/Sign-in refused for "nobody": no such account/);
    expect(text).toMatch(/INFO {2}Signed in: admin \(password\) from 127\.0\.0\.1/);
    expect(text).toMatch(/INFO {2}Signed out: admin/);
    expect(text).not.toMatch(/healthz/);
    // Ordinary reads stay out of the log at the info level.
    expect(text).not.toMatch(/GET \/api/);
    // No pid, hostname or JSON.
    expect(text).not.toMatch(/hostname|"level"/);
  });

  it('at debug, logs every API request with the user, never link tokens or query strings', async () => {
    const { app, lines } = await loggedApp({ LOG_LEVEL: 'debug' });
    const admin = await setupAdmin(app);
    await admin.get('/api/locations?secret=abc');
    await new Client(app).get('/api/invites/SuperSecretToken123');
    const text = lines.join('\n');
    expect(text).toMatch(/DEBUG GET \/api\/locations → 200 in \d+ ms · admin @ 127\.0\.0\.1/);
    expect(text).toMatch(/GET \/api\/invites\/… → 404/);
    expect(text).not.toMatch(/SuperSecretToken123|secret=abc/);
  });

  it('switches to JSON from Settings without a restart', async () => {
    const { app, lines } = await loggedApp();
    const admin = await setupAdmin(app);
    expect((await admin.patch('/api/admin/settings', { logFormat: 'json' })).status).toBe(200);
    await admin.post('/api/locations', { parentId: null, kind: 'company', name: 'Acme' });
    const last = JSON.parse(lines.at(-1)!);
    expect(last).toMatchObject({ level: 30, msg: 'admin: Added company Acme' });
    expect(last.hostname).toBeUndefined();
  });

  it('keeps recent lines for the log viewer, for admins only', async () => {
    const { app } = await loggedApp();
    const admin = await setupAdmin(app);
    await new Client(app).post('/api/auth/login', { username: 'admin', password: 'wrong password!!' });
    const all = (await admin.get('/api/admin/logs')).body;
    expect(all).toMatchObject({ level: 'info', capacity: 500 });
    expect(all.lines.some((l: { text: string }) => l.text.includes('Signed in: admin (first-run setup)'))).toBe(true);
    const warnings = (await admin.get('/api/admin/logs?level=warn')).body.lines;
    expect(warnings.map((l: { level: string }) => l.level)).toEqual(['warn']);
    expect(warnings[0].text).toMatch(/Sign-in refused for "admin": wrong password/);
    expect((await new Client(app).get('/api/admin/logs')).status).toBe(401);
  });

  it('keeps only the newest 500 lines', () => {
    const stream = new LogStream('text', () => undefined);
    for (let i = 0; i < 520; i++) stream.write(`{"level":30,"time":${i},"msg":"line ${i}"}\n`);
    const kept = stream.recent();
    expect(kept).toHaveLength(500);
    expect(kept[0]!.text).toMatch(/line 20$/);
  });

  it('says at start-up what is running and what is misconfigured', () => {
    const db = openDatabase(':memory:');
    const env = {
      DATA_DIR: '/tmp/unused',
      APP_VERSION: '1.2.3',
      OIDC_ISSUER: 'https://login.example/t/v2.0',
      TZ: 'UTC',
    };
    const config = withSettings(loadConfig(env), new SettingsStore(db, env));
    const text = startupLines(db, config, env)
      .map((l) => `${l.level} ${l.msg}`)
      .join('\n');
    expect(text).toMatch(/^info Circuit Breaker Tracker 1\.2\.3 starting · Node v\d+.* · times in this log are UTC/);
    expect(text).toMatch(/0 people, 0 locations, 0 panels, 0 breakers/);
    expect(text).toMatch(/No accounts yet/);
    expect(text).toMatch(/Public address not set/);
    expect(text).toMatch(/warn Single sign-on is partly set up/);
    expect(text).toMatch(/Set by environment variables \(locked in Settings\): OIDC_ISSUER/);
  });
});
