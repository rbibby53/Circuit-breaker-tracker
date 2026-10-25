import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { purgeExpired } from '../src/cleanup';
import type { DB } from '../src/db';
import { Client, createLocation, invite, setupAdmin, testApp } from './helpers';

let app: FastifyInstance;
let db: DB;

beforeEach(async () => {
  ({ app, db } = await testApp());
});

describe('security headers', () => {
  it('sends a strict content security policy and no-store on the API', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/auth/config' });
    expect(r.headers['content-security-policy']).toContain("default-src 'self'");
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['strict-transport-security']).toBeUndefined();
  });

  it('adds HSTS when served over HTTPS', async () => {
    const secure = await testApp({ PUBLIC_URL: 'https://breakers.example.com' });
    const r = await secure.app.inject({ method: 'GET', url: '/healthz' });
    expect(r.headers['strict-transport-security']).toMatch(/max-age=/);
  });

  it('reports the app version', async () => {
    const r = await testApp({ APP_VERSION: '9.9.9' });
    expect((await new Client(r.app).get('/api/auth/config')).body.version).toBe('9.9.9');
  });
});

describe('purgeExpired', () => {
  it('removes expired sessions and stale one-time links, and keeps live ones', async () => {
    const admin = await setupAdmin(app);
    const co = await createLocation(admin, null, 'company', 'Personal');
    await admin.post(`/api/locations/${co}/invites`, { role: 'viewer' });
    const future = Date.now() + 40 * 86_400_000; // after the 7-day invite and 30-day keep window
    const nothing = purgeExpired(db);
    expect(nothing).toEqual({ sessions: 0, states: 0, challenges: 0, invites: 0, resets: 0, tokens: 0 });
    const later = purgeExpired(db, future + 30 * 86_400_000);
    expect(later.sessions).toBe(1);
    expect(later.invites).toBe(1);
  });
});

describe('search', () => {
  async function scenario() {
    const admin = await setupAdmin(app);
    const co = await createLocation(admin, null, 'company', 'Personal');
    const site = await createLocation(admin, co, 'site', 'Home');
    const ground = await createLocation(admin, site, 'floor', 'Ground');
    const kitchen = await createLocation(admin, ground, 'room', 'Kitchen');
    const garage = await createLocation(admin, ground, 'room', 'Garage');
    const panel = (await admin.post(`/api/locations/${kitchen}/panels`, { name: 'Main panel', spaces: 12 })).body.id;
    const b = (clientKey: string, position: number, serves: number[]) => ({
      clientKey,
      position,
      poles: 1,
      amps: 20,
      label: clientKey,
      serves: serves.map((locationId) => ({ locationId })),
    });
    const r = await admin.req('PUT', `/api/panels/${panel}`, {
      name: 'Main panel',
      spaces: 12,
      version: 1,
      breakers: [b('Kitchen counter', 1, [kitchen]), b('Smoke alarms', 3, [site]), b('Freezer', 5, [garage])],
    });
    expect(r.status).toBe(200);
    const guest = await invite(app, admin, garage, 'viewer', 'guest');
    return { admin, guest };
  }

  it('finds breakers by label and by the room they serve', async () => {
    const { admin } = await scenario();
    const byLabel = (await admin.get('/api/search?q=smoke')).body;
    expect(byLabel.breakers.map((b: any) => b.label)).toEqual(['Smoke alarms']);
    const byRoom = (await admin.get('/api/search?q=garage')).body;
    expect(byRoom.locations.map((l: any) => l.name)).toEqual(['Garage']);
    expect(byRoom.breakers.map((b: any) => [b.label, b.serves])).toEqual([['Freezer', 'Garage']]);
  });

  it('only shows what the person may see', async () => {
    const { guest } = await scenario();
    // The guest can see the garage only: breakers serving it or the whole site, but no kitchen.
    expect((await guest.get('/api/search?q=kitchen')).body).toEqual({
      locations: [],
      panels: [],
      generators: [],
      devices: [],
      equipment: [],
      meters: [],
      breakers: [],
    });
    const smoke = (await guest.get('/api/search?q=smoke')).body.breakers;
    expect(smoke).toEqual([expect.objectContaining({ label: 'Smoke alarms', canViewPanel: false })]);
    expect((await guest.get('/api/search?q=main')).body.panels).toEqual([]);
  });

  it('treats wildcards literally and ignores very short queries', async () => {
    const { admin } = await scenario();
    expect((await admin.get('/api/search?q=%25%25')).body.breakers).toEqual([]);
    expect((await admin.get('/api/search?q=k')).body.breakers).toEqual([]);
  });
});
