import { KIND_LABELS } from '@cbt/core';
import { flatten, type TreeNode } from '../tree';

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
  const rows = flatten(roots);
  if (rows.length === 0) return <p className="muted">Nothing here yet.</p>;
  return (
    <ul className="tree" aria-label={label}>
      {rows.map((n) => {
        const b = badge?.(n);
        const crumb = n.access === 'breadcrumb';
        return (
          <li key={n.id}>
            <button
              type="button"
              className={`tree-row${n.id === selectedId ? ' is-selected' : ''}${crumb ? ' is-crumb' : ''}`}
              style={{ paddingLeft: 8 + n.indent * 16 }}
              aria-current={n.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect(n.id)}
            >
              <span className="tree-kind">{KIND_LABELS[n.kind]}</span>
              <span className={`tree-name${n.kind === 'company' ? ' is-company' : ''}`}>{n.name}</span>
              {b && <span className="tree-badge">{b}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
