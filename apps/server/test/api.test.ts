import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { completeOidcLogin } from '../src/routes/auth';
import type { DB } from '../src/db';
import { Client, PASSWORD, createLocation, invite, setupAdmin, testApp } from './helpers';

let app: FastifyInstance;
let db: DB;

beforeEach(async () => {
  ({ app, db } = await testApp());
});

describe('first run and sign-in', () => {
  it('needs setup until the first admin exists, then never again', async () => {
    const anon = new Client(app);
    expect((await anon.get('/api/auth/config')).body.needsSetup).toBe(true);
    const admin = await setupAdmin(app);
    expect((await anon.get('/api/auth/config')).body.needsSetup).toBe(false);
    const again = await anon.post('/api/setup', { username: 'second', displayName: 'X', password: PASSWORD });
    expect(again.status).toBe(409);
    const me = await admin.get('/api/auth/me');
    expect(me.body.user.isAdmin).toBe(true);
    expect(me.body.viewingAs).toBe(false);
  });

  it('rejects writes without the CSRF header', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'a', password: 'b' } });
    expect(r.statusCode).toBe(403);
  });

  it('logs in with username and password, and rejects a wrong password', async () => {
    await setupAdmin(app);
    const c = new Client(app);
    expect((await c.post('/api/auth/login', { username: 'admin', password: 'nope-nope-nope' })).status).toBe(403);
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await c.post('/api/auth/login', { username: 'ADMIN', password: PASSWORD })).status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(200);
    await c.post('/api/auth/logout');
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('requires sign-in for the API', async () => {
    expect((await new Client(app).get('/api/locations')).status).toBe(401);
  });
});

describe('locations', () => {
  it('builds a tree, hiding the automatic building for floors added under a site', async () => {
    const admin = await setupAdmin(app);
    const co = await createLocation(admin, null, 'company', 'Personal');
    const home = await createLocation(admin, co, 'site', 'Home');
    const floor = await createLocation(admin, home, 'floor', 'Basement');
    const list = (await admin.get('/api/locations')).body as any[];
    const building = list.find((l) => l.kind === 'building');
    expect(building).toMatchObject({ parentId: home, isDefaultBuilding: true, name: 'Main building' });
    expect(list.find((l) => l.id === floor).parentId).toBe(building.id);
  });

  it('does not add a stray building to sites made of buildings', async () => {
    const admin = await setupAdmin(app);
    const co = await createLocation(admin, null, 'company', 'KSU');
    const campus = await createLocation(admin, co, 'site', 'Campus');
    await createLocation(admin, campus, 'building', 'Building A');
    const buildings = ((await admin.get('/api/locations')).body as any[]).filter((l) => l.kind === 'building');
    expect(buildings.map((b) => b.name)).toEqual(['Building A']);
    expect((await admin.post('/api/locations', { parentId: campus, kind: 'floor', name: 'X' })).status).toBe(400);
  });

  it('enforces parent kinds', async () => {
    const admin = await setupAdmin(app);
    const co = await createLocation(admin, null, 'company', 'Personal');
    expect((await admin.post('/api/locations', { parentId: co, kind: 'room', name: 'X' })).status).toBe(400);
    expect((await admin.post('/api/locations', { parentId: co, kind: 'company', name: 'X' })).status).toBe(400);
  });

  it('refuses to delete a location that still has things inside, but a bare site is fine', async () => {
    const admin = await setupAdmin(app);
    const co = await createLocation(admin, null, 'company', 'Personal');
    const site = await createLocation(admin, co, 'site', 'Home');
    expect((await admin.del(`/api/locations/${co}`)).status).toBe(409);
    expect((await admin.del(`/api/locations/${site}`)).status).toBe(200);
    expect((await admin.del(`/api/locations/${co}`)).status).toBe(200);
  });
});

/** The scenario from the plan: Personal and KSU, with a supervisor managing KSU only. */
async function scenario() {
  const admin = await setupAdmin(app);
  const personal = await createLocation(admin, null, 'company', 'Personal');
  const apartment = await createLocation(admin, personal, 'site', 'Apartment');
  const ksu = await createLocation(admin, null, 'company', 'KSU');
  const campus = await createLocation(admin, ksu, 'site', 'Campus');
  const bA = await createLocation(admin, campus, 'building', 'Building A');
  const floor2 = await createLocation(admin, bA, 'floor', 'Floor 2');
  const supervisor = await invite(app, admin, ksu, 'manager', 'supervisor', 'editor');
  const roommate = await invite(app, admin, apartment, 'editor', 'roommate');
  return { admin, personal, apartment, ksu, campus, bA, floor2, supervisor, roommate };
}

