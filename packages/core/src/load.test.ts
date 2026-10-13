import { describe, expect, it } from 'vitest';
import { legOf, panelLoad, type LoadBreaker } from './load';

const b = (position: number, amps: number, poles = 1, isSpare = false): LoadBreaker => ({
  position,
  poles,
  amps,
  isSpare,
});

describe('panel load', () => {
  it('alternates split-phase legs by row', () => {
    const panel = { layout: 'residential' as const, spaces: 8 };
    expect([1, 2, 3, 4, 5, 6].map((p) => legOf(panel, p))).toEqual(['L1', 'L1', 'L2', 'L2', 'L1', 'L1']);
  });

  it('adds ratings per leg, counting a 2-pole breaker on both legs', () => {
    const panel = { layout: 'residential' as const, spaces: 12 };
    const load = panelLoad(panel, [b(1, 50, 2), b(2, 20), b(4, 15), b(6, 20, 1, true)]);
    expect(load.legs).toEqual([
      { leg: 'L1', amps: 70, circuits: 2, va: 0, demandVa: 0, loadAmps: 0 },
      { leg: 'L2', amps: 65, circuits: 2, va: 0, demandVa: 0, loadAmps: 0 },
    ]);
    expect(load).toMatchObject({ circuits: 3, spares: 1, freeSpaces: 7, warning: null });
  });

  it('uses phases A, B and C on 3-phase panels and warns about an uneven spread', () => {
    const panel = { layout: 'commercial' as const, spaces: 12 };
    // Rows go A, B, C; positions 1-2 are row 1 (A), 3-4 row 2 (B), 5-6 row 3 (C).
    const load = panelLoad(panel, [b(1, 50), b(2, 50), b(3, 20), b(5, 20)]);
    expect(load.legs.map((l) => [l.leg, l.amps])).toEqual([
      ['A', 100],
      ['B', 20],
      ['C', 20],
    ]);
    expect(load.imbalance).toBeCloseTo(0.8);
    expect(load.warning).toBe(
      'Phase A has 100 A of breakers on it and phase B only 20 A. Moving a circuit or two could even them out.',
    );
  });

  it('stays quiet about small panels', () => {
    const load = panelLoad({ layout: 'residential', spaces: 4 }, [b(1, 20)]);
    expect(load.imbalance).toBe(1);
    expect(load.warning).toBeNull();
  });

  it('lists surge protectors and counts only the ones with breakers as circuits', () => {
    const panel = { layout: 'residential' as const, spaces: 12 };
    const load = panelLoad(panel, [
      { position: 5, poles: 2, amps: 0, isSpare: false, device: 'surge' },
      { position: 1, poles: 2, amps: 20, isSpare: false, device: 'surge' },
      b(2, 15),
    ]);
    expect(load.surge).toEqual([
      [1, 3],
      [5, 7],
    ]);
    expect(load.circuits).toBe(2);
    expect(load.legs.map((l) => l.amps)).toEqual([35, 20]);
    expect(load.freeSpaces).toBe(7);
  });
});
