import {
  cellOf,
  circuitLabel,
  columnsFor,
  freeAt,
  phaseOf,
  phasesOf,
  positionsOf,
  rowsFor,
  type Slot,
} from '@cbt/core';
import type { DragEvent, ReactElement } from 'react';
import type { TreeNode } from '../tree';
import { servesSummary } from './serves';
import type { EditBreaker, EditPanel } from './state';

const TEST_COLOR: Record<EditBreaker['protection'], string | null> = {
  standard: null,
  gfci: '#2F6FD6',
  afci: '#F59E2A',
  dual: '#C9B3FF',
};

interface Props {
  doc: EditPanel;
  byId: Map<number, TreeNode>;
  selectedKey: string | null;
  readOnly: boolean;
  onSelect: (key: string) => void;
  onAdd: (position: number, slot: Slot) => void;
  onMove: (key: string, position: number, slot?: Slot) => void;
  /** Sub-panels each saved breaker feeds, by breaker id. */
  feeds: Map<number, string[]>;
  /** When set, breakers without this tag are dimmed. */
  highlightTag?: string | null;
}

const DRAG_TYPE = 'application/x-cbt-breaker';

export function PanelGrid({ doc, byId, selectedKey, readOnly, onSelect, onAdd, onMove, feeds, highlightTag }: Props) {
  const cols = columnsFor(doc);
  const rows = rowsFor(doc);
  const shapes = doc.breakers.map((b) => ({ key: b.key, position: b.position, slot: b.slot, poles: b.poles }));
  // Grid columns: left, bus bar, right (single-column panels: just one).
  const gridCol = (column: number) => (cols === 1 ? 1 : column === 0 ? 1 : 3);

  const dropProps = (position: number, slot?: Slot) =>
    readOnly
      ? {}
      : {
          onDragOver: (e: DragEvent) => {
            if (e.dataTransfer.types.includes(DRAG_TYPE)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }
          },
          onDrop: (e: DragEvent) => {
            const key = e.dataTransfer.getData(DRAG_TYPE);
            if (key) {
              e.preventDefault();
              onMove(key, position, slot);
            }
          },
        };

  const empties: ReactElement[] = [];
  for (let p = 1; p <= doc.spaces; p++) {
    const free = freeAt(doc, shapes, p);
    const { column, row } = cellOf(doc, p);
    const left = column === 0 || cols === 1;
    if (free.full) {
      empties.push(
        <button
          key={`space-${p}`}
          type="button"
          className={`pg-space${left ? '' : ' is-right'}`}
          style={{ gridColumn: gridCol(column), gridRow: row }}
          disabled={readOnly}
          aria-label={readOnly ? `Space ${p}, empty` : `Add a breaker at space ${p}`}
          onClick={() => onAdd(p, 'full')}
          {...dropProps(p)}
        >
          <span className="pg-num">{p}</span>
          <span className="pg-space-text">{readOnly ? 'Space' : '+ Add breaker'}</span>
        </button>,
      );
    } else if (free.A !== free.B) {
      const slot: Slot = free.A ? 'A' : 'B';
      empties.push(
        <button
          key={`half-${p}-${slot}`}
          type="button"
          className={`pg-space pg-half${left ? '' : ' is-right'}`}
          style={{ gridColumn: gridCol(column), gridRow: row, alignSelf: slot === 'A' ? 'start' : 'end' }}
          disabled={readOnly}
          aria-label={readOnly ? `Space ${p}${slot}, empty` : `Add a tandem breaker at ${p}${slot}`}
          onClick={() => onAdd(p, slot)}
          {...dropProps(p, slot)}
        >
          <span className="pg-num">
            {p}
            {slot}
          </span>
          <span className="pg-space-text">{readOnly ? 'Empty' : '+ Add'}</span>
        </button>,
      );
    }
  }

  return (
    <div className="pg-frame">
      <div className="pg-inner">
        <div className="pg-main" aria-label="Main breaker">
          {doc.mainType === 'lugs' ? (
            <span className="pg-main-amps">MAIN LUGS</span>
          ) : (
            <>
              <span className="pg-main-handles" aria-hidden="true">
                <span />
                <span />
              </span>
              <span className="pg-main-text">
                <span className="pg-main-label">MAIN</span>
                <span className="pg-main-amps">{doc.mainAmps ? `${doc.mainAmps}A` : '—'}</span>
              </span>
            </>
          )}
        </div>
        <div
          className={`pg-grid${cols === 1 ? ' is-single' : ''}${doc.layout === 'commercial' && cols === 2 ? ' is-phased' : ''}`}
          style={{ gridTemplateRows: `repeat(${rows}, 46px)` }}
        >
          {cols === 2 && <div className="pg-bus" style={{ gridRow: `1 / span ${rows}` }} aria-hidden="true" />}
          {cols === 2 &&
            doc.layout === 'commercial' &&
            Array.from({ length: rows }, (_, i) => (
              <span key={`phase-${i}`} className="pg-phase" style={{ gridRow: i + 1 }} aria-hidden="true">
                {phaseOf(doc, i * 2 + 1)}
              </span>
            ))}
          {empties}
          {doc.breakers.map((b) => {
            const { column, row } = cellOf(doc, b.position);
            const left = column === 0 || cols === 1;
            const tandem = b.slot !== 'full';
            const circuits = positionsOf(doc, b).map((p) => `${p}${tandem ? b.slot : ''}`);
            const test = TEST_COLOR[b.protection];
            const selected = b.key === selectedKey;
            const phases = phasesOf(doc, b);
            const dim = !!highlightTag && !b.tags.some((t) => t.toLowerCase() === highlightTag.toLowerCase());
            return (
              <button
                key={b.key}
                type="button"
                className={`pg-breaker${left ? '' : ' is-right'}${tandem ? ' is-tandem' : ''}${b.isSpare ? ' is-spare' : ''}${selected ? ' is-selected' : ''}${dim ? ' is-dim' : ''}`}
                style={{
                  gridColumn: gridCol(column),
                  gridRow: `${row} / span ${b.poles}`,
                  alignSelf: tandem ? (b.slot === 'A' ? 'start' : 'end') : 'stretch',
                }}
                aria-label={`Circuit ${circuitLabel(doc, b)}${phases.length ? `, phase ${phases.join(' ')}` : ''}, ${b.label || 'unlabelled'}, ${b.amps} amps${b.critical ? ', critical' : ''}${b.backup !== 'none' ? `, on ${b.backup}` : ''}`}
                aria-pressed={selected}
                draggable={!readOnly}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, b.key);
                  e.dataTransfer.effectAllowed = 'move';
                  onSelect(b.key);
                }}
                onClick={() => onSelect(b.key)}
                {...dropProps(b.position)}
              >
                <span className="pg-nums">
                  {circuits.map((c) => (
                    <span key={c}>{c}</span>
                  ))}
                </span>
                <span className="pg-text">
                  <span className="pg-label-row">
                    <span className="pg-label">{b.label || (b.isSpare ? 'Spare' : 'Unlabelled')}</span>
                    {b.critical && <span className="badge badge-crit">CRIT</span>}
                    {b.backup === 'ups' && <span className="badge badge-ups">UPS</span>}
                    {b.backup === 'generator' && <span className="badge badge-gen">GEN</span>}
                  </span>
                  {!tandem && (
                    <span className="pg-sub">
                      {b.id && feeds.get(b.id)?.length && b.serves.length === 0
                        ? `Feeds ${feeds.get(b.id)!.join(', ')}`
                        : servesSummary(byId, b.serves, b.isSpare)}
                    </span>
                  )}
                </span>
                <span className="pg-amps">
                  <span>{b.amps}A</span>
                  {!tandem && <span className="pg-test" style={{ background: test ?? 'transparent' }} />}
                </span>
                <span className="pg-handles">
                  {circuits.map((c) => (
                    <span key={c} className="pg-handle" />
                  ))}
                  {b.poles > 1 && <span className="pg-tie" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
