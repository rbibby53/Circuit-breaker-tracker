import { panelLoad, type PanelShape } from '@cbt/core';
import { useState } from 'react';
import type { EditBreaker } from './state';

/** Circuits, free spaces and breaker ratings per leg or phase, under the panel. */
export function LoadSummary({
  panel,
  breakers,
  mainAmps,
}: {
  panel: PanelShape;
  breakers: EditBreaker[];
  mainAmps: number | null;
}) {
  const [open, setOpen] = useState(false);
  const load = panelLoad(panel, breakers);
  const critical = breakers.filter((b) => b.critical).length;
  const onBackup = breakers.filter((b) => b.backup !== 'none').length;
  const max = Math.max(1, ...load.legs.map((l) => l.amps));
  const phase = panel.layout === 'commercial';
  return (
    <section className="load-summary" aria-label="Panel summary">
      <div className="load-line">
        <span>
          <strong>{load.circuits}</strong> {load.circuits === 1 ? 'circuit' : 'circuits'}
        </span>
        {load.spares > 0 && (
          <span>
            <strong>{load.spares}</strong> {load.spares === 1 ? 'spare' : 'spares'}
          </span>
        )}
        <span>
          <strong>{load.freeSpaces}</strong> free {load.freeSpaces === 1 ? 'space' : 'spaces'}
        </span>
        {critical > 0 && (
          <span>
            <strong>{critical}</strong> critical
          </span>
        )}
        {onBackup > 0 && (
          <span>
            <strong>{onBackup}</strong> on backup power
          </span>
        )}
        {load.surge.length > 0 && (
          <span className="load-surge">
            <span className="badge badge-spd">SPD</span> Surge protector{load.surge.length > 1 ? 's' : ''} at{' '}
            {load.surge.map((spots) => spots.join(' + ')).join(', ')}
          </span>
        )}
        {load.legs.length > 1 && (
          <button type="button" className="link-btn small" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Show'} {phase ? 'phase' : 'leg'} balance
          </button>
        )}
      </div>
      {load.warning && !open && <p className="load-warning small">{load.warning}</p>}
      {open && (
        <div className="load-detail">
          {load.legs.map((l) => (
            <div key={l.leg} className="load-leg">
              <span className="load-leg-name">
                {phase ? 'Phase' : 'Leg'} {l.leg}
              </span>
              <span className="load-bar" aria-hidden="true">
                <span style={{ width: `${(l.amps / max) * 100}%` }} />
              </span>
              <span className="load-leg-amps">
                {l.amps} A · {l.circuits} {l.circuits === 1 ? 'circuit' : 'circuits'}
              </span>
            </div>
          ))}
          {load.warning && <p className="load-warning small">{load.warning}</p>}
          <p className="muted small">
            These add up breaker ratings, not measured current, so they only show how evenly circuits are spread.
            Ratings normally add up to more than the {mainAmps ? `${mainAmps} A ` : ''}main.
          </p>
        </div>
      )}
    </section>
  );
}
