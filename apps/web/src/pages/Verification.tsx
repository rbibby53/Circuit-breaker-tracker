import type { VerificationLog } from '@cbt/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { ErrorNote, formatDate } from '../components/ui';
import { useTitle } from '../lib/useTitle';
import { useLocations } from '../queries';
import { ancestry, buildTree } from '../tree';

/**
 * Who verified what: every circuit and meter checked in the field, newest first, with how many
 * each person has checked. Filter by place, person and result.
 */
export function VerificationPage() {
  useTitle('Who verified what');
  const [params, setParams] = useSearchParams();
  const loc = params.get('loc') ?? '';
  const by = params.get('by') ?? '';
  const status = params.get('status') ?? '';
  const locations = useLocations();
  const { byId } = useMemo(() => buildTree(locations.data ?? []), [locations.data]);
  const places = [...byId.values()]
    .filter((n) => n.access === 'full' && (n.kind === 'site' || (n.kind === 'building' && !n.isDefaultBuilding)))
    .map((n) => ({
      id: n.id,
      label: ancestry(byId, n.id)
        .map((a) => a.name)
        .join(' › '),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const q = new URLSearchParams();
  if (loc) q.set('loc', loc);
  if (by) q.set('by', by);
  if (status) q.set('status', status);
  const log = useQuery({
    queryKey: ['verifications', loc, by, status],
    queryFn: () => api.get<VerificationLog>(`/api/verifications?${q}`),
  });
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const data = log.data;

  return (
    <main className="content stack-lg">
      <div className="page-head">
        <div>
          <span className="eyebrow">Field verification</span>
          <h1>Who verified what</h1>
          <p className="muted">
            Every circuit and meter checked in the field, with who checked it and when. Each panel&apos;s history and
            Activity keep the earlier checks.
          </p>
        </div>
      </div>
      <div className="row verify-filters">
        <label className="field">
          <span className="field-label">Where</span>
          <select value={loc} onChange={(e) => set('loc', e.target.value)}>
            <option value="">Everywhere you can see</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Who</span>
          <select value={by} onChange={(e) => set('by', e.target.value)}>
            <option value="">Everyone</option>
            {(data?.people ?? []).map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Result</span>
          <select value={status} onChange={(e) => set('status', e.target.value)}>
            <option value="">Verified or wrong</option>
            <option value="verified">Verified</option>
            <option value="wrong">Wrong</option>
          </select>
        </label>
      </div>
      <ErrorNote error={log.error} />
      {data && data.people.length > 0 && (
        <section className="panel stack-sm" aria-label="By person">
          <h2 className="h-caps">By person</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Who</th>
                  <th scope="col">Verified</th>
                  <th scope="col">Wrong</th>
                  <th scope="col">Last check</th>
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => (
                  <tr key={p.name} className={by === p.name ? 'is-selected' : ''}>
                    <td>
                      <button
                        type="button"
                        className="link-btn strong"
                        onClick={() => set('by', by === p.name ? '' : p.name)}
                      >
                        {p.name}
                      </button>
                    </td>
                    <td className="mono">{p.verified}</td>
                    <td className="mono">{p.wrong}</td>
                    <td className="small muted">{formatDate(p.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {data && (
        <section className="stack-sm" aria-label="Checks">
          <h2 className="h-caps">
            {data.total} {data.total === 1 ? 'check' : 'checks'}
            {by && ` by ${by}`}
          </h2>
          {data.items.length === 0 ? (
            <p className="muted">Nothing checked here yet. Field mode is the quickest way to start.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Who</th>
                    <th scope="col">What</th>
                    <th scope="col">Result</th>
                    <th scope="col">Where</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((i) => (
                    <tr key={`${i.kind}${i.id}`}>
                      <td className="small">{formatDate(i.at)}</td>
                      <td>{i.by || 'Unknown'}</td>
                      <td>
                        {i.kind === 'meter' ? (
                          <Link to={`/meters/${i.id}`}>{i.what}</Link>
                        ) : i.panelId ? (
                          <Link to={`/panels/${i.panelId}`}>
                            {i.panelName} · {i.what}
                          </Link>
                        ) : (
                          i.what
                        )}
                        {i.label && <span className="muted small block">{i.label}</span>}
                      </td>
                      <td>
                        <span className={`badge ${i.status === 'verified' ? 'badge-ups' : 'badge-crit'}`}>
                          {i.status === 'verified' ? '✓ Verified' : '✗ Wrong'}
                        </span>
                      </td>
                      <td className="small muted">{i.path}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.total > data.items.length && (
            <p className="small muted">Showing the newest {data.items.length}. Narrow it down by place or person.</p>
          )}
        </section>
      )}
    </main>
  );
}
