import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { CSRF_HEADER } from '../src/app';
import type { DB } from '../src/db';
import { Client, PASSWORD, createLocation, invite, setupAdmin, testApp } from './helpers';

let app: FastifyInstance;
let db: DB;
afterEach(async () => app?.close());

/** A request as a script would make it: the token and nothing else. */
async function withToken(token: string, method: InjectOptions['method'], url: string, body?: unknown) {
  const res = await app.inject({
    method,
    url,
    payload: body as InjectOptions['payload'],
    headers: { authorization: `Bearer ${token}`, [CSRF_HEADER]: '1' },
  });
  let json: any = null;
  try {
    json = res.json();
  } catch {
    // CSV and PDF bodies
  }
  return { status: res.statusCode, body: json, text: res.body, headers: res.headers };
}
const read = (token: string, url: string) => withToken(token, 'GET', url);

async function makeToken(c: Client, name = 'SysON', days: number | null = 90) {
  const r = await c.post('/api/me/tokens', { name, days });
  expect(r.status).toBe(200);
  return r.body as { token: string; info: { id: number; hint: string; expiresAt: string | null } };
}

/** An admin, a viewer with access to one site, and a panel in each of two sites. */
async function scenario() {
  ({ app, db } = await testApp());
  const admin = await setupAdmin(app);
  const co = await createLocation(admin, null, 'company', 'Acme');
  const lab = await createLocation(admin, co, 'site', 'Lab');
  const shop = await createLocation(admin, co, 'site', 'Shop');
  const panel = async (site: number, name: string) => {
    const building = await createLocation(admin, site, 'building', `${name} building`);
    const floor = await createLocation(admin, building, 'floor', 'Ground');
    const room = await createLocation(admin, floor, 'room', 'Electrical');
    const r = await admin.post(`/api/locations/${room}/panels`, { name, spaces: 12 });
    expect(r.status).toBe(200);
    return r.body.id as number;
  };
  const labPanel = await panel(lab, 'LP-1');
  const shopPanel = await panel(shop, 'SP-1');
  const sam = await invite(app, admin, lab, 'viewer', 'sam');
  return { admin, sam, co, lab, shop, labPanel, shopPanel };
}

