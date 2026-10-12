import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { Client, createLocation, invite, setupAdmin, testApp } from './helpers';

let app: FastifyInstance;

beforeEach(async () => {
  ({ app } = await testApp());
});

const row = (clientKey: string, position: number, extra: Record<string, unknown> = {}) => ({
  clientKey,
  position,
  slot: 'full',
  poles: 1,
  amps: 20,
  label: clientKey,
  ...extra,
});

async function save(c: Client, id: number, breakers: unknown[] | null, extra: Record<string, unknown> = {}) {
  const p = (await c.get(`/api/panels/${id}`)).body;
  return c.req('PUT', `/api/panels/${id}`, {
    name: p.name,
    layout: p.layout,
    spaces: p.spaces,
    mainAmps: p.mainAmps,
    mainType: p.mainType,
    voltage: p.voltage,
    version: p.version,
    breakers:
      breakers ??
      p.breakers.map((b: any) => ({
        ...b,
        clientKey: String(b.id),
        serves: b.serves.map((s: any) => ({ locationId: s.locationId })),
      })),
    ...extra,
  });
}

/** A campus building with a lighting panel LP-1, an emergency panel EM-1 feeding EM-2, and a generator. */
async function campus() {
  const admin = await setupAdmin(app);
  const ksu = await createLocation(admin, null, 'company', 'KSU');
  const site = await createLocation(admin, ksu, 'site', 'Main campus');
  const hall = await createLocation(admin, site, 'building', 'Science Hall');
  const floor = await createLocation(admin, hall, 'floor', 'Floor 1');
  const elec = await createLocation(admin, floor, 'room', 'Electrical 101');
  const corridor = await createLocation(admin, floor, 'room', 'Corridor');
  const other = await createLocation(admin, ksu, 'site', 'Farm');
  const panel = async (name: string, extra: Record<string, unknown> = {}) => {
    const r = await admin.post(`/api/locations/${elec}/panels`, {
      name,
      layout: 'commercial',
      spaces: 42,
      mainAmps: 225,
      ...extra,
    });
    expect(r.status).toBe(200);
    return r.body.id as number;
  };
  const lp = await panel('LP-1');
  const lpSaved = await save(admin, lp, [
    row('corridor', 1, { label: 'Corridor lights' }),
    row('lab', 3, { label: 'Lab lights' }),
  ]);
  const [corridorBreaker, labBreaker] = ['corridor', 'lab'].map((k) => lpSaved.body.idMap[k] as number);
  const em1 = await panel('EM-1');
  const feeder = (await save(admin, em1, [row('em2', 1, { poles: 3, amps: 100, label: 'EM-2' })])).body.idMap
    .em2 as number;
  const em2 = await panel('EM-2');
  expect((await save(admin, em2, [], { fedFromBreakerId: feeder })).status).toBe(200);
  const gen = await admin.post(`/api/locations/${hall}/generators`, {
    name: 'GEN-1',
    kw: 250,
    fuel: 'diesel',
    voltage: '277/480 V',
  });
  expect(gen.status).toBe(200);
  return {
    admin,
    ksu,
    site,
    hall,
    floor,
    elec,
    corridor,
    other,
    lp,
    em1,
    em2,
    corridorBreaker,
    labBreaker,
    gen: gen.body.id as number,
  };
}

