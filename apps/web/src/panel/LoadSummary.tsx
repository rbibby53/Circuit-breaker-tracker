import { formatVa, panelLoad, vaFromText, type LoadCheck, type PanelShape } from '@cbt/core';
import { useState } from 'react';
import type { EditBreaker } from './state';

const pct = (r: number) => `${Math.round(r * 100)}%`;

/**
 * Circuits, free spaces and the spread across legs or phases, under the panel. With connected
 * loads recorded: load and amps per phase, demand totals, and how full the main, the feeder and
 * any transformer above are. Things that look wrong (voltages, capacity) are listed too.
 */
export function LoadSummary({
  panel,
  breakers,
  mainAmps,
  check,
  warnings,
  onFillFromNotes,
}: {
  panel: PanelShape & { voltage: string };
  breakers: EditBreaker[];
  mainAmps: number | null;
  /** From the last save: demand below the panel against its ratings. */
  check?: LoadCheck;
  warnings?: string[];
  /** Fill the Load field of breakers whose label or notes give one. Omitted when read-only. */
  onFillFromNotes?: (loads: Map<string, number>) => void;
}) {
  const [open, setOpen] = useState(false);
  const load = panelLoad(panel, breakers);
  const critical = breakers.filter((b) => b.critical).length;
  const onBackup = breakers.filter((b) => b.backup !== 'none').length;
  const phase = panel.layout === 'commercial';
  const hasLoads = load.loadedCircuits > 0;
  const max = Math.max(1, ...load.legs.map((l) => (hasLoads ? l.demandVa : l.amps)));
  const inNotes = new Map<string, number>();
  for (const b of breakers) {
    if (b.loadVa || b.isSpare) continue;
    const va = vaFromText(`${b.label} ${b.notes}`);
    if (va) inNotes.set(b.key, va);
  }
  // Voltage and capacity notes come from the server; the balance one is worked out here, live.
  const notes = warnings ?? [];
  const flagged = (check?.limits ?? []).some((l) => l.ratio >= 0.8);
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
        {hasLoads && (
          <span>
            <strong>{formatVa(load.demandVa)}</strong> demand
            {load.demandVa !== load.connectedVa && <span className="muted"> of {formatVa(load.connectedVa)}</span>}
          </span>
        )}
        {load.surge.length > 0 && (
          <span className="load-surge">
            <span className="badge badge-spd">SPD</span> Surge protector{load.surge.length > 1 ? 's' : ''} at{' '}
            {load.surge.map((spots) => spots.join(' + ')).join(', ')}
          </span>
        )}
        {(load.legs.length > 1 || hasLoads || (check?.limits.length ?? 0) > 0) && (
          <button type="button" className="link-btn small" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Show'} {hasLoads ? 'load' : `${phase ? 'phase' : 'leg'} balance`}
          </button>
        )}
      </div>
      {notes.map((w) => (
        <p key={w} className="load-warning small" role="note">
          {w}
        </p>
      ))}
      {load.warning && (hasLoads || !open) && <p className="load-warning small">{load.warning}</p>}
      {!open && flagged && <span className="sr-only">Some ratings are at 80% or more.</span>}
      {onFillFromNotes && inNotes.size > 0 && (
        <p className="small load-fill">
          {inNotes.size === 1 ? 'One breaker has' : `${inNotes.size} breakers have`} a load (VA) in the label or notes.{' '}
          <button type="button" className="link-btn" onClick={() => onFillFromNotes(inNotes)}>
            Fill {inNotes.size === 1 ? 'it' : 'them'} in
          </button>
        </p>
      )}
      {open && (
        <div className="load-detail">
          {load.legs.map((l) => (
            <div key={l.leg} className="load-leg">
              <span className="load-leg-name">
                {phase ? 'Phase' : 'Leg'} {l.leg}
              </span>
              <span className="load-bar" aria-hidden="true">
                <span style={{ width: `${((hasLoads ? l.demandVa : l.amps) / max) * 100}%` }} />
              </span>
              <span className="load-leg-amps">
                {hasLoads
                  ? `${formatVa(l.demandVa)}${l.loadAmps !== null ? ` · ${Math.round(l.loadAmps)} A` : ''}`
                  : `${l.amps} A · ${l.circuits} ${l.circuits === 1 ? 'circuit' : 'circuits'}`}
              </span>
            </div>
          ))}
          {hasLoads && load.legs.length > 1 && (
            <p className="small">
              Imbalance <strong>{pct(load.loadImbalance)}</strong> · connected {formatVa(load.connectedVa)} · demand{' '}
              {formatVa(load.demandVa)} · {load.loadedCircuits} of {load.circuits} circuits have a load recorded
            </p>
          )}
          {check && check.limits.length > 0 && (
            <div className="capacity">
              <h3 className="field-label">
                Capacity
                {check.totalDemandVa !== check.demandVa && (
                  <span className="muted"> · {formatVa(check.totalDemandVa)} including what it feeds</span>
                )}
              </h3>
              {check.limits.map((l) => (
                <div
                  key={l.label}
                  className={`capacity-row${l.ratio >= 1 ? ' is-over' : l.ratio >= 0.8 ? ' is-high' : ''}`}
                >
                  <span className="capacity-label">{l.label}</span>
                  <span
                    className="capacity-bar"
                    role="meter"
                    aria-label={l.label}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(l.ratio * 100)}
                  >
                    <span style={{ width: `${Math.min(100, l.ratio * 100)}%` }} />
                    <i style={{ left: '80%' }} aria-hidden="true" />
                  </span>
                  <span className="capacity-pct">
                    {pct(l.ratio)}{' '}
                    <span className="muted">
                      · {formatVa(l.demandVa)} of {formatVa(l.capacityVa)}
                    </span>
                  </span>
                </div>
              ))}
              <p className="muted small">
                Demand load of the circuits recorded here, against each rating; 80% is marked. Circuits without a load
                count as nothing, so this is a floor, not a measurement.
              </p>
            </div>
          )}
          {!hasLoads && load.warning && <p className="load-warning small">{load.warning}</p>}
          {!hasLoads && (
            <p className="muted small">
              These add up breaker ratings, not measured current, so they only show how evenly circuits are spread.
              Ratings normally add up to more than the {mainAmps ? `${mainAmps} A ` : ''}main. Record each
              circuit&apos;s load (VA) to see the real load per phase.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
