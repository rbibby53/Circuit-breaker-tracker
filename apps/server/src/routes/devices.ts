// Power devices: transformers, disconnects, UPSs and utility services. Each sits at a location
// like a panel, is fed from a breaker or another device, and feeds panels or further devices.

import {
  POWER_DEVICE_LABELS,
  atLeast,
  canView,
  circuitLabel,
  deviceRating,
  effectiveRole,
  formatVa,
  isRelayPanel,
  powerDeviceInputSchema,
  type DeviceLoad,
  type FeedCandidate,
  type FeedOptions,
  type PowerDeviceDetail,
  type PowerDeviceInput,
  type PowerDeviceSummary,
} from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit';
import { CAPACITY_WARNING, deviceVoltageWarnings, LoadWalk } from '../capacity';
import { actorOf, requireAuth } from '../context';
import { now, type DB } from '../db';
import { badRequest, forbidden, idParam, notFound, parse } from '../errors';
import {
  allDevices,
  allPanels,
  breakersOf,
  canViewPanel,
  chainLinks,
  deviceFeed,
  deviceShape,
  feedReaches,
  getBreaker,
  getDevice,
  getPanel,
  panelFeed,
  upstream,
  type DeviceRow,
  type FeedRef,
  type PanelRow,
} from '../panels';
import { AccessData } from '../repo';

type Actor = ReturnType<typeof actorOf>;

