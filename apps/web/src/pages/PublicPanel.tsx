import { PROTECTION_LABELS, ampsLabel, breakerTags, circuitLabel, phasesOf, type PublicPanel } from '@cbt/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuthConfig, useMe } from '../auth';
import { Logo } from '../components/Logo';
import { formatDate } from '../components/ui';
import { useTitle } from '../lib/useTitle';

/** The page a panel's QR code opens when the panel is shared: read-only, no sign-in. */
export function PublicPanelPage() {
  const { token = '' } = useParams();
  const config = useAuthConfig();
  const me = useMe();
  const [filter, setFilter] = useState('');
  // The circuit being reported ("" for the panel as a whole), or null when the form is closed.
  const [reporting, setReporting] = useState<string | null>(null);
  const panel = useQuery({
    queryKey: ['public-panel', token],
    queryFn: () => api.get<PublicPanel>(`/api/public/panels/${encodeURIComponent(token)}`),
    retry: false,
  });
  useTitle(panel.data?.name ?? 'Panel');

  const signedIn = !!me.data;
  const editPath = panel.data ? `/panels/${panel.data.id}` : '/';
  const q = filter.trim().toLowerCase();

  return (
    <div className="public-page">
      <header className="public-bar">
        <span className="public-brand">
          <Logo size={24} />
          <span>{config.data?.appName ?? 'Circuit Breaker Tracker'}</span>
        </span>
        {panel.data &&
          (signedIn ? (
            <Link className="btn btn-sm btn-primary" to={editPath}>
              Open in the app
            </Link>
          ) : (
            <Link className="btn btn-sm btn-primary" to={`/login?next=${encodeURIComponent(editPath)}`}>
              Sign in to edit
            </Link>
          ))}
      </header>

      <main className="public-main">
        {panel.isLoading && <p className="muted">Loading…</p>}
        {panel.error && (
          <div className="empty">
            <h1>Panel not available</h1>
            <p>
              {panel.error instanceof ApiError && panel.error.status === 404
                ? 'This panel is not shared, or its link has changed. Ask whoever looks after it for a new QR code.'
                : 'Could not reach the server. Try again in a moment.'}
            </p>
            <Link className="btn" to="/login">
              Sign in
            </Link>
          </div>
        )}
        {panel.data && (
          <>
            <div className="stack-sm">
              <span className="eyebrow">{panel.data.locationPath}</span>
              <h1>{panel.data.name}</h1>
              <p className="muted">
                {[
                  panel.data.mainType === 'lugs'
                    ? 'Main lugs'
                    : panel.data.mainAmps
                      ? `${panel.data.mainAmps} A main breaker`
                      : null,
                  panel.data.voltage,
                  `${panel.data.spaces} spaces`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {panel.data.fedFrom && (
                <p className="small muted">
                  Fed from {panel.data.fedFrom.panelName}
                  {panel.data.fedFrom.circuit && `, circuit ${panel.data.fedFrom.circuit}`}
                </p>
              )}
              {panel.data.notes && <p className="notes">{panel.data.notes}</p>}
              <div className="row">
                <button type="button" className="btn btn-sm" onClick={() => setReporting('')}>
                  Report a problem
                </button>
              </div>
            </div>

            <input
              type="search"
              className="public-filter"
              placeholder="Find a breaker: fridge, kitchen, lights, 20A…"
              aria-label="Find a breaker"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />

            <ul className="public-list" aria-label="Breakers">
              {panel.data.breakers
                .map((b) => ({
                  b,
                  circuit: circuitLabel(panel.data!, b),
                  phases: phasesOf(panel.data!, b),
                  tags: breakerTags(b),
                }))
                .filter(({ b, circuit }) =>
                  !q
                    ? true
                    : [b.label, circuit, `${b.amps}a`, ...b.serves, ...b.tags, b.notes, PROTECTION_LABELS[b.protection]]
                        .join(' ')
                        .toLowerCase()
                        .includes(q),
                )
                .map(({ b, circuit, phases, tags }) => (
                  <li
                    key={`${b.section}-${b.position}${b.slot}`}
                    className={`public-breaker${b.critical ? ' is-critical' : ''}`}
                  >
                    <span className="public-circuit mono">
                      {circuit}
                      {phases.length > 0 && <span className="public-phase">Ø {phases.join(' ')}</span>}
                    </span>
                    <span className="public-body">
                      <span className="public-label">
                        {b.label || (b.device === 'surge' ? 'Surge protector' : b.isSpare ? 'Spare' : 'Unlabelled')}
                      </span>
                      {b.serves.length > 0 && <span className="small muted">{b.serves.join(', ')}</span>}
                      {b.tags.length > 0 && <span className="small">{b.tags.join(' · ')}</span>}
                      {b.notes && <span className="small">{b.notes}</span>}
                      {tags.length > 0 && (
                        <span className="public-tags">
                          {tags.map((t) => (
                            <span key={t} className={`print-tag${t === 'CRIT' ? ' is-solid' : ''}`}>
                              {t}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className="public-side">
                      <span className="public-amps mono">{ampsLabel(b)}</span>
                      <button
                        type="button"
                        className="link-btn small"
                        aria-label={`Report a problem with circuit ${circuit}`}
                        onClick={() => setReporting(`${b.section}:${b.position}:${b.slot}`)}
                      >
                        Report
                      </button>
                    </span>
                  </li>
                ))}
            </ul>
            {q && (
              <p className="small muted">
                Showing breakers matching “{filter.trim()}”.{' '}
                <button type="button" className="link-btn" onClick={() => setFilter('')}>
                  Show all
                </button>
              </p>
            )}
            <p className="small muted">Last updated {formatDate(panel.data.updatedAt)}.</p>
            <PublicReport token={token} panel={panel.data} circuit={reporting} onClose={() => setReporting(null)} />
          </>
        )}
      </main>
    </div>
  );
}

/**
 * "Something doesn't match": anyone who scanned the door label can tell whoever looks after the
 * panel, without signing in.
 */
function PublicReport({
  token,
  panel,
  circuit,
  onClose,
}: {
  token: string;
  panel: PublicPanel;
  circuit: string | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [which, setWhich] = useState('');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (circuit !== null && d && !d.open) {
      setWhich(circuit);
      setState('idle');
      setError(null);
      d.showModal();
    }
    if (circuit === null && d?.open) d.close();
  }, [circuit]);

  const send = async () => {
    const [section, position, slot] = which ? which.split(':') : [];
    setState('sending');
    setError(null);
    try {
      await api.post(`/api/public/panels/${encodeURIComponent(token)}/reports`, {
        section: section ? Number(section) : null,
        position: position ? Number(position) : null,
        slot: slot ?? 'full',
        message,
        name,
        website,
      });
      setMessage('');
      setState('sent');
    } catch (e) {
      setState('idle');
      setError(e instanceof ApiError ? e.message : 'Could not send. Check your signal and try again.');
    }
  };

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="report-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {state === 'sent' ? (
        <div className="stack">
          <h2 id="report-title">Thanks</h2>
          <p>Whoever looks after {panel.name} will see your report.</p>
          <div className="dialog-actions">
            <button type="button" className="btn btn-dark" onClick={onClose} autoFocus>
              Close
            </button>
          </div>
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <h2 id="report-title">Report a problem</h2>
          <p className="small muted">
            For a label that is wrong, a breaker that does something else, or anything that doesn't match.
          </p>
          <label className="field">
            <span className="field-label">Which circuit</span>
            <select value={which} onChange={(e) => setWhich(e.target.value)}>
              <option value="">The panel in general</option>
              {panel.breakers.map((b) => (
                <option key={`${b.section}:${b.position}:${b.slot}`} value={`${b.section}:${b.position}:${b.slot}`}>
                  {circuitLabel(panel, b)} {b.label || ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">What doesn't match?</span>
            <textarea
              rows={4}
              required
              maxLength={1000}
              value={message}
              placeholder="e.g. Breaker 5 turns off the hallway lights, not the kitchen."
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Your name or phone (optional)</span>
            <input value={name} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="sr-only" aria-hidden="true">
            Website
            <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
          {error && <p className="error">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-dark" disabled={state === 'sending' || !message.trim()}>
              {state === 'sending' ? 'Sending…' : 'Send report'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
