import { describe, expect, it } from 'vitest';
import { panelLoad } from './load';
import { circuitLabel, positionsOf, spacesText, validateLayout, validateSections } from './panel';

const b = (key: string, position: number, extra: Record<string, unknown> = {}) => ({
  key,
  position,
  slot: 'full' as const,
  poles: 1,
  ...extra,
});

describe('switchboards and MCCs', () => {
  const msb = { layout: 'switchboard' as const, spaces: 120 };
  it('take one row per unit, whatever its poles, and up to 200 units', () => {
    expect(positionsOf(msb, { position: 7, poles: 3 })).toEqual([7]);
    expect(validateLayout(msb, [b('a', 1, { poles: 3 }), b('b', 2, { poles: 3 }), b('c', 120, { poles: 3 })])).toEqual(
      [],
    );
    expect(validateLayout(msb, [b('a', 1), b('b', 1)])[0]?.message).toMatch(/already used/);
    expect(validateLayout({ layout: 'mcc', spaces: 201 }, [])[0]?.message).toMatch(/between 1 and 200 units/);
  });
  it('label units as written', () => {
    expect(circuitLabel(msb, { position: 3, poles: 3, slot: 'full', unit: '2A' })).toBe('2A');
    expect(circuitLabel(msb, { position: 3, poles: 3, slot: 'full', unit: '' })).toBe('3');
    expect(spacesText({ layout: 'mcc', spaces: 12 })).toBe('12 units');
  });
  it('spread unit loads over all three phases', () => {
    const load = panelLoad({ ...msb, voltage: '277/480 V 3-phase' }, [
      { position: 1, poles: 3, amps: 400, isSpare: false, loadVa: 90000 },
    ]);
    expect(load.legs.map((l) => l.demandVa)).toEqual([30000, 30000, 30000]);
    expect(load.loadImbalance).toBe(0);
  });
});

describe('sections', () => {
  const panel = {
    layout: 'commercial' as const,
    spaces: 42,
    sections: [{ name: 'Section 2', spaces: 42, throughLugs: true }],
  };
  it('number each section from 1, checked on its own', () => {
    expect(validateSections(panel, [b('a', 1), b('b', 1, { section: 2 })])).toEqual([]);
    expect(validateSections(panel, [b('a', 1, { section: 2 }), b('b', 1, { section: 2 })])[0]?.message).toMatch(
      /^Section 2: Space 1 is already used/,
    );
    expect(validateSections(panel, [b('a', 1, { section: 3 })])[0]?.message).toMatch(
      /section this panel does not have/,
    );
    expect(circuitLabel(panel, { position: 1, poles: 3, slot: 'full', section: 2 })).toBe('S2 · 1 + 3 + 5');
    expect(spacesText(panel)).toBe('42 + 42 spaces');
  });
  it('count free spaces across sections', () => {
    expect(panelLoad(panel, [{ position: 1, poles: 1, amps: 20, isSpare: false, section: 2 }]).freeSpaces).toBe(83);
  });
});
