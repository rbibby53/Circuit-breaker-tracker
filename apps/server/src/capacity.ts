// How much load sits below each panel, breaker and transformer, checked against what they are
// rated for; and voltages that do not line up along a feed. Loads are the connected VA recorded
// on circuits, after demand factors.

import {
  circuitCapacityVa,
  circuitLabel,
  demandOf,
  formatVa,
  isRelayPanel,
  outputVoltage,
  parseVoltage,
  sameVoltage,
  serviceCapacityVa,
  type CapacityLimit,
  type LoadCheck,
} from '@cbt/core';
import type { DB } from './db';
import { breakersOf, panelFeed, upstream, type BreakerRow, type DeviceRow, type PanelRow } from './panels';

/** At this share of a rating or above, the item is flagged. */
export const CAPACITY_WARNING = 0.8;

/** Demand totals for one request, cached so a site walk stays cheap. */
export class LoadWalk {
  private panels = new Map<number, number>();
  private devices = new Map<number, number>();
  private breakers = new Map<number, number>();
  private busy = new Set<string>();
  constructor(private db: DB) {}

  /** Demand of a panel's own circuits. Relay panels add none: their circuits are counted at the breakers they switch. */
  own(panel: PanelRow, breakers = breakersOf(this.db, panel.id)): number {
    if (isRelayPanel(panel)) return 0;
    return breakers.reduce(
      (sum, b) => sum + (b.is_spare ? 0 : demandOf({ loadVa: b.load_va, demandPct: b.demand_pct })),
      0,
    );
  }

  /** A panel and everything it feeds. */
  panel(panel: PanelRow): number {
    const cached = this.panels.get(panel.id);
    if (cached !== undefined) return cached;
    const key = `p${panel.id}`;
    if (this.busy.has(key)) return 0; // a loop in the data
    this.busy.add(key);
    const breakers = breakersOf(this.db, panel.id);
    let total = this.own(panel, breakers);
    for (const b of breakers) total += this.below(b);
    this.busy.delete(key);
    this.panels.set(panel.id, total);
    return total;
  }

  /** What a breaker feeds: panels and devices on it (its own circuit load is counted in its panel). */
  below(b: BreakerRow): number {
    const cached = this.breakers.get(b.id);
    if (cached !== undefined) return cached;
    const panels = this.db.prepare('SELECT * FROM panels WHERE fed_from_breaker_id = ?').all(b.id) as PanelRow[];
    const devices = this.db
      .prepare('SELECT * FROM power_devices WHERE fed_from_breaker_id = ?')
      .all(b.id) as DeviceRow[];
    const total =
      panels.reduce((sum, p) => sum + this.panel(p), 0) + devices.reduce((sum, d) => sum + this.device(d), 0);
    this.breakers.set(b.id, total);
    return total;
  }

  /** A breaker's whole demand: what it feeds, plus its own circuit load. */
  breaker(b: BreakerRow): number {
    return this.below(b) + (b.is_spare ? 0 : demandOf({ loadVa: b.load_va, demandPct: b.demand_pct }));
  }

  /** Everything a transformer, disconnect or UPS feeds. */
  device(d: DeviceRow): number {
    const cached = this.devices.get(d.id);
    if (cached !== undefined) return cached;
    const key = `d${d.id}`;
    if (this.busy.has(key)) return 0;
    this.busy.add(key);
    const panels = this.db.prepare('SELECT * FROM panels WHERE fed_from_device_id = ?').all(d.id) as PanelRow[];
    const devices = this.db
      .prepare('SELECT * FROM power_devices WHERE fed_from_device_id = ?')
      .all(d.id) as DeviceRow[];
    const total =
      panels.reduce((sum, p) => sum + this.panel(p), 0) + devices.reduce((sum, x) => sum + this.device(x), 0);
    this.busy.delete(key);
    this.devices.set(d.id, total);
    return total;
  }
}

const limit = (label: string, demandVa: number, capacityVa: number): CapacityLimit => ({
  label,
  demandVa,
  capacityVa,
  ratio: capacityVa > 0 ? demandVa / capacityVa : 0,
});

