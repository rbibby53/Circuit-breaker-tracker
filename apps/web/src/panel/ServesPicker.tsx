import { KIND_LABELS } from '@cbt/core';
import { useState } from 'react';
import { hiddenBuilding, shownChildren, type TreeNode } from '../tree';
import type { EditServe } from './state';

/**
 * Checkbox list of everything in the panel's site the person can see: the whole site, each
 * building (unless hidden), each floor, each room.
 */
export function ServesPicker({
  site,
  serves,
  onChange,
}: {
  site: TreeNode;
  serves: EditServe[];
  onChange: (next: EditServe[]) => void;
}) {
  const [filter, setFilter] = useState('');
  const chosen = new Set(serves.map((s) => s.locationId));
  const toggle = (id: number) =>
    onChange(chosen.has(id) ? serves.filter((s) => s.locationId !== id) : [...serves, { locationId: id, note: '', hidden: false }]);

  const rows: { node: TreeNode; depth: number }[] = [];
  const walk = (n: TreeNode, depth: number) => {
    if (n.access === 'full') rows.push({ node: n, depth });
    for (const c of shownChildren(n)) walk(c, depth + 1);
  };
  walk(site, 0);
  const q = filter.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.node.name.toLowerCase().includes(q)) : rows;

  return (
    <div className="serves-picker">
      <label className="sr-only" htmlFor="serves-filter">
        Find a room
      </label>
      <input id="serves-filter" placeholder="Find a room…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <ul>
        {shown.map(({ node, depth }) => (
          <li key={node.id} style={{ paddingLeft: q ? 0 : depth * 16 }}>
            <label className="check">
              <input type="checkbox" checked={chosen.has(node.id)} onChange={() => toggle(node.id)} />
              <span className={node.kind === 'room' ? '' : 'strong'}>
                {node.kind === 'room' ? node.name : node.kind === 'site' ? `Whole site (${node.name})` : `Whole ${KIND_LABELS[node.kind].toLowerCase()}: ${node.name}`}
              </span>
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="muted small">No matches.</li>}
      </ul>
      {hiddenBuilding(site) === null && rows.length <= 1 && <p className="muted small">Add floors and rooms to this site to tag them here.</p>}
    </div>
  );
}
