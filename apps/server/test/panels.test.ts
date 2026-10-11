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

describe('three-phase panelboards', () => {
  it('creates a commercial panel and takes 3-pole breakers on phases A, B and C', async () => {
    const h = await home();
    const r = await h.admin.post(`/api/locations/${h.utility}/panels`, {
      name: 'LP-1',
      layout: 'commercial',
      spaces: 42,
      mainAmps: 225,
      voltage: '120/208 V 3-phase',
    });
    expect(r.status).toBe(200);
    const saved = await save(h.admin, r.body.id, [
      breaker('RTU-1', 1, { poles: 3, amps: 60 }),
      breaker('Lights', 2),
      breaker('Pump', 4, { poles: 2, amps: 30 }),
    ]);
    expect(saved.status).toBe(200);
    const rtu = saved.body.panel.breakers.find((b: { label: string }) => b.label === 'RTU-1');
    expect(rtu).toMatchObject({ position: 1, poles: 3 });
    const history = await h.admin.get(`/api/panels/${r.body.id}/history`);
    expect(history.body[0].details).toContain('Added 1 + 3 + 5 RTU-1 (60A)');
  });

  it('refuses tandems and space counts that leave the phases uneven', async () => {
    const h = await home();
    const bad = await h.admin.post(`/api/locations/${h.utility}/panels`, {
      name: 'LP-2',
      layout: 'commercial',
      spaces: 40,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/multiple of 6/);
    const ok = await h.admin.post(`/api/locations/${h.utility}/panels`, {
      name: 'LP-2',
      layout: 'commercial',
      spaces: 30,
    });
    const r = await save(h.admin, ok.body.id, [breaker('Half', 3, { slot: 'A' })]);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/no tandems/);
  });

  it('switches a panel between layouts only when its breakers still fit', async () => {
    const h = await home();
    await save(h.admin, h.main, [breaker('Hall', 21, { slot: 'A' })]);
    const blocked = await save(h.admin, h.main, [breaker('Hall', 21, { slot: 'A' })], { layout: 'commercial' });
    expect(blocked.status).toBe(400);
    const moved = await save(h.admin, h.main, [breaker('Hall', 21)], { layout: 'commercial' });
    expect(moved.status).toBe(200);
    expect(moved.body.panel.layout).toBe('commercial');
    const pdf = await h.admin.raw(`/api/panels/${h.main}/pdf`);
    expect(pdf.status).toBe(200);
  });
});

describe('duplicating a panel', () => {
  it('copies the breakers into another room, keeping room tags inside the same site', async () => {
    const h = await home();
    await save(h.admin, h.main, [
      breaker('Range', 1, { poles: 2, amps: 50, serves: [{ locationId: h.kitchen, note: 'oven' }] }),
      breaker('Alarm', 9, { slot: 'A', critical: true, notes: 'Keep on' }),
    ]);
    const r = await h.admin.post(`/api/panels/${h.main}/duplicate`, {
      name: 'Main panel (copy)',
      locationId: h.garage,
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ keptTags: 1, droppedTags: 0 });
    const copy = (await h.admin.get(`/api/panels/${r.body.id}`)).body;
    expect(copy).toMatchObject({ name: 'Main panel (copy)', locationId: h.garage, spaces: 24, fedFromBreakerId: null });
    expect(copy.breakers.map((b: any) => [b.position, b.slot, b.poles, b.label, b.critical, b.notes])).toEqual([
      [1, 'full', 2, 'Range', false, ''],
      [9, 'A', 1, 'Alarm', true, 'Keep on'],
    ]);
    expect(copy.breakers[0].serves).toEqual([expect.objectContaining({ locationId: h.kitchen, note: 'oven' })]);
    const history = await h.admin.get(`/api/panels/${r.body.id}/history`);
    expect(history.body[0].summary).toBe('Duplicated panel Main panel as Main panel (copy) (2 breakers)');
  });

  it('leaves room tags off when the copy goes to another site', async () => {
    const h = await home();
    await save(h.admin, h.main, [breaker('Range', 1, { serves: [{ locationId: h.kitchen, note: '' }] })]);
    const apt = await createLocation(h.admin, h.personal, 'site', 'Apartment');
    const floor = await createLocation(h.admin, apt, 'floor', 'Unit 2');
    const closet = await createLocation(h.admin, floor, 'room', 'Closet');
    const r = await h.admin.post(`/api/panels/${h.main}/duplicate`, { name: 'Unit 2 panel', locationId: closet });
    expect(r.body).toMatchObject({ keptTags: 0, droppedTags: 1 });
    const copy = (await h.admin.get(`/api/panels/${r.body.id}`)).body;
    expect(copy.breakers[0].serves).toEqual([]);
  });

  it('needs Editor access where the copy goes, and a room', async () => {
    const h = await home();
    const viewer = await invite(app, h.admin, h.site, 'viewer', 'viewer');
    expect((await viewer.post(`/api/panels/${h.main}/duplicate`, { name: 'X', locationId: h.garage })).status).toBe(
      403,
    );
    expect((await h.admin.post(`/api/panels/${h.main}/duplicate`, { name: 'X', locationId: h.ground })).status).toBe(
      400,
    );
  });
});

