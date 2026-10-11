import { PROTECTION_LABELS, ampsLabel, breakerTags, circuitLabel, phasesOf, type PublicPanel } from '@cbt/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
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
                  Fed from {panel.data.fedFrom.panelName}, circuit {panel.data.fedFrom.circuit}
                </p>
              )}
              {panel.data.notes && <p className="notes">{panel.data.notes}</p>}
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
                  <li key={`${b.position}${b.slot}`} className={`public-breaker${b.critical ? ' is-critical' : ''}`}>
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
                    <span className="public-amps mono">{ampsLabel(b)}</span>
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
          </>
        )}
      </main>
    </div>
  );
}
