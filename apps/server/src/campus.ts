// Campus grids: buildings fed from switching cubes (medium-voltage switchgear) on a site's own
// distribution, usually through a transformer at each building.

import { canView, deviceRating, type CampusBuilding, type CampusFeed } from '@cbt/core';
import type { actorOf } from './context';
import type { DB } from './db';
import {
  allDevices,
  allPanels,
  deviceFeed,
  deviceShape,
  panelFeed,
  upstream,
  type DeviceRow,
  type PanelRow,
  type UpStep,
} from './panels';
import type { AccessData } from './repo';

type Actor = ReturnType<typeof actorOf>;

/** The building a location is in (itself if it is one), or null for a site or company. */
function buildingOf(access: AccessData, locationId: number): number | null {
  let l = access.byId.get(locationId);
  while (l) {
    if (l.kind === 'building') return l.id;
    l = l.parent_id !== null ? access.byId.get(l.parent_id) : undefined;
  }
  return null;
}

const describe = (item: { kind: 'panel'; row: PanelRow } | { kind: 'device'; row: DeviceRow }) => {
  if (item.kind === 'panel') return item.row.name;
  const rating = deviceRating(deviceShape(item.row));
  return rating ? `${item.row.name} (${rating})` : item.row.name;
};

/**
 * Everything below a device, with the item directly under it that each hangs from (and that
 * item's way), down through panels' breakers and further devices.
 */
function below(db: DB, root: DeviceRow) {
  const panelsByBreakerParent = new Map<number, PanelRow[]>();
  const panels = allPanels(db);
  const devices = allDevices(db);
  const breakerPanel = new Map(
    (db.prepare('SELECT id, panel_id FROM breakers').all() as { id: number; panel_id: number }[]).map((b) => [
      b.id,
      b.panel_id,
    ]),
  );
  for (const p of panels) {
    const parent = p.fed_from_breaker_id ? breakerPanel.get(p.fed_from_breaker_id) : undefined;
    if (parent !== undefined) panelsByBreakerParent.set(parent, [...(panelsByBreakerParent.get(parent) ?? []), p]);
  }
  type Item = { kind: 'panel'; row: PanelRow } | { kind: 'device'; row: DeviceRow };
  const out: { item: Item; top: Item }[] = [];
  const seen = new Set<string>();
  const children = (item: Item): Item[] => {
    if (item.kind === 'device') {
      return [
        ...panels.filter((p) => p.fed_from_device_id === item.row.id).map((row): Item => ({ kind: 'panel', row })),
        ...devices.filter((d) => d.fed_from_device_id === item.row.id).map((row): Item => ({ kind: 'device', row })),
      ];
    }
    const panelId = item.row.id;
    return [
      ...(panelsByBreakerParent.get(panelId) ?? []).map((row): Item => ({ kind: 'panel', row })),
      ...devices
        .filter((d) => d.fed_from_breaker_id !== null && breakerPanel.get(d.fed_from_breaker_id) === panelId)
        .map((row): Item => ({ kind: 'device', row })),
    ];
  };
  const visit = (item: Item, top: Item) => {
    const key = `${item.kind}:${item.row.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ item, top });
    for (const c of children(item)) visit(c, top);
  };
  seen.add(`device:${root.id}`);
  for (const c of children({ kind: 'device', row: root })) visit(c, c);
  return out;
}

/** The buildings a switching cube (or other device) feeds, by way, with what each comes in through. */
export function buildingsFed(db: DB, actor: Actor, access: AccessData, device: DeviceRow): CampusBuilding[] {
  const found = new Map<string, CampusBuilding>();
  for (const { item, top } of below(db, device)) {
    const building = buildingOf(access, item.row.location_id);
    if (building === null) continue;
    const node = access.node(building);
    if (!node || !canView(actor, node, access.grants)) continue;
    const way = top.row.fed_way;
    const key = `${building}:${way}`;
    if (found.has(key)) continue;
    found.set(key, {
      locationId: building,
      name: access.byId.get(building)!.name,
      path: access.pathLabel(building),
      way,
      via: describe(top),
    });
  }
  return [...found.values()].sort(
    (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.way.localeCompare(b.way),
  );
}

/**
 * The switching cubes a building (or any place) ties back to: for each panel and device in it,
 * the nearest cube above, the way it comes off, and the first thing below the cube.
 */
export function campusFeed(db: DB, actor: Actor, access: AccessData, locationId: number): CampusFeed {
  const inside = (id: number) => {
    const l = access.byId.get(id);
    return !!l && (l.id === locationId || l.path.includes(`/${locationId}/`));
  };
  const found = new Map<string, CampusFeed['cubes'][number]>();
  const consider = (steps: UpStep[], start: { kind: 'panel'; row: PanelRow } | { kind: 'device'; row: DeviceRow }) => {
    const i = steps.findIndex((s) => s.kind === 'device' && s.device.kind === 'switch');
    if (i < 0) return;
    const cube = (steps[i] as Extract<UpStep, { kind: 'device' }>).device;
    // The item just under the cube.
    const prev = i === 0 ? null : steps[i - 1]!;
    const under = !prev
      ? start
      : prev.kind === 'device'
        ? { kind: 'device' as const, row: prev.device }
        : { kind: 'panel' as const, row: prev.panel };
    const key = `${cube.id}:${under.row.fed_way}`;
    if (found.has(key)) return;
    const node = access.node(cube.location_id);
    found.set(key, {
      id: cube.id,
      name: cube.name,
      path: access.pathLabel(cube.location_id),
      way: under.row.fed_way,
      via: describe(under),
      canView: !!node && canView(actor, node, access.grants),
    });
  };
  for (const p of allPanels(db)) {
    if (inside(p.location_id)) consider(upstream(db, panelFeed(p), { panelId: p.id }), { kind: 'panel', row: p });
  }
  for (const d of allDevices(db)) {
    if (d.kind !== 'switch' && inside(d.location_id)) {
      consider(upstream(db, deviceFeed(d), { deviceId: d.id }), { kind: 'device', row: d });
    }
  }
  return { cubes: [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.way.localeCompare(b.way)) };
}