describe('API tokens', () => {
  it('read what the browser export gives, and show the token only once', async () => {
    const { sam, labPanel } = await scenario();
    const { token, info } = await makeToken(sam);
    expect(token).toMatch(/^cbt_[A-Za-z0-9_-]{43}$/);
    expect(info.hint).toBe(token.slice(-4));

    const csv = await read(token, `/api/panels/${labPanel}/csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toBe((await sam.raw(`/api/panels/${labPanel}/csv`)).body.toString());
    expect((await read(token, `/api/panels/${labPanel}`)).body.name).toBe('LP-1');
    expect((await read(token, '/api/auth/me')).body).toMatchObject({ user: { username: 'sam' }, viewingAs: false });

    const list = (await sam.get('/api/me/tokens')).body as any[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'SysON', hint: info.hint, expired: false, lastUsedIp: '127.0.0.1' });
    expect(list[0].lastUsedAt).toBeTruthy();
    expect(JSON.stringify(list)).not.toContain(token);
    // Only a hash is stored.
    expect(JSON.stringify(db.prepare('SELECT * FROM api_tokens').all())).not.toContain(token);
  });

  it('see only what their owner can see', async () => {
    const { sam, lab, shop, shopPanel } = await scenario();
    const { token } = await makeToken(sam);
    expect((await read(token, `/api/panels/${shopPanel}`)).status).toBe(404);
    expect((await read(token, `/api/panels/${shopPanel}/csv`)).status).toBe(404);
    expect((await read(token, `/api/locations/${shop}/csv`)).status).toBe(404);
    expect((await read(token, `/api/locations/${lab}/csv`)).status).toBe(200);
  });

  it('can only read', async () => {
    const { admin, labPanel } = await scenario();
    const { token } = await makeToken(admin);
    for (const [method, url, body] of [
      ['DELETE', `/api/panels/${labPanel}`, undefined],
      ['PATCH', '/api/me', { displayName: 'Mallory' }],
      ['POST', '/api/me/tokens', { name: 'another', days: null }],
    ] as const) {
      const r = await withToken(token, method, url, body);
      expect(r.status, `${method} ${url}`).toBe(403);
      expect(r.body.error).toBe('read_only');
    }
    expect((await admin.get(`/api/panels/${labPanel}`)).status).toBe(200);
    expect((await admin.get('/api/auth/me')).body.user.displayName).toBe('Admin');
    expect((await admin.get('/api/me/tokens')).body).toHaveLength(1);
  });

  it('never reach accounts, people or settings, even an admin’s', async () => {
    const { admin, lab } = await scenario();
    const { token } = await makeToken(admin);
    for (const url of [
      '/api/admin/backup',
      '/api/admin/settings',
      '/api/admin/logs',
      '/api/admin/tokens',
      '/api/me/tokens',
      '/api/me/sessions',
      '/api/users',
      `/api/locations/${lab}/access`,
      `/api/locations/${lab}/invites`,
      '/api/panels/../admin/backup',
      '/api/panels/%2e%2e/admin/backup',
      '/api/panels/1%2f..%2f..%2fadmin%2fbackup',
      '/api/auth/config',
    ]) {
      expect((await read(token, url)).status, url).toBe(403);
    }
    expect((await read(token, '/api/locations')).status).toBe(200);
  });

  it('stop working when revoked, expired, the owner is disabled, or tokens are turned off', async () => {
    const { admin, sam } = await scenario();
    const samId = (await sam.get('/api/auth/me')).body.user.id;
    const ok = async (token: string) => (await read(token, '/api/locations')).status;

    expect(await ok('cbt_not-a-real-token')).toBe(401);

    const revoked = await makeToken(sam, 'old');
    expect((await sam.del(`/api/me/tokens/${revoked.info.id}`)).status).toBe(200);
    expect(await ok(revoked.token)).toBe(401);

    const expiring = await makeToken(sam, 'expiring');
    db.prepare('UPDATE api_tokens SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', expiring.info.id);
    expect(await ok(expiring.token)).toBe(401);
    expect((await sam.get('/api/me/tokens')).body.find((t: any) => t.id === expiring.info.id).expired).toBe(true);

    const live = await makeToken(sam, 'live', null);
    expect(live.info.expiresAt).toBeNull();
    expect(await ok(live.token)).toBe(200);
    await admin.patch('/api/admin/settings', { allowApiTokens: false });
    expect(await ok(live.token)).toBe(401);
    expect((await sam.post('/api/me/tokens', { name: 'new', days: 30 })).status).toBe(403);
    expect((await new Client(app).get('/api/auth/config')).body.apiTokens).toBe(false);
    await admin.patch('/api/admin/settings', { allowApiTokens: null });
    expect(await ok(live.token)).toBe(200);

    await admin.patch(`/api/users/${samId}`, { disabled: true });
    expect(await ok(live.token)).toBe(401);
  });

  it('leave other Authorization headers, such as a proxy’s, to the browser session', async () => {
    await scenario();
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: PASSWORD },
      headers: { [CSRF_HEADER]: '1' },
    });
    const cookie = `cbt_session=${login.cookies.find((c) => c.name === 'cbt_session')!.value}`;
    for (const authorization of ['Basic dXNlcjpwYXNz', 'Bearer eyJhbGciOiJSUzI1NiJ9.e30.sig']) {
      const r = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization, cookie } });
      expect(r.statusCode, authorization).toBe(200);
    }
  });

  it('are listed and revoked by admins only, and only by their owner otherwise', async () => {
    const { admin, sam } = await scenario();
    const mine = await makeToken(sam);
    await makeToken(admin, 'backup script');

    const all = (await admin.get('/api/admin/tokens')).body as any[];
    expect(all.map((t) => [t.user.username, t.name])).toEqual([
      ['admin', 'backup script'],
      ['sam', 'SysON'],
    ]);
    expect((await sam.get('/api/admin/tokens')).status).toBe(403);
    expect((await sam.del(`/api/admin/tokens/${all[0].id}`)).status).toBe(403);
    expect((await sam.del(`/api/me/tokens/${all[0].id}`)).status).toBe(404);

    expect((await admin.del(`/api/admin/tokens/${mine.info.id}`)).status).toBe(200);
    expect((await read(mine.token, '/api/locations')).status).toBe(401);
    const log = db.prepare("SELECT summary FROM audit_log WHERE action LIKE 'token.%' ORDER BY id").all();
    expect(log.map((r: any) => r.summary)).toEqual([
      'Made API token SysON',
      'Made API token backup script',
      "Revoked sam's API token SysON",
    ]);
  });

  it('check names, expiry and how many one person has', async () => {
    const { sam } = await scenario();
    expect((await sam.post('/api/me/tokens', { name: ' ', days: 30 })).status).toBe(400);
    expect((await sam.post('/api/me/tokens', { name: 'x', days: 7 })).status).toBe(400);
    for (let i = 0; i < 25; i++) await makeToken(sam, `t${i}`);
    expect((await sam.post('/api/me/tokens', { name: 'one more', days: 30 })).status).toBe(400);
  });
});
