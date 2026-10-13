// Shutdown impact: everything that loses power when a breaker is opened, a panel's main is shut
// off, or a transformer or disconnect is opened. For lockout/tagout and outage planning.

import { canView, circuitLabel, generatorRating, type ImpactReport } from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import { actorOf, requireAuth } from '../context';
import type { DB } from '../db';
import { badRequest, idParam, notFound } from '../errors';
import {
  breakersOf,
  canViewPanel,
  generatorFor,
  getBreaker,
  getDevice,
  getPanel,
  servesOf,
  type BreakerRow,
  type DeviceRow,
  type EquipmentRow,
  type PanelRow,
} from '../panels';
import { AccessData } from '../repo';

export function impactRoutes(app: FastifyInstance, db: DB): void {
  app.get('/api/impact', async (req): Promise<ImpactReport> => {
    const actor = actorOf(requireAuth(req));
    const access = new AccessData(db);
    const q = req.query as { breaker?: string; panel?: string; device?: string };
    const canSee = (locationId: number) => {
      const node = access.node(locationId);
      return !!node && canView(actor, node, access.grants);
    };

    const report: ImpactReport = {
      title: '',
      circuits: 0,
      panels: [],
      devices: [],
      equipment: [],
      relays: [],
      critical: [],
      rooms: [],
      hidden: 0,
    };
    const seenPanels = new Set<number>();
    const seenDevices = new Set<number>();
    const dark: BreakerRow[] = [];
    const panelOf = new Map<number, PanelRow>();

    const fedPanels = db.prepare('SELECT * FROM panels WHERE fed_from_breaker_id = ? OR fed_from_device_id = ?');
    const fedDevicesByBreaker = db.prepare('SELECT * FROM power_devices WHERE fed_from_breaker_id = ?');
    const fedDevicesByDevice = db.prepare('SELECT * FROM power_devices WHERE fed_from_device_id = ?');
    const equipmentOn = db.prepare('SELECT * FROM equipment WHERE fed_from_breaker_id = ? OR fed_from_device_id = ?');

    const addEquipment = (rows: EquipmentRow[]) => {
      for (const e of rows) {
        if (!canSee(e.location_id)) {
          report.hidden++;
          continue;
        }
        report.equipment.push({ id: e.id, tag: e.tag, kind: e.kind, path: access.pathLabel(e.location_id) });
      }
    };

    const visitBreaker = (b: BreakerRow, panel: PanelRow) => {
      if (b.is_spare) return;
      dark.push(b);
      panelOf.set(b.id, panel);
      for (const p of fedPanels.all(b.id, -1) as PanelRow[]) visitPanel(p);
      for (const d of fedDevicesByBreaker.all(b.id) as DeviceRow[]) visitDevice(d);
      addEquipment(equipmentOn.all(b.id, -1) as EquipmentRow[]);
    };

    const visitPanel = (p: PanelRow, start = false) => {
      if (seenPanels.has(p.id)) return;
      seenPanels.add(p.id);
      const shown = canViewPanel(actor, access, p);
      // A panel on its own transfer switch or generator moves to the generator: it is listed,
      // and what it feeds keeps power. (A generator further up is above the opening.)
      const backing = start ? null : generatorFor(db, p);
      const keeps = !!backing && backing.via === null;
      const breakers = breakersOf(db, p.id).filter((b) => !b.is_spare);
      if (shown) {
        report.panels.push({
          id: p.id,
          name: p.name,
          path: access.pathLabel(p.location_id),
          circuits: breakers.length,
          backup: keeps
            ? `Moves to ${backing!.generator.name} (${generatorRating(backing!.generator)})${backing!.transferSwitch ? ` through ${backing!.transferSwitch}` : ''}`
            : null,
        });
      } else report.hidden++;
      if (keeps) return;
      for (const b of breakers) visitBreaker(b, p);
    };

    const visitDevice = (d: DeviceRow) => {
      if (seenDevices.has(d.id)) return;
      seenDevices.add(d.id);
      // A UPS carries its loads on battery, so what it feeds stays on for a while.
      const battery = d.kind === 'ups';
      if (canSee(d.location_id)) {
        report.devices.push({
          id: d.id,
          name: d.name,
          kind: d.kind,
          path: access.pathLabel(d.location_id),
          backup: battery ? 'Runs on battery' : null,
        });
      } else report.hidden++;
      if (battery) return;
      for (const p of fedPanels.all(-1, d.id) as PanelRow[]) visitPanel(p);
      for (const x of fedDevicesByDevice.all(d.id) as DeviceRow[]) visitDevice(x);
      addEquipment(equipmentOn.all(-1, d.id) as EquipmentRow[]);
    };

    if (q.breaker) {
      const b = getBreaker(db, idParam(q.breaker));
      const p = b ? getPanel(db, b.panel_id) : undefined;
      if (!b || !p || !canViewPanel(actor, access, p)) throw notFound('Breaker not found.');
      report.title = `${p.name} circuit ${circuitLabel(p, b)}${b.label ? ` (${b.label})` : ''}`;
      seenPanels.add(p.id); // the panel itself stays on
      visitBreaker({ ...b, is_spare: 0 }, p);
    } else if (q.panel) {
      const p = getPanel(db, idParam(q.panel));
      if (!p || !canViewPanel(actor, access, p)) throw notFound('Panel not found.');
      report.title = `Panel ${p.name}`;
      visitPanel(p, true);
    } else if (q.device) {
      const d = getDevice(db, idParam(q.device));
      if (!d || !canSee(d.location_id)) throw notFound('Equipment not found.');
      report.title = d.name;
      seenDevices.add(d.id);
      for (const p of fedPanels.all(-1, d.id) as PanelRow[]) visitPanel(p);
      for (const x of fedDevicesByDevice.all(d.id) as DeviceRow[]) visitDevice(x);
      addEquipment(equipmentOn.all(-1, d.id) as EquipmentRow[]);
    } else throw badRequest('Say which breaker, panel or device.');

    // Relays switching circuits that go dark lose power too.
    const ids = dark.map((b) => b.id);
    const relays = ids.length
      ? (db
          .prepare(
            `SELECT r.*, p.name AS p_name, p.layout AS p_layout, p.spaces AS p_spaces, p.location_id AS p_location
               FROM breakers r JOIN panels p ON p.id = r.panel_id
              WHERE r.source_breaker_id IN (${ids.map(() => '?').join(',')})`,
          )
          .all(...ids) as (BreakerRow & {
          p_name: string;
          p_layout: PanelRow['layout'];
          p_spaces: number;
          p_location: number;
        })[])
      : [];
    for (const r of relays) {
      if (!canSee(r.p_location)) {
        report.hidden++;
        continue;
      }
      report.relays.push({
        panelId: r.panel_id,
        panelName: r.p_name,
        relay: circuitLabel({ layout: r.p_layout, spaces: r.p_spaces }, r),
        label: r.label,
      });
    }

    report.circuits = dark.length;
    // Critical circuits panel by panel, top down, in circuit order.
    const order = [...seenPanels];
    const critical = dark
      .filter((b) => b.critical && canViewPanel(actor, access, panelOf.get(b.id)!))
      .sort((a, b) => order.indexOf(a.panel_id) - order.indexOf(b.panel_id) || a.position - b.position);
    for (const b of critical) {
      const p = panelOf.get(b.id)!;
      report.critical.push({
        panelId: p.id,
        panelName: p.name,
        circuit: circuitLabel(p, b),
        label: b.label,
        backup: b.backup === 'ups' ? 'On UPS' : b.backup === 'generator' ? 'On generator' : null,
      });
    }
    // Rooms served by any circuit (or relay) that goes dark.
    const roomIds = new Set(servesOf(db, [...ids, ...relays.map((r) => r.id)]).map((s) => s.location_id));
    for (const id of roomIds) {
      if (!canSee(id)) continue;
      report.rooms.push({ id, name: access.byId.get(id)!.name, path: access.pathLabel(id) });
    }
    report.rooms.sort((a, b) => a.path.localeCompare(b.path));
    return report;
  });
}
