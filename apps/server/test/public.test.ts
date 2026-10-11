import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { panelQrUrl } from '../src/pdf/document';
import { Client, createLocation, invite, setupAdmin, testApp } from './helpers';

let app: FastifyInstance;

beforeEach(async () => {
  ({ app } = await testApp());
});

async function home() {
  const admin = await setupAdmin(app);
  const co = await createLocation(admin, null, 'company', 'Personal');
  const site = await createLocation(admin, co, 'site', 'Home');
  const floor = await createLocation(admin, site, 'floor', 'Ground');
  const kitchen = await createLocation(admin, floor, 'room', 'Kitchen');
  const panel = (await admin.post(`/api/locations/${kitchen}/panels`, { name: 'Main panel', spaces: 12 })).body.id;
  const cur = (await admin.get(`/api/panels/${panel}`)).body;
  await admin.req('PUT', `/api/panels/${panel}`, {
    ...cur,
    breakers: [
      {
        clientKey: 'a',
        position: 1,
        poles: 1,
        amps: 20,
        label: 'Fridge',
        notes: 'Dedicated',
        critical: true,
        serves: [{ locationId: kitchen, note: 'fridge' }],
      },
    ],
  });
  return { admin, site, kitchen, panel };
}

const share = (c: Client, panel: number, body: object) => c.req('PUT', `/api/panels/${panel}/public`, body);

describe('public panel pages', () => {
  it('are off until a manager turns them on, then readable without signing in', async () => {
    const h = await home();
    expect((await h.admin.get(`/api/panels/${h.panel}`)).body).toMatchObject({ publicPath: null, canShare: true });

    const on = await share(h.admin, h.panel, { enabled: true });
    expect(on.body.publicPath).toMatch(/^\/p\/[A-Za-z0-9_-]{24}$/);
    const token = on.body.publicPath.slice(3);

    const anon = new Client(app);
    const page = await anon.get(`/api/public/panels/${token}`);
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ name: 'Main panel', locationPath: 'Personal › Home › Ground › Kitchen' });
    expect(page.body.breakers).toEqual([
      expect.objectContaining({ position: 1, label: 'Fridge', critical: true, serves: ['Kitchen (fridge)'] }),
    ]);
    // Nothing about people or other records.
    expect(JSON.stringify(page.body)).not.toMatch(/admin|locationId|breakerId|version/);
    // Turning it on again keeps the same link.
    expect((await share(h.admin, h.panel, { enabled: true })).body.publicPath).toBe(on.body.publicPath);
  });

  it('stop working when turned off, or when the link is replaced', async () => {
    const h = await home();
    const anon = new Client(app);
    const first = (await share(h.admin, h.panel, { enabled: true })).body.publicPath.slice(3);
    const second = (await share(h.admin, h.panel, { enabled: true, renew: true })).body.publicPath.slice(3);
    expect(second).not.toBe(first);
    expect((await anon.get(`/api/public/panels/${first}`)).status).toBe(404);
    expect((await anon.get(`/api/public/panels/${second}`)).status).toBe(200);
    await share(h.admin, h.panel, { enabled: false });
    expect((await anon.get(`/api/public/panels/${second}`)).status).toBe(404);
    expect((await anon.get('/api/public/panels/not-a-real-token-at-all')).status).toBe(404);
  });

  it('can only be shared by managers, and admins can switch them off everywhere', async () => {
    const h = await home();
    const editor = await invite(app, h.admin, h.site, 'editor', 'ed');
    expect((await editor.get(`/api/panels/${h.panel}`)).body.canShare).toBe(false);
    expect((await share(editor, h.panel, { enabled: true })).status).toBe(403);
    const manager = await invite(app, h.admin, h.site, 'manager', 'boss', 'editor');
    const token = (await share(manager, h.panel, { enabled: true })).body.publicPath.slice(3);

    await h.admin.patch('/api/admin/settings', { publicPanels: false });
    expect((await new Client(app).get(`/api/public/panels/${token}`)).status).toBe(404);
    expect((await share(manager, h.panel, { enabled: true, renew: true })).status).toBe(400);
    expect((await new Client(app).get('/api/auth/config')).body.publicPanels).toBe(false);
  });

  it('are not copied when a panel is duplicated', async () => {
    const h = await home();
    await share(h.admin, h.panel, { enabled: true });
    const copy = await h.admin.post(`/api/panels/${h.panel}/duplicate`, { name: 'Copy', locationId: h.kitchen });
    expect((await h.admin.get(`/api/panels/${copy.body.id}`)).body.publicPath).toBeNull();
  });
});

describe('QR code links', () => {
  it('lead to the public page when there is one and it is allowed', () => {
    const base = { qrBase: 'https://b.example', publicPanels: true };
    expect(panelQrUrl(base, { id: 4, publicPath: '/p/abc' })).toBe('https://b.example/p/abc');
    expect(panelQrUrl(base, { id: 4, publicPath: null })).toBe('https://b.example/panels/4');
    expect(panelQrUrl({ ...base, publicPanels: false }, { id: 4, publicPath: '/p/abc' })).toBe(
      'https://b.example/panels/4',
    );
    expect(panelQrUrl({ ...base, qrBase: null }, { id: 4, publicPath: '/p/abc' })).toBeNull();
  });
});
