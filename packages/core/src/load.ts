// What a panel's breakers add up to: circuits, free spaces, and breaker ratings per leg or
// phase. These are ratings, not measured load; they show how evenly circuits are spread.

import { cellOf, phaseOf, positionsOf, type PanelShape } from './panel';

export interface LoadBreaker {
  position: number;
  poles: number;
  amps: number;
  isSpare: boolean;
}

export interface LegLoad {
  /** "L1"/"L2" on split-phase panels, "A"/"B"/"C" on 3-phase ones. */
  leg: string;
  /** Sum of the ratings of the breakers connected to it. */
  amps: number;
  circuits: number;
}

export interface PanelLoad {
  circuits: number;
  spares: number;
  /** Spaces with nothing in them. */
  freeSpaces: number;
  legs: LegLoad[];
  /** The most-loaded leg's rating sum compared with the least-loaded, as a fraction (0–1). */
  imbalance: number;
  /** Set when the spread is uneven enough to be worth a look. */
  warning: string | null;
}

/** Below this, a small panel's spread says nothing useful. */
const MIN_AMPS_FOR_WARNING = 60;
const IMBALANCE_WARNING = 0.3;

/** Which leg a space is on: phases on 3-phase panels; on split-phase ones the bus alternates by row. */
export function legOf(panel: PanelShape, position: number): string {
  const phase = phaseOf(panel, position);
  if (phase) return phase;
  if (panel.layout === 'single') return 'L1';
  return cellOf(panel, position).row % 2 === 1 ? 'L1' : 'L2';
}

export function panelLoad(panel: PanelShape, breakers: readonly LoadBreaker[]): PanelLoad {
  const legNames = panel.layout === 'commercial' ? ['A', 'B', 'C'] : panel.layout === 'single' ? ['L1'] : ['L1', 'L2'];
  const legs = new Map(legNames.map((leg) => [leg, { leg, amps: 0, circuits: 0 }]));
  const used = new Set<number>();
  let circuits = 0;
  let spares = 0;
  for (const b of breakers) {
    const spots = positionsOf(panel, b).filter((p) => p >= 1 && p <= panel.spaces);
    spots.forEach((p) => used.add(p));
    if (b.isSpare) {
      spares++;
      continue;
    }
    circuits++;
    // A multi-pole breaker draws on every leg it spans; count each leg once.
    for (const leg of new Set(spots.map((p) => legOf(panel, p)))) {
      const l = legs.get(leg);
      if (!l) continue;
      l.amps += b.amps;
      l.circuits++;
    }
  }
  const list = [...legs.values()];
  const amps = list.map((l) => l.amps);
  const max = Math.max(...amps);
  const min = Math.min(...amps);
  const imbalance = list.length > 1 && max > 0 ? (max - min) / max : 0;
  let warning: string | null = null;
  if (list.length > 1 && max >= MIN_AMPS_FOR_WARNING && imbalance >= IMBALANCE_WARNING) {
    const high = list.find((l) => l.amps === max)!;
    const low = list.find((l) => l.amps === min)!;
    const what = panel.layout === 'commercial' ? 'Phase' : 'Leg';
    warning = `${what} ${high.leg} has ${high.amps} A of breakers on it and ${what.toLowerCase()} ${low.leg} only ${low.amps} A. Moving a circuit or two could even them out.`;
  }
  return { circuits, spares, freeSpaces: panel.spaces - used.size, legs: list, imbalance, warning };
}
