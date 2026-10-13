import { describe, expect, it } from 'vitest';
import { panelLoad } from './load';
import { ampsPerPhase, formatVa, parseVoltage, sameVoltage, serviceCapacityVa, vaFromText } from './voltage';

describe('voltages', () => {
  it('reads the labels people write', () => {
    expect(parseVoltage('277/480 V 3-phase')).toEqual({ lineToNeutral: 277, lineToLine: 480, phases: 3 });
    expect(parseVoltage('120/208 V')).toEqual({ lineToNeutral: 120, lineToLine: 208, phases: 3 });
    expect(parseVoltage('120/240 V split-phase')).toEqual({ lineToNeutral: 120, lineToLine: 240, phases: 1 });
    expect(parseVoltage('480 V')).toEqual({ lineToNeutral: 277, lineToLine: 480, phases: 3 });
    expect(parseVoltage('277 V')).toMatchObject({ lineToNeutral: 277, lineToLine: 480 });
    expect(parseVoltage('120/208 V single-phase')?.phases).toBe(1);
    expect(parseVoltage('')).toBeNull();
    expect(sameVoltage('277/480 V 3-phase', '480 V')).toBe(true);
    expect(sameVoltage('277/480 V', '120/208 V')).toBe(false);
  });

  it('turns ratings and loads into volt-amps and amps', () => {
    const v = parseVoltage('120/208 V 3-phase')!;
    expect(Math.round(serviceCapacityVa(225, v))).toBe(81060);
    expect(Math.round(ampsPerPhase(36000, v))).toBe(100);
    expect(formatVa(1250)).toBe('1,250 VA');
    expect(formatVa(45000)).toBe('45 kVA');
    expect(vaFromText('RECEPT RM 3002 1200 VA')).toBe(1200);
    expect(vaFromText('3 x lights, 1.5 kVA')).toBe(1500);
    expect(vaFromText('no load here')).toBeNull();
  });

  it('splits connected load across phases, with demand and imbalance', () => {
    const panel = { layout: 'commercial' as const, spaces: 42, voltage: '120/208 V 3-phase' };
    const load = panelLoad(panel, [
      // 1 (A), 3 (B), 5 (C): 1-pole loads; 7+9+11: a 3-pole load across A, B and C.
      { position: 1, poles: 1, amps: 20, isSpare: false, loadVa: 1800 },
      { position: 3, poles: 1, amps: 20, isSpare: false, loadVa: 1200, demandPct: 50 },
      { position: 5, poles: 1, amps: 20, isSpare: false },
      { position: 7, poles: 3, amps: 30, isSpare: false, loadVa: 9000 },
    ]);
    expect(load.loadedCircuits).toBe(3);
    expect(load.connectedVa).toBe(12000);
    expect(load.demandVa).toBe(11400);
    expect(load.legs.map((l) => Math.round(l.demandVa))).toEqual([4800, 3600, 3000]);
    expect(load.legs[0]!.loadAmps).toBe(40);
    expect(Math.round(load.loadImbalance * 100)).toBe(26);
    expect(load.warning).toMatch(/26% out of balance: phase A carries 4,800 VA and phase C 3,000 VA/);
  });
});
