import { describe, expect, it } from 'vitest';
import {
  cellOf,
  checkChange,
  circuitLabel,
  freeAt,
  positionsOf,
  rowsFor,
  validateLayout,
  type BreakerShape,
  type PanelShape,
} from './panel';

const res: PanelShape = { layout: 'residential', spaces: 24 };
const b = (
  key: string,
  position: number,
  poles = 1,
  slot: BreakerShape['slot'] = 'full',
  label = key,
): BreakerShape => ({
  key,
  position,
  poles,
  slot,
  label,
});

describe('geometry', () => {
  it('numbers odd left and even right, two per row', () => {
    expect(cellOf(res, 1)).toEqual({ column: 0, row: 1 });
    expect(cellOf(res, 2)).toEqual({ column: 1, row: 1 });
    expect(cellOf(res, 23)).toEqual({ column: 0, row: 12 });
    expect(rowsFor(res)).toBe(12);
  });

  it('multi-pole breakers run down one column', () => {
    expect(positionsOf(res, { position: 6, poles: 2 })).toEqual([6, 8]);
    expect(circuitLabel(res, { position: 6, poles: 2, slot: 'full' })).toBe('6 + 8');
    expect(circuitLabel(res, { position: 21, poles: 1, slot: 'B' })).toBe('21B');
  });

  it('single-column panels number straight down', () => {
    const single: PanelShape = { layout: 'single', spaces: 8 };
    expect(positionsOf(single, { position: 3, poles: 2 })).toEqual([3, 4]);
    expect(cellOf(single, 4)).toEqual({ column: 0, row: 4 });
  });
});

describe('validateLayout', () => {
  it('accepts the mockup panel', () => {
    const breakers = [
      b('range', 1, 2),
      b('dryer', 2, 2),
      b('heat', 6, 2),
      b('5', 5),
      b('21a', 21, 1, 'A'),
      b('21b', 21, 1, 'B'),
      b('24', 24),
    ];
    expect(validateLayout(res, breakers)).toEqual([]);
  });

  it('rejects overlaps, naming the breaker in the way', () => {
    const issues = validateLayout(res, [b('Dryer', 2, 2), b('Washer', 4)]);
    expect(issues).toEqual([{ key: 'Washer', message: 'Space 4 is already used by "Dryer".' }]);
  });

  it('rejects 3-pole breakers on split-phase panels', () => {
    expect(validateLayout(res, [b('Pump', 1, 3)])[0]?.message).toMatch(/split-phase/);
    expect(validateLayout({ layout: 'commercial', spaces: 42 }, [b('Pump', 1, 3)])).toEqual([]);
  });

  it('rejects breakers that run off the bottom', () => {
    expect(validateLayout(res, [b('Big', 23, 2)])[0]?.message).toMatch(/24 spaces/);
  });

  it('tandems share a space but not a half, and never with a full breaker', () => {
    expect(validateLayout(res, [b('a', 5, 1, 'A'), b('b', 5, 1, 'A')])).toHaveLength(1);
    expect(validateLayout(res, [b('a', 5, 1, 'A'), b('full', 5)])).toHaveLength(1);
    expect(validateLayout(res, [b('a', 5, 2, 'A')])[0]?.message).toMatch(/single-pole/);
  });

  it('rejects odd space counts on two-column panels', () => {
    expect(validateLayout({ layout: 'residential', spaces: 23 }, [])[0]?.message).toMatch(/even/);
  });
});

describe('editing helpers', () => {
  const breakers = [b('dryer', 2, 2), b('a', 21, 1, 'A')];

  it('reports what is free at a space', () => {
    expect(freeAt(res, breakers, 4)).toEqual({ full: false, A: false, B: false });
    expect(freeAt(res, breakers, 21)).toEqual({ full: false, A: false, B: true });
    expect(freeAt(res, breakers, 3)).toEqual({ full: true, A: true, B: true });
    expect(freeAt(res, breakers, 4, 'dryer').full).toBe(true);
  });

  it('checks a move without counting the breaker against itself', () => {
    expect(checkChange(res, breakers, b('dryer', 4, 2))).toBeNull();
    expect(checkChange(res, breakers, b('dryer', 19, 2))).toMatch(/21/);
  });
});
