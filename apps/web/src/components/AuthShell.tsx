import type { ReactNode } from 'react';
import { useAuthConfig } from '../auth';
import { Logo } from './Logo';

export function AuthShell({ children }: { children: ReactNode }) {
  const config = useAuthConfig();
  return (
    <div className="auth-shell">
      <div className="auth-brand">
        <Logo size={30} />
        <span>{config.data?.appName ?? 'Circuit Breaker Tracker'}</span>
      </div>
      <div className="auth-cards">{children}</div>
    </div>
  );
}
