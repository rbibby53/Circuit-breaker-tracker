import { Suspense } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuthConfig, useCurrentUser } from '../auth';
import { useLocations } from '../queries';
import { Logo } from './Logo';
import { Search } from './Search';
import { Avatar } from './Avatar';
import { useOpenReports } from './Reports';
import { clearOfflineData } from '../lib/offline';

export function Layout() {
  const me = useCurrentUser();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const exitViewAs = useMutation({
    mutationFn: () => api.del('/api/admin/view-as'),
    onSuccess: async () => {
      await qc.invalidateQueries();
      navigate('/access');
    },
  });
  const logout = useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSuccess: () => {
      clearOfflineData();
      qc.clear();
      navigate('/login');
    },
  });

  // Access, People and Activity are for admins and managers only; hide them from everyone else.
  const locations = useLocations();
  const config = useAuthConfig();
  const openReports = useOpenReports().data?.length ?? 0;
  const manages = me.user.isAdmin || (locations.data ?? []).some((l) => l.role === 'manager');
  const appName = config.data?.appName ?? 'Circuit Breaker Tracker';

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="Circuit Breaker Tracker home">
          <Logo />
          <span className="brand-text">{appName}</span>
        </NavLink>
        <nav className="topnav" aria-label="Main">
          <NavLink to="/" end>
            Sites
          </NavLink>
          <NavLink to="/power">Power</NavLink>
          <NavLink to="/equipment">Equipment</NavLink>
          {openReports > 0 && (
            <NavLink to="/reports" aria-label={`Reports, ${openReports} open`}>
              Reports <span className="nav-count">{openReports}</span>
            </NavLink>
          )}
          {manages && (
            <>
              <NavLink to="/access">Access</NavLink>
              <NavLink to="/users">People</NavLink>
              <NavLink to="/activity">Activity</NavLink>
            </>
          )}
          {me.user.isAdmin && <NavLink to="/settings">Settings</NavLink>}
        </nav>
        <Search />
        <div className="topbar-user">
          <NavLink to="/account" className="userchip" aria-label={`Your account: ${me.realUser.displayName}`}>
            <Avatar name={me.realUser.displayName} url={me.realUser.avatarUrl} />
            <span className="userchip-name">{me.realUser.displayName}</span>
            {me.realUser.isAdmin && <span className="chip chip-dark">Admin</span>}
          </NavLink>
          <button className="btn btn-ghost-dark" onClick={() => logout.mutate()}>
            Sign out
          </button>
        </div>
      </header>
      {me.viewingAs && (
        <div className="viewas" role="status">
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M1.5 10S5 3.5 10 3.5 18.5 10 18.5 10 15 16.5 10 16.5 1.5 10 1.5 10z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <circle cx="10" cy="10" r="2.8" fill="currentColor" />
          </svg>
          <strong>Viewing as {me.user.displayName}</strong>
          <span>Read-only. You see exactly what they see.</span>
          <div className="spacer" />
          <button className="btn btn-on-accent" onClick={() => exitViewAs.mutate()} disabled={exitViewAs.isPending}>
            Exit view
          </button>
        </div>
      )}
      <div className="app-body" id="main" tabIndex={-1}>
        {/* Keeps the header in place while a page's code loads. */}
        <Suspense fallback={<div className="page-loading">Loading…</div>}>
          <Outlet />
        </Suspense>
      </div>
      <footer className="app-footer">
        <span>
          {appName} {formatVersion(config.data?.version)}
        </span>
        <a href="https://github.com/rbibby53/Circuit-breaker-tracker" target="_blank" rel="noreferrer">
          Source on GitHub
        </a>
      </footer>
    </div>
  );
}

export function initials(name: string): string {
  return (
    name
      .replace(/[[\]]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

/** "v1.2.3" for releases and builds from main ("v1.2.3-dev.abc1234"); "dev" when run from source. */
function formatVersion(version: string | undefined): string {
  if (!version) return '';
  return /^\d/.test(version) ? `v${version}` : version;
}
