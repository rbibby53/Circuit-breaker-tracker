import { useState, type ReactNode } from 'react';

/**
 * The location sidebar. On wide screens it is always there. On phones it folds into a
 * "Locations" button so the page itself comes first, and folds again after a pick.
 */
export function Sidebar({
  label,
  head,
  current,
  selectedId,
  children,
}: {
  label: string;
  /** Left side of the header row, e.g. a title. */
  head: ReactNode;
  /** What the folded button says is selected, e.g. "Kitchen". */
  current: string | null;
  /** Picking another location folds the sidebar on phones. */
  selectedId: number | null;
  children: ReactNode;
}) {
  // Open "for" a selection: choosing a different location closes it without an effect.
  const [openFor, setOpenFor] = useState<number | null | undefined>(undefined);
  const open = openFor !== undefined && openFor === selectedId;
  return (
    <aside className={`sidebar${open ? ' is-open' : ''}`} aria-label={label}>
      <button
        type="button"
        className="sidebar-toggle"
        aria-expanded={open}
        onClick={() => setOpenFor(open ? undefined : selectedId)}
      >
        <span className="eyebrow">{label}</span>
        <span className="sidebar-current">{current ?? 'All'}</span>
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d={open ? 'M2 8l4-4 4 4' : 'M2 4l4 4 4-4'} fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </button>
      <div className="sidebar-body">
        <div className="sidebar-head">{head}</div>
        {children}
      </div>
    </aside>
  );
}