describe('generators', () => {
  it('belong to a site or building and are edited by editors', async () => {
    const c = await campus();
    expect((await c.admin.post(`/api/locations/${c.ksu}/generators`, { name: 'X' })).status).toBe(400);
    expect((await c.admin.post(`/api/locations/${c.hall}/generators`, { name: '' })).status).toBe(400);
    const viewer = await invite(app, c.admin, c.hall, 'viewer', 'viewer');
    expect((await viewer.get(`/api/generators/${c.gen}`)).body).toMatchObject({
      name: 'GEN-1',
      kw: 250,
      canEdit: false,
    });
    expect((await viewer.req('PATCH', `/api/generators/${c.gen}`, { name: 'Mine' })).status).toBe(403);
    const outsider = await invite(app, c.admin, c.other, 'editor', 'outsider');
    expect((await outsider.get(`/api/generators/${c.gen}`)).status).toBe(404);
    expect((await outsider.get('/api/generators')).body).toEqual([]);

    expect(
      (await c.admin.req('PATCH', `/api/generators/${c.gen}`, { name: 'GEN-1', kw: 300, fuel: 'natural-gas' })).status,
    ).toBe(200);
    expect((await c.admin.get(`/api/generators/${c.gen}`)).body).toMatchObject({ kw: 300, fuel: 'natural-gas' });
    // A location holding a generator cannot be deleted.
    const yard = await createLocation(c.admin, c.site, 'building', 'Yard');
    await c.admin.post(`/api/locations/${yard}/generators`, { name: 'GEN-2' });
    expect((await c.admin.del(`/api/locations/${yard}`)).status).toBe(409);
  });

  it('back up the panels tied to them, and the panels those feed', async () => {
    const c = await campus();
    expect((await save(c.admin, c.em1, null, { generatorId: c.gen, transferSwitch: 'ATS-1' })).status).toBe(200);

    const em1 = (await c.admin.get(`/api/panels/${c.em1}`)).body;
    expect(em1.generator).toMatchObject({
      id: c.gen,
      name: 'GEN-1',
      transferSwitch: 'ATS-1',
      via: null,
      canView: true,
    });
    const em2 = (await c.admin.get(`/api/panels/${c.em2}`)).body;
    expect(em2.generatorId).toBeNull();
    expect(em2.generator).toMatchObject({ id: c.gen, via: { panelId: c.em1, panelName: 'EM-1' } });
    expect((await c.admin.get(`/api/panels/${c.lp}`)).body.generator).toBeNull();
    const summaries = (await c.admin.get('/api/panels')).body as any[];
    expect(summaries.find((p) => p.id === c.em2).generatorName).toBe('GEN-1');

    const g = (await c.admin.get(`/api/generators/${c.gen}`)).body;
    expect(g.panelCount).toBe(2);
    expect(g.panels).toEqual([
      expect.objectContaining({ id: c.em1, transferSwitch: 'ATS-1', via: null }),
      expect.objectContaining({ id: c.em2, via: 'EM-1' }),
    ]);

    // Saving without the generator fields leaves the link alone.
    expect((await save(c.admin, c.em1, null, { notes: 'Emergency' })).status).toBe(200);
    expect((await c.admin.get(`/api/panels/${c.em1}`)).body.transferSwitch).toBe('ATS-1');

    // History says what changed.
    const history = (await c.admin.get(`/api/panels/${c.em1}/history`)).body as any[];
    expect(JSON.stringify(history)).toContain('generator changed');

    // Deleting the generator unlinks its panels.
    expect((await c.admin.del(`/api/generators/${c.gen}`)).status).toBe(200);
    expect((await c.admin.get(`/api/panels/${c.em1}`)).body).toMatchObject({
      generatorId: null,
      generator: null,
      transferSwitch: '',
    });
  });

  it('can only be linked when the person can see the generator', async () => {
    const c = await campus();
    const farmGen = (await c.admin.post(`/api/locations/${c.other}/generators`, { name: 'FARM' })).body.id;
    const editor = await invite(app, c.admin, c.hall, 'editor', 'editor');
    expect((await save(editor, c.em1, null, { generatorId: farmGen })).status).toBe(400);
    expect((await save(editor, c.em1, null, { generatorId: c.gen })).status).toBe(200);
  });

  it('are found by search', async () => {
    const c = await campus();
    expect((await c.admin.get('/api/search?q=gen-1')).body.generators).toEqual([
      { id: c.gen, name: 'GEN-1', path: 'KSU › Main campus › Science Hall' },
    ]);
  });
});

