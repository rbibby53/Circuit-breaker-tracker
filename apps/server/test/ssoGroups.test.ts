import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../src/db';
import { hashPassword } from '../src/passwords';
import { completeOidcLogin, type SsoRules } from '../src/routes/auth';
import { Client, PASSWORD, createLocation, setupAdmin, testApp } from './helpers';

let app: FastifyInstance;
let db: DB;

beforeEach(async () => {
  ({ app, db } = await testApp());
});

const NO_STATE = { inviteToken: null, linkUserId: null };
const rules = (r: Partial<SsoRules> = {}): SsoRules => ({
  provider: 'Authentik',
  adminGroups: [],
  allowedGroups: [],
  createAccounts: true,
  ...r,
});
const claims = (subject: string, groups: string[] | null) => ({
  issuer: 'https://auth.example.com/application/o/breakers/',
  subject,
  email: `${subject}@home.example`,
  name: subject,
  preferredUsername: subject,
  groups,
});

/** Sign in as an SSO-made account through the API, by giving it a password. */
async function clientFor(userId: number): Promise<Client> {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(PASSWORD), userId);
  const { username } = db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as { username: string };
  const c = new Client(app);
  expect((await c.post('/api/auth/login', { username, password: PASSWORD })).status).toBe(200);
  return c;
}

const isAdmin = (id: number) => !!(db.prepare('SELECT is_admin FROM users WHERE id = ?').get(id) as any).is_admin;

async function setup() {
  const admin = await setupAdmin(app);
  const home = await createLocation(admin, null, 'company', 'Home');
  const house = await createLocation(admin, home, 'site', 'House');
  const work = await createLocation(admin, null, 'company', 'Work');
  return { admin, home, house, work };
}

describe('group access', () => {
  it('lets admins map groups to locations and lists known groups', async () => {
    const s = await setup();
    const r = await s.admin.post('/api/admin/sso-groups', { group: 'family', locationId: s.home, role: 'editor' });
    expect(r.status).toBe(200);
    expect(
      (await s.admin.post('/api/admin/sso-groups', { group: 'FAMILY', locationId: s.home, role: 'viewer' })).status,
    ).toBe(409);
    expect(
      (await s.admin.post('/api/admin/sso-groups', { group: 'x', locationId: s.home, role: 'manager' })).status,
    ).toBe(400);

    await completeOidcLogin(db, claims('sam', ['Family', 'Other']), NO_STATE, rules());
    const list = (await s.admin.get('/api/admin/sso-groups')).body;
    expect(list.mappings).toMatchObject([{ group: 'family', locationPath: 'Home', role: 'editor', members: 1 }]);
    expect(list.knownGroups).toEqual(['Family', 'Other']);

    expect((await s.admin.del(`/api/admin/sso-groups/${r.body.id}`)).status).toBe(200);
    expect((await s.admin.get('/api/admin/sso-groups')).body.mappings).toEqual([]);
  });

  it('is for admins only', async () => {
    const s = await setup();
    await s.admin.post('/api/admin/sso-groups', {
      group: 'family',
      locationId: s.home,
      role: 'manager',
      inviteLimit: 'viewer',
    });
    const { userId } = await completeOidcLogin(db, claims('sam', ['family']), NO_STATE, rules());
    const sam = await clientFor(userId);
    expect((await sam.get('/api/admin/sso-groups')).status).toBe(403);
    expect((await sam.post('/api/admin/sso-groups', { group: 'me', locationId: s.work, role: 'editor' })).status).toBe(
      403,
    );
  });

  it('creates accounts for people whose groups give access, and gives them that access', async () => {
    const s = await setup();
    await s.admin.post('/api/admin/sso-groups', { group: 'family', locationId: s.home, role: 'editor' });

    await expect(completeOidcLogin(db, claims('stranger', ['guests']), NO_STATE, rules())).rejects.toThrow(/invite/);
    await expect(
      completeOidcLogin(db, claims('sam', ['family']), NO_STATE, rules({ createAccounts: false })),
    ).rejects.toThrow(/invite/);

    const { userId } = await completeOidcLogin(db, claims('sam', ['family']), NO_STATE, rules());
    const sam = await clientFor(userId);
    const seen = ((await sam.get('/api/locations')).body as any[]).map((l) => l.id);
    expect(seen).toEqual(expect.arrayContaining([s.home, s.house]));
    expect(seen).not.toContain(s.work);
    // Editors can add things inside.
    expect((await sam.post('/api/locations', { parentId: s.house, kind: 'building', name: 'Garage' })).status).toBe(
      200,
    );

    // The access shows as coming from the group, and cannot be edited as a grant.
    const people = (await s.admin.get('/api/users')).body as any[];
    expect(people.find((p) => p.id === userId)).toMatchObject({
      ssoGroups: ['family'],
      grants: [{ locationId: s.home, role: 'editor', group: 'family', canManage: false }],
    });
    const applies = (await s.admin.get(`/api/locations/${s.house}/access`)).body.applies as any[];
    expect(applies).toEqual([expect.objectContaining({ group: 'family', inherited: true })]);
  });

  it('follows group changes at the next sign-in, and new mappings at once', async () => {
    const s = await setup();
    await s.admin.post('/api/admin/sso-groups', { group: 'family', locationId: s.home, role: 'viewer' });
    const { userId } = await completeOidcLogin(db, claims('sam', ['family']), NO_STATE, rules());
    const sam = await clientFor(userId);
    const seen = async () => ((await sam.get('/api/locations')).body as any[]).map((l) => l.id);
    expect(await seen()).toContain(s.home);

    await s.admin.post('/api/admin/sso-groups', { group: 'family', locationId: s.work, role: 'viewer' });
    expect(await seen()).toContain(s.work);

    // Left the group in the provider: the account stays, its group access goes.
    await completeOidcLogin(db, claims('sam', []), NO_STATE, rules());
    expect(await seen()).toEqual([]);
  });

  it('keeps grants given by hand beside group access', async () => {
    const s = await setup();
    await s.admin.post('/api/admin/sso-groups', { group: 'family', locationId: s.home, role: 'viewer' });
    const { userId } = await completeOidcLogin(db, claims('sam', ['family']), NO_STATE, rules());
    expect((await s.admin.post(`/api/locations/${s.house}/grants`, { userId, role: 'editor' })).status).toBe(200);
    await completeOidcLogin(db, claims('sam', []), NO_STATE, rules());
    const sam = await clientFor(userId);
    const seen = ((await sam.get('/api/locations')).body as any[]).map((l) => l.id);
    expect(seen).toContain(s.house);
  });

  it('refuses people outside the allowed groups, even with an account', async () => {
    await setup();
    await expect(
      completeOidcLogin(db, claims('sam', ['family']), NO_STATE, rules({ allowedGroups: ['staff'] })),
    ).rejects.toThrow(/not in a group/);
    await expect(
      completeOidcLogin(db, claims('sam', null), NO_STATE, rules({ allowedGroups: ['staff'] })),
    ).rejects.toThrow(/not in a group/);
  });
});

