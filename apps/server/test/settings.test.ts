import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { Client, PASSWORD, createLocation, invite, setupAdmin, testApp } from './helpers';

let app: FastifyInstance;

beforeEach(async () => {
  ({ app } = await testApp());
});

const setting = (res: any, key: string) => res.body.settings.find((s: any) => s.key === key);

describe('admin settings', () => {
  it('lists defaults, saves changes that apply at once, and resets them', async () => {
    const admin = await setupAdmin(app);
    expect(setting(await admin.get('/api/admin/settings'), 'appName')).toMatchObject({
      value: 'Circuit Breaker Tracker',
      source: 'default',
    });
    const r = await admin.patch('/api/admin/settings', { appName: 'Bibby Breakers', inviteDays: 14 });
    expect(r.status).toBe(200);
    expect((await new Client(app).get('/api/auth/config')).body.appName).toBe('Bibby Breakers');
    const co = await createLocation(admin, null, 'company', 'Personal');
    const link = (await admin.post(`/api/locations/${co}/invites`, { role: 'viewer' })).body;
    const days = (Date.parse(link.expiresAt) - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(14);
    await admin.patch('/api/admin/settings', { appName: null });
    expect(setting(await admin.get('/api/admin/settings'), 'appName').source).toBe('default');
  });

  it('rejects bad values without changing anything', async () => {
    const admin = await setupAdmin(app);
    const r = await admin.patch('/api/admin/settings', { appName: 'Fine', sessionDays: 0 });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/Stay signed in/);
    expect(setting(await admin.get('/api/admin/settings'), 'appName').source).toBe('default');
    expect((await admin.patch('/api/admin/settings', { publicUrl: 'not a url' })).status).toBe(400);
    expect((await admin.patch('/api/admin/settings', { nope: 1 })).status).toBe(400);
  });

  it('never sends secrets back, and records changes without them', async () => {
    const admin = await setupAdmin(app);
    await admin.patch('/api/admin/settings', { oidcClientSecret: 'super-secret-value' });
    expect(setting(await admin.get('/api/admin/settings'), 'oidcClientSecret')).toMatchObject({
      value: '',
      hasValue: true,
    });
    const activity = JSON.stringify((await admin.get('/api/activity')).body);
    expect(activity).not.toContain('super-secret-value');
  });

  it('turns single sign-on on once everything it needs is saved', async () => {
    const admin = await setupAdmin(app);
    await admin.patch('/api/admin/settings', {
      oidcIssuer: 'https://login.example/tenant/v2.0',
      oidcClientId: 'abc',
      oidcClientSecret: 'shh',
    });
    expect((await admin.get('/api/auth/config')).body.oidc.enabled).toBe(false);
    await admin.patch('/api/admin/settings', { publicUrl: 'https://breakers.example.com/' });
    const s = await admin.get('/api/admin/settings');
    expect(s.body.ssoEnabled).toBe(true);
    expect(s.body.redirectUri).toBe('https://breakers.example.com/api/auth/oidc/callback');
    expect((await admin.get('/api/auth/config')).body.oidc.enabled).toBe(true);
  });

  it('is for admins only', async () => {
    const admin = await setupAdmin(app);
    const co = await createLocation(admin, null, 'company', 'KSU');
    const manager = await invite(app, admin, co, 'manager', 'boss', 'editor');
    expect((await manager.get('/api/admin/settings')).status).toBe(403);
    expect((await manager.patch('/api/admin/settings', { appName: 'x' })).status).toBe(403);
    expect((await manager.req('GET', '/api/admin/backup')).status).toBe(403);
  });

  it('settings pinned by environment variables cannot be changed', async () => {
    const pinned = await testApp({ APP_NAME: 'From Docker', TRUST_PROXY: 'true' });
    const admin = await setupAdmin(pinned.app);
    expect(setting(await admin.get('/api/admin/settings'), 'appName')).toMatchObject({
      value: 'From Docker',
      source: 'env',
    });
    const r = await admin.patch('/api/admin/settings', { appName: 'Other' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/APP_NAME/);
  });
});

describe('password sign-in switch', () => {
  it('blocks passwords for everyone except admins when turned off', async () => {
    const admin = await setupAdmin(app);
    const co = await createLocation(admin, null, 'company', 'Personal');
    await invite(app, admin, co, 'viewer', 'family');
    const link = (await admin.post(`/api/locations/${co}/invites`, { role: 'viewer' })).body.url as string;
    await admin.patch('/api/admin/settings', { allowLocalLogin: false });

    const family = new Client(app);
    const r = await family.post('/api/auth/login', { username: 'family', password: PASSWORD });
    expect(r.status).toBe(403);
    expect(r.body.message).toMatch(/single sign-on/);
    expect((await new Client(app).post('/api/auth/login', { username: 'admin', password: PASSWORD })).status).toBe(200);

    const token = link.split('/invite/')[1];
    const accept = await new Client(app).post(`/api/invites/${token}/accept`, {
      username: 'newbie',
      displayName: 'New',
      password: PASSWORD,
    });
    expect(accept.status).toBe(403);
    expect((await new Client(app).get('/api/auth/config')).body.localLogin).toBe(false);
  });
});

describe('backup', () => {
  it('downloads a copy of the database', async () => {
    const admin = await setupAdmin(app);
    const r = await app.inject({ method: 'GET', url: '/api/admin/backup', headers: { cookie: (admin as any).cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="circuit-breaker-tracker-.*\.db"/);
    expect(r.rawPayload.subarray(0, 15).toString()).toBe('SQLite format 3');
  });
});
