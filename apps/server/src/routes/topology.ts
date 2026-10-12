// Power flow for a location: where power comes from (the utility, generators through transfer
// switches) and how it reaches each panel, sub-panel and relay panel. Panels inside the location
// are shown with everything upstream of them, so the path back to the service is complete.

import {
  canView,
  circuitLabel,
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
  allPanels,
  breakersOf,
  canViewPanel,
  generatorFor,
  getBreaker,
  getGenerator,
  getTransferSwitch,
  type BreakerRow,
  type GeneratorRow,
  type PanelRow,
  type TransferSwitchRow,
} from '../panels';
import { AccessData } from '../repo';

const MAX_UPSTREAM = 50;

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
          detail: seen ? [ATS_KIND_LABELS[t.kind], t.amps ? `${t.amps} A` : ''].filter(Boolean).join(' · ') : '',
          href: seen && t.generator_id ? `/generators/${t.generator_id}` : null,
          locationPath: seen ? access.pathLabel(t.location_id) : '',
          onGenerator: !!t.generator_id,
          critical: 0,
          inScope: inside(t.location_id),
        });
        const g = t.generator_id ? getGenerator(db, t.generator_id) : undefined;
        if (g) addEdge({ from: generatorNode(g), to: key, kind: 'emergency', label: 'Emergency' });
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

    /** A panel and everything above it, with the edges that bring power to it. */
    const visit = (start: PanelRow) => {
      let p: PanelRow | undefined = start;
      for (let steps = 0; p && steps < MAX_UPSTREAM; steps++) {
        const key = panelNode(p);
        const done = edges.some((e) => e.to === key || (p!.ats_id && e.to === `a${p!.ats_id}`));
        const feeder: BreakerRow | undefined = p.fed_from_breaker_id
          ? getBreaker(db, p.fed_from_breaker_id)
          : undefined;
        const feederPanel: PanelRow | undefined = feeder ? panels.get(feeder.panel_id) : undefined;
        const source = feeder && feederPanel ? panelNode(feederPanel) : null;
        const ats = p.ats_id ? getTransferSwitch(db, p.ats_id) : undefined;
        if (ats) {
          const a = atsNode(ats);
          addEdge({ from: a, to: key, kind: 'load', label: '' });
          addEdge({
            from: source ?? utility(),
            to: a,
            kind: 'normal',
            label: feeder && feederPanel ? feederLabel(feeder, feederPanel) : 'Normal',
          });
        } else if (source) {
          addEdge({ from: source, to: key, kind: 'feed', label: feederLabel(feeder!, feederPanel!) });
        } else if (!isRelayPanel(p)) {
          addEdge({ from: utility(), to: key, kind: 'feed', label: p.main_type === 'lugs' ? 'Feed not set' : '' });
        }
        if (p.generator_id) {
          const g = getGenerator(db, p.generator_id);
          if (g) addEdge({ from: generatorNode(g), to: key, kind: 'backup', label: p.transfer_switch || 'Backup' });
        }
        if (done) break;
        p = feederPanel;
      }
    };

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

    const l = access.byId.get(id)!;
    return { location: { id, name: l.name, path: access.pathLabel(id) }, nodes: [...nodes.values()], edges };
  });
}