const ids = async (c: Client) => ((await c.get('/api/locations')).body as any[]).map((l) => l.id);

describe('scoped access', () => {
  it('a supervisor on KSU never sees Personal', async () => {
    const s = await scenario();
    const seen = await ids(s.supervisor);
    expect(seen).toContain(s.floor2);
    expect(seen).not.toContain(s.personal);
    expect(seen).not.toContain(s.apartment);
    expect((await s.supervisor.get(`/api/locations/${s.apartment}/access`)).status).toBe(404);
  });

  it('managers invite inside their scope only, and only up to their limit', async () => {
    const s = await scenario();
    expect((await s.supervisor.post(`/api/locations/${s.apartment}/invites`, { role: 'viewer' })).status).toBe(404);
    expect((await s.supervisor.post(`/api/locations/${s.bA}/invites`, { role: 'manager', inviteLimit: 'viewer' })).status).toBe(403);
    expect((await s.supervisor.post(`/api/locations/${s.bA}/invites`, { role: 'editor' })).status).toBe(200);
  });

  it('a coworker scoped to a floor sees the floor and only the names above it', async () => {
    const s = await scenario();
    const coworker = await invite(app, s.supervisor, s.floor2, 'viewer', 'coworker');
    const list = (await coworker.get('/api/locations')).body as any[];
    expect(list.map((l) => [l.id, l.access])).toEqual(
      expect.arrayContaining([
        [s.floor2, 'full'],
        [s.bA, 'breadcrumb'],
        [s.ksu, 'breadcrumb'],
      ]),
    );
    expect(list).toHaveLength(4);
    expect((await coworker.post('/api/locations', { parentId: s.floor2, kind: 'room', name: 'X' })).status).toBe(403);
  });

  it('managers cannot hand out access to people they cannot see', async () => {
    const s = await scenario();
    const roommateId = (await s.roommate.get('/api/auth/me')).body.user.id;
    const r = await s.supervisor.post(`/api/locations/${s.bA}/grants`, { userId: roommateId, role: 'viewer' });
    expect(r.status).toBe(404);
    const users = (await s.supervisor.get('/api/users')).body as any[];
    expect(users.map((u) => u.username)).not.toContain('roommate');
  });

  it('managers cannot change their own grant', async () => {
    const s = await scenario();
    const access = (await s.supervisor.get(`/api/locations/${s.ksu}/access`)).body;
    const own = access.applies.find((g: any) => g.user.username === 'supervisor');
    expect(own.canManage).toBe(false);
    expect((await s.supervisor.patch(`/api/grants/${own.id}`, { role: 'manager', inviteLimit: 'manager' })).status).toBe(403);
  });

  it('an invite stops working when its creator loses the right to grant it', async () => {
    const s = await scenario();
    const link = (await s.supervisor.post(`/api/locations/${s.bA}/invites`, { role: 'viewer' })).body.url as string;
    const token = link.split('/invite/')[1];
    expect((await new Client(app).get(`/api/invites/${token}`)).status).toBe(200);
    const access = (await s.admin.get(`/api/locations/${s.ksu}/access`)).body;
    const grant = access.applies.find((g: any) => g.user.username === 'supervisor');
    expect((await s.admin.del(`/api/grants/${grant.id}`)).status).toBe(200);
    expect((await new Client(app).get(`/api/invites/${token}`)).status).toBe(410);
  });

  it('a signed-in person accepting an invite gets the access added to their account', async () => {
    const s = await scenario();
    const link = (await s.admin.post(`/api/locations/${s.campus}/invites`, { role: 'viewer' })).body.url as string;
    const token = link.split('/invite/')[1];
    expect((await s.roommate.post(`/api/invites/${token}/accept`, {})).status).toBe(200);
    expect(await ids(s.roommate)).toContain(s.campus);
    expect((await s.roommate.post(`/api/invites/${token}/accept`, {})).status).toBe(410);
  });
});

