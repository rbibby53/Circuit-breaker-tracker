// Standby generators: placed at a location like panels, and linked to the panels they back up
// (through a transfer switch). Panels fed from a backed-up panel are on the generator too.

import {
  atLeast,
  canView,
  effectiveRole,
  generatorInputSchema,
  generatorRating,
  transferSwitchInputSchema,
  ATS_KIND_LABELS,
  type GeneratorDetail,
  type GeneratorSummary,
  type TransferSwitchDto,
} from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit';
import { actorOf, requireAuth } from '../context';
import { now, type DB } from '../db';
import { badRequest, forbidden, idParam, notFound, parse } from '../errors';
import {
  allPanels,
  canViewPanel,
  generatorFor,
  getGenerator,
  getTransferSwitch,
  type GeneratorRow,
  type PanelRow,
  type TransferSwitchRow,
} from '../panels';
import { AccessData } from '../repo';

type Actor = ReturnType<typeof actorOf>;

export function generatorRoutes(app: FastifyInstance, db: DB): void {
  const canSeeLocation = (actor: Actor, access: AccessData, locationId: number) => {
    const node = access.node(locationId);
    return !!node && canView(actor, node, access.grants);
  };
  const canSee = (actor: Actor, access: AccessData, g: GeneratorRow) => canSeeLocation(actor, access, g.location_id);
  const visibleGenerator = (actor: Actor, access: AccessData, id: number) => {
    const g = getGenerator(db, id);
    if (!g || !canSee(actor, access, g)) throw notFound('Generator not found.');
    return g;
  };
  const requireEdit = (actor: Actor, access: AccessData, locationId: number) => {
    if (!atLeast(effectiveRole(actor, access.node(locationId)!, access.grants), 'editor')) {
      throw forbidden('You need Editor access here to change generators.');
    }
  };

  /** A transfer switch with the panels on it that the actor can see. */
  const switchDto = (actor: Actor, access: AccessData, t: TransferSwitchRow): TransferSwitchDto => {
    const generator = t.generator_id ? getGenerator(db, t.generator_id) : undefined;
    const panels = (
      db.prepare('SELECT * FROM panels WHERE ats_id = ? ORDER BY name COLLATE NOCASE').all(t.id) as PanelRow[]
    )
      .filter((p) => canViewPanel(actor, access, p))
      .map((p) => ({ id: p.id, name: p.name, locationPath: access.pathLabel(p.location_id) }));
    return {
      id: t.id,
      name: t.name,
      kind: t.kind,
      duty: t.duty,
      transition: t.transition,
      priority: t.priority,
      amps: t.amps,
      generatorId: t.generator_id,
      generatorName: generator && canSee(actor, access, generator) ? generator.name : null,
      locationId: t.location_id,
      locationPath: access.pathLabel(t.location_id),
      notes: t.notes,
      panels,
      canEdit: atLeast(effectiveRole(actor, access.node(t.location_id)!, access.grants), 'editor'),
    };
  };

  /** Every panel on each generator: set on the panel, or through the panel feeding it. */
  const panelsByGenerator = () => {
    const out = new Map<number, { panel: PanelRow; transferSwitch: string; via: PanelRow | null }[]>();
    for (const panel of allPanels(db)) {
      const backing = generatorFor(db, panel);
      if (!backing) continue;
      const list = out.get(backing.generator.id) ?? [];
      list.push({ panel, transferSwitch: backing.transferSwitch, via: backing.via });
      out.set(backing.generator.id, list);
    }
    return out;
  };

  const summary = (
    actor: Actor,
    access: AccessData,
    g: GeneratorRow,
    panels: ReturnType<typeof panelsByGenerator>,
  ): GeneratorSummary => ({
    id: g.id,
    locationId: g.location_id,
    locationPath: access.pathLabel(g.location_id),
    name: g.name,
    kw: g.kw,
    fuel: g.fuel,
    voltage: g.voltage,
    tankGallons: g.tank_gallons,
    runtimeHours: g.runtime_hours,
    panelCount: panels.get(g.id)?.length ?? 0,
    role: effectiveRole(actor, access.node(g.location_id)!, access.grants)!,
  });

  app.get('/api/generators', async (req): Promise<GeneratorSummary[]> => {
    const actor = actorOf(requireAuth(req));
    const access = new AccessData(db);
    const panels = panelsByGenerator();
    return (db.prepare('SELECT * FROM generators ORDER BY name COLLATE NOCASE').all() as GeneratorRow[])
      .filter((g) => canSee(actor, access, g))
      .map((g) => summary(actor, access, g, panels));
  });

  app.get('/api/generators/:id', async (req): Promise<GeneratorDetail> => {
    const actor = actorOf(requireAuth(req));
    const access = new AccessData(db);
    const g = visibleGenerator(actor, access, idParam((req.params as { id: string }).id));
    const panels = panelsByGenerator();
    const on = panels.get(g.id) ?? [];
    const shown = on.filter((p) => canViewPanel(actor, access, p.panel));
    const base = summary(actor, access, g, panels);
    return {
      ...base,
      manufacturer: g.manufacturer,
      model: g.model,
      notes: g.notes,
      updatedAt: g.updated_at,
      canEdit: atLeast(base.role, 'editor'),
      panels: shown
        .map((p) => ({
          id: p.panel.id,
          name: p.panel.name,
          locationPath: access.pathLabel(p.panel.location_id),
          transferSwitch: p.transferSwitch,
          via: p.via?.name ?? null,
        }))
        .sort((a, b) => Number(!!a.via) - Number(!!b.via) || a.name.localeCompare(b.name)),
      hiddenPanels: on.length - shown.length,
      transferSwitches: (
        db
          .prepare('SELECT * FROM transfer_switches WHERE generator_id = ? ORDER BY name COLLATE NOCASE')
          .all(g.id) as TransferSwitchRow[]
      )
        .filter((t) => canSeeLocation(actor, access, t.location_id))
        .map((t) => switchDto(actor, access, t)),
    };
  });

  app.post('/api/locations/:id/generators', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const locationId = idParam((req.params as { id: string }).id);
    const node = access.node(locationId);
    if (!node || !canView(actor, node, access.grants)) throw notFound();
    if (node.kind === 'company') throw badRequest('Put the generator on a site or building, not a company.');
    requireEdit(actor, access, locationId);
    const body = parse(generatorInputSchema, req.body);
    const t = now();
    const r = db
      .prepare(
        `INSERT INTO generators (location_id, name, kw, fuel, voltage, manufacturer, model, notes, tank_gallons,
           runtime_hours, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        locationId,
        body.name,
        body.kw,
        body.fuel,
        body.voltage,
        body.manufacturer,
        body.model,
        body.notes,
        body.tankGallons,
        body.runtimeHours,
        t,
        t,
      );
    const id = Number(r.lastInsertRowid);
    audit(
      db,
      auth,
      {
        action: 'generator.create',
        entity: 'generator',
        entityId: id,
        locationId,
        summary: `Added generator ${body.name} (${generatorRating(body)})`,
        after: body,
      },
      access,
    );
    return { id };
  });

  app.patch('/api/generators/:id', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const g = visibleGenerator(actor, access, idParam((req.params as { id: string }).id));
    requireEdit(actor, access, g.location_id);
    const body = parse(generatorInputSchema, req.body);
    db.prepare(
      `UPDATE generators SET name = ?, kw = ?, fuel = ?, voltage = ?, manufacturer = ?, model = ?, notes = ?,
         tank_gallons = ?, runtime_hours = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      body.name,
      body.kw,
      body.fuel,
      body.voltage,
      body.manufacturer,
      body.model,
      body.notes,
      body.tankGallons,
      body.runtimeHours,
      now(),
      g.id,
    );
    const before = {
      name: g.name,
      kw: g.kw,
      fuel: g.fuel,
      voltage: g.voltage,
      manufacturer: g.manufacturer,
      model: g.model,
      notes: g.notes,
      tankGallons: g.tank_gallons,
      runtimeHours: g.runtime_hours,
    };
    const changed = (Object.keys(before) as (keyof typeof before)[]).filter((k) => before[k] !== body[k]);
    if (changed.length) {
      audit(
        db,
        auth,
        {
          action: 'generator.update',
          entity: 'generator',
          entityId: g.id,
          locationId: g.location_id,
          summary: `Edited generator ${body.name}: ${changed.join(', ')} changed`,
          before,
          after: body,
        },
        access,
      );
    }
    return { ok: true };
  });

  app.delete('/api/generators/:id', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const g = visibleGenerator(actor, access, idParam((req.params as { id: string }).id));
    requireEdit(actor, access, g.location_id);
    const linked = (db.prepare('SELECT COUNT(*) AS n FROM panels WHERE generator_id = ?').get(g.id) as { n: number }).n;
    db.transaction(() => {
      // Panels it backed up keep everything else; their generator link is cleared.
      db.prepare("UPDATE panels SET generator_id = NULL, transfer_switch = '' WHERE generator_id = ?").run(g.id);
      db.prepare('DELETE FROM generators WHERE id = ?').run(g.id);
    })();
    audit(
      db,
      auth,
      {
        action: 'generator.delete',
        entity: 'generator',
        entityId: g.id,
        locationId: g.location_id,
        summary: `Deleted generator ${g.name}${linked ? ` (unlinked ${linked} panel${linked === 1 ? '' : 's'})` : ''}`,
        before: g,
      },
      access,
    );
    return { ok: true };
  });

  // ---- Transfer switches ------------------------------------------------------------------

  const visibleSwitch = (actor: Actor, access: AccessData, id: number) => {
    const t = getTransferSwitch(db, id);
    if (!t || !canSeeLocation(actor, access, t.location_id)) throw notFound('Transfer switch not found.');
    return t;
  };
  /** Where a transfer switch may go, and the generator it may use. */
  const checkSwitch = (actor: Actor, access: AccessData, body: { locationId: number; generatorId: number | null }) => {
    const node = access.node(body.locationId);
    if (!node || !canView(actor, node, access.grants)) throw notFound('Location not found.');
    if (node.kind === 'company')
      throw badRequest('Put the transfer switch on a site, building or room, not a company.');
    requireEdit(actor, access, body.locationId);
    if (body.generatorId !== null) {
      const g = getGenerator(db, body.generatorId);
      if (!g || !canSee(actor, access, g)) throw badRequest('Generator not found.');
    }
  };

  app.get('/api/transfer-switches', async (req): Promise<TransferSwitchDto[]> => {
    const actor = actorOf(requireAuth(req));
    const access = new AccessData(db);
    return (db.prepare('SELECT * FROM transfer_switches ORDER BY name COLLATE NOCASE').all() as TransferSwitchRow[])
      .filter((t) => canSeeLocation(actor, access, t.location_id))
      .map((t) => switchDto(actor, access, t));
  });

  app.post('/api/transfer-switches', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const body = parse(transferSwitchInputSchema, req.body);
    checkSwitch(actor, access, body);
    const t = now();
    const r = db
      .prepare(
        `INSERT INTO transfer_switches (location_id, name, kind, duty, transition, priority, amps, generator_id, notes,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        body.locationId,
        body.name,
        body.kind,
        body.duty,
        body.transition,
        body.priority,
        body.amps,
        body.generatorId,
        body.notes,
        t,
        t,
      );
    const id = Number(r.lastInsertRowid);
    audit(
      db,
      auth,
      {
        action: 'ats.create',
        entity: 'transfer_switch',
        entityId: id,
        locationId: body.locationId,
        summary: `Added transfer switch ${body.name} (${ATS_KIND_LABELS[body.kind].toLowerCase()}${body.amps ? `, ${body.amps} A` : ''})`,
        after: body,
      },
      access,
    );
    return { id };
  });

  app.patch('/api/transfer-switches/:id', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const t = visibleSwitch(actor, access, idParam((req.params as { id: string }).id));
    requireEdit(actor, access, t.location_id);
    const body = parse(transferSwitchInputSchema, req.body);
    if (body.locationId !== t.location_id || body.generatorId !== t.generator_id) checkSwitch(actor, access, body);
    db.prepare(
      `UPDATE transfer_switches SET name = ?, kind = ?, duty = ?, transition = ?, priority = ?, amps = ?, generator_id = ?,
         location_id = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      body.name,
      body.kind,
      body.duty,
      body.transition,
      body.priority,
      body.amps,
      body.generatorId,
      body.locationId,
      body.notes,
      now(),
      t.id,
    );
    audit(
      db,
      auth,
      {
        action: 'ats.update',
        entity: 'transfer_switch',
        entityId: t.id,
        locationId: body.locationId,
        summary: `Edited transfer switch ${body.name}`,
        before: t,
        after: body,
      },
      access,
    );
    return { ok: true };
  });

  app.delete('/api/transfer-switches/:id', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const t = visibleSwitch(actor, access, idParam((req.params as { id: string }).id));
    requireEdit(actor, access, t.location_id);
    const linked = (db.prepare('SELECT COUNT(*) AS n FROM panels WHERE ats_id = ?').get(t.id) as { n: number }).n;
    db.transaction(() => {
      db.prepare('UPDATE panels SET ats_id = NULL WHERE ats_id = ?').run(t.id);
      db.prepare('DELETE FROM transfer_switches WHERE id = ?').run(t.id);
    })();
    audit(
      db,
      auth,
      {
        action: 'ats.delete',
        entity: 'transfer_switch',
        entityId: t.id,
        locationId: t.location_id,
        summary: `Deleted transfer switch ${t.name}${linked ? ` (took ${linked} panel${linked === 1 ? '' : 's'} off it)` : ''}`,
        before: t,
      },
      access,
    );
    return { ok: true };
  });
}
