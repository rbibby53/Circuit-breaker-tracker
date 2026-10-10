import type { ReactNode } from 'react';
import { Logo } from './Logo';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <div className="auth-brand">
        <Logo size={30} />
        <span>Circuit Breaker Tracker</span>
      </div>
      <div className="auth-cards">{children}</div>
    </div>
  );
}