describe('relay panels', () => {
  async function relayPanel(c: Awaited<ReturnType<typeof campus>>) {
    const r = await c.admin.post(`/api/locations/${c.elec}/panels`, {
      name: 'RP-1',
      layout: 'relay',
      spaces: 16,
      mainAmps: 100,
      voltage: '277 V',
      controlSystem: 'nLight',
    });
    expect(r.status).toBe(200);
    return r.body.id as number;
  }

  it('have numbered relays, each switching a breaker circuit, shown on both sides', async () => {
    const c = await campus();
    const rp = await relayPanel(c);
    const created = (await c.admin.get(`/api/panels/${rp}`)).body;
    expect(created).toMatchObject({ layout: 'relay', mainType: 'lugs', mainAmps: null, controlSystem: 'nLight' });

    const saved = await save(c.admin, rp, [
      row('r1', 1, {
        label: 'Corridor',
        sourceBreakerId: c.corridorBreaker,
        control: 'Zone 3 · schedule',
        serves: [{ locationId: c.corridor }],
      }),
      row('r2', 2, { label: 'Lab', sourceBreakerId: c.labBreaker, poles: 2 }),
      row('r4', 4, { label: 'Spare', isSpare: true }),
    ]);
    expect(saved.status).toBe(200);
    const relays = saved.body.panel.breakers;
    expect(relays[0]).toMatchObject({
      position: 1,
      control: 'Zone 3 · schedule',
      source: {
        breakerId: c.corridorBreaker,
        panelId: c.lp,
        panelName: 'LP-1',
        circuit: '1',
        label: 'Corridor lights',
        canView: true,
      },
    });
    expect(relays[1]).toMatchObject({ poles: 2, source: { breakerId: c.labBreaker } });

    const lp = (await c.admin.get(`/api/panels/${c.lp}`)).body;
    const corridor = lp.breakers.find((b: any) => b.id === c.corridorBreaker);
    expect(corridor.switchedBy).toEqual([
      { panelId: rp, panelName: 'RP-1', relay: '1', label: 'Corridor', control: 'Zone 3 · schedule' },
    ]);

    // Relay control text is searchable.
    const found = (await c.admin.get('/api/search?q=zone 3')).body.breakers;
    expect(found).toEqual([expect.objectContaining({ panelName: 'RP-1', circuit: '1', label: 'Corridor' })]);

    // CSV shows both sides.
    const csv = (await c.admin.raw(`/api/panels/${rp}/csv`)).body.toString();
    expect(csv).toContain('Relay');
    expect(csv).toContain('LP-1 1 Corridor lights');
    expect((await c.admin.raw(`/api/panels/${c.lp}/csv`)).body.toString()).toContain('RP-1 relay 1');
    // And the PDF renders.
    expect((await c.admin.raw(`/api/panels/${rp}/pdf`)).status).toBe(200);
  });

  it('hold relays only, fed from breakers in breaker panels', async () => {
    const c = await campus();
    const rp = await relayPanel(c);
    const first = await save(c.admin, rp, [row('r1', 1, { sourceBreakerId: c.corridorBreaker })]);
    const relayId = first.body.idMap.r1;
    expect((await save(c.admin, rp, [row('r1', 1, { device: 'surge', amps: 0 })])).status).toBe(400);
    expect((await save(c.admin, rp, [row('r1', 1, { slot: 'A' })])).status).toBe(400);
    expect((await save(c.admin, rp, [row('r1', 1, { poles: 3 })])).status).toBe(400);
    expect((await save(c.admin, rp, [row('r2', 2, { sourceBreakerId: relayId })])).status).toBe(400);
    expect((await save(c.admin, rp, [row('r2', 2, { sourceBreakerId: 999999 })])).status).toBe(400);
    // A relay panel stays a relay panel.
    expect((await save(c.admin, rp, null, { layout: 'commercial', spaces: 42 })).status).toBe(400);
    expect((await save(c.admin, c.lp, null, { layout: 'relay', spaces: 16 })).status).toBe(400);
    // Breaker panels ignore relay fields.
    const lp = await save(c.admin, c.lp, [row('x', 1, { sourceBreakerId: c.labBreaker, control: 'nope' })]);
    expect(lp.body.panel.breakers[0]).toMatchObject({ sourceBreakerId: null, control: '' });
  });

  it('offer breakers from breaker panels (not relays) as feeds', async () => {
    const c = await campus();
    const rp = await relayPanel(c);
    await save(c.admin, rp, [row('r1', 1)]);
    const candidates = (await c.admin.get(`/api/panels/${rp}/feed-candidates?for=relay`)).body as any[];
    expect(candidates.some((x) => x.breakerId === c.corridorBreaker)).toBe(true);
    expect(candidates.some((x) => x.panelId === rp)).toBe(false);
    // Panels are never fed from a relay.
    const feeds = (await c.admin.get(`/api/panels/${c.lp}/feed-candidates`)).body as any[];
    expect(feeds.some((x) => x.panelId === rp)).toBe(false);
  });

  it('keep relays when their feeding breaker is removed, without the link', async () => {
    const c = await campus();
    const rp = await relayPanel(c);
    await save(c.admin, rp, [row('r1', 1, { sourceBreakerId: c.labBreaker })]);
    await save(c.admin, c.lp, [row('corridor', 1)]);
    const relay = (await c.admin.get(`/api/panels/${rp}`)).body.breakers[0];
    expect(relay).toMatchObject({ sourceBreakerId: null, source: null });
  });

  it('show a feeding breaker the person cannot open, and keep it on save', async () => {
    const c = await campus();
    const rp = await relayPanel(c);
    await save(c.admin, rp, [row('r1', 1, { sourceBreakerId: c.corridorBreaker })]);
    // Move LP-1 out of the editor's reach: put it in another site's room.
    const farmFloor = await createLocation(c.admin, c.other, 'floor', 'Ground');
    const farmRoom = await createLocation(c.admin, farmFloor, 'room', 'Barn');
    const lpPanel = await c.admin.post(`/api/locations/${farmRoom}/panels`, {
      name: 'FARM-LP',
      spaces: 24,
      mainAmps: 100,
    });
    const farmBreaker = (await save(c.admin, lpPanel.body.id, [row('barn', 1)])).body.idMap.barn;
    await save(c.admin, rp, [row('r1', 1, { sourceBreakerId: farmBreaker })]);
    const editor = await invite(app, c.admin, c.hall, 'editor', 'editor');
    const seen = (await editor.get(`/api/panels/${rp}`)).body.breakers[0];
    expect(seen.source).toMatchObject({ panelName: 'FARM-LP', canView: false });
    const kept = await save(editor, rp, null);
    expect(kept.status).toBe(200);
    expect(kept.body.panel.breakers[0].sourceBreakerId).toBe(farmBreaker);
    // But cannot newly pick one they cannot see.
    const id = seen.id;
    await save(c.admin, rp, [{ ...row('r1', 1), id }]);
    expect((await save(editor, rp, [{ ...row('r1', 1), id, sourceBreakerId: farmBreaker }])).status).toBe(400);
  });
});

