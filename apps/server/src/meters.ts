// Meters on a breaker's circuit, a panel's main or a device: what they measure, in words.

import { circuitLabel, type MeterProtocol, type MeterSummary, type VerifyStatus } from '@cbt/core';
import type { DB } from './db';
import { getBreaker, getDevice, getPanel } from './panels';

export interface MeterRow {
  id: number;
  location_id: number;
  name: string;
  meter_number: string;
  manufacturer: string;
  model: string;
  serial: string;
  ct_ratio: string;
  pt_ratio: string;
  multiplier: number | null;
  protocol: MeterProtocol;
  address: string;
  notes: string;
  panel_id: number | null;
  breaker_id: number | null;
  device_id: number | null;
  verify_status: VerifyStatus;
  verified_by: string;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export const getMeter = (db: DB, id: number) =>
  db.prepare('SELECT * FROM meters WHERE id = ?').get(id) as MeterRow | undefined;

/** "LP-1A main", "MSB · 2A (Chiller CH-1)", "T-ETC", or "" when it measures nothing recorded. */
export function measuresText(db: DB, m: MeterRow): string {
  if (m.breaker_id) {
    const b = getBreaker(db, m.breaker_id);
    const p = b ? getPanel(db, b.panel_id) : undefined;
    if (b && p) return `${p.name} · ${circuitLabel(p, b)}${b.label ? ` (${b.label})` : ''}`;
  }
  if (m.panel_id) {
    const p = getPanel(db, m.panel_id);
    if (p) return `${p.name} main`;
  }
  if (m.device_id) {
    const d = getDevice(db, m.device_id);
    if (d) return d.name;
  }
  return '';
}

export const meterSummary = (db: DB, m: MeterRow): MeterSummary => ({
  id: m.id,
  name: m.name,
  meterNumber: m.meter_number,
  measures: measuresText(db, m),
  breakerId: m.breaker_id,
  verifyStatus: m.verify_status,
  verifiedBy: m.verified_by,
  verifiedAt: m.verified_at,
});

/** Meters on a panel's main or on any of its breakers, main first. */
export function panelMeters(db: DB, panelId: number): MeterSummary[] {
  const rows = db
    .prepare(
      `SELECT m.* FROM meters m LEFT JOIN breakers b ON b.id = m.breaker_id
        WHERE m.panel_id = ? OR b.panel_id = ?
        ORDER BY m.breaker_id IS NOT NULL, b.section, b.position, m.name COLLATE NOCASE`,
    )
    .all(panelId, panelId) as MeterRow[];
  return rows.map((m) => meterSummary(db, m));
}

export function deviceMeters(db: DB, deviceId: number): MeterSummary[] {
  const rows = db
    .prepare('SELECT * FROM meters WHERE device_id = ? ORDER BY name COLLATE NOCASE')
    .all(deviceId) as MeterRow[];
  return rows.map((m) => meterSummary(db, m));
}
