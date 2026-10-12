import { canView, circuitLabel, visibleLocations, type SearchResponse, type TagCount } from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import { actorOf, requireAuth } from '../context';
import type { DB } from '../db';
import { allPanels, canViewPanel, tagsOf, type BreakerRow, type GeneratorRow, type PanelRow } from '../panels';
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
    if (q.length < 2) return { locations: [], panels: [], generators: [], breakers: [] };
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

    const generators = (
      db.prepare("SELECT * FROM generators WHERE name LIKE ? ESCAPE '\\' ORDER BY name").all(pattern) as GeneratorRow[]
    )
      .filter((g) => visible.get(g.location_id)?.access === 'full')
      .slice(0, LIMIT)
      .map((g) => ({ id: g.id, name: g.name, path: access.pathLabel(g.location_id) }));

    // Breakers matching by tag, label or notes, or serving a matching place. Tags come first:
    // searching "servers" should list every breaker tagged Servers.
    const byTag = db
      .prepare(
        `SELECT b.* FROM breaker_tags t JOIN breakers b ON b.id = t.breaker_id
         WHERE t.tag LIKE ? ESCAPE '\\' ORDER BY b.panel_id, b.position LIMIT 200`,
      )
      .all(`${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) as BreakerRow[];
    const byText = db
      .prepare(
        "SELECT * FROM breakers WHERE label LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\' OR control LIKE ? ESCAPE '\\' LIMIT 200",
      )
      .all(pattern, pattern, pattern) as BreakerRow[];
    const byPlace = locationIds.length
      ? (db
          .prepare(
            `SELECT b.*, s.location_id AS served FROM breaker_serves s JOIN breakers b ON b.id = s.breaker_id
             WHERE s.location_id IN (${locationIds.map(() => '?').join(',')}) LIMIT 200`,
          )
          .all(...locationIds) as (BreakerRow & { served: number })[])
      : [];

    const servesStmt = db.prepare('SELECT location_id FROM breaker_serves WHERE breaker_id = ?');
    const servesOf = (breakerId: number) =>
      (servesStmt.all(breakerId) as { location_id: number }[]).map((r) => r.location_id);
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
        tags: tagsOf(db, [b.id]).map((t) => t.tag),
      });
    };
    for (const b of byTag) add(b, null);
    for (const b of byText) add(b, null);
    for (const b of byPlace) add(b, access.byId.get(b.served)?.name ?? null);

    return { locations, panels, generators, breakers };
  });

  /** Tags on breakers the person can see, most used first, for suggestions and filters. */
  app.get('/api/tags', async (req): Promise<TagCount[]> => {
    const auth = requireAuth(req);
    const actor = actorOf(auth);
    const access = new AccessData(db);
    const visiblePanels = new Set(
      allPanels(db)
        .filter((p) => canViewPanel(actor, access, p))
        .map((p) => p.id),
    );
    const rows = db
      .prepare('SELECT b.panel_id, t.tag FROM breaker_tags t JOIN breakers b ON b.id = t.breaker_id')
      .all() as { panel_id: number; tag: string }[];
    const counts = new Map<string, TagCount>();
    for (const r of rows) {
      if (!visiblePanels.has(r.panel_id)) continue;
      const key = r.tag.toLowerCase();
      const c = counts.get(key) ?? { tag: r.tag, count: 0 };
      c.count++;
      counts.set(key, c);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  });
}
