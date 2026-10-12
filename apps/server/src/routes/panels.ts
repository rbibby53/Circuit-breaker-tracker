import {
  AVAILABLE_LAYOUTS,
  KIND_LABELS,
  atLeast,
  canView,
  circuitLabel,
  createPanelSchema,
  duplicatePanelSchema,
  effectiveRole,
  isRelayPanel,
  isWithin,
  pathIds,
  savePanelSchema,
  validateLayout,
  validatePanelShape,
  visibleLocations,
  type DuplicatePanelResponse,
  type FeedCandidate,
  type PanelHistoryItem,
  type PanelSummary,
  type SavePanelResponse,
  type ServedByItem,
} from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import { audit } from '../audit';
import { actorOf, requireAuth } from '../context';
import { now, type DB } from '../db';
import { badRequest, conflict, forbidden, idParam, notFound, parse } from '../errors';
import {
  allPanels,
  breakersOf,
  canViewPanel,
  describeChanges,
  getBreaker,
  getGenerator,
  getPanel,
  getTransferSwitch,
  isDownstream,
  locationName,
  panelDetail,
  panelSummary,
  servesOf,
  setTags,
  siteOf,
  snapshot,
  tagsOf,
  type BreakerRow,
} from '../panels';
import { AccessData } from '../repo';

