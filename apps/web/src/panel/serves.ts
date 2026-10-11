import { KIND_LABELS } from '@cbt/core';
import type { TreeNode } from '../tree';
import type { EditServe } from './state';

/** The floor a location sits on, if any. */
export function floorOf(byId: Map<number, TreeNode>, id: number): TreeNode | null {
  let n = byId.get(id);
  while (n) {
    if (n.kind === 'floor') return n;
    n = n.parentId !== null ? byId.get(n.parentId) : undefined;
  }
  return null;
}

export function siteOf(byId: Map<number, TreeNode>, id: number): TreeNode | null {
  let n = byId.get(id);
  while (n) {
    if (n.kind === 'site') return n;
    n = n.parentId !== null ? byId.get(n.parentId) : undefined;
  }
  return null;
}

/** "Kitchen", "Whole floor: Upper", "Whole site". */
export function serveLabel(byId: Map<number, TreeNode>, locationId: number): string {
  const n = byId.get(locationId);
  if (!n) return 'Unknown';
  if (n.kind === 'room') return n.name;
  if (n.kind === 'site') return 'Whole site';
  return `Whole ${KIND_LABELS[n.kind].toLowerCase()}: ${n.name}`;
}

/** One line for the breaker face: rooms on one floor by name, otherwise a count and floors. */
export function servesSummary(byId: Map<number, TreeNode>, serves: EditServe[], isSpare: boolean): string {
  const shown = serves.filter((s) => !s.hidden && byId.has(s.locationId));
  const hidden = serves.length - shown.length;
  if (serves.length === 0) return isSpare ? 'Nothing connected' : 'Not tagged';
  if (shown.length === 0) return `${hidden} place${hidden === 1 ? '' : 's'} outside your access`;
  const floors = new Set(shown.map((s) => floorOf(byId, s.locationId)?.name ?? ''));
  const names = shown.map((s) => serveLabel(byId, s.locationId));
  const extra = hidden ? ` + ${hidden} more` : '';
  if (floors.size <= 1) return names.join(', ') + extra;
  return `${shown.length + hidden} places · ${[...floors].filter(Boolean).join(' & ')}`;
}

/** Group visible serves by floor for chips in the inspector. */
export function servesByFloor(
  byId: Map<number, TreeNode>,
  serves: EditServe[],
): { floor: string; items: { locationId: number; label: string }[] }[] {
  const groups = new Map<string, { locationId: number; label: string }[]>();
  for (const s of serves) {
    if (s.hidden || !byId.has(s.locationId)) continue;
    const n = byId.get(s.locationId)!;
    const floor = n.kind === 'room' ? (floorOf(byId, n.id)?.name ?? '') : '';
    const list = groups.get(floor) ?? [];
    list.push({ locationId: s.locationId, label: serveLabel(byId, s.locationId) });
    groups.set(floor, list);
  }
  return [...groups.entries()].map(([floor, items]) => ({ floor, items }));
}
