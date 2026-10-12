// The equipment register (AHU-1, EF-2, CT-1…) and room links suggested from breaker labels.

import {
  acceptRoomLinksSchema,
  atLeast,
  canView,
  circuitLabel,
  effectiveRole,
  equipmentInputSchema,
  isRelayPanel,
  isWithin,
  pathIds,
  voltageFits,
  type EquipmentDto,
  type EquipmentInput,
  type RoomLinkSuggestion,
} from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit';
import { actorOf, requireAuth } from '../context';
import { now, type DB } from '../db';
import { badRequest, forbidden, idParam, notFound, parse } from '../errors';
import { changePanel } from '../panelChange';
import {
  allPanels,
  breakersOf,
  canViewPanel,
  chainLinks,
  equipmentFeed,
  getBreaker,
  getDevice,
  getEquipment,
  getPanel,
  nearestFeedText,
  outputVoltageOf,
  servesOf,
  upstream,
  type EquipmentRow,
} from '../panels';
import { AccessData } from '../repo';

type Actor = ReturnType<typeof actorOf>;

export function equipmentRoutes(app: FastifyInstance, db: DB): void {
  const canSeeLocation = (actor: Actor, access: AccessData, locationId: number) => {
    const node = access.node(locationId);
    return !!node && canView(actor, node, access.grants);
  };
  const canEditAt = (actor: Actor, access: AccessData, locationId: number) =>
    atLeast(effectiveRole(actor, access.node(locationId)!, access.grants), 'editor');
  const visible = (actor: Actor, access: AccessData, id: number) => {
    const e = getEquipment(db, id);
    if (!e || !canSeeLocation(actor, access, e.location_id)) throw notFound('Equipment not found.');
    return e;
  };

  const dto = (actor: Actor, access: AccessData, e: EquipmentRow): EquipmentDto => {
    const steps = upstream(db, equipmentFeed(e));
    const warnings: string[] = [];
    // The voltage it gets: the circuit it is on, or what the device feeding it puts out.
    const first = steps[0];
    if (e.voltage && first) {
      const fits =
        first.kind === 'breaker'
          ? voltageFits(e.voltage, first.panel.voltage, first.breaker.poles)
          : voltageFits(e.voltage, outputVoltageOf(first.device), 3);
      if (fits === false) {
        const supply =
          first.kind === 'breaker'
            ? `a ${first.breaker.poles}-pole circuit on ${first.panel.voltage}`
            : `${first.device.name} at ${outputVoltageOf(first.device)}`;
        warnings.push(`${e.tag} is rated ${e.voltage}, but it is fed from ${supply}.`);
      }
    }
    return {
      id: e.id,
      tag: e.tag,
      kind: e.kind,
      description: e.description,
      locationId: e.location_id,
      locationPath: access.pathLabel(e.location_id),
      hp: e.hp,
      voltage: e.voltage,
      manufacturer: e.manufacturer,
      model: e.model,
      notes: e.notes,
      fedFromBreakerId: e.fed_from_breaker_id,
      fedFromDeviceId: e.fed_from_device_id,
      fedFrom: nearestFeedText(steps),
      feedChain: chainLinks(actor, access, steps),
      warnings,
      canEdit: canEditAt(actor, access, e.location_id),
    };
  };

  /** Where equipment may go, and that what feeds it is something the person can see. */
  const check = (actor: Actor, access: AccessData, body: EquipmentInput, self: EquipmentRow | null) => {
    const node = access.node(body.locationId);
    if (!node || !canView(actor, node, access.grants)) throw notFound('Location not found.');
    if (node.kind === 'company') throw badRequest('Put it in a site, building or room, not a company.');
    if (!canEditAt(actor, access, body.locationId)) throw forbidden('You need Editor access here to change equipment.');
    if (body.fedFromBreakerId && body.fedFromDeviceId) throw badRequest('Choose one thing that feeds it.');
    if (body.fedFromBreakerId && body.fedFromBreakerId !== self?.fed_from_breaker_id) {
      const b = getBreaker(db, body.fedFromBreakerId);
      const p = b ? getPanel(db, b.panel_id) : undefined;
      if (!b || !p || !canViewPanel(actor, access, p) || isRelayPanel(p)) throw badRequest('Feeder breaker not found.');
    }
    if (body.fedFromDeviceId && body.fedFromDeviceId !== self?.fed_from_device_id) {
      const d = getDevice(db, body.fedFromDeviceId);
      if (!d || !canSeeLocation(actor, access, d.location_id)) throw badRequest('Disconnect or device not found.');
    }
  };

  app.get('/api/equipment', async (req): Promise<EquipmentDto[]> => {
    const actor = actorOf(requireAuth(req));
    const access = new AccessData(db);
    return (db.prepare('SELECT * FROM equipment ORDER BY tag COLLATE NOCASE').all() as EquipmentRow[])
      .filter((e) => canSeeLocation(actor, access, e.location_id))
      .map((e) => dto(actor, access, e));
  });

  app.get('/api/equipment/:id', async (req): Promise<EquipmentDto> => {
    const actor = actorOf(requireAuth(req));
    const access = new AccessData(db);
    return dto(actor, access, visible(actor, access, idParam((req.params as { id: string }).id)));
  });

  const columns = (b: EquipmentInput) => [
    b.tag,
    b.kind,
    b.description,
    b.locationId,
    b.hp,
    b.voltage,
    b.manufacturer,
    b.model,
    b.notes,
  ];

  app.post('/api/equipment', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const body = parse(equipmentInputSchema, req.body);
    check(actor, access, body, null);
    const t = now();
    const r = db
      .prepare(
        `INSERT INTO equipment (tag, kind, description, location_id, hp, voltage, manufacturer, model, notes,
           fed_from_breaker_id, fed_from_device_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...columns(body), body.fedFromBreakerId ?? null, body.fedFromDeviceId ?? null, t, t);
    const id = Number(r.lastInsertRowid);
    audit(
      db,
      auth,
      {
        action: 'equipment.create',
        entity: 'equipment',
        entityId: id,
        locationId: body.locationId,
        summary: `Added equipment ${body.tag}${body.kind ? ` (${body.kind})` : ''}`,
        after: body,
      },
      access,
    );
    return { id };
  });

  app.patch('/api/equipment/:id', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const e = visible(actor, access, idParam((req.params as { id: string }).id));
    if (!canEditAt(actor, access, e.location_id)) throw forbidden('You need Editor access here to change equipment.');
    const body = parse(equipmentInputSchema, req.body);
    // Omitted feeds stay as they are; setting one clears the other.
    let breakerId = body.fedFromBreakerId === undefined ? e.fed_from_breaker_id : body.fedFromBreakerId;
    let deviceId = body.fedFromDeviceId === undefined ? e.fed_from_device_id : body.fedFromDeviceId;
    if (body.fedFromBreakerId) deviceId = null;
    else if (body.fedFromDeviceId) breakerId = null;
    check(actor, access, { ...body, fedFromBreakerId: breakerId, fedFromDeviceId: deviceId }, e);
    db.prepare(
      `UPDATE equipment SET tag = ?, kind = ?, description = ?, location_id = ?, hp = ?, voltage = ?, manufacturer = ?,
         model = ?, notes = ?, fed_from_breaker_id = ?, fed_from_device_id = ?, updated_at = ?
       WHERE id = ?`,
    ).run(...columns(body), breakerId, deviceId, now(), e.id);
    audit(
      db,
      auth,
      {
        action: 'equipment.update',
        entity: 'equipment',
        entityId: e.id,
        locationId: body.locationId,
        summary: `Edited equipment ${body.tag}`,
        before: e,
        after: body,
      },
      access,
    );
    return { ok: true };
  });

  app.delete('/api/equipment/:id', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const e = visible(actor, access, idParam((req.params as { id: string }).id));
    if (!canEditAt(actor, access, e.location_id)) throw forbidden('You need Editor access here to change equipment.');
    db.prepare('DELETE FROM equipment WHERE id = ?').run(e.id);
    audit(
      db,
      auth,
      {
        action: 'equipment.delete',
        entity: 'equipment',
        entityId: e.id,
        locationId: e.location_id,
        summary: `Deleted equipment ${e.tag}`,
        before: e,
      },
      access,
    );
    return { ok: true };
  });

  // ---- Room links suggested from labels -----------------------------------------------------

  /**
   * Breakers in panels at or under a location whose label names a room ("RECEPT ROOM 3002",
   * "LAB 110 LTS") in the same site that they do not serve yet. A room is matched by the number
   * in its name; numbers used by more than one room in the site match only within the panel's
   * own building.
   */
  app.get('/api/locations/:id/room-links', async (req): Promise<RoomLinkSuggestion[]> => {
    const actor = actorOf(requireAuth(req));
    const access = new AccessData(db);
    const id = idParam((req.params as { id: string }).id);
    const root = access.node(id);
    if (!root || !canView(actor, root, access.grants)) throw notFound();
    return roomLinkSuggestions(actor, access, id);
  });

  const roomKey = (s: string) => s.toUpperCase().replace(/^0+(?=\d)/, '');
  const roomNumbers = (name: string) => (name.match(/\b[A-Z]?\d{3,5}[A-Z]?\b/gi) ?? []).map(roomKey);
  const buildingOf = (access: AccessData, locationId: number) => {
    const l = access.byId.get(locationId);
    if (!l) return null;
    for (const pid of pathIds(l.path)) if (access.byId.get(pid)?.kind === 'building') return pid;
    return null;
  };
  const siteOf = (access: AccessData, locationId: number) => {
    const l = access.byId.get(locationId);
    if (!l) return null;
    for (const pid of pathIds(l.path)) if (access.byId.get(pid)?.kind === 'site') return pid;
    return null;
  };

  function roomLinkSuggestions(actor: Actor, access: AccessData, rootId: number): RoomLinkSuggestion[] {
    const root = access.node(rootId)!;
    // Rooms the person can see, by the numbers in their names, per site.
    const rooms = new Map<string, number[]>();
    for (const l of access.byId.values()) {
      if (l.kind !== 'room' || !canSeeLocation(actor, access, l.id)) continue;
      const site = siteOf(access, l.id);
      for (const n of roomNumbers(l.name)) rooms.set(`${site}:${n}`, [...(rooms.get(`${site}:${n}`) ?? []), l.id]);
    }
    const out: RoomLinkSuggestion[] = [];
    for (const p of allPanels(db)) {
      const node = access.node(p.location_id);
      if (!node || !isWithin(node, root.id) || !canViewPanel(actor, access, p) || isRelayPanel(p)) continue;
      if (!canEditAt(actor, access, p.location_id)) continue;
      const site = siteOf(access, p.location_id);
      const building = buildingOf(access, p.location_id);
      const breakers = breakersOf(db, p.id);
      const served = new Set(
        servesOf(
          db,
          breakers.map((b) => b.id),
        ).map((s) => `${s.breaker_id}:${s.location_id}`),
      );
      for (const b of breakers) {
        if (b.is_spare) continue;
        const seen = new Set<number>();
        for (const n of roomNumbers(b.label)) {
          let matches = rooms.get(`${site}:${n}`) ?? [];
          if (matches.length > 1) matches = matches.filter((r) => buildingOf(access, r) === building);
          if (matches.length !== 1) continue;
          const roomId = matches[0]!;
          if (seen.has(roomId) || served.has(`${b.id}:${roomId}`)) continue;
          seen.add(roomId);
          const room = access.byId.get(roomId)!;
          out.push({
            breakerId: b.id,
            panelId: p.id,
            panelName: p.name,
            circuit: circuitLabel(p, b),
            label: b.label,
            locationId: roomId,
            roomName: room.name,
            roomPath: access.pathLabel(roomId),
          });
        }
      }
    }
    return out;
  }

  /** Accept suggested room links: each breaker serves the room, recorded in its panel's history. */
  app.post('/api/room-links', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const body = parse(acceptRoomLinksSchema, req.body);
    const byPanel = new Map<number, { breakerId: number; locationId: number }[]>();
    for (const link of body.links) {
      const b = getBreaker(db, link.breakerId);
      const p = b ? getPanel(db, b.panel_id) : undefined;
      if (!b || !p || !canViewPanel(actor, access, p)) throw badRequest('A breaker was not found.');
      if (!canEditAt(actor, access, p.location_id)) throw forbidden(`You need Editor access to change ${p.name}.`);
      const room = access.node(link.locationId);
      const site = siteOf(access, p.location_id);
      if (!room || !canSeeLocation(actor, access, link.locationId) || !site || !isWithin(room, site)) {
        throw badRequest('A room was not found in the panel’s site.');
      }
      byPanel.set(p.id, [...(byPanel.get(p.id) ?? []), link]);
    }
    let linked = 0;
    const add = db.prepare('INSERT OR IGNORE INTO breaker_serves (breaker_id, location_id, note) VALUES (?, ?, ?)');
    for (const [panelId, links] of byPanel) {
      const panel = getPanel(db, panelId)!;
      changePanel(db, auth, access, panel, 'Linked rooms from breaker labels', () => {
        for (const l of links) linked += add.run(l.breakerId, l.locationId, '').changes;
      });
    }
    return { linked };
  });
}
