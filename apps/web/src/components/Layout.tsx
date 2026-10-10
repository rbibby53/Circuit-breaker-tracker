import { useMutation, useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useCurrentUser } from '../auth';
import { Logo } from './Logo';

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
      qc.clear();
      navigate('/login');
    },
  });

  // The Access, People and Activity screens are for admins and managers; the server decides
  // per request, so showing the links to everyone only costs a polite "no access" page.
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="Circuit Breaker Tracker home">
          <Logo />
          <span>Circuit Breaker Tracker</span>
        </NavLink>
        <nav className="topnav" aria-label="Main">
          <NavLink to="/" end>
            Sites
          </NavLink>
          <NavLink to="/access">Access</NavLink>
          <NavLink to="/users">People</NavLink>
          <NavLink to="/activity">Activity</NavLink>
        </nav>
        <div className="spacer" />
        <NavLink to="/account" className="userchip">
          <span className="avatar" aria-hidden="true">
            {initials(me.realUser.displayName)}
          </span>
          <span>{me.realUser.displayName}</span>
          {me.realUser.isAdmin && <span className="chip chip-dark">Admin</span>}
        </NavLink>
        <button className="btn btn-ghost-dark" onClick={() => logout.mutate()}>
          Sign out
        </button>
      </header>
      {me.viewingAs && (
        <div className="viewas" role="status">
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M1.5 10S5 3.5 10 3.5 18.5 10 18.5 10 15 16.5 10 16.5 1.5 10 1.5 10z" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="10" cy="10" r="2.8" fill="currentColor" />
          </svg>
          <strong>Viewing as {me.user.displayName}</strong>
          <span>Read-only. You see exactly what they see.</span>
          <div className="spacer" />
          <button className="btn btn-dark" onClick={() => exitViewAs.mutate()} disabled={exitViewAs.isPending}>
            Exit view
          </button>
        </div>
      )}
      <Outlet />
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
