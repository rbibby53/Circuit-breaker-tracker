import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db';
import { Client, createLocation, invite, setupAdmin, testApp } from './helpers';

let app: FastifyInstance;
let db: ReturnType<typeof openDatabase>;

beforeEach(async () => {
  ({ app, db } = await testApp());
});

/** KSU with two campuses; a manager of Kennesaw who may invite up to editors; a viewer. */
async function campus() {
  const admin = await setupAdmin(app);
  const ksu = await createLocation(admin, null, 'company', 'KSU');
  const kennesaw = await createLocation(admin, ksu, 'site', 'Kennesaw');
  const marietta = await createLocation(admin, ksu, 'site', 'Marietta');
  const manager = await invite(app, admin, kennesaw, 'manager', 'mgr', 'editor');
  const viewer = await invite(app, admin, kennesaw, 'viewer', 'vee');
  const make = async (c: Client, loc: number, body: object) => {
    const r = await c.post(`/api/locations/${loc}/invites`, body);
    expect(r.status).toBe(200);
    return String(r.body.url).split('/invite/')[1]!;
  };
  return { admin, manager, viewer, ksu, kennesaw, marietta, make };
}

describe('pending invites', () => {
  it('lists every unused invite for an admin, newest first, with where and for whom', async () => {
    const c = await campus();
    await c.make(c.admin, c.kennesaw, { role: 'viewer', note: 'Night shift' });
    await c.make(c.admin, c.marietta, { role: 'manager', inviteLimit: 'viewer' });
    const r = await c.admin.get('/api/invites');
    expect(r.status).toBe(200);
    expect(r.body).toEqual([
      expect.objectContaining({
        locationId: c.marietta,
        locationPath: 'KSU › Marietta',
        role: 'manager',
        inviteLimit: 'viewer',
        note: null,
        createdBy: 'Admin',
        canRevoke: true,
      }),
      expect.objectContaining({
        locationId: c.kennesaw,
        locationPath: 'KSU › Kennesaw',
        role: 'viewer',
        note: 'Night shift',
        canRevoke: true,
      }),
    ]);
  });

  it('leaves out invites that were used or have expired', async () => {
    const c = await campus();
    // The two invites accepted while setting up are used, so they are not listed.
    expect((await c.admin.get('/api/invites')).body).toEqual([]);
    await c.make(c.admin, c.kennesaw, { role: 'viewer', note: 'old' });
    db.prepare("UPDATE invites SET expires_at = '2000-01-01T00:00:00.000Z' WHERE note = 'old'").run();
    expect((await c.admin.get('/api/invites')).body).toEqual([]);
  });

  it('shows a manager only the invites inside what they manage, and which they may revoke', async () => {
    const c = await campus();
    await c.make(c.admin, c.marietta, { role: 'viewer', note: 'elsewhere' });
    await c.make(c.admin, c.kennesaw, { role: 'manager', inviteLimit: 'viewer', note: 'stronger' });
    await c.make(c.manager, c.kennesaw, { role: 'editor', note: 'mine' });
    const r = await c.manager.get('/api/invites');
    expect(r.status).toBe(200);
    expect(r.body.map((i: { note: string; canRevoke: boolean }) => [i.note, i.canRevoke])).toEqual([
      ['mine', true],
      // Above their invite limit: they can see it but not take it back.
      ['stronger', false],
    ]);
    const stronger = r.body.find((i: { note: string }) => i.note === 'stronger');
    expect((await c.manager.del(`/api/invites/${stronger.id}`)).status).toBe(403);

    // The list for one location says the same.
    const here = (await c.manager.get(`/api/locations/${c.kennesaw}/invites`)).body;
    expect(here.map((i: { note: string; canRevoke: boolean }) => [i.note, i.canRevoke])).toEqual([
      ['mine', true],
      ['stronger', false],
    ]);
  });

  it('is not for people who manage nothing', async () => {
    const c = await campus();
    expect((await c.viewer.get('/api/invites')).status).toBe(403);
    expect((await new Client(app).get('/api/invites')).status).toBe(401);
  });

  it('revoking takes it off the list and the link stops working', async () => {
    const c = await campus();
    const token = await c.make(c.manager, c.kennesaw, { role: 'viewer', note: 'oops' });
    const [pending] = (await c.manager.get('/api/invites')).body;
    expect((await c.manager.del(`/api/invites/${pending.id}`)).status).toBe(200);
    expect((await c.manager.get('/api/invites')).body).toEqual([]);
    expect((await new Client(app).get(`/api/invites/${token}`)).status).toBe(404);
    const activity = (await c.admin.get('/api/activity')).body;
    expect(JSON.stringify(activity)).toContain('Revoked an invite');
  });
});
