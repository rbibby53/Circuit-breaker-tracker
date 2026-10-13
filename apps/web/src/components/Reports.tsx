import type { ReportDto } from '@cbt/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { formatDate } from './ui';

/** Open discrepancy reports across everything the person can see (for the nav count). */
export const useOpenReports = () =>
  useQuery({ queryKey: ['reports', 'open'], queryFn: () => api.get<ReportDto[]>('/api/reports') });

function ReportItem({ report, showPanel }: { report: ReportDto; showPanel: boolean }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const change = useMutation({
    mutationFn: (status: 'open' | 'resolved') =>
      api.patch<ReportDto>(`/api/reports/${report.id}`, { status, resolution: status === 'resolved' ? note : '' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });
  const open = report.status === 'open';
  return (
    <li className={`report${open ? '' : ' is-resolved'}`}>
      <div className="report-head">
        {showPanel && (
          <Link to={`/panels/${report.panelId}`} className="strong">
            {report.panelName}
          </Link>
        )}
        <span className="mono">{report.circuit || 'The panel in general'}</span>
        <span className={`badge ${open ? 'badge-crit' : 'badge-ups'}`}>{open ? 'Open' : 'Resolved'}</span>
      </div>
      <p className="report-message">{report.message}</p>
      <p className="small muted">
        {report.source === 'public' ? 'From the public page' : 'From field mode'}
        {report.reporter ? ` · ${report.reporter}` : ''} · {formatDate(report.createdAt)}
        {showPanel && ` · ${report.locationPath}`}
      </p>
      {!open && (
        <p className="small">
          Resolved by {report.resolvedBy} {formatDate(report.resolvedAt)}
          {report.resolution ? `: ${report.resolution}` : ''}
        </p>
      )}
      {report.canResolve &&
        (open ? (
          <form
            className="report-resolve"
            onSubmit={(e) => {
              e.preventDefault();
              change.mutate('resolved');
            }}
          >
            <input
              aria-label="What was done"
              placeholder="What was done (optional)"
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button className="btn btn-sm btn-dark" disabled={change.isPending}>
              Resolve
            </button>
          </form>
        ) : (
          <button type="button" className="link-btn small" onClick={() => change.mutate('open')}>
            Reopen
          </button>
        ))}
      {change.error && <p className="error small">{errorMessage(change.error)}</p>}
    </li>
  );
}

export function ReportList({ reports, showPanel = false }: { reports: ReportDto[]; showPanel?: boolean }) {
  return (
    <ul className="report-list">
      {reports.map((r) => (
        <ReportItem key={r.id} report={r} showPanel={showPanel} />
      ))}
    </ul>
  );
}

/** On a panel: "2 open reports from the field", opening the list. */
export function PanelReports({ panelId, count }: { panelId: number; count: number }) {
  const [open, setOpen] = useState(false);
  const reports = useQuery({
    queryKey: ['reports', 'panel', panelId],
    queryFn: () => api.get<ReportDto[]>(`/api/panels/${panelId}/reports`),
    enabled: open || count > 0,
  });
  // Once loaded, the list is the latest word (a report may have been resolved here).
  const live = reports.data ? reports.data.filter((r) => r.status === 'open').length : count;
  if (live === 0 && !open) return null;
  return (
    <div className="banner banner-warn report-banner" role="status">
      <div className="row space-between">
        <span>
          <strong>
            {live} open {live === 1 ? 'report' : 'reports'}
          </strong>{' '}
          that something here doesn't match.
        </span>
        <button type="button" className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide reports' : 'Show reports'}
        </button>
      </div>
      {open && reports.data && <ReportList reports={reports.data} />}
    </div>
  );
}
