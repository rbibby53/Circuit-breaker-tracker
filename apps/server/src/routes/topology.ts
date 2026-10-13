// Power flow for a location: where power comes from (the utility, generators through transfer
// switches) and how it reaches each transformer, panel, sub-panel and relay panel. Panels inside the location
// are shown with everything upstream of them, so the path back to the service is complete.

import {
  ATS_DUTY_SHORT,
  canView,
  circuitLabel,
  deviceRating,
  generatorRating,
  isRelayPanel,
  isWithin,
  ATS_KIND_LABELS,
  type Topology,
  type TopologyEdge,
  type TopologyNode,
} from '@cbt/core';
import type { FastifyInstance } from 'fastify';
import { actorOf, requireAuth } from '../context';
import type { DB } from '../db';
import { idParam, notFound } from '../errors';
import {
  allDevices,
  allPanels,
  breakersOf,
  canViewPanel,
  deviceFeed,
  deviceShape,
  generatorFor,
  getBreaker,
  getDevice,
  getGenerator,
  getTransferSwitch,
  panelFeed,
  type BreakerRow,
  type DeviceRow,
  type FeedRef,
  type GeneratorRow,
  type PanelRow,
  type TransferSwitchRow,
} from '../panels';
import { AccessData } from '../repo';

export function topologyRoutes(app: FastifyInstance, db: DB): void {
  app.get('/api/locations/:id/topology', async (req): Promise<Topology> => {
    const actor = actorOf(requireAuth(req));
    const access = new AccessData(db);
    const id = idParam((req.params as { id: string }).id);
    const root = access.node(id);
    if (!root || !canView(actor, root, access.grants)) throw notFound();
    const canSeeLocation = (locationId: number) => {
      const node = access.node(locationId);
      return !!node && canView(actor, node, access.grants);
    };
    const inside = (locationId: number) => {
      const node = access.node(locationId);
      return !!node && isWithin(node, id);
    };

    const panels = new Map(allPanels(db).map((p) => [p.id, p]));
    const nodes = new Map<string, TopologyNode>();
    const edges: TopologyEdge[] = [];
    const edgeKeys = new Set<string>();
    const addEdge = (e: TopologyEdge) => {
      const key = `${e.from}>${e.to}:${e.kind}`;
      if (edgeKeys.has(key) || e.from === e.to) return;
      edgeKeys.add(key);
      edges.push(e);
    };

    const panelNode = (p: PanelRow): string => {
      const key = canViewPanel(actor, access, p) ? `p${p.id}` : `h${p.id}`;
      if (nodes.has(key)) return key;
      if (key.startsWith('h')) {
        nodes.set(key, {
          id: key,
          kind: 'hidden',
          name: p.name,
          detail: 'Outside your access',
          href: null,
          locationPath: '',
          onGenerator: !!generatorFor(db, p),
          critical: 0,
          inScope: false,
        });
        return key;
      }
      const breakers = breakersOf(db, p.id);
      const relay = isRelayPanel(p);
      const main = p.main_type === 'lugs' ? 'main lugs' : p.main_amps ? `${p.main_amps} A main` : '';
      nodes.set(key, {
        id: key,
        kind: relay ? 'relay' : 'panel',
        name: p.name,
        detail: relay
          ? [`${p.control_system ? `${p.control_system} ` : ''}relays`, `${breakers.length}/${p.spaces}`].join(' · ')
          : [p.voltage, main].filter(Boolean).join(' · '),
        href: `/panels/${p.id}`,
        locationPath: access.pathLabel(p.location_id),
        onGenerator: !!generatorFor(db, p),
        critical: breakers.filter((b) => b.critical).length,
        inScope: inside(p.location_id),
      });
      return key;
    };

    const generatorNode = (g: GeneratorRow): string => {
      const key = `g${g.id}`;
      if (!nodes.has(key)) {
        const seen = canSeeLocation(g.location_id);
        nodes.set(key, {
          id: key,
          kind: 'generator',
          name: seen ? g.name : 'Generator',
          detail: seen ? [generatorRating(g), g.voltage].filter(Boolean).join(' · ') : 'Outside your access',
          href: seen ? `/generators/${g.id}` : null,
          locationPath: seen ? access.pathLabel(g.location_id) : '',
          onGenerator: true,
          critical: 0,
          inScope: inside(g.location_id),
        });
      }
      return key;
    };

    const atsNode = (t: TransferSwitchRow): string => {
      const key = `a${t.id}`;
      if (!nodes.has(key)) {
        const seen = canSeeLocation(t.location_id);
        nodes.set(key, {
          id: key,
          kind: 'ats',
          name: seen ? t.name : 'Transfer switch',
          detail: seen
            ? [ATS_DUTY_SHORT[t.duty] || ATS_KIND_LABELS[t.kind], t.amps ? `${t.amps} A` : '']
                .filter(Boolean)
                .join(' · ')
            : '',
          href: seen && t.generator_id ? `/generators/${t.generator_id}` : null,
          locationPath: seen ? access.pathLabel(t.location_id) : '',
          onGenerator: !!t.generator_id,
          critical: 0,
          inScope: inside(t.location_id),
        });
        const g = t.generator_id ? getGenerator(db, t.generator_id) : undefined;
        if (g) addEdge({ from: generatorNode(g), to: key, kind: 'emergency', label: '' });
      }
      return key;
    };

    const utility = () => {
      if (!nodes.has('u')) {
        nodes.set('u', {
          id: 'u',
          kind: 'utility',
          name: 'Utility service',
          detail: '',
          href: null,
          locationPath: '',
          onGenerator: false,
          critical: 0,
          inScope: true,
        });
      }
      return 'u';
    };

    const feederLabel = (feeder: BreakerRow, feederPanel: PanelRow) =>
      `${circuitLabel(feederPanel, feeder)}${feeder.amps ? ` · ${feeder.amps} A` : ''}`;

    const deviceNode = (d: DeviceRow): string => {
      const key = `d${d.id}`;
      if (!nodes.has(key)) {
        const seen = canSeeLocation(d.location_id);
        nodes.set(key, {
          id: key,
          kind: d.kind,
          name: d.name,
          detail: deviceRating(deviceShape(d)),
          href: seen ? `/devices/${d.id}` : null,
          locationPath: seen ? access.pathLabel(d.location_id) : '',
          onGenerator: false,
          critical: 0,
          inScope: inside(d.location_id),
        });
      }
      return key;
    };

    // Each panel and device is walked once; marking it first stops any loop in the data.
    const walkedPanels = new Set<number>();
    const walkedDevices = new Set<number>();

    /** The node a feed comes from (walking everything above it), and the label for its line. */
    const sourceOf = (feed: FeedRef, way = ''): { key: string; label: string } | null => {
      if (feed.breakerId) {
        const feeder = getBreaker(db, feed.breakerId);
        const feederPanel = feeder ? panels.get(feeder.panel_id) : undefined;
        if (!feeder || !feederPanel) return null;
        walkPanel(feederPanel);
        return { key: panelNode(feederPanel), label: feederLabel(feeder, feederPanel) };
      }
      if (feed.deviceId) {
        const d = getDevice(db, feed.deviceId);
        if (!d) return null;
        walkDevice(d);
        // A switching cube's way, e.g. "Way 3".
        return { key: deviceNode(d), label: way };
      }
      return null;
    };

    /** A device and everything above it. A utility service is where power comes in. */
    const walkDevice = (d: DeviceRow) => {
      if (walkedDevices.has(d.id)) return;
      walkedDevices.add(d.id);
      const key = deviceNode(d);
      const source = sourceOf(deviceFeed(d), d.fed_way);
      if (source) addEdge({ from: source.key, to: key, kind: 'feed', label: source.label });
    };

    /** A panel and everything above it, with the edges that bring power to it. */
    const walkPanel = (p: PanelRow) => {
      if (walkedPanels.has(p.id)) return;
      walkedPanels.add(p.id);
      const key = panelNode(p);
      const source = sourceOf(panelFeed(p), p.fed_way);
      const ats = p.ats_id ? getTransferSwitch(db, p.ats_id) : undefined;
      if (ats) {
        const a = atsNode(ats);
        addEdge({ from: a, to: key, kind: 'load', label: '' });
        addEdge({ from: source?.key ?? utility(), to: a, kind: 'normal', label: source?.label || 'Normal' });
      } else if (source) {
        addEdge({ from: source.key, to: key, kind: 'feed', label: source.label });
      } else if (!isRelayPanel(p)) {
        addEdge({ from: utility(), to: key, kind: 'feed', label: p.main_type === 'lugs' ? 'Feed not set' : '' });
      }
      if (p.generator_id) {
        const g = getGenerator(db, p.generator_id);
        if (g) addEdge({ from: generatorNode(g), to: key, kind: 'backup', label: p.transfer_switch || 'Backup' });
      }
    };
    const visit = walkPanel;

    const inScope = [...panels.values()].filter((p) => inside(p.location_id) && canViewPanel(actor, access, p));
    for (const p of inScope) visit(p);

    // Relay panels: which breaker panels their relays switch circuits from.
    for (const p of inScope.filter(isRelayPanel)) {
      const counts = new Map<number, number>();
      for (const r of breakersOf(db, p.id)) {
        const src = r.source_breaker_id ? getBreaker(db, r.source_breaker_id) : undefined;
        if (src) counts.set(src.panel_id, (counts.get(src.panel_id) ?? 0) + 1);
      }
      for (const [panelId, n] of counts) {
        const source = panels.get(panelId);
        if (!source) continue;
        if (!nodes.has(`p${panelId}`) && !nodes.has(`h${panelId}`)) visit(source);
        addEdge({ from: panelNode(source), to: `p${p.id}`, kind: 'relay', label: `${n} relay${n === 1 ? '' : 's'}` });
      }
    }

    // Generators and transfer switches here, even with nothing on them yet.
    for (const g of db.prepare('SELECT * FROM generators').all() as GeneratorRow[]) {
      if (inside(g.location_id) && canSeeLocation(g.location_id)) generatorNode(g);
    }
    for (const t of db.prepare('SELECT * FROM transfer_switches').all() as TransferSwitchRow[]) {
      if (inside(t.location_id) && canSeeLocation(t.location_id)) atsNode(t);
    }
    // Transformers, disconnects, UPSs and services here, with what feeds them.
    for (const d of allDevices(db)) {
      if (inside(d.location_id) && canSeeLocation(d.location_id)) walkDevice(d);
    }

    const l = access.byId.get(id)!;
    return { location: { id, name: l.name, path: access.pathLabel(id) }, nodes: [...nodes.values()], edges };
  });
}
