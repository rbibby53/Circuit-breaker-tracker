import type { ReportDto } from '@cbt/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { ReportList } from '../components/Reports';
import { ErrorNote } from '../components/ui';
import { useTitle } from '../lib/useTitle';

/** Every "this doesn't match" report, from field mode and public pages, for editors to work through. */
export function ReportsPage() {
  useTitle('Reports');
  const [all, setAll] = useState(false);
  const reports = useQuery({
    queryKey: ['reports', all ? 'all' : 'open'],
    queryFn: () => api.get<ReportDto[]>(`/api/reports${all ? '?status=all' : ''}`),
  });
  return (
    <main className="content stack-lg">
      <div className="page-head">
        <div>
          <span className="eyebrow">Field</span>
          <h1>Reports</h1>
          <p className="muted">
            Things that don't match, reported from field mode or by scanning a panel's door label.
          </p>
        </div>
      </div>
      <div className="segmented two" role="group" aria-label="Show">
        <button type="button" aria-pressed={!all} onClick={() => setAll(false)}>
          Open
        </button>
        <button type="button" aria-pressed={all} onClick={() => setAll(true)}>
          All
        </button>
      </div>
      {reports.error && <ErrorNote error={reports.error} />}
      {reports.data && reports.data.length === 0 && (
        <p className="muted">{all ? 'No reports yet.' : 'Nothing open. Everything reported has been dealt with.'}</p>
      )}
      {reports.data && reports.data.length > 0 && <ReportList reports={reports.data} showPanel />}
    </main>
  );
}