export function deviceRoutes(app: FastifyInstance, db: DB): void {
  const canSeeLocation = (actor: Actor, access: AccessData, locationId: number) => {
    const node = access.node(locationId);
    return !!node && canView(actor, node, access.grants);
  };
  const visibleDevice = (actor: Actor, access: AccessData, id: number) => {
    const d = getDevice(db, id);
    if (!d || !canSeeLocation(actor, access, d.location_id)) throw notFound('Equipment not found.');
    return d;
  };
  const requireEdit = (actor: Actor, access: AccessData, locationId: number) => {
    if (!atLeast(effectiveRole(actor, access.node(locationId)!, access.grants), 'editor')) {
      throw forbidden('You need Editor access here to change equipment.');
    }
  };

  /** Short text for what feeds a device: "MSB · 1 + 3 + 5" or another device's name. */
  const fedFromText = (d: DeviceRow): string | null => {
    const up = upstream(db, deviceFeed(d), { deviceId: d.id })[0];
    if (!up) return null;
    return up.kind === 'breaker' ? `${up.panel.name} · ${circuitLabel(up.panel, up.breaker)}` : up.device.name;
  };

  const summary = (actor: Actor, access: AccessData, d: DeviceRow): PowerDeviceSummary => ({
    ...deviceShape(d),
    id: d.id,
    name: d.name,
    locationId: d.location_id,
    locationPath: access.pathLabel(d.location_id),
    meter: d.meter,
    utility: d.utility,
    rating: deviceRating(deviceShape(d)),
    fedFrom: fedFromText(d),
    role: effectiveRole(actor, access.node(d.location_id)!, access.grants)!,
  });

  /**
   * Where a device may go and what may feed it: a visible place that is not a company, and a
   * visible breaker in a breaker panel or a visible device, without making a loop.
   */
  const check = (actor: Actor, access: AccessData, body: PowerDeviceInput, self: DeviceRow | null) => {
    const node = access.node(body.locationId);
    if (!node || !canView(actor, node, access.grants)) throw notFound('Location not found.');
    if (node.kind === 'company') throw badRequest('Put it on a site, building or room, not a company.');
    requireEdit(actor, access, body.locationId);
    if (body.fedFromBreakerId && body.fedFromDeviceId) throw badRequest('Choose one thing that feeds it.');
    if (body.kind === 'service' && (body.fedFromBreakerId || body.fedFromDeviceId)) {
      throw badRequest('A utility service is where power comes in, so nothing feeds it.');
    }
    if (body.fedFromBreakerId && body.fedFromBreakerId !== self?.fed_from_breaker_id) {
      const b = getBreaker(db, body.fedFromBreakerId);
      const p = b ? getPanel(db, b.panel_id) : undefined;
      if (!b || !p || !canViewPanel(actor, access, p) || isRelayPanel(p)) throw badRequest('Feeder breaker not found.');
    }
    if (body.fedFromDeviceId && body.fedFromDeviceId !== self?.fed_from_device_id) {
      const d = getDevice(db, body.fedFromDeviceId);
      if (!d || !canSeeLocation(actor, access, d.location_id)) throw badRequest('Feeding equipment not found.');
    }
    if (
      self &&
      feedReaches(
        db,
        { breakerId: body.fedFromBreakerId ?? null, deviceId: body.fedFromDeviceId ?? null },
        { deviceId: self.id },
      )
    ) {
      throw badRequest('It cannot be fed from itself or from something it feeds.');
    }
  };

  /** Panels and devices fed by a device. */
  const loadsOf = (d: DeviceRow) => ({
    panels: db
      .prepare('SELECT * FROM panels WHERE fed_from_device_id = ? ORDER BY name COLLATE NOCASE')
      .all(d.id) as PanelRow[],
    devices: db
      .prepare('SELECT * FROM power_devices WHERE fed_from_device_id = ? ORDER BY name COLLATE NOCASE')
      .all(d.id) as DeviceRow[],
  });

  app.get('/api/power-devices', async (req): Promise<PowerDeviceSummary[]> => {
    const actor = actorOf(requireAuth(req));
    const access = new AccessData(db);
    return allDevices(db)
      .filter((d) => canSeeLocation(actor, access, d.location_id))
      .map((d) => summary(actor, access, d));
  });

  app.get('/api/power-devices/:id', async (req): Promise<PowerDeviceDetail> => {
    const actor = actorOf(requireAuth(req));
    const access = new AccessData(db);
    const d = visibleDevice(actor, access, idParam((req.params as { id: string }).id));
    const base = summary(actor, access, d);
    const { panels, devices } = loadsOf(d);
    const demandVa = new LoadWalk(db).device(d);
    const ratio = (d.kind === 'transformer' || d.kind === 'ups') && d.kva ? demandVa / (d.kva * 1000) : null;
    const loads: DeviceLoad[] = [
      ...panels
        .filter((p) => canViewPanel(actor, access, p))
        .map((p): DeviceLoad => ({
          kind: 'panel',
          id: p.id,
          name: p.name,
          detail: p.voltage,
          locationPath: access.pathLabel(p.location_id),
        })),
      ...devices
        .filter((x) => canSeeLocation(actor, access, x.location_id))
        .map((x): DeviceLoad => ({
          kind: 'device',
          id: x.id,
          name: x.name,
          detail: deviceRating(deviceShape(x)),
          locationPath: access.pathLabel(x.location_id),
        })),
    ];
    return {
      ...base,
      manufacturer: d.manufacturer,
      model: d.model,
      notes: d.notes,
      updatedAt: d.updated_at,
      canEdit: atLeast(base.role, 'editor'),
      fedFromBreakerId: d.fed_from_breaker_id,
      fedFromDeviceId: d.fed_from_device_id,
      feedChain: chainLinks(actor, access, upstream(db, deviceFeed(d), { deviceId: d.id })),
      demandVa,
      ratio,
      warnings: [
        ...deviceVoltageWarnings(db, d),
        ...(ratio !== null && ratio >= CAPACITY_WARNING
          ? [`Its load is ${Math.round(ratio * 100)}% of its ${d.kva} kVA (${formatVa(demandVa)}).`]
          : []),
      ],
      loads,
      hiddenLoads: panels.length + devices.length - loads.length,
    };
  });

  const columns = (b: PowerDeviceInput) => [
    b.kind,
    b.name,
    b.kva,
    b.voltage,
    b.kind === 'transformer' ? b.secondaryVoltage : '',
    b.amps,
    b.kind === 'disconnect' && b.fused ? 1 : 0,
    b.kind === 'disconnect' && b.fused ? b.fuseAmps : null,
    b.kind === 'ups' ? b.runtimeMinutes : null,
    b.kind === 'service' ? b.meter : '',
    b.kind === 'service' ? b.utility : '',
    b.manufacturer,
    b.model,
    b.notes,
  ];

  app.post('/api/power-devices', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const body = parse(powerDeviceInputSchema, req.body);
    check(actor, access, body, null);
    const t = now();
    const r = db
      .prepare(
        `INSERT INTO power_devices (kind, name, kva, voltage, secondary_voltage, amps, fused, fuse_amps, runtime_minutes,
           meter, utility, manufacturer, model, notes, location_id, fed_from_breaker_id, fed_from_device_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...columns(body), body.locationId, body.fedFromBreakerId ?? null, body.fedFromDeviceId ?? null, t, t);
    const id = Number(r.lastInsertRowid);
    const rating = deviceRating({ ...body, meter: body.meter });
    audit(
      db,
      auth,
      {
        action: 'device.create',
        entity: 'power_device',
        entityId: id,
        locationId: body.locationId,
        summary: `Added ${POWER_DEVICE_LABELS[body.kind].toLowerCase()} ${body.name}${rating ? ` (${rating})` : ''}`,
        after: body,
      },
      access,
    );
    return { id };
  });

  app.patch('/api/power-devices/:id', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const d = visibleDevice(actor, access, idParam((req.params as { id: string }).id));
    requireEdit(actor, access, d.location_id);
    const body = parse(powerDeviceInputSchema, req.body);
    if (body.kind !== d.kind) throw badRequest('Equipment cannot change kind. Add a new one instead.');
    // Omitted feeds stay as they are; setting one clears the other.
    const feed: FeedRef = {
      breakerId: body.fedFromBreakerId === undefined ? d.fed_from_breaker_id : body.fedFromBreakerId,
      deviceId: body.fedFromDeviceId === undefined ? d.fed_from_device_id : body.fedFromDeviceId,
    };
    if (body.fedFromBreakerId) feed.deviceId = null;
    else if (body.fedFromDeviceId) feed.breakerId = null;
    check(actor, access, { ...body, fedFromBreakerId: feed.breakerId, fedFromDeviceId: feed.deviceId }, d);
    db.prepare(
      `UPDATE power_devices SET kind = ?, name = ?, kva = ?, voltage = ?, secondary_voltage = ?, amps = ?, fused = ?,
         fuse_amps = ?, runtime_minutes = ?, meter = ?, utility = ?, manufacturer = ?, model = ?, notes = ?, location_id = ?,
         fed_from_breaker_id = ?, fed_from_device_id = ?, updated_at = ?
       WHERE id = ?`,
    ).run(...columns(body), body.locationId, feed.breakerId, feed.deviceId, now(), d.id);
    audit(
      db,
      auth,
      {
        action: 'device.update',
        entity: 'power_device',
        entityId: d.id,
        locationId: body.locationId,
        summary: `Edited ${POWER_DEVICE_LABELS[d.kind].toLowerCase()} ${body.name}`,
        before: d,
        after: body,
      },
      access,
    );
    return { ok: true };
  });

  app.delete('/api/power-devices/:id', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const d = visibleDevice(actor, access, idParam((req.params as { id: string }).id));
    requireEdit(actor, access, d.location_id);
    const { panels, devices } = loadsOf(d);
    db.transaction(() => {
      // What it fed loses its feed (set again under Fed from); nothing else changes.
      db.prepare('UPDATE panels SET fed_from_device_id = NULL WHERE fed_from_device_id = ?').run(d.id);
      db.prepare('UPDATE power_devices SET fed_from_device_id = NULL WHERE fed_from_device_id = ?').run(d.id);
      db.prepare('DELETE FROM power_devices WHERE id = ?').run(d.id);
    })();
    const n = panels.length + devices.length;
    audit(
      db,
      auth,
      {
        action: 'device.delete',
        entity: 'power_device',
        entityId: d.id,
        locationId: d.location_id,
        summary: `Deleted ${POWER_DEVICE_LABELS[d.kind].toLowerCase()} ${d.name}${n ? ` (${n} item${n === 1 ? '' : 's'} it fed now have no feed set)` : ''}`,
        before: d,
      },
      access,
    );
    return { ok: true };
  });

  /**
   * What could feed a panel (?panel=) or a device (?device=): visible breakers in breaker panels
   * and visible devices (not utility-service-fed loops), leaving out anything downstream of it.
   */
  app.get('/api/feed-options', async (req): Promise<FeedOptions> => {
    const actor = actorOf(requireAuth(req));
    const access = new AccessData(db);
    const q = req.query as { panel?: string; device?: string };
    let target: { panelId?: number; deviceId?: number };
    if (q.panel) {
      const p = getPanel(db, idParam(q.panel));
      if (!p || !canViewPanel(actor, access, p)) throw notFound('Panel not found.');
      target = { panelId: p.id };
    } else if (q.device) {
      const d = visibleDevice(actor, access, idParam(q.device));
      target = { deviceId: d.id };
    } else throw badRequest('Say what is being fed.');
    const loops = (feed: FeedRef) => feedReaches(db, feed, target);

    const breakers: FeedCandidate[] = [];
    for (const p of allPanels(db)) {
      if (!canViewPanel(actor, access, p) || isRelayPanel(p)) continue;
      // A panel's own breakers, or those of anything it feeds, would loop.
      if (p.id === target.panelId || loops(panelFeed(p))) continue;
      for (const b of breakersOf(db, p.id)) {
        breakers.push({
          breakerId: b.id,
          panelId: p.id,
          panelName: p.name,
          locationPath: access.pathLabel(p.location_id),
          circuit: circuitLabel(p, b),
          label: b.label,
          amps: b.amps,
        });
      }
    }
    const devices = allDevices(db)
      .filter((d) => canSeeLocation(actor, access, d.location_id))
      .filter((d) => d.id !== target.deviceId && !loops({ breakerId: null, deviceId: d.id }))
      .map((d) => ({
        id: d.id,
        name: d.name,
        kind: d.kind,
        rating: deviceRating(deviceShape(d)),
        locationPath: access.pathLabel(d.location_id),
      }));
    return { breakers, devices };
  });
}