describe('admin groups', () => {
  it('makes members admins and takes it away when they leave, but never from hand-made admins', async () => {
    const s = await setup();
    const r = rules({ adminGroups: ['cbt-admins'] });
    const { userId } = await completeOidcLogin(db, claims('pat', ['cbt-admins']), NO_STATE, r);
    expect(isAdmin(userId)).toBe(true);
    const people = (await s.admin.get('/api/users')).body as any[];
    expect(people.find((p) => p.id === userId)).toMatchObject({ isAdmin: true, adminFromGroups: true });

    await completeOidcLogin(db, claims('pat', ['other']), NO_STATE, r);
    expect(isAdmin(userId)).toBe(false);

    // Made an admin by hand: groups no longer decide.
    await completeOidcLogin(db, claims('pat', ['cbt-admins']), NO_STATE, r);
    expect((await s.admin.patch(`/api/users/${userId}`, { isAdmin: true })).status).toBe(200);
    await completeOidcLogin(db, claims('pat', []), NO_STATE, r);
    expect(isAdmin(userId)).toBe(true);
  });

  it('never removes the last admin', async () => {
    const s = await setup();
    const r = rules({ adminGroups: ['cbt-admins'] });
    const { userId } = await completeOidcLogin(db, claims('pat', ['cbt-admins']), NO_STATE, r);
    const adminId = (await s.admin.get('/api/auth/me')).body.user.id;
    db.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').run(adminId);
    await completeOidcLogin(db, claims('pat', []), NO_STATE, r);
    expect(isAdmin(userId)).toBe(true);
  });

  it('leaves admins alone when no admin groups are set', async () => {
    await setup();
    const { userId } = await completeOidcLogin(
      db,
      claims('pat', ['cbt-admins']),
      NO_STATE,
      rules({ adminGroups: ['cbt-admins'] }),
    );
    await completeOidcLogin(db, claims('pat', []), NO_STATE, rules());
    expect(isAdmin(userId)).toBe(true);
  });

  it('drops group access when single sign-on is unlinked', async () => {
    const s = await setup();
    await s.admin.post('/api/admin/sso-groups', { group: 'family', locationId: s.home, role: 'viewer' });
    const { userId } = await completeOidcLogin(db, claims('sam', ['family']), NO_STATE, rules());
    const sam = await clientFor(userId);
    expect((await s.admin.del(`/api/users/${userId}/identities/oidc`)).status).toBe(200);
    expect(((await sam.get('/api/locations')).body as any[]).length).toBe(0);
  });
});
