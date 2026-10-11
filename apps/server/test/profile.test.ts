import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { gravatarUrl } from '../src/repo';
import { createLocation, invite, setupAdmin, testApp } from './helpers';

let app: FastifyInstance;
afterEach(async () => app?.close());

describe('profile and pictures', () => {
  it('builds a Gravatar address from a normalised email', () => {
    const hash = createHash('sha256').update('ryan@example.com').digest('hex');
    expect(gravatarUrl('  Ryan@Example.com ')).toBe(`https://gravatar.com/avatar/${hash}?s=96&d=404`);
    expect(gravatarUrl(null)).toBeNull();
  });

  it('lets people set, change and clear their own email', async () => {
    ({ app } = await testApp());
    const admin = await setupAdmin(app);
    expect((await admin.get('/api/auth/me')).body.user.avatarUrl).toBeNull();

    const r = await admin.patch('/api/me', { displayName: 'Site Admin', email: 'Admin@Example.com' });
    expect(r.status).toBe(200);
    const me = (await admin.get('/api/auth/me')).body.user;
    expect(me.displayName).toBe('Site Admin');
    expect(me.email).toBe('admin@example.com');
    expect(me.avatarUrl).toBe(gravatarUrl('admin@example.com'));

    expect((await admin.patch('/api/me', { email: 'not an email' })).status).toBe(400);
    expect((await admin.patch('/api/me', { email: '' })).status).toBe(200);
    expect((await admin.get('/api/auth/me')).body.user.avatarUrl).toBeNull();
  });

  it('refuses an email someone else already uses', async () => {
    ({ app } = await testApp());
    const admin = await setupAdmin(app);
    const co = await createLocation(admin, null, 'company', 'Acme');
    const home = await createLocation(admin, co, 'site', 'Home');
    const sam = await invite(app, admin, home, 'viewer', 'sam');
    expect((await admin.patch('/api/me', { email: 'shared@example.com' })).status).toBe(200);
    const clash = await sam.patch('/api/me', { email: 'SHARED@example.com' });
    expect(clash.status).toBe(409);
    expect(clash.body.message).toMatch(/already uses/);
    // Saving your own address again is fine.
    expect((await admin.patch('/api/me', { email: 'shared@example.com' })).status).toBe(200);
  });

  it('shows pictures on the people list and lets managers grant more access there', async () => {
    ({ app } = await testApp());
    const admin = await setupAdmin(app);
    const co = await createLocation(admin, null, 'company', 'Acme');
    const home = await createLocation(admin, co, 'site', 'Home');
    const shop = await createLocation(admin, co, 'site', 'Shop');
    const sam = await invite(app, admin, home, 'viewer', 'sam');
    await sam.patch('/api/me', { email: 'sam@example.com' });

    const list = (await admin.get('/api/users')).body as { username: string; id: number; avatarUrl: string }[];
    const row = list.find((u) => u.username === 'sam')!;
    expect(row.avatarUrl).toBe(gravatarUrl('sam@example.com'));

    expect(
      (await admin.post(`/api/locations/${shop}/grants`, { userId: row.id, role: 'editor', inviteLimit: null })).status,
    ).toBe(200);
    const after = (await admin.get('/api/users')).body.find((u: { id: number }) => u.id === row.id);
    expect(
      after.grants.map((g: { locationName: string; role: string }) => `${g.locationName}:${g.role}`).sort(),
    ).toEqual(['Home:viewer', 'Shop:editor']);
  });

  it('reports the Gravatar setting to the browser', async () => {
    ({ app } = await testApp({ GRAVATAR: 'false' }));
    await setupAdmin(app);
    const r = await app.inject({ method: 'GET', url: '/api/auth/config' });
    expect(r.json().gravatar).toBe(false);
  });
});
