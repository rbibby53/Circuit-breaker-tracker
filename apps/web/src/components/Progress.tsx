import type { ProgressReport, VerifyProgress } from '@cbt/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

const pct = (p: { circuits: number; verified: number }) =>
  p.circuits ? Math.floor((p.verified / p.circuits) * 100) : 0;

function Bar({ p, label }: { p: VerifyProgress; label: string }) {
  const done = pct(p);
  const wrong = p.circuits ? (p.wrong / p.circuits) * 100 : 0;
  return (
    <div className="progress-row">
      <span className="progress-label">{label}</span>
      <span
        className="progress-bar"
        role="meter"
        aria-label={`${label}: ${done}% verified`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={done}
      >
        <span className="progress-done" style={{ width: `${done}%` }} />
        <span className="progress-wrong" style={{ width: `${wrong}%` }} />
      </span>
      <span className="progress-text">
        <strong>{done}%</strong> verified{' '}
        <span className="muted">
          · {p.verified} of {p.circuits} circuits{p.wrong ? ` · ${p.wrong} wrong` : ''}
        </span>
      </span>
    </div>
  );
}

/**
 * How far field checking has got: this place, each building in it, and the panels with the
 * most left to check.
 */
export function VerifyProgressCard({ locationId, name }: { locationId: number; name: string }) {
  const [open, setOpen] = useState(false);
  const report = useQuery({
    queryKey: ['progress', locationId],
    queryFn: () => api.get<ProgressReport>(`/api/locations/${locationId}/progress`),
  });
  const r = report.data;
  if (!r || r.total.circuits === 0) return null;
  const left = r.panels.filter((p) => p.verified < p.circuits);
  return (
    <section className="panel stack-sm progress-card" aria-label="Field verification">
      <div className="row space-between">
        <h2 className="h-caps">Field verification</h2>
        <span className="small muted">
          {r.total.panelsDone} of {r.total.panels} panels fully checked ·{' '}
          <Link to={`/verification?loc=${locationId}`}>Who verified what</Link>
        </span>
      </div>
      <Bar p={r.total} label={name} />
      {r.parts.length > 1 && r.parts.map((p) => <Bar key={p.locationId} p={p} label={p.name} />)}
      {left.length > 0 && (
        <>
          <button type="button" className="link-btn small" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Show'} panels left to check ({left.length})
          </button>
          {open && (
            <ul className="progress-panels">
              {left.slice(0, 30).map((p) => (
                <li key={p.id}>
                  <Link to={`/panels/${p.id}`}>{p.name}</Link>{' '}
                  <span className="muted small">
                    {p.verified}/{p.circuits}
                    {p.wrong ? ` · ${p.wrong} wrong` : ''} · {p.path}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
