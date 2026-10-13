import { describe, expect, it } from 'vitest';
import {
  guessMapping,
  looksLikeHeader,
  matchPlace,
  mergeBreakers,
  parseAmps,
  parseCircuit,
  parseDelimited,
  readRows,
  spacesToFit,
  splitServe,
  type ImportedBreaker,
  type MergeBreaker,
} from './importer';

const opts = { panelName: '', defaultAmps: 20 };

describe('parseDelimited', () => {
  it('reads CSV with quotes, commas, line breaks and a byte-order mark', () => {
    expect(parseDelimited('﻿Panel,Label\r\nLP-1,"Lights, east"\r\n"LP-2","Say ""hi""\nthere"\n\n')).toEqual([
      ['Panel', 'Label'],
      ['LP-1', 'Lights, east'],
      ['LP-2', 'Say "hi"\nthere'],
    ]);
  });
  it('reads cells pasted from a spreadsheet, and semicolon CSV', () => {
    expect(parseDelimited('Ckt\tDescription\n1\tLights, hall\n')).toEqual([
      ['Ckt', 'Description'],
      ['1', 'Lights, hall'],
    ]);
    expect(parseDelimited('Ckt;Description\n1;Lights\n')).toEqual([
      ['Ckt', 'Description'],
      ['1', 'Lights'],
    ]);
  });
  it("drops the quote this app's export puts before formula-like text", () => {
    expect(parseDelimited("Label\n'-48 V DC\n")).toEqual([['Label'], ['-48 V DC']]);
  });
});

describe('guessMapping', () => {
  it("maps this app's export and common schedule headers", () => {
    expect(
      guessMapping([
        'Location',
        'Panel',
        'Circuit',
        'Phase',
        'Poles',
        'Type',
        'Amps',
        'Load (VA)',
        'Demand %',
        'Label',
        'Serves',
      ]),
    ).toEqual(['location', 'panel', 'circuit', null, 'poles', null, 'amps', 'loadVa', 'demandPct', 'label', 'serves']);
    expect(guessMapping(['CKT #', 'Load Description', 'Trip', 'P', 'kVA', 'Room'])).toEqual([
      'circuit',
      'label',
      'amps',
      'poles',
      'loadKva',
      'serves',
    ]);
  });
  it('tells headers from data', () => {
    expect(looksLikeHeader(['Ckt', 'Description', 'Amps'])).toBe(true);
    expect(looksLikeHeader(['1', 'Lights', '20'])).toBe(false);
  });
});

describe('parseCircuit and parseAmps', () => {
  it('reads the ways schedules write circuits', () => {
    expect(parseCircuit('5')).toMatchObject({ positions: [5], section: null, slot: 'full' });
    for (const t of ['1,3,5', '1-3-5', '1/3/5', '1 + 3 + 5']) expect(parseCircuit(t)?.positions).toEqual([1, 3, 5]);
    expect(parseCircuit('S2 · 1 + 3')).toMatchObject({ section: 2, positions: [1, 3] });
    expect(parseCircuit('Sec 2-7')).toMatchObject({ section: 2, positions: [7] });
    expect(parseCircuit('21A')).toMatchObject({ positions: [21], slot: 'A' });
    expect(parseCircuit('M1')).toMatchObject({ positions: [], unit: 'M1' });
    expect(parseCircuit('')).toBeNull();
    expect(parseCircuit('lights?')).toBeNull();
  });
  it('reads ratings', () => {
    expect(parseAmps('20')).toEqual({ amps: 20, poles: null });
    expect(parseAmps('20A')).toEqual({ amps: 20, poles: null });
    expect(parseAmps('100/3')).toEqual({ amps: 100, poles: 3 });
    expect(parseAmps('3P 100A')).toEqual({ amps: 100, poles: 3 });
    expect(parseAmps('1P-20A')).toEqual({ amps: 20, poles: 1 });
    expect(parseAmps('')).toEqual({ amps: null, poles: null });
  });
});

describe('readRows', () => {
  const mapping = guessMapping(['Panel', 'Ckt', 'Description', 'Trip', 'Poles', 'kVA', 'Room', 'Notes']);
  it('groups rows by panel and reads each breaker', () => {
    const [lp, hb] = readRows(
      [
        ['LP-1', '1', 'Lights 110', '20', '1', '1.2', 'Lab 110', ''],
        ['LP-1', '2,4,6', 'RTU-1', '60/3', '', '', '', 'roof'],
        ['LP-1', '3', 'SPACE', '', '', '', '', ''],
        ['LP-1', '5', 'SPARE', '20', '', '', '', ''],
        ['HB', '1', 'Exit signs', '', '', '', '', ''],
        ['HB', '', 'Orphan', '', '', '', '', ''],
      ],
      mapping,
      opts,
    );
    expect(lp!.name).toBe('LP-1');
    expect(lp!.breakers.map((b) => [b.position, b.poles, b.values.label, b.values.amps])).toEqual([
      [1, 1, 'Lights 110', 20],
      [2, 3, 'RTU-1', 60],
      [5, 1, 'SPARE', 20],
    ]);
    expect(lp!.breakers[0]!.values.loadVa).toBe(1200);
    expect(lp!.breakers[0]!.serves).toEqual(['Lab 110']);
    expect(lp!.breakers[2]!.values.isSpare).toBe(true);
    expect(lp!.breakers[1]!.given.has('notes')).toBe(true);
    expect(lp!.breakers[0]!.given.has('notes')).toBe(false);
    expect(hb!.issues).toEqual([
      { line: 7, level: 'error', message: '"Orphan" has no circuit number; row skipped.' },
      { line: 0, level: 'warning', message: '1 breaker has no rating; new ones get 20 A and stay "Not checked".' },
    ]);
  });
  it('uses one panel name when there is no panel column', () => {
    const [p] = readRows([['1', 'Lights', '20']], guessMapping(['Ckt', 'Label', 'Amps']), {
      ...opts,
      panelName: 'LP-9',
    });
    expect(p!.name).toBe('LP-9');
  });
  it('notes a poles column that disagrees with the circuit numbers', () => {
    const [p] = readRows([['1,3', 'Heater', '30', '3']], guessMapping(['Ckt', 'Label', 'Amps', 'Poles']), {
      ...opts,
      panelName: 'X',
    });
    expect(p!.breakers[0]!.poles).toBe(3);
    expect(p!.issues[0]).toMatchObject({ level: 'warning', message: expect.stringContaining('lists 2 spaces') });
  });
});

