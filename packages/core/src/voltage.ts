// Reading the free-text voltages on panels and equipment ("277/480 V 3-phase", "120/240 V
// split-phase", "208 V") well enough to do arithmetic with them and spot mismatches.

export interface VoltageInfo {
  /** Line-to-neutral volts, e.g. 120 or 277. Null when there is no neutral (e.g. "480 V delta"). */
  lineToNeutral: number | null;
  /** Line-to-line volts, e.g. 208, 240 or 480. */
  lineToLine: number;
  /** 3 for three-phase, 1 for single- or split-phase. */
  phases: 1 | 3;
}

const SQRT3 = Math.sqrt(3);

/** Standard pairs: the line-to-neutral voltage that goes with each line-to-line one. */
const NEUTRAL_OF: Record<number, number> = { 208: 120, 480: 277, 600: 347, 415: 240, 400: 230 };

/**
 * What a voltage label means, or null when there is no number in it. A label without a phase
 * count is taken as three-phase when its pair is a three-phase one (120/208, 277/480).
 */
export function parseVoltage(text: string, fallbackPhases?: 1 | 3): VoltageInfo | null {
  const nums = (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => n >= 24 && n <= 35000);
  // "3-phase", "3 phase", "3ph", "3Ø": that number is a phase count, not a voltage.
  const three = /\b3\s*-?\s*(?:phase|ph\b|ø|φ)|three[-\s]?phase/i.test(text);
  const single = /\b1\s*-?\s*(?:phase|ph\b|ø|φ)|single[-\s]?phase|split[-\s]?phase/i.test(text);
  if (nums.length === 0) return null;
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const high = sorted[sorted.length - 1]!;
  const low = sorted.length > 1 ? sorted[0]! : null;
  let phases: 1 | 3;
  if (three) phases = 3;
  else if (single) phases = 1;
  else if (low && Math.abs(low * SQRT3 - high) / high < 0.03)
    phases = 3; // 120/208, 277/480
  else if (low && Math.abs(low * 2 - high) / high < 0.03)
    phases = 1; // 120/240
  else phases = fallbackPhases ?? (high === 240 || high === 120 ? 1 : 3);
  // A single number: line-to-line, unless it is a typical line-to-neutral one (120, 277).
  if (!low) {
    if (high === 120 || high === 277 || high === 347 || high === 230) {
      return { lineToNeutral: high, lineToLine: phases === 3 ? Math.round(high * SQRT3) : high * 2, phases };
    }
    return { lineToNeutral: NEUTRAL_OF[high] ?? (phases === 1 && high === 240 ? 120 : null), lineToLine: high, phases };
  }
  return { lineToNeutral: low, lineToLine: high, phases };
}

/** Volt-amps a breaker of this rating can carry at this voltage (all its poles together). */
export function circuitCapacityVa(amps: number, poles: number, v: VoltageInfo): number {
  if (poles >= 3) return amps * v.lineToLine * SQRT3;
  if (poles === 2) return amps * v.lineToLine;
  return amps * (v.lineToNeutral ?? v.lineToLine);
}

/** Volt-amps a panel's main or feeder carries at full rating. */
export function serviceCapacityVa(amps: number, v: VoltageInfo): number {
  return v.phases === 3 ? amps * v.lineToLine * SQRT3 : amps * v.lineToLine;
}

/** Amps on each phase for a balanced share of this load. */
export function ampsPerPhase(va: number, v: VoltageInfo): number {
  return v.phases === 3 ? va / (v.lineToLine * SQRT3) : va / v.lineToLine;
}

/** Whether two voltage labels describe the same system (their line-to-line voltages match). */
export function sameVoltage(a: string, b: string): boolean | null {
  const x = parseVoltage(a);
  const y = parseVoltage(b);
  if (!x || !y) return null;
  return Math.abs(x.lineToLine - y.lineToLine) / Math.max(x.lineToLine, y.lineToLine) < 0.05;
}

/** "1,250 VA", "12.5 kVA", "1.2 MVA". */
export function formatVa(va: number): string {
  if (va >= 1_000_000) return `${(va / 1_000_000).toFixed(2).replace(/\.?0+$/, '')} MVA`;
  if (va >= 10_000) return `${(va / 1000).toFixed(1).replace(/\.0$/, '')} kVA`;
  return `${Math.round(va).toLocaleString('en-US')} VA`;
}

/**
 * A connected load written in a breaker's notes, e.g. "1200 VA", "1.5 kVA", "0.8KVA". The first
 * one found, in VA; null when there is none.
 */
export function vaFromText(text: string): number | null {
  const m = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k?)\s*va\b/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(m[2] ? n * 1000 : n);
}