describe('transfer switches', () => {
  it('put panels on a generator through a switch, and list on the generator', async () => {
    const c = await campus();
    const ats = await c.admin.post('/api/transfer-switches', {
      name: 'ATS-1',
      kind: 'automatic',
      amps: 400,
      generatorId: c.gen,
      locationId: c.elec,
    });
    expect(ats.status).toBe(200);
    expect((await c.admin.post('/api/transfer-switches', { name: 'X', locationId: c.ksu })).status).toBe(400);

    // On a switch, any generator sent for the panel is ignored: the switch's generator backs it.
    expect((await save(c.admin, c.em1, null, { atsId: ats.body.id, generatorId: c.gen })).status).toBe(200);
    const em1 = (await c.admin.get(`/api/panels/${c.em1}`)).body;
    expect(em1).toMatchObject({ atsId: ats.body.id, generatorId: null });
    expect(em1.generator).toMatchObject({
      id: c.gen,
      transferSwitch: 'ATS-1',
      ats: { id: ats.body.id, kind: 'automatic' },
    });
    expect((await c.admin.get(`/api/panels/${c.em2}`)).body.generator).toMatchObject({ via: { panelName: 'EM-1' } });

    const g = (await c.admin.get(`/api/generators/${c.gen}`)).body;
    expect(g.transferSwitches).toEqual([
      expect.objectContaining({
        name: 'ATS-1',
        amps: 400,
        generatorName: 'GEN-1',
        panels: [expect.objectContaining({ id: c.em1 })],
      }),
    ]);
    expect(g.panelCount).toBe(2);

    // Viewers cannot change switches; deleting one takes its panels off it.
    const viewer = await invite(app, c.admin, c.hall, 'viewer', 'viewer');
    expect(
      (await viewer.req('PATCH', `/api/transfer-switches/${ats.body.id}`, { name: 'Mine', locationId: c.elec })).status,
    ).toBe(403);
    expect((await c.admin.del(`/api/transfer-switches/${ats.body.id}`)).status).toBe(200);
    expect((await c.admin.get(`/api/panels/${c.em1}`)).body).toMatchObject({ atsId: null, generator: null });
  });
});

