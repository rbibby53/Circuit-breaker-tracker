import type { AuthConfig, MeResponse } from '@cbt/core';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, ApiError } from './api';

export const useAuthConfig = () =>
  useQuery({ queryKey: ['auth-config'], queryFn: () => api.get<AuthConfig>('/api/auth/config'), staleTime: 60_000 });

export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/api/auth/me'),
    retry: (count, err) => !(err instanceof ApiError && err.status === 401) && count < 2,
  });

/** The signed-in user (or the viewed user). Only use under <RequireAuth>. */
export function useCurrentUser(): MeResponse {
  const me = useMe();
  if (!me.data) throw new Error('useCurrentUser outside RequireAuth');
  return me.data;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const config = useAuthConfig();
  const me = useMe();
  const location = useLocation();
  if (config.data?.needsSetup) return <Navigate to="/setup" replace />;
  // A stale "signed out" result may still be cached while we re-check after signing in.
  if (me.isLoading || config.isLoading || (me.isError && me.isFetching)) {
    return <div className="page-loading">Loading…</div>;
  }
  if (me.error instanceof ApiError && me.error.status === 401) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (!me.data) return <div className="page-loading">Could not reach the server.</div>;
  return <>{children}</>;
}
