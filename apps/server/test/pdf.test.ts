import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../src/db';
import { AccessData, getUser, toActor } from '../src/repo';
import { printedLine } from '../src/pdf/document';
import { roomIndex } from '../src/roomIndex';
import { Client, createLocation, invite, setupAdmin, testApp } from './helpers';

let app: FastifyInstance;
let db: DB;

beforeEach(async () => {
  ({ app, db } = await testApp());
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

async function save(c: Client, id: number, breakers: unknown[], extra: Record<string, unknown> = {}) {
  const current = (await c.get(`/api/panels/${id}`)).body;
  const r = await c.req('PUT', `/api/panels/${id}`, { ...current, breakers, ...extra });
  expect(r.status).toBe(200);
}

const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;

async function home() {
  const admin = await setupAdmin(app);
  const personal = await createLocation(admin, null, 'company', 'Personal');
  const site = await createLocation(admin, personal, 'site', 'Home');
  const basement = await createLocation(admin, site, 'floor', 'Basement');
  const utility = await createLocation(admin, basement, 'room', 'Utility room');
  const ground = await createLocation(admin, site, 'floor', 'Ground');
  const kitchen = await createLocation(admin, ground, 'room', 'Kitchen');
  const garage = await createLocation(admin, ground, 'room', 'Garage');
  const main = (await admin.post(`/api/locations/${utility}/panels`, { name: 'Main panel', spaces: 24 })).body.id;
  const sub = (await admin.post(`/api/locations/${garage}/panels`, { name: 'Garage sub', spaces: 12 })).body.id;
  await save(admin, main, [
    breaker('Range', 1, { poles: 2, amps: 50, serves: [{ locationId: kitchen, note: '' }] }),
    breaker('Fridge', 2, { critical: true, serves: [{ locationId: kitchen, note: 'fridge' }] }),
    breaker('Smoke alarms', 4, { serves: [{ locationId: site, note: '' }] }),
    breaker('Garage feeder', 6, { poles: 2, amps: 60 }),
    breaker('Hall', 9, { slot: 'A', amps: 15 }),
    breaker('Alarm', 9, { slot: 'B', amps: 15, backup: 'ups', notes: 'Panel in the closet.' }),
  ]);
  const feeder = (await admin.get(`/api/panels/${main}`)).body.breakers.find(
    (b: { label: string }) => b.label === 'Garage feeder',
  ).id;
  await save(admin, sub, [breaker('Door opener', 1, { serves: [{ locationId: garage, note: '' }] })], {
    fedFromBreakerId: feeder,
  });
  return { admin, personal, site, basement, utility, ground, kitchen, garage, main, sub };
}

describe('panel PDFs', () => {
  it('prints a panel sheet inline as a PDF, without the page security policy', async () => {
    const h = await home();
    const r = await h.admin.raw(`/api/panels/${h.main}/pdf`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toContain('inline; filename="Main panel.pdf"');
    expect(r.headers['content-security-policy']).toBeUndefined();
    expect(r.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pages(r.body)).toBe(1);
    expect(r.body.toString('latin1')).toContain('/MediaBox [0 0 612 792]');
  });

  it('says who printed it, on the page and in the file properties', async () => {
    const h = await home();
    await h.admin.patch('/api/me', { displayName: 'Ryan Bibby' });
    const r = await h.admin.raw(`/api/panels/${h.main}/pdf`);
    const raw = r.body.toString('latin1');
    const ref = raw.match(/\/Author (\d+) 0 R/)![1];
    expect(raw).toContain(`\n${ref} 0 obj\n(Ryan Bibby)\nendobj`);
    const now = new Date(Date.UTC(2026, 9, 11, 15));
    expect(printedLine({ now, timeZone: 'UTC', printedBy: 'Ryan Bibby' })).toBe('Printed Oct 11, 2026 by Ryan Bibby');
    expect(printedLine({ now, timeZone: 'UTC', printedBy: null }, false)).toBe('printed Oct 11, 2026');
  });

  it('prints a door card on A4 as a download', async () => {
    const h = await home();
    const r = await h.admin.raw(`/api/panels/${h.main}/pdf?style=door&paper=a4&download=1`);
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toContain('attachment; filename="Main panel door card.pdf"');
    expect(r.body.toString('latin1')).toContain('/MediaBox [0 0 595.28 841.89]');
  });

  it('uses the paper size from Settings by default', async () => {
    const h = await home();
    await h.admin.patch('/api/admin/settings', { paperSize: 'a4' });
    const r = await h.admin.raw(`/api/panels/${h.main}/pdf`);
    expect(r.body.toString('latin1')).toContain('/MediaBox [0 0 595.28 841.89]');
    expect((await new Client(app).get('/api/auth/config')).body.paperSize).toBe('a4');
  });

  it('continues long notes on another page', async () => {
    const h = await home();
    const long = Array.from({ length: 30 }, (_, i) => `Line ${i} of a long note.`).join('\n');
    await save(
      h.admin,
      h.sub,
      Array.from({ length: 12 }, (_, i) => breaker(`Circuit ${i + 1}`, i + 1, { notes: long })),
    );
    const r = await h.admin.raw(`/api/panels/${h.sub}/pdf`);
    expect(pages(r.body)).toBeGreaterThan(1);
  });

  it('hides panels from people who cannot see them, and needs a sign-in', async () => {
    const h = await home();
    const viewer = await invite(app, h.admin, h.ground, 'viewer', 'viewer');
    expect((await viewer.raw(`/api/panels/${h.main}/pdf`)).status).toBe(404);
    expect((await viewer.raw(`/api/panels/${h.sub}/pdf`)).status).toBe(200);
    expect((await new Client(app).raw(`/api/panels/${h.main}/pdf`)).status).toBe(401);
  });

  it('refuses unknown styles and paper sizes', async () => {
    const h = await home();
    expect((await h.admin.raw(`/api/panels/${h.main}/pdf?style=poster`)).status).toBe(400);
    expect((await h.admin.raw(`/api/panels/${h.main}/pdf?paper=legal`)).status).toBe(400);
  });
});

describe('location PDFs', () => {
  it('prints a book: cover, every panel inside, then the room index', async () => {
    const h = await home();
    const r = await h.admin.raw(`/api/locations/${h.site}/pdf`);
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toContain('filename="Home panel directory.pdf"');
    expect(pages(r.body)).toBe(4);
  });

  it('only includes the panels the reader can see', async () => {
    const h = await home();
    const viewer = await invite(app, h.admin, h.ground, 'viewer', 'viewer');
    expect((await viewer.raw(`/api/locations/${h.site}/pdf`)).status).toBe(404);
    const r = await viewer.raw(`/api/locations/${h.ground}/pdf`);
    expect(r.status).toBe(200);
    expect(pages(r.body)).toBe(3); // Cover, Garage sub, room index.
  });

  it('prints just the room index', async () => {
    const h = await home();
    const r = await h.admin.raw(`/api/locations/${h.site}/pdf?style=index`);
    expect(r.status).toBe(200);
    expect(pages(r.body)).toBe(1);
  });
});

describe('room index', () => {
  it('groups rooms by floor and lists whole-site breakers once', async () => {
    const h = await home();
    const access = new AccessData(db);
    const index = roomIndex(db, toActor(getUser(db, 1)!), access, h.site);
    expect(index.sections.map((s) => s.title)).toEqual(['Home', 'Basement', 'Ground']);
    expect(index.sections[0]!.whole.map((b) => b.label)).toEqual(['Smoke alarms']);
    const ground = index.sections.find((s) => s.title === 'Ground')!;
    const kitchen = ground.rooms.find((r) => r.name === 'Kitchen')!;
    expect(kitchen.breakers.map((b) => [b.circuit, b.label, b.amps, b.note, b.tags])).toEqual([
      ['1 + 3', 'Range', '2P 50A', '', []],
      ['2', 'Fridge', '20A', 'fridge', ['CRIT']],
    ]);
    expect(ground.rooms.find((r) => r.name === 'Garage')!.breakers[0]).toMatchObject({ panelName: 'Garage sub' });
    expect(index.sections.find((s) => s.title === 'Basement')!.rooms[0]).toMatchObject({ breakers: [] });
  });

  it('shows whole-site breakers above a floor, and leaves out rooms the reader cannot see', async () => {
    const h = await home();
    await invite(app, h.admin, h.kitchen, 'viewer', 'cook');
    const cook = db.prepare("SELECT * FROM users WHERE username = 'cook'").get() as Parameters<typeof toActor>[0];
    const access = new AccessData(db);
    const index = roomIndex(db, toActor(cook), access, h.kitchen);
    expect(index.above).toEqual([
      { title: 'Whole site: Home', breakers: [expect.objectContaining({ label: 'Smoke alarms' })] },
    ]);
    expect(index.sections.map((s) => s.rooms.map((r) => r.name))).toEqual([['Kitchen']]);

    const fromGround = roomIndex(db, toActor(getUser(db, 1)!), access, h.ground);
    expect(fromGround.sections.map((s) => s.title)).toEqual(['Ground']);
    expect(fromGround.sections[0]!.rooms.map((r) => r.name)).toEqual(['Garage', 'Kitchen']);
  });
});

describe('CSV export', () => {
  const lines = (body: Buffer) =>
    body
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .trimEnd()
      .split('\r\n');

  it('exports a panel with one row per breaker', async () => {
    const h = await home();
    const r = await h.admin.raw(`/api/panels/${h.main}/csv`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(r.headers['content-disposition']).toContain('attachment; filename="Main panel breakers.csv"');
    expect(r.body.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const rows = lines(r.body);
    expect(rows[0]).toBe(
      'Location,Panel,Circuit,Phase,Poles,Amps,Label,Protection,Critical,Backup power,Spare,Serves,Feeds,Tags,Notes',
    );
    expect(rows).toHaveLength(7);
    expect(rows[1]).toBe(
      'Personal › Home › Basement › Utility room,Main panel,1 + 3,,2,50,Range,Standard,No,,No,Personal › Home › Ground › Kitchen,,,',
    );
    expect(rows.find((l) => l.includes('Garage feeder'))).toContain(',Garage sub,');
    expect(rows.find((l) => l.includes('Alarm'))).toContain(
      '9B,,1,15,Alarm,Standard,No,UPS,No,,,,Panel in the closet.',
    );
  });

  it('exports everything the reader can see under a location', async () => {
    const h = await home();
    expect(lines((await h.admin.raw(`/api/locations/${h.site}/csv`)).body)).toHaveLength(8);
    const viewer = await invite(app, h.admin, h.ground, 'viewer', 'viewer');
    const rows = lines((await viewer.raw(`/api/locations/${h.ground}/csv`)).body);
    expect(rows.slice(1).map((l) => l.split(',')[1])).toEqual(['Garage sub']);
    expect((await viewer.raw(`/api/panels/${h.main}/csv`)).status).toBe(404);
  });

  it('keeps spreadsheet formulas from running', async () => {
    const h = await home();
    await save(h.admin, h.sub, [breaker('=HYPERLINK("http://x","y")', 1, { notes: 'a, "quoted" note' })]);
    const row = lines((await h.admin.raw(`/api/panels/${h.sub}/csv`)).body)[1]!;
    expect(row).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(row).toContain('"a, ""quoted"" note"');
  });
});