export function panelRoutes(app: FastifyInstance, db: DB): void {
  /** Load a panel the actor can see, or 404 (never reveal panels outside someone's scope). */
  const visiblePanel = (actor: ReturnType<typeof actorOf>, access: AccessData, id: number) => {
    const panel = getPanel(db, id);
    if (!panel || !canViewPanel(actor, access, panel)) throw notFound('Panel not found.');
    return panel;
  };

  const requireEdit = (actor: ReturnType<typeof actorOf>, access: AccessData, locationId: number) => {
    if (!atLeast(effectiveRole(actor, access.node(locationId)!, access.grants), 'editor')) {
      throw forbidden('You need Editor access here to change panels.');
    }
  };

  /** A transfer switch the actor can see, for putting a panel on it. */
  const checkAts = (actor: ReturnType<typeof actorOf>, access: AccessData, atsId: number | null) => {
    if (atsId === null) return;
    const t = getTransferSwitch(db, atsId);
    const node = t ? access.node(t.location_id) : undefined;
    if (!t || !node || !canView(actor, node, access.grants)) throw badRequest('Transfer switch not found.');
  };

  /** A generator the actor can see, for linking to a panel. */
  const checkGenerator = (actor: ReturnType<typeof actorOf>, access: AccessData, generatorId: number | null) => {
    if (generatorId === null) return;
    const g = getGenerator(db, generatorId);
    const node = g ? access.node(g.location_id) : undefined;
    if (!g || !node || !canView(actor, node, access.grants)) throw badRequest('Generator not found.');
  };

  app.get('/api/panels', async (req): Promise<PanelSummary[]> => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    return allPanels(db)
      .filter((p) => canViewPanel(actor, access, p))
      .map((p) => panelSummary(db, actor, access, p));
  });

  app.post('/api/locations/:id/panels', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const id = idParam((req.params as { id: string }).id);
    const access = new AccessData(db);
    const node = access.node(id);
    if (!node || !canView(actor, node, access.grants)) throw notFound();
    if (node.kind !== 'room') throw badRequest('Panels go in a room. Add a room first, then put the panel in it.');
    requireEdit(actor, access, id);
    const body = parse(createPanelSchema, req.body);
    if (!AVAILABLE_LAYOUTS.includes(body.layout)) throw badRequest('That panel layout is not available yet.');
    const shapeIssue = validatePanelShape(body)[0];
    if (shapeIssue) throw badRequest(shapeIssue.message);
    checkGenerator(actor, access, body.generatorId);
    checkAts(actor, access, body.atsId);
    const relay = isRelayPanel(body);
    // On a transfer switch, the switch's generator is the panel's.
    const createGenerator = body.atsId ? null : body.generatorId;
    const t = now();
    const r = db
      .prepare(
        `INSERT INTO panels (location_id, name, layout, spaces, main_amps, main_type, voltage, manufacturer, model, notes,
           generator_id, transfer_switch, control_system, ats_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        body.name,
        body.layout,
        body.spaces,
        // Relay panels have no main.
        relay ? null : body.mainAmps,
        relay ? 'lugs' : body.mainType,
        body.voltage,
        body.manufacturer,
        body.model,
        body.notes,
        createGenerator,
        createGenerator ? body.transferSwitch : '',
        relay ? body.controlSystem : '',
        body.atsId,
        t,
        t,
      );
    const panelId = Number(r.lastInsertRowid);
    audit(
      db,
      auth,
      {
        action: 'panel.create',
        entity: 'panel',
        entityId: panelId,
        locationId: id,
        summary: relay
          ? `Added relay panel ${body.name} (${body.spaces} relays)`
          : `Added panel ${body.name} (${body.spaces} spaces)`,
      },
      access,
    );
    return { id: panelId };
  });

  app.get('/api/panels/:id', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const panel = visiblePanel(actor, access, idParam((req.params as { id: string }).id));
    return panelDetail(db, actor, access, panel);
  });

  app.put('/api/panels/:id', async (req): Promise<SavePanelResponse> => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const panel = visiblePanel(actor, access, idParam((req.params as { id: string }).id));
    requireEdit(actor, access, panel.location_id);
    const body = parse(savePanelSchema, req.body);

    if (body.version !== panel.version) {
      throw conflict('Someone else changed this panel since you opened it. Reload to see their changes.');
    }
    if (body.layout !== panel.layout && !AVAILABLE_LAYOUTS.includes(body.layout)) {
      throw badRequest('That panel layout is not available yet.');
    }
    const relay = isRelayPanel(panel);
    if (isRelayPanel(body) !== relay) {
      throw badRequest('A relay panel cannot become a breaker panel, or the other way round. Add a new panel instead.');
    }
    const atsId = body.atsId === undefined ? panel.ats_id : body.atsId;
    if (atsId !== panel.ats_id) checkAts(actor, access, atsId);
    // A panel is on a transfer switch (whose generator backs it) or on a generator directly.
    const generatorId = atsId ? null : body.generatorId === undefined ? panel.generator_id : body.generatorId;
    const transferSwitch = body.transferSwitch ?? panel.transfer_switch;
    const controlSystem = body.controlSystem ?? panel.control_system;
    if (generatorId !== panel.generator_id) checkGenerator(actor, access, generatorId);
    const shape = { layout: body.layout, spaces: body.spaces };
    const issue = validateLayout(
      shape,
      body.breakers.map((b) => ({
        key: b.clientKey,
        position: b.position,
        slot: b.slot,
        poles: b.poles,
        label: b.label,
      })),
    )[0];
    if (issue) throw badRequest(issue.message);

    const existing = breakersOf(db, panel.id);
    const existingIds = new Set(existing.map((b) => b.id));
    for (const b of body.breakers) {
      if (b.id !== undefined && !existingIds.has(b.id)) throw badRequest('A breaker does not belong to this panel.');
    }

    // "Serves" targets must be in the same site and visible to the person saving. Tags they
    // cannot see are kept as they are, since they could not have been shown in the editor.
    const visible = visibleLocations(actor, [...access.nodes.values()], access.grants);
    const site = siteOf(access, panel.location_id);
    for (const b of body.breakers) {
      for (const s of b.serves) {
        const node = access.node(s.locationId);
        if (!node || visible.get(s.locationId)?.access !== 'full') {
          throw badRequest('A breaker is tagged with a location you cannot see.');
        }
        if (!site || !isWithin(node, site))
          throw badRequest(`${locationName(access, s.locationId)} is in a different site.`);
      }
    }
    // Relays switch circuits fed from breakers in other (breaker) panels. A feeding breaker the
    // person cannot see may stay as it was, but not be newly chosen.
    const existingSource = new Map(existing.map((b) => [b.id, b.source_breaker_id]));
    for (const b of body.breakers) {
      if (!relay) {
        if (b.device !== 'breaker' && b.device !== 'surge') throw badRequest('Unknown device.');
        continue;
      }
      if (b.device !== 'breaker') throw badRequest('A relay panel holds relays only.');
      if (b.sourceBreakerId === null || (b.id !== undefined && existingSource.get(b.id) === b.sourceBreakerId))
        continue;
      const src = getBreaker(db, b.sourceBreakerId);
      const srcPanel = src ? getPanel(db, src.panel_id) : undefined;
      if (!src || !srcPanel || !canViewPanel(actor, access, srcPanel)) {
        throw badRequest('The breaker feeding a relay was not found.');
      }
      if (isRelayPanel(srcPanel)) throw badRequest('A relay is fed from a breaker, not from another relay.');
    }
    const before = servesOf(db, [...existingIds]);
    const hiddenServes = before.filter((s) => visible.get(s.location_id)?.access !== 'full');

    // Fed-from: undefined leaves it alone; the feeder must be visible and must not create a loop.
    let fedFrom = panel.fed_from_breaker_id;
    if (body.fedFromBreakerId !== undefined) {
      fedFrom = body.fedFromBreakerId;
      if (fedFrom !== null) {
        const feeder = getBreaker(db, fedFrom);
        const feederPanel = feeder ? getPanel(db, feeder.panel_id) : undefined;
        if (!feeder || !feederPanel || !canViewPanel(actor, access, feederPanel))
          throw badRequest('Feeder breaker not found.');
        if (isDownstream(db, panel.id, feederPanel.id)) {
          throw badRequest('A panel cannot be fed from itself or from a panel it feeds.');
        }
      }
    }

    const beforeSnap = snapshot(
      panel,
      existing,
      before,
      tagsOf(
        db,
        existing.map((b) => b.id),
      ),
    );
    const idMap: Record<string, number> = {};

    db.transaction(() => {
      const keep = new Set(body.breakers.filter((b) => b.id !== undefined).map((b) => b.id!));
      for (const b of existing) if (!keep.has(b.id)) db.prepare('DELETE FROM breakers WHERE id = ?').run(b.id);

      const update = db.prepare(
        `UPDATE breakers SET position = ?, slot = ?, poles = ?, amps = ?, protection = ?, label = ?, notes = ?,
           is_spare = ?, critical = ?, backup = ?, device = ?, source_breaker_id = ?, control = ? WHERE id = ?`,
      );
      const insert = db.prepare(
        `INSERT INTO breakers (panel_id, position, slot, poles, amps, protection, label, notes, is_spare, critical, backup, device,
           source_breaker_id, control)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const clearServes = db.prepare('DELETE FROM breaker_serves WHERE breaker_id = ?');
      const addServe = db.prepare(
        'INSERT OR REPLACE INTO breaker_serves (breaker_id, location_id, note) VALUES (?, ?, ?)',
      );

      for (const b of body.breakers) {
        const values = [
          b.position,
          b.slot,
          b.poles,
          b.amps,
          // GFCI/AFCI describe breakers; surge protectors and relays have none of their own.
          b.device === 'surge' || relay ? 'standard' : b.protection,
          b.label,
          b.notes,
          b.isSpare ? 1 : 0,
          b.critical ? 1 : 0,
          b.backup,
          b.device,
          relay ? b.sourceBreakerId : null,
          relay ? b.control : '',
        ] as const;
        let id: number;
        if (b.id !== undefined) {
          update.run(...values, b.id);
          id = b.id;
        } else {
          id = Number(insert.run(panel.id, ...values).lastInsertRowid);
          idMap[b.clientKey] = id;
        }
        clearServes.run(id);
        for (const s of b.serves) addServe.run(id, s.locationId, s.note);
        setTags(db, id, b.tags);
        for (const s of hiddenServes) if (s.breaker_id === id) addServe.run(id, s.location_id, s.note);
      }

      db.prepare(
        `UPDATE panels SET name = ?, layout = ?, spaces = ?, main_amps = ?, main_type = ?, voltage = ?, manufacturer = ?,
           model = ?, notes = ?, fed_from_breaker_id = ?, generator_id = ?, transfer_switch = ?, control_system = ?,
           ats_id = ?
         WHERE id = ?`,
      ).run(
        body.name,
        body.layout,
        body.spaces,
        relay ? null : body.mainAmps,
        relay ? 'lugs' : body.mainType,
        body.voltage,
        body.manufacturer,
        body.model,
        body.notes,
        fedFrom,
        generatorId,
        generatorId ? transferSwitch : '',
        relay ? controlSystem : '',
        atsId,
        panel.id,
      );

      const afterPanel = getPanel(db, panel.id)!;
      const afterBreakers = breakersOf(db, panel.id);
      const afterIds = afterBreakers.map((x) => x.id);
      const afterSnap = snapshot(afterPanel, afterBreakers, servesOf(db, afterIds), tagsOf(db, afterIds));
      if (JSON.stringify(afterSnap) === JSON.stringify(beforeSnap)) return; // nothing changed: no new version

      db.prepare('UPDATE panels SET version = version + 1, updated_at = ? WHERE id = ?').run(now(), panel.id);
      const details = describeChanges(shape, beforeSnap, afterSnap, (id) => locationName(access, id));
      audit(
        db,
        auth,
        {
          action: 'panel.update',
          entity: 'panel',
          entityId: panel.id,
          locationId: panel.location_id,
          summary: `Edited panel ${afterPanel.name}${details.length ? `: ${details.slice(0, 2).join('; ')}${details.length > 2 ? ` and ${details.length - 2} more` : ''}` : ''}`,
          before: beforeSnap,
          after: { ...afterSnap, details },
        },
        access,
      );
    })();

    return { panel: panelDetail(db, actor, access, getPanel(db, panel.id)!), idMap };
  });

  app.delete('/api/panels/:id', async (req) => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const panel = visiblePanel(actor, access, idParam((req.params as { id: string }).id));
    requireEdit(actor, access, panel.location_id);
    const breakers = breakersOf(db, panel.id);
    audit(
      db,
      auth,
      {
        action: 'panel.delete',
        entity: 'panel',
        entityId: panel.id,
        locationId: panel.location_id,
        summary: `Deleted panel ${panel.name} and its ${breakers.length} breakers`,
        before: snapshot(
          panel,
          breakers,
          servesOf(
            db,
            breakers.map((b) => b.id),
          ),
        ),
      },
      access,
    );
    db.prepare('DELETE FROM panels WHERE id = ?').run(panel.id);
    return { ok: true };
  });

  /**
   * Copy a panel and its breakers into a room, e.g. for identical apartments. Room tags are
   * kept only inside the same site; the copy is never fed from anything until someone says so.
   */
  app.post('/api/panels/:id/duplicate', async (req): Promise<DuplicatePanelResponse> => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const source = visiblePanel(actor, access, idParam((req.params as { id: string }).id));
    const body = parse(duplicatePanelSchema, req.body);
    const dest = access.node(body.locationId);
    if (!dest || !canView(actor, dest, access.grants)) throw notFound('Room not found.');
    if (dest.kind !== 'room') throw badRequest('Panels go in a room. Pick a room for the copy.');
    requireEdit(actor, access, dest.id);

    const breakers = breakersOf(db, source.id);
    const serves = servesOf(
      db,
      breakers.map((b) => b.id),
    );
    const tags = tagsOf(
      db,
      breakers.map((b) => b.id),
    );
    const visible = visibleLocations(actor, [...access.nodes.values()], access.grants);
    const destSite = siteOf(access, dest.id);
    const keep = (locationId: number) => {
      const node = access.node(locationId);
      return !!node && visible.get(locationId)?.access === 'full' && !!destSite && isWithin(node, destSite);
    };
    let keptTags = 0;
    let droppedTags = 0;
    const t = now();
    // The copy stays on the same generator only when it is in the generator's site.
    const sourceGenerator = source.generator_id ? getGenerator(db, source.generator_id) : undefined;
    const generator =
      sourceGenerator && destSite && siteOf(access, sourceGenerator.location_id) === destSite
        ? sourceGenerator.id
        : null;
    const sourceAts = source.ats_id ? getTransferSwitch(db, source.ats_id) : undefined;
    const ats = sourceAts && destSite && siteOf(access, sourceAts.location_id) === destSite ? sourceAts.id : null;

    const id = db.transaction(() => {
      const r = db
        .prepare(
          `INSERT INTO panels (location_id, name, layout, spaces, main_amps, main_type, voltage, manufacturer, model, notes,
             generator_id, transfer_switch, control_system, ats_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          dest.id,
          body.name,
          source.layout,
          source.spaces,
          source.main_amps,
          source.main_type,
          source.voltage,
          source.manufacturer,
          source.model,
          source.notes,
          generator,
          generator ? source.transfer_switch : '',
          source.control_system,
          ats,
          t,
          t,
        );
      const panelId = Number(r.lastInsertRowid);
      const insert = db.prepare(
        `INSERT INTO breakers (panel_id, position, slot, poles, amps, protection, label, notes, is_spare, critical, backup, device,
           source_breaker_id, control)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const addServe = db.prepare('INSERT INTO breaker_serves (breaker_id, location_id, note) VALUES (?, ?, ?)');
      for (const b of breakers) {
        const newId = Number(
          insert.run(
            panelId,
            b.position,
            b.slot,
            b.poles,
            b.amps,
            b.protection,
            b.label,
            b.notes,
            b.is_spare,
            b.critical,
            b.backup,
            b.device,
            b.source_breaker_id,
            b.control,
          ).lastInsertRowid,
        );
        setTags(
          db,
          newId,
          tags.filter((t) => t.breaker_id === b.id).map((t) => t.tag),
        );
        for (const s of serves.filter((x) => x.breaker_id === b.id)) {
          if (keep(s.location_id)) {
            addServe.run(newId, s.location_id, s.note);
            keptTags++;
          } else droppedTags++;
        }
      }
      audit(
        db,
        auth,
        {
          action: 'panel.create',
          entity: 'panel',
          entityId: panelId,
          locationId: dest.id,
          summary: `Duplicated panel ${source.name} as ${body.name} (${breakers.length} breakers)`,
        },
        access,
      );
      return panelId;
    })();

    return { id, keptTags, droppedTags };
  });

  app.get('/api/panels/:id/history', async (req): Promise<PanelHistoryItem[]> => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const panel = visiblePanel(actor, access, idParam((req.params as { id: string }).id));
    const rows = db
      .prepare(
        `SELECT id, at, user_name, acting_as_name, summary, after FROM audit_log
         WHERE entity = 'panel' AND entity_id = ? ORDER BY id DESC LIMIT 200`,
      )
      .all(panel.id) as {
      id: number;
      at: string;
      user_name: string | null;
      acting_as_name: string | null;
      summary: string;
      after: string | null;
    }[];
    return rows.map((r) => {
      let details: string[] = [];
      try {
        details = (r.after ? JSON.parse(r.after).details : null) ?? [];
      } catch {
        details = [];
      }
      return {
        id: r.id,
        at: r.at,
        user: r.user_name ?? 'System',
        actingAs: r.acting_as_name,
        summary: r.summary,
        details,
      };
    });
  });

  /** Breakers that could feed this panel: any visible breaker not in this panel or below it. */
  app.get('/api/panels/:id/feed-candidates', async (req): Promise<FeedCandidate[]> => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const panel = visiblePanel(actor, access, idParam((req.params as { id: string }).id));
    // ?for=relay: breakers a relay in this panel can be fed from (any breaker panel but this one).
    const forRelay = (req.query as { for?: string }).for === 'relay';
    const out: FeedCandidate[] = [];
    for (const p of allPanels(db)) {
      if (!canViewPanel(actor, access, p) || isRelayPanel(p)) continue;
      if (forRelay ? p.id === panel.id : isDownstream(db, panel.id, p.id)) continue;
      for (const b of breakersOf(db, p.id)) {
        out.push({
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
    return out;
  });

  /**
   * Breakers serving a location: tagged with it, with something inside it, or with something
   * above it (a whole floor or site). Shown read-only even when the panel is out of scope.
   */
  app.get('/api/locations/:id/served-by', async (req): Promise<ServedByItem[]> => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const id = idParam((req.params as { id: string }).id);
    const access = new AccessData(db);
    const node = access.node(id);
    if (!node || !canView(actor, node, access.grants)) throw notFound();

    const ancestors = new Set(pathIds(node.path));
    const rows = db
      .prepare(
        `SELECT s.location_id AS target, b.*, p.id AS p_id, p.name AS p_name, p.location_id AS p_location, p.layout AS p_layout, p.spaces AS p_spaces
         FROM breaker_serves s JOIN breakers b ON b.id = s.breaker_id JOIN panels p ON p.id = b.panel_id
         JOIN locations l ON l.id = s.location_id
         WHERE l.path LIKE ? OR s.location_id IN (${[...ancestors].map(() => '?').join(',')})
         ORDER BY p.name, b.position`,
      )
      .all(`${node.path}%`, ...ancestors) as (BreakerRow & {
      target: number;
      p_id: number;
      p_name: string;
      p_location: number;
      p_layout: 'residential' | 'commercial' | 'single';
      p_spaces: number;
    })[];

    const seen = new Set<number>();
    const out: ServedByItem[] = [];
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const target = access.byId.get(r.target)!;
      const via =
        r.target === id
          ? `This ${KIND_LABELS[node.kind].toLowerCase()}`
          : ancestors.has(r.target)
            ? `Whole ${KIND_LABELS[target.kind].toLowerCase()}: ${target.name}`
            : target.name;
      const panelNode = access.node(r.p_location);
      out.push({
        breakerId: r.id,
        circuit: circuitLabel({ layout: r.p_layout, spaces: r.p_spaces }, r),
        label: r.label,
        amps: r.amps,
        device: r.device,
        poles: r.poles,
        protection: r.protection,
        critical: !!r.critical,
        backup: r.backup,
        isSpare: !!r.is_spare,
        panelId: r.p_id,
        panelName: r.p_name,
        panelPath: access.pathLabel(r.p_location),
        canViewPanel: !!panelNode && canView(actor, panelNode, access.grants),
        via,
      });
    }
    return out;
  });
}
