import {
  DEVICE_LABELS,
  KIND_LABELS,
  canView,
  circuitLabel,
  effectiveRole,
  pathIds,
  positionsOf,
  visibleLocations,
  deviceRating,
  outputVoltage,
  type Actor,
  type AtsDuty,
  type AtsTransition,
  type Mounting,
  type PanelNameplate,
  type PowerDeviceKind,
  type PowerDeviceShape,
  type Backup,
  type BreakerDto,
  type Device,
  type FeedLink,
  type MainType,
  type PanelDetail,
  type PanelGenerator,
  type RelaySource,
  type PanelLayout,
  type PanelSummary,
  type Protection,
  type Slot,
} from '@cbt/core';
import { capacityWarnings, loadCheck, voltageWarnings } from './capacity';
import type { DB } from './db';
import type { AccessData } from './repo';

export interface PanelRow {
  id: number;
  location_id: number;
  name: string;
  layout: PanelLayout;
  spaces: number;
  main_amps: number | null;
  main_type: MainType;
  voltage: string;
  manufacturer: string;
  model: string;
  notes: string;
  fed_from_breaker_id: number | null;
  public_token: string | null;
  generator_id: number | null;
  transfer_switch: string;
  control_system: string;
  ats_id: number | null;
  fed_from_device_id: number | null;
  aic_ka: number | null;
  bus_amps: number | null;
  mounting: Mounting;
  enclosure: string;
  feeder_wire: string;
  feeder_conduit: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface BreakerRow {
  id: number;
  panel_id: number;
  position: number;
  slot: Slot;
  poles: number;
  amps: number;
  device: Device;
  protection: Protection;
  label: string;
  notes: string;
  is_spare: number;
  critical: number;
  backup: Backup;
  /** Relays: the breaker whose circuit this relay switches. */
  source_breaker_id: number | null;
  control: string;
  load_va: number | null;
  demand_pct: number | null;
}

export interface GeneratorRow {
  id: number;
  location_id: number;
  name: string;
  kw: number | null;
  fuel: PanelGenerator['fuel'];
  voltage: string;
  manufacturer: string;
  model: string;
  notes: string;
  tank_gallons: number | null;
  runtime_hours: number | null;
  created_at: string;
  updated_at: string;
}

export const getGenerator = (db: DB, id: number) =>
  db.prepare('SELECT * FROM generators WHERE id = ?').get(id) as GeneratorRow | undefined;

export interface TransferSwitchRow {
  id: number;
  location_id: number;
  name: string;
  kind: 'automatic' | 'manual';
  duty: AtsDuty;
  transition: AtsTransition;
  priority: number | null;
  amps: number | null;
  generator_id: number | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export const getTransferSwitch = (db: DB, id: number) =>
  db.prepare('SELECT * FROM transfer_switches WHERE id = ?').get(id) as TransferSwitchRow | undefined;

/** A transformer, disconnect, UPS or utility service. */
export interface DeviceRow {
  id: number;
  location_id: number;
  kind: PowerDeviceKind;
  name: string;
  kva: number | null;
  voltage: string;
  secondary_voltage: string;
  amps: number | null;
  fused: number;
  fuse_amps: number | null;
  runtime_minutes: number | null;
  meter: string;
  utility: string;
  manufacturer: string;
  model: string;
  notes: string;
  fed_from_breaker_id: number | null;
  fed_from_device_id: number | null;
  created_at: string;
  updated_at: string;
}

export const getDevice = (db: DB, id: number) =>
  db.prepare('SELECT * FROM power_devices WHERE id = ?').get(id) as DeviceRow | undefined;

export const allDevices = (db: DB) =>
  db.prepare('SELECT * FROM power_devices ORDER BY name COLLATE NOCASE').all() as DeviceRow[];

export const deviceShape = (d: DeviceRow): PowerDeviceShape => ({
  kind: d.kind,
  kva: d.kva,
  voltage: d.voltage,
  secondaryVoltage: d.secondary_voltage,
  amps: d.amps,
  fused: !!d.fused,
  fuseAmps: d.fuse_amps,
  runtimeMinutes: d.runtime_minutes,
  meter: d.meter,
});

/** What feeds a panel or device: a breaker, a device, or nothing. */
export interface FeedRef {
  breakerId: number | null;
  deviceId: number | null;
}
export const panelFeed = (p: PanelRow): FeedRef => ({
  breakerId: p.fed_from_breaker_id,
  deviceId: p.fed_from_device_id,
});
export const deviceFeed = (d: DeviceRow): FeedRef => ({
  breakerId: d.fed_from_breaker_id,
  deviceId: d.fed_from_device_id,
});

export type UpStep = { kind: 'breaker'; breaker: BreakerRow; panel: PanelRow } | { kind: 'device'; device: DeviceRow };

/**
 * Everything above a feed, nearest first: each breaker with the panel it sits in, and the
 * transformers, disconnects and UPSs in between. Stops at a loop or the top.
 */
export function upstream(db: DB, feed: FeedRef, start: { panelId?: number; deviceId?: number } = {}): UpStep[] {
  const out: UpStep[] = [];
  const panels = new Set<number>(start.panelId ? [start.panelId] : []);
  const devices = new Set<number>(start.deviceId ? [start.deviceId] : []);
  let next: FeedRef = feed;
  while (out.length < MAX_CHAIN) {
    if (next.breakerId) {
      const breaker = getBreaker(db, next.breakerId);
      const panel = breaker ? getPanel(db, breaker.panel_id) : undefined;
      if (!breaker || !panel || panels.has(panel.id)) break;
      panels.add(panel.id);
      out.push({ kind: 'breaker', breaker, panel });
      next = panelFeed(panel);
    } else if (next.deviceId) {
      const device = getDevice(db, next.deviceId);
      if (!device || devices.has(device.id)) break;
      devices.add(device.id);
      out.push({ kind: 'device', device });
      next = deviceFeed(device);
    } else break;
  }
  return out;
}

/** True when the feed comes from (or through) the given panel or device: feeding it would loop. */
export function feedReaches(db: DB, feed: FeedRef, target: { panelId?: number; deviceId?: number }): boolean {
  if (target.deviceId && feed.deviceId === target.deviceId) return true;
  return upstream(db, feed).some((s) =>
    s.kind === 'breaker' ? s.panel.id === target.panelId : s.device.id === target.deviceId,
  );
}

export interface ServesRow {
  breaker_id: number;
  location_id: number;
  note: string;
}

export const getPanel = (db: DB, id: number) =>
  db.prepare('SELECT * FROM panels WHERE id = ?').get(id) as PanelRow | undefined;

export const getBreaker = (db: DB, id: number) =>
  db.prepare('SELECT * FROM breakers WHERE id = ?').get(id) as BreakerRow | undefined;

export const breakersOf = (db: DB, panelId: number) =>
  db.prepare('SELECT * FROM breakers WHERE panel_id = ? ORDER BY position, slot').all(panelId) as BreakerRow[];

export function servesOf(db: DB, breakerIds: number[]): ServesRow[] {
  if (breakerIds.length === 0) return [];
  return db
    .prepare(`SELECT * FROM breaker_serves WHERE breaker_id IN (${breakerIds.map(() => '?').join(',')})`)
    .all(...breakerIds) as ServesRow[];
}

export interface TagRow {
  breaker_id: number;
  tag: string;
}

export function tagsOf(db: DB, breakerIds: number[]): TagRow[] {
  if (breakerIds.length === 0) return [];
  return db
    .prepare(
      `SELECT * FROM breaker_tags WHERE breaker_id IN (${breakerIds.map(() => '?').join(',')}) ORDER BY tag COLLATE NOCASE`,
    )
    .all(...breakerIds) as TagRow[];
}

/** Trimmed, without case-insensitive duplicates, in the order given. */
export function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>();
  return tags
    .map((t) => t.trim().replace(/\s+/g, ' '))
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
}

export function setTags(db: DB, breakerId: number, tags: string[]): void {
  db.prepare('DELETE FROM breaker_tags WHERE breaker_id = ?').run(breakerId);
  const insert = db.prepare('INSERT INTO breaker_tags (breaker_id, tag) VALUES (?, ?)');
  for (const t of cleanTags(tags)) insert.run(breakerId, t);
}

const MAX_CHAIN = 50;

export const allPanels = (db: DB) =>
  db.prepare('SELECT * FROM panels ORDER BY name COLLATE NOCASE').all() as PanelRow[];

export function canViewPanel(actor: Actor, access: AccessData, panel: PanelRow): boolean {
  const node = access.node(panel.location_id);
  return !!node && canView(actor, node, access.grants);
}

/** The site a location belongs to (the location itself when it is a site). */
export function siteOf(access: AccessData, locationId: number): number | null {
  const l = access.byId.get(locationId);
  if (!l) return null;
  for (const id of pathIds(l.path)) if (access.byId.get(id)?.kind === 'site') return id;
  return null;
}

/** Feed-chain links for the steps above a panel or device, as the viewer may see them. */
export function chainLinks(actor: Actor, access: AccessData, steps: UpStep[]): FeedLink[] {
  return steps.map((s): FeedLink => {
    if (s.kind === 'device') {
      const node = access.node(s.device.location_id);
      return {
        kind: 'device',
        deviceId: s.device.id,
        deviceKind: s.device.kind,
        name: s.device.name,
        rating: deviceRating(deviceShape(s.device)),
        voltage: outputVoltage({
          kind: s.device.kind,
          voltage: s.device.voltage,
          secondaryVoltage: s.device.secondary_voltage,
        }),
        locationPath: access.pathLabel(s.device.location_id),
        canView: !!node && canView(actor, node, access.grants),
      };
    }
    return {
      kind: 'panel',
      panelId: s.panel.id,
      panelName: s.panel.name,
      locationPath: access.pathLabel(s.panel.location_id),
      breakerId: s.breaker.id,
      circuit: circuitLabel(s.panel, s.breaker),
      label: s.breaker.label,
      amps: s.breaker.amps,
      canView: canViewPanel(actor, access, s.panel),
      voltage: s.panel.voltage,
    };
  });
}

/**
 * The chain of feeders above a panel, nearest first. Everyone who can see the panel sees
 * this summary, even for upstream panels they cannot open.
 */
export function feedChain(db: DB, actor: Actor, access: AccessData, panel: PanelRow): FeedLink[] {
  return chainLinks(actor, access, upstream(db, panelFeed(panel), { panelId: panel.id }));
}

/**
 * The generator backing a panel: the one set on it, or else on the nearest panel up its feed
 * chain (a panel fed from an emergency panel is on that panel's generator too).
 */
export function generatorFor(
  db: DB,
  panel: PanelRow,
): { generator: GeneratorRow; transferSwitch: string; ats: TransferSwitchRow | null; via: PanelRow | null } | null {
  // This panel, then each panel above it (through any transformers or disconnects).
  const chain = [
    panel,
    ...upstream(db, panelFeed(panel), { panelId: panel.id }).flatMap((s) => (s.kind === 'breaker' ? [s.panel] : [])),
  ];
  for (const current of chain) {
    const via = current.id === panel.id ? null : current;
    // On a transfer switch: its generator. Otherwise a generator linked to the panel directly.
    const ats = current.ats_id ? getTransferSwitch(db, current.ats_id) : undefined;
    if (ats?.generator_id) {
      const generator = getGenerator(db, ats.generator_id);
      if (generator) return { generator, transferSwitch: ats.name, ats, via };
    }
    if (current.generator_id) {
      const generator = getGenerator(db, current.generator_id);
      if (generator) return { generator, transferSwitch: current.transfer_switch, ats: null, via };
    }
  }
  return null;
}

/** True when `candidatePanelId` is `panelId` itself or anywhere downstream of it. */
export function isDownstream(db: DB, panelId: number, candidatePanelId: number): boolean {
  if (panelId === candidatePanelId) return true;
  const candidate = getPanel(db, candidatePanelId);
  return !!candidate && feedReaches(db, panelFeed(candidate), { panelId });
}

export function panelSummary(db: DB, actor: Actor, access: AccessData, panel: PanelRow): PanelSummary {
  const breakers = breakersOf(db, panel.id);
  const used = new Set<number>();
  for (const b of breakers) for (const p of positionsOf(panel, b)) used.add(p);
  const feeder = panel.fed_from_breaker_id ? getBreaker(db, panel.fed_from_breaker_id) : undefined;
  const feederPanel = feeder ? getPanel(db, feeder.panel_id) : undefined;
  const feederDevice = panel.fed_from_device_id ? getDevice(db, panel.fed_from_device_id) : undefined;
  return {
    id: panel.id,
    locationId: panel.location_id,
    name: panel.name,
    layout: panel.layout,
    spaces: panel.spaces,
    mainAmps: panel.main_amps,
    mainType: panel.main_type,
    voltage: panel.voltage,
    usedSpaces: used.size,
    breakerCount: breakers.length,
    criticalCount: breakers.filter((b) => b.critical).length,
    fedFrom:
      feeder && feederPanel
        ? `${feederPanel.name} · ${circuitLabel(feederPanel, feeder)}`
        : (feederDevice?.name ?? null),
    generatorName: generatorFor(db, panel)?.generator.name ?? null,
    controlSystem: panel.control_system,
    role: effectiveRole(actor, access.node(panel.location_id)!, access.grants)!,
  };
}

export function panelDetail(db: DB, actor: Actor, access: AccessData, panel: PanelRow): PanelDetail {
  const breakers = breakersOf(db, panel.id);
  const serves = servesOf(
    db,
    breakers.map((b) => b.id),
  );
  const tags = tagsOf(
    db,
    breakers.map((b) => b.id),
  );
  const visible = visibleLocations(actor, [...access.nodes.values()], access.grants);
  const fedPanels = db
    .prepare(`SELECT p.* FROM panels p JOIN breakers b ON b.id = p.fed_from_breaker_id WHERE b.panel_id = ?`)
    .all(panel.id) as PanelRow[];
  const role = effectiveRole(actor, access.node(panel.location_id)!, access.grants)!;
  const fedDevices = db
    .prepare(
      `SELECT d.* FROM power_devices d JOIN breakers b ON b.id = d.fed_from_breaker_id
        WHERE b.panel_id = ? ORDER BY d.name COLLATE NOCASE`,
    )
    .all(panel.id) as DeviceRow[];

  // Relays in other panels that switch these breakers' circuits.
  const ids = breakers.map((b) => b.id);
  const relays = ids.length
    ? (db
        .prepare(
          `SELECT r.*, p.name AS relay_panel_name, p.layout AS relay_panel_layout, p.spaces AS relay_panel_spaces,
                  p.location_id AS relay_panel_location
             FROM breakers r JOIN panels p ON p.id = r.panel_id
            WHERE r.source_breaker_id IN (${ids.map(() => '?').join(',')})
            ORDER BY p.name COLLATE NOCASE, r.position`,
        )
        .all(...ids) as (BreakerRow & {
        relay_panel_name: string;
        relay_panel_layout: PanelLayout;
        relay_panel_spaces: number;
        relay_panel_location: number;
      })[])
    : [];
  const canSeeLocation = (locationId: number) => {
    const node = access.node(locationId);
    return !!node && canView(actor, node, access.grants);
  };
  // The breakers feeding this panel's relays, with their panels.
  const sourceOf = (b: BreakerRow): RelaySource | null => {
    const src = b.source_breaker_id ? getBreaker(db, b.source_breaker_id) : undefined;
    const srcPanel = src ? getPanel(db, src.panel_id) : undefined;
    if (!src || !srcPanel) return null;
    return {
      breakerId: src.id,
      panelId: srcPanel.id,
      panelName: srcPanel.name,
      circuit: circuitLabel(srcPanel, src),
      label: src.label,
      amps: src.amps,
      canView: canViewPanel(actor, access, srcPanel),
    };
  };

  const dto = (b: BreakerRow): BreakerDto => {
    const feeds = fedPanels.filter((p) => p.fed_from_breaker_id === b.id);
    const shown = feeds.filter((p) => canViewPanel(actor, access, p));
    const switching = relays.filter((r) => r.source_breaker_id === b.id);
    const switchingShown = switching.filter((r) => canSeeLocation(r.relay_panel_location));
    return {
      id: b.id,
      position: b.position,
      slot: b.slot,
      poles: b.poles,
      amps: b.amps,
      device: b.device,
      protection: b.protection,
      label: b.label,
      notes: b.notes,
      isSpare: !!b.is_spare,
      critical: !!b.critical,
      backup: b.backup,
      serves: serves
        .filter((s) => s.breaker_id === b.id)
        .map((s) => {
          const l = access.byId.get(s.location_id);
          const seen = l && visible.has(l.id);
          return {
            locationId: s.location_id,
            note: seen ? s.note : '',
            name: seen ? l!.name : null,
            kind: seen ? l!.kind : null,
            path: seen ? access.pathLabel(l!.id) : null,
          };
        }),
      tags: tags.filter((t) => t.breaker_id === b.id).map((t) => t.tag),
      feeds: shown.map((p) => ({ panelId: p.id, panelName: p.name })),
      feedsDevices: fedDevices
        .filter((d) => d.fed_from_breaker_id === b.id && canSeeLocation(d.location_id))
        .map((d) => ({ deviceId: d.id, name: d.name, kind: d.kind })),
      hiddenFeeds:
        feeds.length -
        shown.length +
        fedDevices.filter((d) => d.fed_from_breaker_id === b.id && !canSeeLocation(d.location_id)).length,
      sourceBreakerId: b.source_breaker_id,
      source: sourceOf(b),
      control: b.control,
      switchedBy: switchingShown.map((r) => ({
        panelId: r.panel_id,
        panelName: r.relay_panel_name,
        relay: circuitLabel({ layout: r.relay_panel_layout, spaces: r.relay_panel_spaces }, r),
        label: r.label,
        control: r.control,
      })),
      hiddenSwitchedBy: switching.length - switchingShown.length,
      loadVa: b.load_va,
      demandPct: b.demand_pct,
    };
  };
  const check = loadCheck(db, panel);
  const backing = generatorFor(db, panel);
  const generator: PanelGenerator | null = backing
    ? {
        id: backing.generator.id,
        name: backing.generator.name,
        kw: backing.generator.kw,
        fuel: backing.generator.fuel,
        transferSwitch: backing.transferSwitch,
        ats: backing.ats
          ? { id: backing.ats.id, name: backing.ats.name, kind: backing.ats.kind, duty: backing.ats.duty }
          : null,
        via: backing.via ? { panelId: backing.via.id, panelName: backing.via.name } : null,
        canView: canSeeLocation(backing.generator.location_id),
      }
    : null;

  return {
    id: panel.id,
    locationId: panel.location_id,
    locationPath: access.pathLabel(panel.location_id),
    name: panel.name,
    layout: panel.layout,
    spaces: panel.spaces,
    mainAmps: panel.main_amps,
    mainType: panel.main_type,
    voltage: panel.voltage,
    manufacturer: panel.manufacturer,
    model: panel.model,
    notes: panel.notes,
    version: panel.version,
    updatedAt: panel.updated_at,
    role,
    canEdit: role === 'admin' || role === 'editor' || role === 'manager',
    breakers: breakers.map(dto),
    feedChain: feedChain(db, actor, access, panel),
    fedFromBreakerId: panel.fed_from_breaker_id,
    fedFromDeviceId: panel.fed_from_device_id,
    nameplate: nameplateOf(panel),
    loadCheck: check,
    warnings: [...voltageWarnings(db, panel, breakers), ...capacityWarnings(check)],
    publicPath: panel.public_token ? `/p/${panel.public_token}` : null,
    canShare: role === 'admin' || role === 'manager',
    generatorId: panel.generator_id,
    transferSwitch: panel.transfer_switch,
    controlSystem: panel.control_system,
    atsId: panel.ats_id,
    generator,
  };
}

export const nameplateOf = (p: PanelRow): PanelNameplate => ({
  aicKa: p.aic_ka ?? null,
  busAmps: p.bus_amps ?? null,
  mounting: p.mounting ?? '',
  enclosure: p.enclosure ?? '',
  feederWire: p.feeder_wire ?? '',
  feederConduit: p.feeder_conduit ?? '',
});

/** A plain snapshot used for change detection and history. */
export function snapshot(panel: PanelRow, breakers: BreakerRow[], serves: ServesRow[], tags: TagRow[] = []) {
  return {
    name: panel.name,
    spaces: panel.spaces,
    mainAmps: panel.main_amps,
    mainType: panel.main_type,
    voltage: panel.voltage,
    manufacturer: panel.manufacturer,
    model: panel.model,
    notes: panel.notes,
    fedFromBreakerId: panel.fed_from_breaker_id,
    generatorId: panel.generator_id ?? null,
    transferSwitch: panel.transfer_switch ?? '',
    controlSystem: panel.control_system ?? '',
    atsId: panel.ats_id ?? null,
    fedFromDeviceId: panel.fed_from_device_id ?? null,
    ...nameplateOf(panel),
    breakers: breakers
      .map((b) => ({
        id: b.id,
        position: b.position,
        slot: b.slot,
        poles: b.poles,
        amps: b.amps,
        device: b.device as Device | undefined,
        protection: b.protection,
        label: b.label,
        notes: b.notes,
        isSpare: !!b.is_spare,
        critical: !!b.critical,
        backup: b.backup,
        sourceBreakerId: b.source_breaker_id ?? null,
        control: b.control ?? '',
        loadVa: b.load_va ?? null,
        demandPct: b.demand_pct ?? null,
        serves: serves
          .filter((s) => s.breaker_id === b.id)
          .map((s) => `${s.location_id}:${s.note}`)
          .sort(),
        tags: tags
          .filter((t) => t.breaker_id === b.id)
          .map((t) => t.tag)
          .sort((x, y) => x.localeCompare(y)),
      }))
      .sort((a, b) => a.id - b.id),
  };
}

export type Snapshot = ReturnType<typeof snapshot>;

const PANEL_FIELDS: [keyof Snapshot, string][] = [
  ['name', 'name'],
  ['spaces', 'spaces'],
  ['mainAmps', 'main breaker'],
  ['mainType', 'main type'],
  ['voltage', 'voltage'],
  ['manufacturer', 'manufacturer'],
  ['model', 'model'],
  ['notes', 'notes'],
  ['fedFromBreakerId', 'fed from'],
  ['generatorId', 'generator'],
  ['transferSwitch', 'transfer switch'],
  ['controlSystem', 'control system'],
  ['atsId', 'transfer switch'],
  ['fedFromDeviceId', 'fed from'],
  ['aicKa', 'AIC rating (kA)'],
  ['busAmps', 'bus rating'],
  ['mounting', 'mounting'],
  ['enclosure', 'enclosure'],
  ['feederWire', 'feeder wire'],
  ['feederConduit', 'feeder conduit'],
];

const BREAKER_FIELDS = [
  ['position', 'moved'],
  ['slot', 'slot'],
  ['poles', 'poles'],
  ['amps', 'amps'],
  ['device', 'type'],
  ['protection', 'protection'],
  ['label', 'label'],
  ['notes', 'notes'],
  ['isSpare', 'spare'],
  ['critical', 'critical'],
  ['backup', 'backup power'],
  ['serves', 'serves'],
  ['tags', 'tags'],
  ['sourceBreakerId', 'fed by'],
  ['control', 'control'],
  ['loadVa', 'load (VA)'],
  ['demandPct', 'demand %'],
] as const;

/** Human-readable lines describing what changed between two snapshots. */
export function describeChanges(
  layout: { layout: PanelLayout; spaces: number },
  before: Snapshot,
  after: Snapshot,
  locationName: (id: number) => string,
): string[] {
  const lines: string[] = [];
  const shown = (v: unknown) => (v === null || v === undefined || v === '' ? 'none' : String(v));
  for (const [k, label] of PANEL_FIELDS) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      lines.push(
        k === 'notes' || k === 'fedFromBreakerId' || k === 'fedFromDeviceId' || k === 'generatorId' || k === 'atsId'
          ? `Panel ${label} changed`
          : `Panel ${label}: ${shown(before[k])} → ${shown(after[k])}`,
      );
    }
  }
  const name = (b: Snapshot['breakers'][number]) => `${circuitLabel(layout, b)} ${b.label || 'unlabelled'}`.trim();
  const beforeById = new Map(before.breakers.map((b) => [b.id, b]));
  const afterById = new Map(after.breakers.map((b) => [b.id, b]));
  for (const b of after.breakers) {
    const old = beforeById.get(b.id);
    if (!old) {
      const what = b.device === 'surge' ? (b.amps ? `surge protector, ${b.amps}A` : 'surge protector') : `${b.amps}A`;
      lines.push(`Added ${name(b)} (${what})`);
      continue;
    }
    const changes: string[] = [];
    // History saved before surge protectors existed has no device: those were all breakers.
    const value = (x: Snapshot['breakers'][number], k: (typeof BREAKER_FIELDS)[number][0]) =>
      k === 'device' ? DEVICE_LABELS[x.device ?? 'breaker'].toLowerCase() : x[k];
    for (const [k, label] of BREAKER_FIELDS) {
      if (JSON.stringify(value(old, k)) === JSON.stringify(value(b, k))) continue;
      if (k === 'position') changes.push(`moved from ${circuitLabel(layout, old)}`);
      else if (k === 'serves') {
        const names = (list: string[]) => list.map((s) => locationName(Number(s.split(':')[0])));
        changes.push(
          `serves ${names(old.serves).join(', ') || 'nothing'} → ${names(b.serves).join(', ') || 'nothing'}`,
        );
      } else if (k === 'notes') changes.push('notes changed');
      else if (k === 'sourceBreakerId') changes.push('feeding circuit changed');
      else if (k === 'tags') {
        const list = (t: string[] | undefined) => (t?.length ? t.join(', ') : 'none');
        changes.push(`tags ${list(old.tags)} → ${list(b.tags)}`);
      } else changes.push(`${label} ${String(value(old, k))} → ${String(value(b, k))}`);
    }
    if (changes.length) lines.push(`${name(b)}: ${changes.join('; ')}`);
  }
  for (const b of before.breakers) if (!afterById.has(b.id)) lines.push(`Removed ${name(b)}`);
  return lines;
}

export function locationName(access: AccessData, id: number): string {
  const l = access.byId.get(id);
  return l ? `${l.name}${l.kind === 'room' ? '' : ` (${KIND_LABELS[l.kind].toLowerCase()})`}` : 'a deleted location';
}
