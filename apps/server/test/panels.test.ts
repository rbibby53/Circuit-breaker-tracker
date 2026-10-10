import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { Client, createLocation, invite, setupAdmin, testApp } from './helpers';

let app: FastifyInstance;

beforeEach(async () => {
  ({ app } = await testApp());
});

const breaker = (clientKey: string, position: number, extra: Record<string, unknown> = {}) => ({
  clientKey,
  position,
  slot: 'full',
  poles: 1,
  amps: 20,
  protection: 'standard',
  label: clientKey,
  notes: '',
  isSpare: false,
  critical: false,
  backup: 'none',
  serves: [],
  ...extra,
});

async function home() {
  const admin = await setupAdmin(app);
  const personal = await createLocation(admin, null, 'company', 'Personal');
  const site = await createLocation(admin, personal, 'site', 'Home');
  const basement = await createLocation(admin, site, 'floor', 'Basement');
  const utility = await createLocation(admin, basement, 'room', 'Utility room');
  const ground = await createLocation(admin, site, 'floor', 'Ground');
  const kitchen = await createLocation(admin, ground, 'room', 'Kitchen');
  const garage = await createLocation(admin, ground, 'room', 'Garage');
  const upper = await createLocation(admin, site, 'floor', 'Upper');
  const bath = await createLocation(admin, upper, 'room', 'Hall bath');
  const r = await admin.post(`/api/locations/${utility}/panels`, { name: 'Main panel', spaces: 24, mainAmps: 200 });
  expect(r.status).toBe(200);
  return { admin, personal, site, basement, utility, ground, kitchen, garage, upper, bath, main: r.body.id as number };
}

async function save(c: Client, id: number, breakers: unknown[], extra: Record<string, unknown> = {}) {
  const current = (await c.get(`/api/panels/${id}`)).body;
  return c.req('PUT', `/api/panels/${id}`, {
    name: current.name,
    layout: current.layout,
    spaces: current.spaces,
    mainAmps: current.mainAmps,
    mainType: current.mainType,
    voltage: current.voltage,
    manufacturer: current.manufacturer,
    model: current.model,
    notes: current.notes,
    version: current.version,
    breakers,
    ...extra,
  });
}

describe('panels', () => {
  it('only go in rooms', async () => {
    const h = await home();
    expect((await h.admin.post(`/api/locations/${h.ground}/panels`, { name: 'X', spaces: 24 })).status).toBe(400);
  });

  it('saves breakers, returns ids for new ones and bumps the version', async () => {
    const h = await home();
    const r = await save(h.admin, h.main, [
      breaker('range', 1, { poles: 2, amps: 50, serves: [{ locationId: h.kitchen }] }),
      breaker('bath', 19, {
        protection: 'gfci',
        serves: [{ locationId: h.kitchen }, { locationId: h.bath, note: 'outlets' }],
      }),
      breaker('lights', 21, { slot: 'A', amps: 15 }),
      breaker('network', 21, { slot: 'B', amps: 15, critical: true, backup: 'ups' }),
    ]);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.idMap).sort()).toEqual(['bath', 'lights', 'network', 'range']);
    const p = r.body.panel;
    expect(p.version).toBe(2);
    const net = p.breakers.find((b: any) => b.label === 'network');
    expect(net).toMatchObject({ slot: 'B', critical: true, backup: 'ups' });
    const bath = p.breakers.find((b: any) => b.label === 'bath');
    expect(bath.serves.map((s: any) => s.name).sort()).toEqual(['Hall bath', 'Kitchen']);
  });

  it('rejects overlapping and 3-pole breakers on a home panel', async () => {
    const h = await home();
    expect((await save(h.admin, h.main, [breaker('a', 2, { poles: 2 }), breaker('b', 4)])).status).toBe(400);
    expect((await save(h.admin, h.main, [breaker('a', 1, { poles: 3 })])).body.message).toMatch(/split-phase/);
  });

  it('refuses a stale save instead of overwriting someone else', async () => {
    const h = await home();
    const stale = (await h.admin.get(`/api/panels/${h.main}`)).body;
    expect((await save(h.admin, h.main, [breaker('a', 1)])).status).toBe(200);
    const r = await h.admin.req('PUT', `/api/panels/${h.main}`, { ...stale, breakers: [breaker('b', 3)] });
    expect(r.status).toBe(409);
  });

  it('does not create a new version when nothing changed', async () => {
    const h = await home();
    const first = await save(h.admin, h.main, [breaker('a', 1)]);
    const b = first.body.panel.breakers[0];
    const again = await save(h.admin, h.main, [breaker('a', 1, { id: b.id })]);
    expect(again.body.panel.version).toBe(first.body.panel.version);
  });

  it('records readable history', async () => {
    const h = await home();
    const first = await save(h.admin, h.main, [breaker('Dryer', 2, { poles: 2, amps: 30 })]);
    const id = first.body.panel.breakers[0].id;
    await save(h.admin, h.main, [breaker('Dryer', 6, { id, poles: 2, amps: 40 })]);
    const history = (await h.admin.get(`/api/panels/${h.main}/history`)).body;
    expect(history[0].details).toEqual(['6 + 8 Dryer: moved from 2 + 4; amps 30 → 40']);
    expect(history[1].details).toEqual(['Added 2 + 4 Dryer (30A)']);
  });

  it('keeps tags a less-privileged editor cannot see when they save', async () => {
    const h = await home();
    await save(h.admin, h.main, [breaker('mixed', 1, { serves: [{ locationId: h.kitchen }, { locationId: h.bath }] })]);
    // An editor on the basement only can edit the panel but cannot see the kitchen or bath.
    const editor = await invite(app, h.admin, h.basement, 'editor', 'basement-editor');
    const seen = (await editor.get(`/api/panels/${h.main}`)).body;
    expect(seen.breakers[0].serves.map((s: any) => s.name)).toEqual([null, null]);
    const id = seen.breakers[0].id;
    expect((await save(editor, h.main, [breaker('renamed', 1, { id })])).status).toBe(200);
    const after = (await h.admin.get(`/api/panels/${h.main}`)).body;
    expect(after.breakers[0].label).toBe('renamed');
    expect(after.breakers[0].serves.map((s: any) => s.name).sort()).toEqual(['Hall bath', 'Kitchen']);
    // ...and cannot tag places they cannot see.
    expect((await save(editor, h.main, [breaker('x', 1, { id, serves: [{ locationId: h.garage }] })])).status).toBe(
      400,
    );
  });

  it('refuses tags in another site', async () => {
    const h = await home();
    const other = await createLocation(h.admin, h.personal, 'site', 'Cabin');
    expect((await save(h.admin, h.main, [breaker('a', 1, { serves: [{ locationId: other }] })])).status).toBe(400);
  });

  it('viewers cannot save; rooms with panels cannot be deleted', async () => {
    const h = await home();
    const viewer = await invite(app, h.admin, h.site, 'viewer', 'viewer');
    expect((await save(viewer, h.main, [])).status).toBe(403);
    expect((await h.admin.del(`/api/locations/${h.utility}`)).status).toBe(409);
  });
});

