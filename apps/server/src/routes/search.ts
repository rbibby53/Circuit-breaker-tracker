import { canView, circuitLabel, visibleLocations, type SearchResponse } from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import { actorOf, requireAuth } from '../context';
import type { DB } from '../db';
import { allPanels, canViewPanel, type BreakerRow, type PanelRow } from '../panels';
import { AccessData } from '../repo';

const LIMIT = 8;
const BREAKER_LIMIT = 20;

/** Escape a user string for a LIKE pattern. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function searchRoutes(app: FastifyInstance, db: DB): void {
  /**
   * Search what the person can see: locations, panels, and breakers by label or by the place
   * they serve. Breakers from panels outside someone's scope appear when they serve a place
   * the person can see (the same rule as "served by").
   */
  app.get('/api/search', async (req): Promise<SearchResponse> => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const q = String((req.query as { q?: string }).q ?? '').trim();
    if (q.length < 2) return { locations: [], panels: [], breakers: [] };
    const pattern = like(q);
    const access = new AccessData(db);
    const visible = visibleLocations(actor, [...access.nodes.values()], access.grants);

    const locationIds = (
      db.prepare("SELECT id FROM locations WHERE name LIKE ? ESCAPE '\\'").all(pattern) as { id: number }[]
    )
      .map((r) => r.id)
      .filter((id) => visible.get(id)?.access === 'full' && !access.hiddenBuildings.has(id));
    const locations = locationIds.slice(0, LIMIT).map((id) => {
      const l = access.byId.get(id)!;
      return { id, name: l.name, kind: l.kind, path: access.pathLabel(id) };
    });

    const panelsById = new Map(allPanels(db).map((p) => [p.id, p]));
    const panels = [...panelsById.values()]
      .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) && canViewPanel(actor, access, p))
      .slice(0, LIMIT)
      .map((p) => ({ id: p.id, name: p.name, path: access.pathLabel(p.location_id) }));

    // Breakers matching by label or notes, or serving a matching place.
    const byText = db
      .prepare("SELECT * FROM breakers WHERE label LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' LIMIT 200")
      .all(pattern, pattern) as BreakerRow[];
    const byPlace = locationIds.length
      ? (db
          .prepare(
            `SELECT b.*, s.location_id AS served FROM breaker_serves s JOIN breakers b ON b.id = s.breaker_id
             WHERE s.location_id IN (${locationIds.map(() => '?').join(',')}) LIMIT 200`,
          )
          .all(...locationIds) as (BreakerRow & { served: number })[])
      : [];

    const servesOf = (breakerId: number) =>
      (
        db.prepare('SELECT location_id FROM breaker_serves WHERE breaker_id = ?').all(breakerId) as {
          location_id: number;
        }[]
      ).map((r) => r.location_id);
    const breakers: SearchResponse['breakers'] = [];
    const seen = new Set<number>();
    const add = (b: BreakerRow, servedName: string | null) => {
      if (seen.has(b.id) || breakers.length >= BREAKER_LIMIT) return;
      const panel = panelsById.get(b.panel_id) as PanelRow;
      const panelVisible = canViewPanel(actor, access, panel);
      // Otherwise it must serve a place this person can see, or one above it (e.g. the whole site).
      const servesVisible = servesOf(b.id).some((id) => visible.has(id));
      if (!panelVisible && !servesVisible) return;
      seen.add(b.id);
      const node = access.node(panel.location_id);
      breakers.push({
        breakerId: b.id,
        panelId: panel.id,
        panelName: panel.name,
        panelPath: access.pathLabel(panel.location_id),
        canViewPanel: !!node && canView(actor, node, access.grants),
        circuit: circuitLabel(panel, b),
        label: b.label,
        amps: b.amps,
        critical: !!b.critical,
        serves: servedName,
      });
    };
    for (const b of byText) add(b, null);
    for (const b of byPlace) add(b, access.byId.get(b.served)?.name ?? null);

    return { locations, panels, breakers };
  });
}
