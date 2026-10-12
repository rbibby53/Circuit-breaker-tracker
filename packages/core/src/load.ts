// What a panel's breakers add up to: circuits, free spaces, breaker ratings per leg or phase,
// and, where circuits have a connected load (VA) recorded, the load on each phase with its
// demand total and how far the phases are out of balance.

import { cellOf, isSurgeOnly, phaseOf, positionsOf, type Device, type PanelShape } from './panel';
import { formatVa, parseVoltage } from './voltage';

export interface LoadBreaker {
  position: number;
  poles: number;
  amps: number;
  isSpare: boolean;
  device?: Device;
  /** Connected load in volt-amps, when known. */
  loadVa?: number | null;
  /** Demand factor in percent; unset means 100%. */
  demandPct?: number | null;
}

export interface LegLoad {
  /** "L1"/"L2" on split-phase panels, "A"/"B"/"C" on 3-phase ones. */
  leg: string;
  /** Sum of the ratings of the breakers connected to it. */
  amps: number;
  circuits: number;
  /** Connected load on this leg (VA), multi-pole loads split evenly over their legs. */
  va: number;
  /** The same after demand factors. */
  demandVa: number;
  /** Demand current on this leg, when the panel voltage is known. */
  loadAmps: number | null;
}

export interface PanelLoad {
  circuits: number;
  spares: number;
  /** Where surge protectors sit, as circuit numbers ("1", "13 + 15"). Empty when there are none. */
  surge: number[][];
  /** Spaces with nothing in them. */
  freeSpaces: number;
  legs: LegLoad[];
  /** The most-loaded leg's rating sum compared with the least-loaded, as a fraction (0–1). */
  imbalance: number;
  /** Set when the spread is uneven enough to be worth a look. */
  warning: string | null;
  /** Circuits with a connected load recorded, out of `circuits`. */
  loadedCircuits: number;
  connectedVa: number;
  demandVa: number;
  /** Phase imbalance of the demand load: largest deviation from the average, over the average. */
  loadImbalance: number;
}

/** Below this, a small panel's spread says nothing useful. */
const MIN_AMPS_FOR_WARNING = 60;
const IMBALANCE_WARNING = 0.3;
/** Imbalance of recorded loads worth a warning, and the least load it applies to. */
const LOAD_IMBALANCE_WARNING = 0.15;
const MIN_VA_FOR_WARNING = 3000;

/** Which leg a space is on: phases on 3-phase panels; on split-phase ones the bus alternates by row. */
export function legOf(panel: PanelShape, position: number): string {
  const phase = phaseOf(panel, position);
  if (phase) return phase;
  if (panel.layout === 'single' || panel.layout === 'relay') return 'L1';
  return cellOf(panel, position).row % 2 === 1 ? 'L1' : 'L2';
}

/** Demand VA of one circuit: its connected load times its demand factor. */
export const demandOf = (b: { loadVa?: number | null; demandPct?: number | null }) =>
  (b.loadVa ?? 0) * ((b.demandPct ?? 100) / 100);

export function panelLoad(panel: PanelShape & { voltage?: string }, breakers: readonly LoadBreaker[]): PanelLoad {
  const legNames =
    panel.layout === 'commercial'
      ? ['A', 'B', 'C']
      : panel.layout === 'single' || panel.layout === 'relay'
        ? ['L1']
        : ['L1', 'L2'];
  const legs = new Map<string, LegLoad>(
    legNames.map((leg) => [leg, { leg, amps: 0, circuits: 0, va: 0, demandVa: 0, loadAmps: null }]),
  );
  let loadedCircuits = 0;
  const used = new Set<number>();
  let circuits = 0;
  let spares = 0;
  const surge: number[][] = [];
  for (const b of breakers) {
    const spots = positionsOf(panel, b).filter((p) => p >= 1 && p <= panel.spaces);
    spots.forEach((p) => used.add(p));
    if (b.device === 'surge') surge.push(spots);
    // A surge protector without breakers feeds nothing, so it is not a circuit.
    if (isSurgeOnly({ device: b.device, amps: b.amps })) continue;
    if (b.isSpare) {
      spares++;
      continue;
    }
    circuits++;
    if (b.loadVa) loadedCircuits++;
    // A multi-pole breaker draws on every leg it spans; count each leg once, and share its
    // load evenly between them.
    const onLegs = [...new Set(spots.map((p) => legOf(panel, p)))].filter((leg) => legs.has(leg));
    for (const leg of onLegs) {
      const l = legs.get(leg)!;
      l.amps += b.amps;
      l.circuits++;
      l.va += (b.loadVa ?? 0) / onLegs.length;
      l.demandVa += demandOf(b) / onLegs.length;
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
  surge.sort((x, y) => x[0]! - y[0]!);

  // Amps per leg from its load, at the panel's line-to-neutral voltage (120 V on each leg of a
  // 120/240 V panel; 120 or 277 V per phase on 3-phase ones).
  const v = parseVoltage(panel.voltage ?? '', panel.layout === 'commercial' ? 3 : 1);
  const perLeg = v?.lineToNeutral ?? (v && legNames.length === 1 ? v.lineToLine : null);
  for (const l of list) l.loadAmps = perLeg && l.demandVa ? l.demandVa / perLeg : l.demandVa ? null : 0;
  const demand = list.map((l) => l.demandVa);
  const avg = demand.reduce((a, b) => a + b, 0) / (demand.length || 1);
  const loadImbalance = list.length > 1 && avg > 0 ? Math.max(...demand.map((d) => Math.abs(d - avg))) / avg : 0;
  const connectedVa = breakers.reduce((sum, b) => sum + (b.isSpare ? 0 : (b.loadVa ?? 0)), 0);
  const demandVa = breakers.reduce((sum, b) => sum + (b.isSpare ? 0 : demandOf(b)), 0);
  // With loads recorded, judge the balance on them rather than on breaker ratings.
  if (loadedCircuits > 0 && list.length > 1) {
    warning = null;
    if (loadImbalance >= LOAD_IMBALANCE_WARNING && demandVa >= MIN_VA_FOR_WARNING) {
      const high = list.reduce((a, b) => (b.demandVa > a.demandVa ? b : a));
      const low = list.reduce((a, b) => (b.demandVa < a.demandVa ? b : a));
      const what = panel.layout === 'commercial' ? 'Phase' : 'Leg';
      warning = `The load is ${Math.round(loadImbalance * 100)}% out of balance: ${what.toLowerCase()} ${high.leg} carries ${formatVa(high.demandVa)} and ${what.toLowerCase()} ${low.leg} ${formatVa(low.demandVa)}. Moving a circuit or two could even them out.`;
    }
  }
  return {
    circuits,
    spares,
    surge,
    freeSpaces: panel.spaces - used.size,
    legs: list,
    imbalance,
    warning,
    loadedCircuits,
    connectedVa,
    demandVa,
    loadImbalance,
  };
}