describe('feed chain and served-by', () => {
  async function withSubPanel() {
    const h = await home();
    const main = await save(h.admin, h.main, [
      breaker('Garage sub-panel', 2, { poles: 2, amps: 60 }),
      breaker('Smoke alarms', 22, { serves: [{ locationId: h.site }], critical: true }),
      breaker('Kitchen counter', 5, { protection: 'gfci', serves: [{ locationId: h.kitchen }] }),
    ]);
    const feeder = main.body.panel.breakers.find((b: any) => b.label === 'Garage sub-panel').id;
    const sub = await h.admin.post(`/api/locations/${h.garage}/panels`, {
      name: 'Garage sub-panel',
      spaces: 12,
      mainAmps: null,
      mainType: 'lugs',
    });
    const subId = sub.body.id as number;
    expect(
      (
        await save(h.admin, subId, [breaker('Garage outlets', 1, { serves: [{ locationId: h.garage }] })], {
          fedFromBreakerId: feeder,
        })
      ).status,
    ).toBe(200);
    const garageViewer = await invite(app, h.admin, h.garage, 'viewer', 'garage-viewer');
    return { ...h, feeder, subId, garageViewer };
  }

  it('shows the feed chain read-only, even for panels outside the viewer’s scope', async () => {
    const s = await withSubPanel();
    const sub = (await s.garageViewer.get(`/api/panels/${s.subId}`)).body;
    expect(sub.canEdit).toBe(false);
    expect(sub.feedChain).toEqual([
      expect.objectContaining({
        panelName: 'Main panel',
        locationPath: 'Personal › Home › Basement › Utility room', // the automatic building stays hidden
        circuit: '2 + 4',
        label: 'Garage sub-panel',
        amps: 60,
        canView: false,
      }),
    ]);
    expect((await s.garageViewer.get(`/api/panels/${s.main}`)).status).toBe(404);
  });

  it('lists breakers serving a location, including whole-site tags, from panels out of scope', async () => {
    const s = await withSubPanel();
    const items = (await s.garageViewer.get(`/api/locations/${s.garage}/served-by`)).body as any[];
    expect(items.map((i) => [i.label, i.via, i.canViewPanel])).toEqual([
      ['Garage outlets', 'This room', true],
      ['Smoke alarms', 'Whole site: Home', false],
    ]);
    expect(items.some((i) => i.label === 'Kitchen counter')).toBe(false);
  });

  it('shows what a breaker feeds, and refuses loops', async () => {
    const s = await withSubPanel();
    const main = (await s.admin.get(`/api/panels/${s.main}`)).body;
    expect(main.breakers.find((b: any) => b.id === s.feeder).feeds).toEqual([
      { panelId: s.subId, panelName: 'Garage sub-panel' },
    ]);
    const subBreaker = (await s.admin.get(`/api/panels/${s.subId}`)).body.breakers[0].id;
    const loop = await save(
      s.admin,
      s.main,
      main.breakers.map((b: any) => ({
        ...b,
        clientKey: String(b.id),
        serves: b.serves.map((x: any) => ({ locationId: x.locationId, note: x.note })),
      })),
      { fedFromBreakerId: subBreaker },
    );
    expect(loop.status).toBe(400);
    const candidates = (await s.admin.get(`/api/panels/${s.main}/feed-candidates`)).body as any[];
    expect(candidates.some((c) => c.panelId === s.subId)).toBe(false);
  });

  it('removing the feeder breaker unlinks the sub-panel', async () => {
    const s = await withSubPanel();
    const main = (await s.admin.get(`/api/panels/${s.main}`)).body;
    const rest = main.breakers
      .filter((b: any) => b.id !== s.feeder)
      .map((b: any) => ({
        ...b,
        clientKey: String(b.id),
        serves: b.serves.map((x: any) => ({ locationId: x.locationId, note: x.note })),
      }));
    expect((await save(s.admin, s.main, rest)).status).toBe(200);
    expect((await s.admin.get(`/api/panels/${s.subId}`)).body.feedChain).toEqual([]);
  });
});