describe('mergeBreakers', () => {
  const base = (over: Partial<MergeBreaker>): MergeBreaker => ({
    key: 'k',
    section: 1,
    position: 1,
    poles: 1,
    slot: 'full',
    unit: '',
    label: '',
    amps: 20,
    notes: '',
    isSpare: false,
    critical: false,
    protection: 'standard',
    backup: 'none',
    loadVa: null,
    demandPct: null,
    tags: [],
    frameAmps: null,
    wire: '',
    conduit: '',
    starter: '',
    hp: null,
    control: '',
    serves: [],
    ...over,
  });
  const rows = readRows(
    [
      ['1', 'Lights', '20'],
      ['3', 'Heater', ''],
      ['5', 'New one', '15'],
    ],
    guessMapping(['Ckt', 'Label', 'Amps']),
    { ...opts, panelName: 'P' },
  )[0]!.breakers;
  const existing = [
    base({ key: 'a', id: 1, position: 1, label: 'Lights' }),
    base({ key: 'b', id: 2, position: 3, label: 'Old heater', amps: 30, notes: 'keep me' }),
    base({ key: 'c', id: 3, position: 7, label: 'Untouched' }),
  ];
  let n = 0;
  const make = (r: ImportedBreaker) =>
    base({ key: `new-${n++}`, position: r.position, poles: r.poles, ...r.values, amps: r.values.amps ?? 20 });

  it('changes only what a row gives, and adds the rest', () => {
    const { breakers, changes } = mergeBreakers({ layout: 'residential' }, existing, rows, () => null, make, false);
    expect(changes.map((c) => [c.kind, c.circuit])).toEqual([
      ['same', '1'],
      ['changed', '3'],
      ['new', '5'],
    ]);
    expect(changes[1]).toMatchObject({ fields: ['label'] });
    const heater = breakers.find((b) => b.key === 'b')!;
    expect(heater).toMatchObject({ label: 'Heater', amps: 30, notes: 'keep me', id: 2 });
    expect(breakers.map((b) => b.key)).toEqual(['a', 'b', 'c', 'new-0']);
  });
  it('removes breakers the file leaves out, when replacing', () => {
    const { breakers, changes } = mergeBreakers({ layout: 'residential' }, existing, rows, () => null, make, true);
    expect(changes.at(-1)).toMatchObject({ kind: 'removed', circuit: '7', label: 'Untouched' });
    expect(breakers.some((b) => b.key === 'c')).toBe(false);
  });
  it('matches switchboard units by number, numbering new ones after the last', () => {
    const units = readRows(
      [
        ['2A', 'MCC-1', '400'],
        ['M1', 'Fire pump', '200'],
      ],
      guessMapping(['Unit', 'Label', 'Amps']),
      {
        ...opts,
        panelName: 'MSB',
      },
    )[0]!.breakers;
    const { changes, breakers } = mergeBreakers(
      { layout: 'switchboard' },
      [base({ key: 'u', id: 9, position: 2, unit: '2A', label: 'Old' })],
      units,
      () => null,
      (r) => base({ key: `n${r.line}`, position: r.position, unit: r.unit, ...r.values }),
      false,
    );
    expect(changes.map((c) => [c.kind, c.circuit])).toEqual([
      ['changed', '2A'],
      ['new', 'M1'],
    ]);
    expect(breakers.find((b) => b.unit === 'M1')!.position).toBe(3);
  });
});

describe('places and sizes', () => {
  const places = [
    { id: 1, name: 'Lab 110', path: 'KSU › Main › Science Hall › Floor 1 › Lab 110' },
    { id: 2, name: 'Room 3002', path: 'KSU › Main › Q Building › Floor 3 › Room 3002' },
    { id: 3, name: 'Office', path: 'KSU › Main › Science Hall › Floor 1 › Office' },
    { id: 4, name: 'Office', path: 'KSU › Main › Science Hall › Floor 2 › Office' },
  ];
  it('finds a place by path, name or room number', () => {
    expect(matchPlace('KSU › Main › Science Hall › Floor 1 › Lab 110', places)?.id).toBe(1);
    expect(matchPlace('Floor 1 > Lab 110', places)?.id).toBe(1);
    expect(matchPlace('lab 110', places)?.id).toBe(1);
    expect(matchPlace('RECEPT ROOM 3002', places)?.id).toBe(2);
    expect(matchPlace('Office', places)).toBeNull();
    expect(matchPlace('Floor 2 › Office', places)?.id).toBe(4);
  });
  it('splits a note off a served place', () => {
    expect(splitServe('Lab 110 (benches)')).toEqual({ place: 'Lab 110', note: 'benches' });
    expect(splitServe('Lab 110')).toEqual({ place: 'Lab 110', note: '' });
  });
  it('sizes a new panel to fit', () => {
    expect(spacesToFit('commercial', 31)).toBe(42);
    expect(spacesToFit('residential', 13)).toBe(16);
    expect(spacesToFit('switchboard', 7)).toBe(7);
  });
});
