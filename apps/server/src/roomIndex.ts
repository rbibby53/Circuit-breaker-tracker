import {
  KIND_LABELS,
  ampsLabel,
  breakerTags,
  circuitLabel,
  pathIds,
  visibleLocations,
  type Actor,
  type DirectoryTag,
  type LocationKind,
  type PanelLayout,
} from '@cbt/core';
import type { DB } from './db';
import { allPanels, canViewPanel, type BreakerRow, type PanelRow } from './panels';
import type { AccessData, LocationRow } from './repo';

export interface IndexBreaker {
  circuit: string;
  label: string;
  amps: string;
  tags: DirectoryTag[];
  panelName: string;
  /** The short note on the serves link, e.g. "lights". */
  note: string;
}

export interface IndexRoom {
  id: number;
  name: string;
  breakers: IndexBreaker[];
}

export interface IndexSection {
  id: number;
  kind: LocationKind;
  /** Path below the index's root, e.g. "Science Hall › Floor 2"; the root's own name for the root. */
  title: string;
  /** Breakers tagged with this whole site, building or floor. */
  whole: IndexBreaker[];
  rooms: IndexRoom[];
}

export interface RoomIndex {
  rootName: string;
  rootPath: string;
  /** Breakers tagged with something above the root that covers it, such as the whole site. */
  above: { title: string; breakers: IndexBreaker[] }[];
  sections: IndexSection[];
}

type Row = BreakerRow & { target: number; p_name: string; p_layout: PanelLayout; p_spaces: number };

/** Locations inside `root` (and root itself) in display order: parents before children. */
export function treeOrder(access: AccessData, root: LocationRow): LocationRow[] {
  const children = new Map<number, LocationRow[]>();
  for (const l of access.locations) {
    if (l.parent_id === null || !l.path.startsWith(root.path)) continue;
    children.set(l.parent_id, [...(children.get(l.parent_id) ?? []), l]);
  }
  const out: LocationRow[] = [];
  const walk = (l: LocationRow) => {
    out.push(l);
    for (const c of children.get(l.id) ?? []) walk(c);
  };
  walk(root);
  return out;
}

/** Panels inside `root` that the actor can see, in tree order and then by name. */
export function panelsUnder(db: DB, actor: Actor, access: AccessData, root: LocationRow): PanelRow[] {
  const order = new Map(treeOrder(access, root).map((l, i) => [l.id, i]));
  return allPanels(db)
    .filter((p) => order.has(p.location_id) && canViewPanel(actor, access, p))
    .sort((a, b) => order.get(a.location_id)! - order.get(b.location_id)!);
}

/**
 * Which breakers serve each room under a location, grouped by floor. Only locations the actor
 * can fully see are listed; the breakers may sit in panels they cannot open (as on room pages).
 */
export function roomIndex(db: DB, actor: Actor, access: AccessData, rootId: number): RoomIndex {
  const root = access.byId.get(rootId)!;
  const visible = visibleLocations(actor, [...access.nodes.values()], access.grants);
  const full = (id: number) => visible.get(id)?.access === 'full';
  const ancestors = pathIds(root.path).filter((id) => id !== root.id);

  const rows = db
    .prepare(
      `SELECT s.location_id AS target, s.note AS note_link, b.*, p.name AS p_name, p.layout AS p_layout, p.spaces AS p_spaces
       FROM breaker_serves s JOIN breakers b ON b.id = s.breaker_id JOIN panels p ON p.id = b.panel_id
       JOIN locations l ON l.id = s.location_id
       WHERE l.path LIKE ? ${ancestors.length ? `OR s.location_id IN (${ancestors.map(() => '?').join(',')})` : ''}
       ORDER BY p.name COLLATE NOCASE, b.position, b.slot`,
    )
    .all(`${root.path}%`, ...ancestors) as (Row & { note_link: string })[];

  const byTarget = new Map<number, IndexBreaker[]>();
  for (const r of rows) {
    const entry: IndexBreaker = {
      circuit: circuitLabel({ layout: r.p_layout, spaces: r.p_spaces }, r),
      label: r.label,
      amps: ampsLabel(r),
      tags: breakerTags({ protection: r.protection, critical: !!r.critical, backup: r.backup, isSpare: !!r.is_spare }),
      panelName: r.p_name,
      note: r.note_link,
    };
    byTarget.set(r.target, [...(byTarget.get(r.target) ?? []), entry]);
  }

  const above = ancestors
    .filter((id) => byTarget.has(id) && visible.has(id))
    .map((id) => {
      const l = access.byId.get(id)!;
      return { title: `Whole ${KIND_LABELS[l.kind].toLowerCase()}: ${l.name}`, breakers: byTarget.get(id)! };
    });

  const sections: IndexSection[] = [];
  for (const l of treeOrder(access, root)) {
    if (l.kind === 'room' || !full(l.id)) continue;
    const rooms = access.locations
      .filter((r) => r.parent_id === l.id && r.kind === 'room' && full(r.id))
      .map((r) => ({ id: r.id, name: r.name, breakers: byTarget.get(r.id) ?? [] }));
    const whole = byTarget.get(l.id) ?? [];
    if (rooms.length === 0 && whole.length === 0) continue;
    const below = pathIds(l.path).slice(pathIds(root.path).length - 1);
    const title = below
      .filter((id) => id === root.id || !access.hiddenBuildings.has(id))
      .filter((id, i, list) => list.length === 1 || id !== root.id)
      .map((id) => access.byId.get(id)!.name)
      .join(' › ');
    sections.push({ id: l.id, kind: l.kind, title, whole, rooms });
  }

  // A room as the root: list just that room.
  if (root.kind === 'room') {
    sections.push({
      id: root.id,
      kind: 'room',
      title: root.name,
      whole: [],
      rooms: [{ id: root.id, name: root.name, breakers: byTarget.get(root.id) ?? [] }],
    });
  }

  return { rootName: root.name, rootPath: access.pathLabel(root.id), above, sections };
}