/** A panel's load against its main (or bus), the breaker feeding it, and the nearest transformer above. */
export function loadCheck(db: DB, panel: PanelRow, walk = new LoadWalk(db)): LoadCheck {
  const breakers = breakersOf(db, panel.id);
  const demandVa = walk.own(panel, breakers);
  const totalDemandVa = walk.panel(panel);
  const limits: CapacityLimit[] = [];
  const v = parseVoltage(panel.voltage, panel.layout === 'commercial' ? 3 : 1);
  if (v && !isRelayPanel(panel)) {
    if (panel.main_type === 'breaker' && panel.main_amps) {
      limits.push(limit(`Main breaker ${panel.main_amps} A`, totalDemandVa, serviceCapacityVa(panel.main_amps, v)));
    } else if (panel.bus_amps) {
      limits.push(limit(`Bus ${panel.bus_amps} A`, totalDemandVa, serviceCapacityVa(panel.bus_amps, v)));
    }
  }
  const steps = upstream(db, panelFeed(panel), { panelId: panel.id });
  const feeder = steps.find((s) => s.kind === 'breaker');
  if (feeder?.kind === 'breaker') {
    const fv = parseVoltage(feeder.panel.voltage, feeder.panel.layout === 'commercial' ? 3 : 1);
    if (fv) {
      limits.push(
        limit(
          `Feeder ${feeder.panel.name} ${circuitLabel(feeder.panel, feeder.breaker)} (${feeder.breaker.amps} A)`,
          walk.breaker(feeder.breaker),
          circuitCapacityVa(feeder.breaker.amps, feeder.breaker.poles, fv),
        ),
      );
    }
  }
  // The nearest transformer or UPS between this panel and that feeder.
  for (const s of steps) {
    if (s.kind === 'breaker') break;
    if ((s.device.kind === 'transformer' || s.device.kind === 'ups') && s.device.kva) {
      const what = s.device.kind === 'transformer' ? 'Transformer' : 'UPS';
      limits.push(limit(`${what} ${s.device.name} (${s.device.kva} kVA)`, walk.device(s.device), s.device.kva * 1000));
      break;
    }
  }
  return { demandVa, totalDemandVa, limits };
}

/** Plain-language notes on loads at or above 80% of a rating. */
export function capacityWarnings(check: LoadCheck): string[] {
  return check.limits
    .filter((l) => l.ratio >= CAPACITY_WARNING)
    .map(
      (l) =>
        `${l.label} is at ${Math.round(l.ratio * 100)}% (${formatVa(l.demandVa)} of ${formatVa(l.capacityVa)})${l.ratio >= 1 ? ', over its rating' : ''}.`,
    );
}

/**
 * Voltages that do not line up: a panel at a different voltage from what feeds it with no
 * transformer between, a transformer whose secondary does not match, and 3-pole breakers on a
 * single-phase panel.
 */
export function voltageWarnings(db: DB, panel: PanelRow, breakers = breakersOf(db, panel.id)): string[] {
  const out: string[] = [];
  const v = parseVoltage(panel.voltage);
  if (v?.phases === 1) {
    const three = breakers.filter((b) => b.poles >= 3);
    if (three.length) {
      const list = three.map((b) => circuitLabel(panel, b)).join(', ');
      out.push(
        `${three.length === 1 ? `Circuit ${list} is` : `Circuits ${list} are`} 3-pole, but the panel is set to ${panel.voltage}.`,
      );
    }
  }
  if (!panel.voltage || isRelayPanel(panel)) return out;
  // The first thing above that sets a voltage: a transformer's secondary, a device's voltage, or a panel.
  for (const s of upstream(db, panelFeed(panel), { panelId: panel.id })) {
    if (s.kind === 'breaker') {
      if (sameVoltage(s.panel.voltage, panel.voltage) === false) {
        out.push(
          `Fed from ${s.panel.name} at ${s.panel.voltage}, but this panel is ${panel.voltage} with no transformer between. Check the voltages, or add the transformer and pick it under Fed from.`,
        );
      }
      break;
    }
    const supplied = outputVoltage({
      kind: s.device.kind,
      voltage: s.device.voltage,
      secondaryVoltage: s.device.secondary_voltage,
    });
    if (!supplied) {
      if (s.device.kind === 'transformer') break; // a step we cannot check
      continue;
    }
    if (sameVoltage(supplied, panel.voltage) === false) {
      out.push(
        s.device.kind === 'transformer'
          ? `${s.device.name} steps down to ${supplied}, but this panel is ${panel.voltage}.`
          : `${s.device.name} is ${supplied}, but this panel is ${panel.voltage}.`,
      );
    }
    break;
  }
  return out;
}

/** A transformer's primary against what feeds it. */
export function deviceVoltageWarnings(db: DB, d: DeviceRow): string[] {
  if (d.kind !== 'transformer' || !d.voltage) return [];
  const above = upstream(db, { breakerId: d.fed_from_breaker_id, deviceId: d.fed_from_device_id }, { deviceId: d.id });
  for (const s of above) {
    const supplied =
      s.kind === 'breaker'
        ? s.panel.voltage
        : outputVoltage({
            kind: s.device.kind,
            voltage: s.device.voltage,
            secondaryVoltage: s.device.secondary_voltage,
          });
    if (!supplied) continue;
    if (sameVoltage(supplied, d.voltage) === false) {
      const from = s.kind === 'breaker' ? s.panel.name : s.device.name;
      return [`Its primary is ${d.voltage}, but ${from} supplies ${supplied}.`];
    }
    return [];
  }
  return [];
}
