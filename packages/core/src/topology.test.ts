import { describe, expect, it } from 'vitest';
import type { TopologyEdge, TopologyNode } from './api';
import { layersOf, layoutTopology, NODE_WIDTH, powerPath } from './topology';

const node = (id: string): TopologyNode => ({
  id,
  kind: 'panel',
  name: id,
  detail: '',
  href: null,
  locationPath: '',
  onGenerator: false,
  critical: 0,
  inScope: true,
});
const edge = (from: string, to: string, kind: TopologyEdge['kind'] = 'feed'): TopologyEdge => ({
  from,
  to,
  kind,
  label: '',
});

// u → MDP → (HA, LP) ; HA → ATS? no: u → ATS ← GEN, ATS → EM ; LP → RP (relay)
const nodes = ['u', 'mdp', 'ha', 'lp', 'ats', 'gen', 'em', 'rp', 'gen2', 'sub'].map(node);
const edges = [
  edge('u', 'mdp'),
  edge('mdp', 'ha'),
  edge('mdp', 'lp'),
  edge('mdp', 'ats', 'normal'),
  edge('gen', 'ats', 'emergency'),
  edge('ats', 'em', 'load'),
  edge('lp', 'rp', 'relay'),
  edge('ha', 'sub'),
  edge('gen2', 'sub', 'backup'),
];

describe('power-flow layout', () => {
  it('puts each node a layer below what feeds it, and sources just above what they feed', () => {
    const layer = layersOf(nodes, edges);
    expect(Object.fromEntries(layer)).toEqual({
      u: 0,
      mdp: 1,
      ha: 2,
      lp: 2,
      ats: 2,
      gen: 1,
      em: 3,
      rp: 3,
      sub: 3,
      gen2: 2,
    });
  });

  it('never overlaps nodes in a layer, and keeps everything on the canvas', () => {
    const { nodes: placed, width, height, edges: placedEdges } = layoutTopology(nodes, edges);
    const byLayer = new Map<number, number[]>();
    for (const p of placed.values()) byLayer.set(p.layer, [...(byLayer.get(p.layer) ?? []), p.x]);
    for (const xs of byLayer.values()) {
      xs.sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(NODE_WIDTH);
    }
    expect(Math.min(...[...placed.values()].map((p) => p.x))).toBe(0);
    expect(width).toBeGreaterThanOrEqual(NODE_WIDTH * 4);
    expect(height).toBeGreaterThan(0);
    expect(placedEdges).toHaveLength(edges.length);
    expect(placedEdges[0]!.path).toMatch(/^M [\d.-]+ [\d.-]+ C /);
  });

  it('survives a loop in the data and an empty graph', () => {
    expect(layoutTopology([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')]).nodes.size).toBe(2);
    expect(layoutTopology([], [])).toMatchObject({ width: 0, height: 0 });
  });

  it('finds everything upstream and downstream of a node', () => {
    expect([...powerPath('ats', edges)].sort()).toEqual(['ats', 'em', 'gen', 'mdp', 'u']);
    expect([...powerPath('lp', edges)].sort()).toEqual(['lp', 'mdp', 'rp', 'u']);
  });
});
