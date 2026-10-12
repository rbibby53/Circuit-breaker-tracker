import { formatVa } from '@cbt/core';
import type { TreeNode } from '../tree';
import { servesSummary } from './serves';
import type { EditPanel } from './state';

/**
 * A switchboard or motor control center: units numbered 1, 2, 3… (or 2A, 2B…), one per row, with
 * the frame, trip, feeder and, for MCC buckets, the starter, motor and control.
 */
export function UnitList({
  doc,
  byId,
  selectedKey,
  readOnly,
  onSelect,
  onAdd,
  feeds,
  highlightTag,
}: {
  doc: EditPanel;
  byId: Map<number, TreeNode>;
  selectedKey: string | null;
  readOnly: boolean;
  onSelect: (key: string) => void;
  onAdd: () => void;
  feeds: Map<number, string[]>;
  highlightTag?: string | null;
}) {
  const mcc = doc.layout === 'mcc';
  const units = [...doc.breakers].sort((a, b) => a.position - b.position);
  return (
    <div className="unit-frame">
      <div className="unit-head" aria-label="Main">
        <span>{mcc ? 'MOTOR CONTROL CENTER' : 'SWITCHBOARD'}</span>
        <span className="unit-main">
          {doc.mainType === 'lugs' ? 'MAIN LUGS' : doc.mainAmps ? `MAIN ${doc.mainAmps}A` : 'MAIN'}
        </span>
      </div>
      <div className="unit-scroll">
        <table className="unit-table">
          <thead>
            <tr>
              <th scope="col">Unit</th>
              <th scope="col">Serves</th>
              <th scope="col">Trip</th>
              <th scope="col">Frame</th>
              <th scope="col">Feeder</th>
              {mcc && <th scope="col">Starter</th>}
              {mcc && <th scope="col">Motor</th>}
              <th scope="col">Load</th>
            </tr>
          </thead>
          <tbody>
            {units.map((b) => {
              const dim = !!highlightTag && !b.tags.some((t) => t.toLowerCase() === highlightTag.toLowerCase());
              const feeding = b.id ? feeds.get(b.id) : undefined;
              const sub = feeding?.length ? `Feeds ${feeding.join(', ')}` : servesSummary(byId, b.serves, b.isSpare);
              return (
                <tr
                  key={b.key}
                  className={`${b.key === selectedKey ? 'is-selected' : ''}${b.isSpare ? ' is-spare' : ''}${dim ? ' is-dim' : ''}`}
                >
                  <th scope="row">
                    <button
                      type="button"
                      className="unit-btn"
                      aria-pressed={b.key === selectedKey}
                      aria-label={`Unit ${b.unit || b.position}, ${b.label || 'unlabelled'}, ${b.poles}-pole ${b.amps} amps`}
                      onClick={() => onSelect(b.key)}
                    >
                      {b.unit || b.position}
                    </button>
                  </th>
                  <td>
                    <span className="unit-label">
                      {b.label || (b.isSpare ? 'Spare' : 'Unlabelled')}
                      {b.critical && <span className="badge badge-crit">CRIT</span>}
                      {b.backup === 'ups' && <span className="badge badge-ups">UPS</span>}
                      {b.backup === 'generator' && <span className="badge badge-gen">GEN</span>}
                    </span>
                    <span className="unit-sub">{sub}</span>
                  </td>
                  <td className="mono">
                    {b.poles}P {b.amps}A
                  </td>
                  <td className="mono">{b.frameAmps ? `${b.frameAmps}A` : ''}</td>
                  <td className="small">{[b.wire, b.conduit].filter(Boolean).join(' in ')}</td>
                  {mcc && <td className="small">{[b.starter, b.control].filter(Boolean).join(' · ')}</td>}
                  {mcc && <td className="mono">{b.hp ? `${b.hp} HP` : ''}</td>}
                  <td className="mono">{b.loadVa ? formatVa(b.loadVa) : ''}</td>
                </tr>
              );
            })}
            {units.length === 0 && (
              <tr>
                <td colSpan={mcc ? 8 : 6} className="muted">
                  No units yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <button type="button" className="btn unit-add" onClick={onAdd}>
          + Add {mcc ? 'a bucket' : 'a unit'}
        </button>
      )}
    </div>
  );
}
