import type { LocationDto } from '@cbt/core';

export interface TreeNode extends LocationDto {
  children: TreeNode[];
  depth: number;
}

/**
 * Build the visible tree. A site with a single automatic building shows that building's
 * floors directly, so homes read Site → Floor → Room.
 */
export function buildTree(list: LocationDto[]): { roots: TreeNode[]; byId: Map<number, TreeNode> } {
  const byId = new Map<number, TreeNode>(list.map((l) => [l.id, { ...l, children: [], depth: 0 }]));
  const roots: TreeNode[] = [];
  for (const n of byId.values()) {
    const p = n.parentId !== null ? byId.get(n.parentId) : undefined;
    if (p) p.children.push(n);
    else roots.push(n);
  }
  const sort = (a: TreeNode, b: TreeNode) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  const walk = (nodes: TreeNode[], depth: number) => {
    nodes.sort(sort);
    for (const n of nodes) {
      n.depth = depth;
      walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return { roots, byId };
}

/** The single automatic building of a site, when the building level is hidden. */
export function hiddenBuilding(site: TreeNode): TreeNode | null {
  if (site.kind !== 'site') return null;
  const buildings = site.children.filter((c) => c.kind === 'building');
  return buildings.length === 1 && buildings[0]!.isDefaultBuilding ? buildings[0]! : null;
}

/** Children as shown in the UI (skipping a hidden building). */
export function shownChildren(node: TreeNode): TreeNode[] {
  const hb = hiddenBuilding(node);
  return hb ? hb.children : node.children;
}

/** Flatten for a sidebar, depth adjusted for hidden buildings. */
export function flatten(roots: TreeNode[]): (TreeNode & { indent: number })[] {
  const out: (TreeNode & { indent: number })[] = [];
  const walk = (nodes: TreeNode[], indent: number) => {
    for (const n of nodes) {
      out.push({ ...n, indent });
      walk(shownChildren(n), indent + 1);
    }
  };
  walk(roots, 0);
  return out;
}

export function ancestry(byId: Map<number, TreeNode>, id: number): TreeNode[] {
  const chain: TreeNode[] = [];
  let n = byId.get(id);
  while (n) {
    if (!(n.kind === 'building' && n.isDefaultBuilding && n.parentId && hiddenBuilding(byId.get(n.parentId)!) === n)) {
      chain.unshift(n);
    }
    n = n.parentId !== null ? byId.get(n.parentId) : undefined;
  }
  return chain;
}
