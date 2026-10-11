// The printable panel directory: the panel laid out row by row, the way it looks in the box.
// The PDF draws from this; it has no idea about pages or fonts.

import {
  circuitLabel,
  columnsFor,
  positionsOf,
  rowsFor,
  type Backup,
  type BreakerShape,
  type Device,
  type PanelShape,
  type Protection,
} from './panel';

export interface DirectoryBreaker extends BreakerShape {
  amps: number;
  /** Absent means a breaker. */
  device?: Device;
  protection: Protection;
  critical: boolean;
  backup: Backup;
  isSpare: boolean;
}

/** One block in a column of the directory. Blocks in a column cover every row exactly once. */
export type DirectoryEntry<B> =
  /** A breaker filling its spaces; multi-pole breakers span several rows. */
  | { type: 'breaker'; row: number; span: number; numbers: number[]; circuit: string; breaker: B }
  /** A tandem space: two single-pole breakers sharing one space. Either half may be empty. */
  | { type: 'tandem'; row: number; span: 1; numbers: [number]; a: B | null; b: B | null }
  | { type: 'empty'; row: number; span: 1; numbers: [number] };

export interface Directory<B> {
  rows: number;
  /** Left column first. Residential panels have two: odd numbers left, even right. */
  columns: DirectoryEntry<B>[][];
}

/** Lay out a panel's breakers for printing. Overlapping breakers (invalid data) keep the first one. */
export function panelDirectory<B extends BreakerShape>(panel: PanelShape, breakers: readonly B[]): Directory<B> {
  const rows = rowsFor(panel);
  const cols = columnsFor(panel);
  const byStart = new Map<number, B>();
  const tandems = new Map<number, { a: B | null; b: B | null }>();
  const covered = new Set<number>();

  const sorted = [...breakers].sort((x, y) => x.position - y.position || x.slot.localeCompare(y.slot));
  for (const b of sorted) {
    const spots = positionsOf(panel, b);
    if (spots.some((p) => p < 1 || p > panel.spaces)) continue;
    if (b.slot === 'full') {
      if (spots.some((p) => covered.has(p) || tandems.has(p))) continue;
      spots.forEach((p) => covered.add(p));
      byStart.set(b.position, b);
    } else {
      if (covered.has(b.position)) continue;
      const t = tandems.get(b.position) ?? { a: null, b: null };
      const half = b.slot === 'A' ? 'a' : 'b';
      if (t[half]) continue;
      t[half] = b;
      tandems.set(b.position, t);
    }
  }

  const columns: DirectoryEntry<B>[][] = [];
  for (let c = 0; c < cols; c++) {
    const entries: DirectoryEntry<B>[] = [];
    for (let row = 1; row <= rows;) {
      const position = (row - 1) * cols + c + 1;
      const breaker = byStart.get(position);
      const tandem = tandems.get(position);
      if (position > panel.spaces) {
        row++;
        continue;
      }
      if (breaker) {
        const numbers = positionsOf(panel, breaker);
        entries.push({
          type: 'breaker',
          row,
          span: numbers.length,
          numbers,
          circuit: circuitLabel(panel, breaker),
          breaker,
        });
        row += numbers.length;
      } else if (tandem) {
        entries.push({ type: 'tandem', row, span: 1, numbers: [position], a: tandem.a, b: tandem.b });
        row++;
      } else {
        entries.push({ type: 'empty', row, span: 1, numbers: [position] });
        row++;
      }
    }
    columns.push(entries);
  }
  return { rows, columns };
}

/** Short markers printed next to a breaker. Text, so they survive a black-and-white printer. */
export const DIRECTORY_TAGS = [
  { tag: 'CRIT', meaning: 'Critical circuit' },
  { tag: 'UPS', meaning: 'On UPS backup' },
  { tag: 'GEN', meaning: 'On generator backup' },
  { tag: 'GFCI', meaning: 'Ground-fault protected' },
  { tag: 'AFCI', meaning: 'Arc-fault protected' },
  { tag: 'DF', meaning: 'Dual function (GFCI + AFCI)' },
  { tag: 'SPARE', meaning: 'Spare breaker, nothing connected' },
  { tag: 'SPD', meaning: 'Surge protective device' },
] as const;

export type DirectoryTag = (typeof DIRECTORY_TAGS)[number]['tag'];

const PROTECTION_TAG: Record<Protection, DirectoryTag | null> = {
  standard: null,
  gfci: 'GFCI',
  afci: 'AFCI',
  dual: 'DF',
};
const BACKUP_TAG: Record<Backup, DirectoryTag | null> = { none: null, ups: 'UPS', generator: 'GEN' };

export function breakerTags(
  b: Pick<DirectoryBreaker, 'protection' | 'critical' | 'backup' | 'isSpare' | 'device'>,
): DirectoryTag[] {
  const out: DirectoryTag[] = [];
  if (b.device === 'surge') out.push('SPD');
  if (b.isSpare) out.push('SPARE');
  if (b.critical) out.push('CRIT');
  const backup = BACKUP_TAG[b.backup];
  if (backup) out.push(backup);
  const protection = PROTECTION_TAG[b.protection];
  if (protection) out.push(protection);
  return out;
}

/** "20A", "2P 50A" for a multi-pole breaker, or "2P SPD" for a surge protector without breakers. */
export function ampsLabel(b: Pick<DirectoryBreaker, 'amps' | 'poles' | 'device'>): string {
  return `${b.poles > 1 ? `${b.poles}P ` : ''}${b.amps === 0 && b.device === 'surge' ? 'SPD' : `${b.amps}A`}`;
}