describe('password resets', () => {
  it('managers can only reset people entirely inside their scope', async () => {
    const s = await scenario();
    const coworker = await invite(app, s.supervisor, s.floor2, 'viewer', 'coworker');
    const users = (await s.admin.get('/api/users')).body as any[];
    const id = (name: string) => users.find((u) => u.username === name).id;

    expect((await s.supervisor.post(`/api/users/${id('roommate')}/reset-link`)).status).toBe(404);
    expect((await s.supervisor.post(`/api/users/${id('admin')}/reset-link`)).status).toBe(404);
    const link = await s.supervisor.post(`/api/users/${id('coworker')}/reset-link`);
    expect(link.status).toBe(200);

    const token = String(link.body.url).split('/reset/')[1];
    const anon = new Client(app);
    expect((await anon.post(`/api/reset/${token}`, { password: 'a brand new password' })).status).toBe(200);
    expect((await anon.get('/api/auth/me')).body.user.username).toBe('coworker');
    expect((await coworker.get('/api/auth/me')).status).toBe(401); // old sessions are signed out
  });
});

describe('view as user', () => {
  it('shows exactly what the user sees, read-only, and can be exited', async () => {
    const s = await scenario();
    const roommateId = (await s.roommate.get('/api/auth/me')).body.user.id;
    expect((await s.admin.post(`/api/admin/view-as/${roommateId}`)).status).toBe(200);

    const me = (await s.admin.get('/api/auth/me')).body;
    expect(me).toMatchObject({ viewingAs: true, user: { username: 'roommate' }, realUser: { username: 'admin' } });
    expect(await ids(s.admin)).toEqual(await ids(s.roommate));

    const write = await s.admin.post('/api/locations', { parentId: s.apartment, kind: 'floor', name: 'Upstairs' });
    expect(write.status).toBe(403);
    expect(write.body.error).toBe('read_only');

    expect((await s.admin.del('/api/admin/view-as')).status).toBe(200);
    expect((await s.admin.get('/api/auth/me')).body.viewingAs).toBe(false);
    const actions = ((await s.admin.get('/api/activity')).body as any[]).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['view_as.start', 'view_as.stop']));
  });

  it('is only for admins', async () => {
    const s = await scenario();
    expect((await s.supervisor.post('/api/admin/view-as/1')).status).toBe(403);
  });
});

describe('activity log', () => {
  it('managers only see activity inside their scope', async () => {
    const s = await scenario();
    await createLocation(s.roommate, s.apartment, 'floor', 'Upstairs');
    await createLocation(s.supervisor, s.campus, 'building', 'Building B');
    const items = (await s.supervisor.get('/api/activity')).body as any[];
    expect(items.some((i) => i.summary.includes('Building B'))).toBe(true);
    expect(items.some((i) => i.summary.includes('Upstairs'))).toBe(false);
    expect((await s.roommate.get('/api/activity')).status).toBe(403);
  });
});

describe('single sign-on', () => {
  const claims = { issuer: 'https://login.example/tenant/v2.0', subject: 'abc', email: 'sup@ksu.example', name: 'Sup', preferredUsername: 'sup@ksu.example' };

  it('refuses an unknown identity without an invite', async () => {
    await setupAdmin(app);
    await expect(completeOidcLogin(db, claims, { inviteToken: null, linkUserId: null })).rejects.toThrow(/invite/);
  });

  it('creates an account from an invite, then signs the same identity back in', async () => {
    const s = await scenario();
    const link = (await s.admin.post(`/api/locations/${s.campus}/invites`, { role: 'viewer' })).body.url as string;
    const token = link.split('/invite/')[1]!;
    const first = await completeOidcLogin(db, claims, { inviteToken: token, linkUserId: null });
    const again = await completeOidcLogin(db, claims, { inviteToken: null, linkUserId: null });
    expect(again.userId).toBe(first.userId);
    const users = (await s.admin.get('/api/users')).body as any[];
    expect(users.find((u) => u.id === first.userId)).toMatchObject({ username: 'sup@ksu.example', hasPassword: false, identities: ['oidc'] });
  });

  it('does not match accounts by email alone', async () => {
    const s = await scenario();
    const roommateId = (await s.roommate.get('/api/auth/me')).body.user.id;
    await s.admin.patch(`/api/users/${roommateId}`, { email: 'sup@ksu.example' });
    await expect(completeOidcLogin(db, claims, { inviteToken: null, linkUserId: null })).rejects.toThrow(/invite/);
  });

  it('is hidden when not configured', async () => {
    expect((await new Client(app).get('/api/auth/oidc/start')).status).toBe(404);
  });
});
