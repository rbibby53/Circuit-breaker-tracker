import { KIND_LABELS } from '@cbt/core';
import { useState, type ReactElement } from 'react';
import { shownChildren, type TreeNode } from '../tree';

const STORAGE_KEY = 'cbt-tree-open';

/** Which branches the person opened or closed, remembered in this browser. */
function loadOpen(): Record<number, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<number, boolean>) : {};
  } catch {
    return {};
  }
}

function saveOpen(open: Record<number, boolean>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(open));
  } catch {
    // Storage can be unavailable (private windows); the tree still works for this visit.
  }
}

/** Companies and sites start open; buildings and floors start folded so long lists stay short. */
const openByDefault = (n: TreeNode) => n.kind === 'company' || n.kind === 'site';

export function LocationTree({
  roots,
  selectedId,
  onSelect,
  badge,
  label = 'Locations',
}: {
  roots: TreeNode[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  badge?: (n: TreeNode) => string | null;
  label?: string;
}) {
  const [open, setOpenState] = useState<Record<number, boolean>>(loadOpen);
  const [filter, setFilter] = useState('');
  const setOpen = (next: Record<number, boolean>) => {
    setOpenState(next);
    saveOpen(next);
  };

  if (roots.length === 0) return <p className="muted">Nothing here yet.</p>;

  // The way down to the selected location is always open, so it stays in view.
  const onPath = new Set<number>();
  const findPath = (nodes: TreeNode[]): boolean =>
    nodes.some((n) => {
      if (n.id === selectedId || findPath(shownChildren(n))) {
        onPath.add(n.id);
        return true;
      }
      return false;
    });
  findPath(roots);

  // With a filter, show matches and the locations above them, whatever is folded.
  const q = filter.trim().toLowerCase();
  const keep = new Set<number>();
  const findMatches = (nodes: TreeNode[]): boolean => {
    let any = false;
    for (const n of nodes) {
      const below = findMatches(shownChildren(n));
      if (below || n.name.toLowerCase().includes(q)) {
        keep.add(n.id);
        any = true;
      }
    }
    return any;
  };
  if (q) findMatches(roots);

  const isOpen = (n: TreeNode) => q !== '' || onPath.has(n.id) || (open[n.id] ?? openByDefault(n));
  const toggle = (n: TreeNode) => setOpen({ ...open, [n.id]: !isOpen(n) });
  const setAll = (value: boolean) => {
    const next: Record<number, boolean> = {};
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        const kids = shownChildren(n);
        if (kids.length) next[n.id] = value;
        walk(kids);
      }
    };
    walk(roots);
    setOpen(next);
  };

  const rows: ReactElement[] = [];
  const walk = (nodes: TreeNode[], indent: number) => {
    for (const n of nodes) {
      if (q && !keep.has(n.id)) continue;
      const kids = shownChildren(n);
      const expanded = kids.length > 0 && isOpen(n);
      const b = badge?.(n);
      const crumb = n.access === 'breadcrumb';
      rows.push(
        <li key={n.id} className="tree-item" style={{ paddingLeft: indent * 16 }}>
          {kids.length > 0 ? (
            <button
              type="button"
              className="tree-toggle"
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Fold' : 'Unfold'} ${n.name}`}
              title={`${kids.length} inside`}
              onClick={() => toggle(n)}
              disabled={q !== ''}
            >
              <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                <path
                  d={expanded ? 'M2 4l4 4 4-4' : 'M4 2l4 4-4 4'}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
              </svg>
            </button>
          ) : (
            <span className="tree-toggle-space" aria-hidden="true" />
          )}
          <button
            type="button"
            className={`tree-row${n.id === selectedId ? ' is-selected' : ''}${crumb ? ' is-crumb' : ''}`}
            aria-current={n.id === selectedId ? 'true' : undefined}
            onClick={() => onSelect(n.id)}
          >
            <span className="tree-kind">{KIND_LABELS[n.kind]}</span>
            <span className={`tree-name${n.kind === 'company' ? ' is-company' : ''}`}>{n.name}</span>
            {!expanded && kids.length > 0 && <span className="tree-count">{kids.length}</span>}
            {b && <span className="tree-badge">{b}</span>}
          </button>
        </li>,
      );
      if (expanded) walk(kids, indent + 1);
    }
  };
  walk(roots, 0);

  return (
    <div className="tree-wrap">
      <div className="tree-tools">
        <input
          type="search"
          className="tree-filter"
          placeholder="Filter locations"
          aria-label={`Filter ${label.toLowerCase()}`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button type="button" className="link-btn small" onClick={() => setAll(true)} disabled={q !== ''}>
          Expand all
        </button>
        <button type="button" className="link-btn small" onClick={() => setAll(false)} disabled={q !== ''}>
          Collapse all
        </button>
      </div>
      {rows.length ? (
        <ul className="tree" aria-label={label}>
          {rows}
        </ul>
      ) : (
        <p className="muted small">No locations match “{filter.trim()}”.</p>
      )}
    </div>
  );
}
