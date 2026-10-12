// Laying out a power-flow graph top to bottom: sources (the utility, generators) at the top, then
// transfer switches, panels and the panels and relay panels they feed. Layers come from the longest
// path from a source, the order within a layer from the average position of neighbours (so lines
// cross as little as practical), and x positions centre each node under what feeds it.

import type { TopologyEdge, TopologyNode } from './api';

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 64;
const GAP_X = 36;
const GAP_Y = 96;
const SWEEPS = 6;

export interface PlacedNode {
  id: string;
  layer: number;
  x: number;
  y: number;
}

export interface PlacedEdge extends TopologyEdge {
  /** SVG path from the bottom of `from` to the top of `to`. */
  path: string;
  labelX: number;
  labelY: number;
}

export interface TopologyLayout {
  width: number;
  height: number;
  nodes: Map<string, PlacedNode>;
  edges: PlacedEdge[];
}

/** Layer of each node: the longest chain of edges from a node with nothing above it. */
export function layersOf(nodes: { id: string }[], edges: TopologyEdge[]): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id));
  const into = new Map<string, string[]>();
  const out = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    into.set(e.to, [...(into.get(e.to) ?? []), e.from]);
    out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  }
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // a loop in the data; break it rather than recurse forever
    visiting.add(id);
    let d = 0;
    for (const from of into.get(id) ?? []) d = Math.max(d, depth(from) + 1);
    visiting.delete(id);
    layer.set(id, d);
    return d;
  };
  for (const n of nodes) depth(n.id);
  // Pull sources down to sit just above what they feed (a generator backing one sub-panel deep in
  // the building appears next to it, not at the top). The utility stays on top.
  for (const n of nodes) {
    if (n.id === 'u' || (into.get(n.id)?.length ?? 0) > 0) continue;
    const below = (out.get(n.id) ?? []).map((t) => layer.get(t)!);
    if (below.length) layer.set(n.id, Math.max(0, Math.min(...below) - 1));
  }
  return layer;
}

export function layoutTopology(nodes: TopologyNode[], edges: TopologyEdge[]): TopologyLayout {
  const layer = layersOf(nodes, edges);
  const ids = new Set(nodes.map((n) => n.id));
  const live = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  for (const e of live) {
    up.set(e.to, [...(up.get(e.to) ?? []), e.from]);
    down.set(e.from, [...(down.get(e.from) ?? []), e.to]);
  }

  const depth = nodes.length ? Math.max(...nodes.map((n) => layer.get(n.id)!)) + 1 : 0;
  const rows: string[][] = Array.from({ length: depth }, () => []);
  for (const n of nodes) rows[layer.get(n.id)!]!.push(n.id);

  // Order within each layer by the average position of neighbours, sweeping down then up.
  const index = new Map<string, number>();
  const reindex = (row: string[]) => row.forEach((id, i) => index.set(id, i / Math.max(1, row.length - 1)));
  rows.forEach(reindex);
  const reorder = (row: string[], neighbours: Map<string, string[]>) => {
    const key = new Map(
      row.map((id) => {
        const ns = (neighbours.get(id) ?? []).filter((n) => index.has(n));
        return [id, ns.length ? ns.reduce((s, n) => s + index.get(n)!, 0) / ns.length : index.get(id)!];
      }),
    );
    row.sort((a, b) => key.get(a)! - key.get(b)!);
    reindex(row);
  };
  for (let i = 0; i < SWEEPS; i++) {
    if (i % 2 === 0) for (let l = 1; l < depth; l++) reorder(rows[l]!, up);
    else for (let l = depth - 2; l >= 0; l--) reorder(rows[l]!, down);
  }

  // x positions: each node under the middle of what it connects to, never overlapping.
  const step = NODE_WIDTH + GAP_X;
  const x = new Map<string, number>();
  rows.forEach((row) => row.forEach((id, i) => x.set(id, i * step)));
  const place = (row: string[], neighbours: Map<string, string[]>) => {
    const want = row.map((id) => {
      const ns = neighbours.get(id) ?? [];
      return ns.length ? ns.reduce((s, n) => s + x.get(n)!, 0) / ns.length : x.get(id)!;
    });
    // Two packings, one pushing right and one pushing left; their average keeps the spacing.
    const right = [...want];
    for (let i = 1; i < row.length; i++) right[i] = Math.max(right[i]!, right[i - 1]! + step);
    const left = [...want];
    for (let i = row.length - 2; i >= 0; i--) left[i] = Math.min(left[i]!, left[i + 1]! - step);
    row.forEach((id, i) => x.set(id, (right[i]! + left[i]!) / 2));
  };
  for (let l = 1; l < depth; l++) place(rows[l]!, up);
  for (let l = depth - 2; l >= 0; l--) place(rows[l]!, down);
  for (let l = 1; l < depth; l++) place(rows[l]!, up);

  const minX = nodes.length ? Math.min(...x.values()) : 0;
  const placed = new Map<string, PlacedNode>();
  for (const n of nodes) {
    const l = layer.get(n.id)!;
    placed.set(n.id, { id: n.id, layer: l, x: x.get(n.id)! - minX, y: l * (NODE_HEIGHT + GAP_Y) });
  }
  const width = nodes.length ? Math.max(...[...placed.values()].map((p) => p.x)) + NODE_WIDTH : 0;
  const height = depth ? depth * (NODE_HEIGHT + GAP_Y) - GAP_Y : 0;

  // Several edges leaving the same node fan out a little along its bottom edge.
  const outgoing = new Map<string, TopologyEdge[]>();
  for (const e of live) outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e]);
  for (const list of outgoing.values()) list.sort((a, b) => placed.get(a.to)!.x - placed.get(b.to)!.x);
  const placedEdges = live.map((e): PlacedEdge => {
    const a = placed.get(e.from)!;
    const b = placed.get(e.to)!;
    const siblings = outgoing.get(e.from)!;
    const spread = Math.min(NODE_WIDTH * 0.6, (siblings.length - 1) * 14);
    const offset = siblings.length > 1 ? -spread / 2 + (spread * siblings.indexOf(e)) / (siblings.length - 1) : 0;
    const x1 = a.x + NODE_WIDTH / 2 + offset;
    const y1 = a.y + NODE_HEIGHT;
    const x2 = b.x + NODE_WIDTH / 2;
    const y2 = b.y;
    const bend = Math.max(40, (y2 - y1) / 2);
    const path = `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`;
    // Labels sit on their own line, most of the way down, where lines into one node have separated.
    const t = 0.66;
    const u = 1 - t;
    const labelX = u * u * u * x1 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x2;
    const labelY = u * u * u * y1 + 3 * u * u * t * (y1 + bend) + 3 * u * t * t * (y2 - bend) + t * t * t * y2;
    return { ...e, path, labelX, labelY: labelY + 4 };
  });

  return { width, height, nodes: placed, edges: placedEdges };
}

/** Everything a node draws power from, and everything it powers, including itself. */
export function powerPath(id: string, edges: TopologyEdge[]): Set<string> {
  const walk = (forward: boolean) => {
    const seen = new Set<string>([id]);
    const queue = [id];
    while (queue.length) {
      const at = queue.pop()!;
      for (const e of edges) {
        const [here, there] = forward ? [e.from, e.to] : [e.to, e.from];
        if (here === at && !seen.has(there)) {
          seen.add(there);
          queue.push(there);
        }
      }
    }
    return seen;
  };
  return new Set([...walk(true), ...walk(false)]);
}
