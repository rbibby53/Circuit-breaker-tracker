// Meters: the site's own meters on switchgear, panels and circuits. Each records what it measures
// (a breaker, a panel's main, or a device such as a switching cube), its ratios and how it
// communicates, and can be checked in the field like a circuit.

import {
  METER_PROTOCOL_LABELS,
  VERIFY_LABELS,
  atLeast,
  canView,
  effectiveRole,
  meterInputSchema,
  verifyMeterSchema,
  type MeterDto,
  type MeterInput,
} from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit';
import { actorOf, requireAuth } from '../context';
import { now, type DB } from '../db';
import { badRequest, forbidden, idParam, notFound, parse } from '../errors';
import { getMeter, meterSummary, type MeterRow } from '../meters';
import { canViewPanel, getBreaker, getDevice, getPanel } from '../panels';
import { AccessData } from '../repo';

type Actor = ReturnType<typeof actorOf>;

export function meterRoutes(app: FastifyInstance, db: DB): void {
  const canSeeLocation = (actor: Actor, access: AccessData, locationId: number) => {
    const node = access.node(locationId);
    return !!node && canView(actor, node, access.grants);
  };
  const canEditAt = (actor: Actor, access: AccessData, locationId: number) =>
    atLeast(effectiveRole(actor, access.node(locationId)!, access.grants), 'editor');
  const visible = (actor: Actor, access: AccessData, id: number) => {
    const m = getMeter(db, id);
    if (!m || !canSeeLocation(actor, access, m.location_id)) throw notFound('Meter not found.');
    return m;
  };

  const dto = (actor: Actor, access: AccessData, m: MeterRow, readOnly: boolean): MeterDto => {
    const breaker = m.breaker_id ? getBreaker(db, m.breaker_id) : undefined;
    return {
      ...meterSummary(db, m),
      locationId: m.location_id,
      locationPath: access.pathLabel(m.location_id),
      manufacturer: m.manufacturer,
      model: m.model,
      serial: m.serial,
      ctRatio: m.ct_ratio,
      ptRatio: m.pt_ratio,
      multiplier: m.multiplier,
      protocol: m.protocol,
      address: m.address,
      notes: m.notes,
      panelId: m.panel_id,
      breakerPanelId: breaker?.panel_id ?? null,
      deviceId: m.device_id,
      canEdit: !readOnly && canEditAt(actor, access, m.location_id),
    };
  };

  /** Where a meter may go, and that what it measures is something the person can see. */
  const check = (actor: Actor, access: AccessData, body: MeterInput, self: MeterRow | null) => {
    const node = access.node(body.locationId);
    if (!node || !canView(actor, node, access.grants)) throw notFound('Location not found.');
    if (node.kind === 'company') throw badRequest('Put it in a site, building or room, not a company.');
    if (!canEditAt(actor, access, body.locationId)) throw forbidden('You need Editor access here to change meters.');
    if (body.panelId && body.panelId !== self?.panel_id) {
      const p = getPanel(db, body.panelId);
      if (!p || !canViewPanel(actor, access, p)) throw badRequest('Panel not found.');
    }
    if (body.breakerId && body.breakerId !== self?.breaker_id) {
      const b = getBreaker(db, body.breakerId);
      const p = b ? getPanel(db, b.panel_id) : undefined;
      if (!b || !p || !canViewPanel(actor, access, p)) throw badRequest('Breaker not found.');
    }
    if (body.deviceId && body.deviceId !== self?.device_id) {
      const d = getDevice(db, body.deviceId);
      if (!d || !canSeeLocation(actor, access, d.location_id)) throw badRequest('Transformer or switchgear not found.');
    }
  };

  app.get('/api/meters', async (req): Promise<MeterDto[]> => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    return (db.prepare('SELECT * FROM meters ORDER BY name COLLATE NOCASE').all() as MeterRow[])
      .filter((m) => canSeeLocation(actor, access, m.location_id))
      .map((m) => dto(actor, access, m, auth.readOnly));
  });

  app.get('/api/meters/:id', async (req): Promise<MeterDto> => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    return dto(actor, access, visible(actor, access, idParam((req.params as { id: string }).id)), auth.readOnly);
  });

  const columns = (b: MeterInput) => [
    b.name,
    b.locationId,
    b.meterNumber,
    b.manufacturer,
    b.model,
    b.serial,
    b.ctRatio,
    b.ptRatio,
    b.multiplier,
    b.protocol,
    b.address,
    b.notes,
    b.panelId,
    b.breakerId,
    b.deviceId,
  ];

  const detailsText = (b: MeterInput) =>
    [
      b.meterNumber && `#${b.meterNumber}`,
      b.ctRatio && `CT ${b.ctRatio}`,
      b.ptRatio && `PT ${b.ptRatio}`,
      b.protocol && METER_PROTOCOL_LABELS[b.protocol],
    ]
      .filter(Boolean)
      .join(', ');

  app.post('/api/meters', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const body = parse(meterInputSchema, req.body);
    check(actor, access, body, null);
    const t = now();
    const r = db
      .prepare(
        `INSERT INTO meters (name, location_id, meter_number, manufacturer, model, serial, ct_ratio, pt_ratio, multiplier,
           protocol, address, notes, panel_id, breaker_id, device_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...columns(body), t, t);
    const id = Number(r.lastInsertRowid);
    const details = detailsText(body);
    audit(
      db,
      auth,
      {
        action: 'meter.create',
        entity: 'meter',
        entityId: id,
        locationId: body.locationId,
        summary: `Added meter ${body.name}${details ? ` (${details})` : ''}`,
        after: body,
      },
      access,
    );
    return { id };
  });

  app.put('/api/meters/:id', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const m = visible(actor, access, idParam((req.params as { id: string }).id));
    if (!canEditAt(actor, access, m.location_id)) throw forbidden('You need Editor access here to change meters.');
    const body = parse(meterInputSchema, req.body);
    check(actor, access, body, m);
    db.prepare(
      `UPDATE meters SET name = ?, location_id = ?, meter_number = ?, manufacturer = ?, model = ?, serial = ?, ct_ratio = ?,
         pt_ratio = ?, multiplier = ?, protocol = ?, address = ?, notes = ?, panel_id = ?, breaker_id = ?, device_id = ?,
         updated_at = ?
       WHERE id = ?`,
    ).run(...columns(body), now(), m.id);
    audit(
      db,
      auth,
      {
        action: 'meter.update',
        entity: 'meter',
        entityId: m.id,
        locationId: body.locationId,
        summary: `Edited meter ${body.name}`,
        before: m,
        after: body,
      },
      access,
    );
    return { ok: true };
  });

  app.delete('/api/meters/:id', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const m = visible(actor, access, idParam((req.params as { id: string }).id));
    if (!canEditAt(actor, access, m.location_id)) throw forbidden('You need Editor access here to change meters.');
    db.prepare('DELETE FROM meters WHERE id = ?').run(m.id);
    audit(
      db,
      auth,
      {
        action: 'meter.delete',
        entity: 'meter',
        entityId: m.id,
        locationId: m.location_id,
        summary: `Deleted meter ${m.name}`,
        before: m,
      },
      access,
    );
    return { ok: true };
  });

  /** Check a meter in the field: right, wrong, or back to not checked. Recorded with who and when. */
  app.post('/api/meters/:id/verify', async (req): Promise<MeterDto> => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const m = visible(actor, access, idParam((req.params as { id: string }).id));
    if (auth.readOnly || !canEditAt(actor, access, m.location_id)) {
      throw forbidden('You need Editor access here to check meters.');
    }
    const { status } = parse(verifyMeterSchema, req.body);
    if (status !== m.verify_status) {
      const t = now();
      db.prepare('UPDATE meters SET verify_status = ?, verified_by = ?, verified_at = ? WHERE id = ?').run(
        status,
        status ? auth.user.display_name : '',
        status ? t : null,
        m.id,
      );
      audit(
        db,
        auth,
        {
          action: 'meter.verify',
          entity: 'meter',
          entityId: m.id,
          locationId: m.location_id,
          summary: status
            ? `Checked meter ${m.name}: ${VERIFY_LABELS[status].toLowerCase()}`
            : `Cleared the check on meter ${m.name}`,
        },
        access,
      );
    }
    return dto(actor, access, getMeter(db, m.id)!, auth.readOnly);
  });
}