describe('breaker tags', () => {
  it('saves tags without duplicates, shows them in history, and copies them with the panel', async () => {
    const h = await home();
    const r = await save(h.admin, h.main, [
      breaker('Rack', 1, { tags: ['Servers', ' servers ', 'Network', '  UPS  load '] }),
      breaker('Porch', 2, { tags: ['Lights'] }),
    ]);
    expect(r.status).toBe(200);
    const rack = r.body.panel.breakers.find((b: any) => b.label === 'Rack');
    expect(rack.tags).toEqual(['Network', 'Servers', 'UPS load']);

    const cur = (await h.admin.get(`/api/panels/${h.main}`)).body;
    await save(h.admin, h.main, [
      { ...breaker('Rack', 1), id: rack.id, tags: ['Servers'] },
      { ...breaker('Porch', 2), id: cur.breakers[1].id, tags: ['Lights'] },
    ]);
    const history = (await h.admin.get(`/api/panels/${h.main}/history`)).body;
    expect(history[0].details).toContain('1 Rack: tags Network, Servers, UPS load → Servers');

    const copy = await h.admin.post(`/api/panels/${h.main}/duplicate`, { name: 'Copy', locationId: h.garage });
    const copied = (await h.admin.get(`/api/panels/${copy.body.id}`)).body;
    expect(copied.breakers.map((b: any) => b.tags)).toEqual([['Servers'], ['Lights']]);
  });

  it('lists tags in use and finds breakers by tag', async () => {
    const h = await home();
    await save(h.admin, h.main, [
      breaker('Rack A', 1, { tags: ['Servers'] }),
      breaker('Rack B', 2, { tags: ['servers', 'Network'] }),
      breaker('Porch', 3, { tags: ['Lights'] }),
    ]);
    expect((await h.admin.get('/api/tags')).body).toEqual([
      { tag: 'Servers', count: 2 },
      { tag: 'Lights', count: 1 },
      { tag: 'Network', count: 1 },
    ]);
    const found = (await h.admin.get('/api/search?q=serv')).body.breakers;
    expect(found.map((b: any) => [b.label, b.tags])).toEqual([
      ['Rack A', ['Servers']],
      ['Rack B', ['Network', 'servers']],
    ]);
    // Someone who cannot see the panel sees none of its tags.
    const work = await createLocation(h.admin, null, 'company', 'Work');
    const outsider = await invite(app, h.admin, work, 'viewer', 'outsider');
    expect((await outsider.get('/api/tags')).body).toEqual([]);
  });

  it('refuses too many or too long tags', async () => {
    const h = await home();
    const many = await save(h.admin, h.main, [
      breaker('A', 1, { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }),
    ]);
    expect(many.status).toBe(400);
    const long = await save(h.admin, h.main, [breaker('A', 1, { tags: ['x'.repeat(31)] })]);
    expect(long.status).toBe(400);
  });
});