describe('power flow', () => {
  it('shows the utility, feeds, generators through switches and relay panels', async () => {
    const c = await campus();
    const ats = (
      await c.admin.post('/api/transfer-switches', { name: 'ATS-1', amps: 400, generatorId: c.gen, locationId: c.elec })
    ).body.id as number;
    expect((await save(c.admin, c.em1, null, { atsId: ats })).status).toBe(200);
    const rp = (
      await c.admin.post(`/api/locations/${c.elec}/panels`, {
        name: 'RP-1',
        layout: 'relay',
        spaces: 16,
        controlSystem: 'nLight',
      })
    ).body.id as number;
    await save(c.admin, rp, [
      row('r1', 1, { sourceBreakerId: c.corridorBreaker }),
      row('r2', 2, { sourceBreakerId: c.labBreaker }),
    ]);

    const t = (await c.admin.get(`/api/locations/${c.hall}/topology`)).body;
    expect(t.location).toMatchObject({ id: c.hall, name: 'Science Hall' });
    const node = (id: string) => t.nodes.find((n: any) => n.id === id);
    expect(node(`p${c.lp}`)).toMatchObject({ kind: 'panel', name: 'LP-1', onGenerator: false, inScope: true });
    expect(node(`p${c.em2}`)).toMatchObject({ kind: 'panel', onGenerator: true });
    expect(node(`p${rp}`)).toMatchObject({ kind: 'relay', detail: 'nLight relays · 2/16' });
    expect(node(`a${ats}`)).toMatchObject({ kind: 'ats', name: 'ATS-1', detail: 'Automatic (ATS) · 400 A' });
    expect(node(`g${c.gen}`)).toMatchObject({ kind: 'generator', name: 'GEN-1', href: `/generators/${c.gen}` });

    const edges = t.edges.map((e: any) => `${e.from}>${e.to}:${e.kind}`).sort();
    expect(edges).toEqual(
      [
        `u>p${c.lp}:feed`,
        `u>a${ats}:normal`,
        `g${c.gen}>a${ats}:emergency`,
        `a${ats}>p${c.em1}:load`,
        `p${c.em1}>p${c.em2}:feed`,
        `p${c.lp}>p${rp}:relay`,
      ].sort(),
    );
    expect(t.edges.find((e: any) => e.kind === 'relay').label).toBe('2 relays');
    expect(t.edges.find((e: any) => e.to === `p${c.em2}`).label).toBe('1 + 3 + 5 · 100 A');

    // Another site has nothing here; a location you cannot see is not found.
    expect((await c.admin.get(`/api/locations/${c.other}/topology`)).body).toMatchObject({ nodes: [], edges: [] });
    const viewer = await invite(app, c.admin, c.corridor, 'viewer', 'viewer');
    expect((await viewer.get(`/api/locations/${c.hall}/topology`)).status).toBe(404);
  });

  it('shows panels upstream of a room, hiding the ones you cannot see', async () => {
    const c = await campus();
    const room = await createLocation(c.admin, c.floor, 'room', 'Lab 110');
    const sub = (
      await c.admin.post(`/api/locations/${room}/panels`, { name: 'LAB-1', layout: 'commercial', spaces: 24 })
    ).body.id as number;
    const feeder = (await save(c.admin, c.em2, [row('lab', 1, { poles: 2, amps: 60, label: 'LAB-1' })])).body.idMap
      .lab as number;
    await save(c.admin, sub, [], { fedFromBreakerId: feeder });

    const viewer = await invite(app, c.admin, room, 'viewer', 'viewer');
    const t = (await viewer.get(`/api/locations/${room}/topology`)).body;
    expect(t.nodes.map((n: any) => `${n.id}:${n.kind}`).sort()).toEqual(
      [`p${sub}:panel`, `h${c.em2}:hidden`, `h${c.em1}:hidden`, 'u:utility'].sort(),
    );
    expect(t.nodes.find((n: any) => n.id === `h${c.em2}`)).toMatchObject({ href: null, inScope: false });
  });
});

