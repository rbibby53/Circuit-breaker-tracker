// Standby generators: placed at a location like panels, and linked to the panels they back up
// (through a transfer switch). Panels fed from a backed-up panel are on the generator too.

import {
  atLeast,
  canView,
  effectiveRole,
  generatorInputSchema,
  generatorRating,
  type GeneratorDetail,
  type GeneratorSummary,
} from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit';
import { actorOf, requireAuth } from '../context';
import { now, type DB } from '../db';
import { badRequest, forbidden, idParam, notFound, parse } from '../errors';
import { allPanels, canViewPanel, generatorFor, getGenerator, type GeneratorRow, type PanelRow } from '../panels';
import { AccessData } from '../repo';

type Actor = ReturnType<typeof actorOf>;

export function generatorRoutes(app: FastifyInstance, db: DB): void {
  const canSee = (actor: Actor, access: AccessData, g: GeneratorRow) => {
    const node = access.node(g.location_id);
    return !!node && canView(actor, node, access.grants);
  };
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
        `INSERT INTO generators (location_id, name, kw, fuel, voltage, manufacturer, model, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(locationId, body.name, body.kw, body.fuel, body.voltage, body.manufacturer, body.model, body.notes, t, t);
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
      `UPDATE generators SET name = ?, kw = ?, fuel = ?, voltage = ?, manufacturer = ?, model = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
    ).run(body.name, body.kw, body.fuel, body.voltage, body.manufacturer, body.model, body.notes, now(), g.id);
    const before = {
      name: g.name,
      kw: g.kw,
      fuel: g.fuel,
      voltage: g.voltage,
      manufacturer: g.manufacturer,
      model: g.model,
      notes: g.notes,
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
}
