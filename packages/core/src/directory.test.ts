import { describe, expect, it } from 'vitest';
import { ampsLabel, breakerTags, panelDirectory, type DirectoryBreaker } from './directory';
import type { PanelShape } from './panel';

const panel: PanelShape = { layout: 'residential', spaces: 12 };
const b = (key: string, position: number, opts: Partial<DirectoryBreaker> = {}): DirectoryBreaker => ({
  key,
  position,
  slot: 'full',
  poles: 1,
  amps: 20,
  protection: 'standard',
  critical: false,
  backup: 'none',
  isSpare: false,
  label: key,
  ...opts,
});

describe('panelDirectory', () => {
  it('fills every row of both columns, odd left and even right', () => {
    const d = panelDirectory(panel, [b('Kitchen', 1), b('Bath', 4)]);
    expect(d.rows).toBe(6);
    expect(d.columns).toHaveLength(2);
    for (const col of d.columns) expect(col.reduce((n, e) => n + e.span, 0)).toBe(6);
    expect(d.columns[0]![0]).toMatchObject({ type: 'breaker', numbers: [1], circuit: '1' });
    expect(d.columns[1]![0]).toMatchObject({ type: 'empty', numbers: [2] });
    expect(d.columns[1]![1]).toMatchObject({ type: 'breaker', numbers: [4] });
  });

  it('merges a multi-pole breaker into one entry spanning its rows', () => {
    const d = panelDirectory(panel, [b('Range', 6, { poles: 2, amps: 50 })]);
    const right = d.columns[1]!;
    expect(right.map((e) => e.type)).toEqual(['empty', 'empty', 'breaker', 'empty', 'empty']);
    expect(right[2]).toMatchObject({ row: 3, span: 2, numbers: [6, 8], circuit: '6 + 8' });
  });

  it('puts both halves of a tandem in one space, and keeps a lone half', () => {
    const d = panelDirectory(panel, [
      b('Hall', 9, { slot: 'A' }),
      b('Alarm', 9, { slot: 'B' }),
      b('Porch', 11, { slot: 'B' }),
    ]);
    const left = d.columns[0]!;
    expect(left[4]).toMatchObject({ type: 'tandem', numbers: [9] });
    expect(left[4]!.type === 'tandem' && [left[4]!.a?.key, left[4]!.b?.key]).toEqual(['Hall', 'Alarm']);
    expect(left[5]!.type === 'tandem' && [left[5]!.a, left[5]!.b?.key]).toEqual([null, 'Porch']);
  });

  it('skips breakers that overlap or fall outside the panel', () => {
    const d = panelDirectory(panel, [b('First', 1, { poles: 2 }), b('Clash', 3), b('Outside', 13)]);
    const labels = d.columns.flat().flatMap((e) => (e.type === 'breaker' ? [e.breaker.key] : []));
    expect(labels).toEqual(['First']);
  });

  it('lays out a single-column panel top to bottom', () => {
    const d = panelDirectory({ layout: 'single', spaces: 4 }, [b('Feeder', 2, { poles: 2 })]);
    expect(d.columns).toHaveLength(1);
    expect(d.columns[0]!.map((e) => e.numbers)).toEqual([[1], [2, 3], [4]]);
  });
});

describe('tags and amps', () => {
  it('lists markers in a fixed order', () => {
    expect(breakerTags({ protection: 'dual', critical: true, backup: 'ups', isSpare: false })).toEqual([
      'CRIT',
      'UPS',
      'DF',
    ]);
    expect(breakerTags({ protection: 'standard', critical: false, backup: 'generator', isSpare: true })).toEqual([
      'SPARE',
      'GEN',
    ]);
  });

  it('shows poles only for multi-pole breakers', () => {
    expect(ampsLabel({ amps: 20, poles: 1 })).toBe('20A');
    expect(ampsLabel({ amps: 50, poles: 2 })).toBe('2P 50A');
  });
});