describe('transformers and other equipment', () => {
  /** LP-1 (480 V) → breaker → disconnect DS-1 → transformer T-1 (480 → 208 V) → panel LDP-1. */
  async function stepDown(c: Awaited<ReturnType<typeof campus>>) {
    const lpSaved = await save(c.admin, c.lp, null);
    const lp = (await c.admin.get(`/api/panels/${c.lp}`)).body;
    const withFeeder = await save(c.admin, c.lp, [
      ...lp.breakers.map((b: any) => ({ ...b, clientKey: String(b.id), serves: [] })),
      row('t1', 5, { poles: 3, amps: 125, label: 'T-1' }),
    ]);
    expect(lpSaved.status).toBe(200);
    const feeder = withFeeder.body.idMap.t1 as number;
    const ds = await c.admin.post('/api/power-devices', {
      kind: 'disconnect',
      name: 'DS-1',
      locationId: c.elec,
      amps: 200,
      fused: true,
      fuseAmps: 125,
      fedFromBreakerId: feeder,
    });
    expect(ds.status).toBe(200);
    const t1 = await c.admin.post('/api/power-devices', {
      kind: 'transformer',
      name: 'T-1',
      locationId: c.elec,
      kva: 75,
      voltage: '480 V',
      secondaryVoltage: '120/208 V',
      fedFromDeviceId: ds.body.id,
    });
    expect(t1.status).toBe(200);
    const ldp = (
      await c.admin.post(`/api/locations/${c.elec}/panels`, {
        name: 'LDP-1',
        layout: 'commercial',
        spaces: 42,
        voltage: '120/208 V 3-phase',
      })
    ).body.id as number;
    expect((await save(c.admin, ldp, [], { fedFromDeviceId: t1.body.id })).status).toBe(200);
    return { feeder, ds: ds.body.id as number, t1: t1.body.id as number, ldp };
  }

  it('feed panels through transformers and disconnects, shown up the chain and on the map', async () => {
    const c = await campus();
    const s = await stepDown(c);

    const ldp = (await c.admin.get(`/api/panels/${s.ldp}`)).body;
    expect(ldp).toMatchObject({ fedFromDeviceId: s.t1, fedFromBreakerId: null });
    expect(ldp.feedChain).toEqual([
      expect.objectContaining({
        kind: 'device',
        name: 'T-1',
        rating: '75 kVA · 480 V → 120/208 V',
        voltage: '120/208 V',
      }),
      expect.objectContaining({ kind: 'device', name: 'DS-1', rating: '200 A fused, 125 A fuses' }),
      expect.objectContaining({ kind: 'panel', panelName: 'LP-1', amps: 125 }),
    ]);
    const lp = (await c.admin.get(`/api/panels/${c.lp}`)).body;
    expect(lp.breakers.find((b: any) => b.id === s.feeder).feedsDevices).toEqual([
      { deviceId: s.ds, name: 'DS-1', kind: 'disconnect' },
    ]);
    expect((await c.admin.get('/api/panels')).body.find((p: any) => p.id === s.ldp).fedFrom).toBe('T-1');

    const t1 = (await c.admin.get(`/api/power-devices/${s.t1}`)).body;
    expect(t1).toMatchObject({ fedFrom: 'DS-1', loads: [expect.objectContaining({ kind: 'panel', name: 'LDP-1' })] });
    expect(t1.feedChain.map((f: any) => f.kind)).toEqual(['device', 'panel']);

    const map = (await c.admin.get(`/api/locations/${c.hall}/topology`)).body;
    const edges = map.edges.map((e: any) => `${e.from}>${e.to}`);
    expect(edges).toEqual(expect.arrayContaining([`p${c.lp}>d${s.ds}`, `d${s.ds}>d${s.t1}`, `d${s.t1}>p${s.ldp}`]));
    expect(map.nodes.find((n: any) => n.id === `d${s.t1}`)).toMatchObject({
      kind: 'transformer',
      href: `/devices/${s.t1}`,
    });

    // A generator on LP-1 backs LDP-1 through the transformer.
    await save(c.admin, c.lp, null, { generatorId: c.gen });
    expect((await c.admin.get(`/api/panels/${s.ldp}`)).body.generator).toMatchObject({ via: { panelName: 'LP-1' } });

    // Search finds equipment by name.
    expect((await c.admin.get('/api/search?q=T-1')).body.devices).toEqual([
      expect.objectContaining({ id: s.t1, kind: 'transformer' }),
    ]);
  });

  it('refuse loops, feeds on a utility service, and changes without Editor access', async () => {
    const c = await campus();
    const s = await stepDown(c);
    const ldpFeeder = (await save(c.admin, s.ldp, [row('back', 1, { poles: 3, amps: 100 })])).body.idMap.back;
    const ds = (await c.admin.get(`/api/power-devices/${s.ds}`)).body;
    const patch = (body: Record<string, unknown>) =>
      c.admin.req('PATCH', `/api/power-devices/${s.ds}`, { ...ds, ...body });
    // DS-1 fed from a breaker in LDP-1 (which it feeds), or from T-1 (which it feeds): a loop.
    expect((await patch({ fedFromBreakerId: ldpFeeder, fedFromDeviceId: null })).status).toBe(400);
    expect((await patch({ fedFromBreakerId: null, fedFromDeviceId: s.t1 })).status).toBe(400);
    // LP-1 fed from T-1 would loop too.
    expect((await save(c.admin, c.lp, null, { fedFromDeviceId: s.t1 })).status).toBe(400);
    const options = (await c.admin.get(`/api/feed-options?panel=${c.lp}`)).body;
    expect(options.devices).toEqual([]);
    expect(options.breakers.some((b: any) => b.panelId === s.ldp)).toBe(false);

    const service = { kind: 'service', name: 'Service 1', locationId: c.hall, amps: 2000, meter: '4471' };
    expect((await c.admin.post('/api/power-devices', { ...service, fedFromBreakerId: s.feeder })).status).toBe(400);
    const svc = (await c.admin.post('/api/power-devices', service)).body.id;
    expect((await c.admin.get('/api/search?q=4471')).body.devices[0]).toMatchObject({
      id: svc,
      rating: '2000 A · meter 4471',
    });

    const viewer = await invite(app, c.admin, c.hall, 'viewer', 'viewer');
    expect((await viewer.get(`/api/power-devices/${s.t1}`)).body.canEdit).toBe(false);
    expect((await viewer.post('/api/power-devices', { kind: 'ups', name: 'UPS-1', locationId: c.elec })).status).toBe(
      403,
    );
    expect((await c.admin.del(`/api/locations/${c.elec}`)).status).toBe(409);

    // Deleting a device leaves what it fed with no feed set.
    expect((await c.admin.del(`/api/power-devices/${s.t1}`)).status).toBe(200);
    expect((await c.admin.get(`/api/panels/${s.ldp}`)).body).toMatchObject({ fedFromDeviceId: null, feedChain: [] });
  });

  it('keep panel nameplate details, which a save without them leaves alone', async () => {
    const c = await campus();
    const nameplate = {
      aicKa: 22,
      busAmps: 400,
      mounting: 'surface',
      enclosure: 'NEMA 1',
      feederWire: '4 #3/0 + #6 G',
      feederConduit: '2"',
    };
    expect((await save(c.admin, c.lp, null, nameplate)).status).toBe(200);
    expect((await c.admin.get(`/api/panels/${c.lp}`)).body.nameplate).toEqual(nameplate);
    expect((await save(c.admin, c.lp, null, { notes: 'x' })).status).toBe(200);
    expect((await c.admin.get(`/api/panels/${c.lp}`)).body.nameplate).toEqual(nameplate);
    const history = (await c.admin.get(`/api/panels/${c.lp}/history`)).body;
    expect(history.flatMap((h: any) => h.details)).toContain('Panel AIC rating (kA): none → 22');
  });

  it('record transfer switch duty and generator fuel', async () => {
    const c = await campus();
    const ats = await c.admin.post('/api/transfer-switches', {
      name: 'Life Safety ATS-1',
      duty: 'emergency',
      transition: 'open',
      priority: 1,
      generatorId: c.gen,
      locationId: c.elec,
    });
    expect(ats.status).toBe(200);
    expect((await c.admin.get('/api/transfer-switches')).body[0]).toMatchObject({
      duty: 'emergency',
      transition: 'open',
      priority: 1,
    });
    expect(
      (await c.admin.req('PATCH', `/api/generators/${c.gen}`, { name: 'GEN-1', tankGallons: 500, runtimeHours: 24 }))
        .status,
    ).toBe(200);
    expect((await c.admin.get(`/api/generators/${c.gen}`)).body).toMatchObject({ tankGallons: 500, runtimeHours: 24 });
    await save(c.admin, c.em1, null, { atsId: ats.body.id });
    const map = (await c.admin.get(`/api/locations/${c.hall}/topology`)).body;
    expect(map.nodes.find((n: any) => n.id === `a${ats.body.id}`).detail).toBe('Life safety');
  });
});
