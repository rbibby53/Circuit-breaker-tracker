import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useTitle } from '../lib/useTitle';
import { api } from '../api';
import { useAuthConfig } from '../auth';
import { AuthShell } from '../components/AuthShell';
import { ErrorNote, Field } from '../components/ui';

export function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="1" y="1" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="10" y="1" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="1" y="10" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="10" y="10" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/** Only follow same-site relative paths after sign-in. */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function LoginPage() {
  useTitle('Sign in');
  const config = useAuthConfig();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  // With password sign-in off, the form stays for admins but tucked behind a button.
  const adminsOnly = !!config.data && !config.data.localLogin && config.data.oidc.enabled;
  const login = useMutation({
    mutationFn: () => api.post('/api/auth/login', form),
    onSuccess: async () => {
      await qc.invalidateQueries();
      navigate(safeNext(params.get('next')));
    },
  });

  if (config.data?.needsSetup) return <Navigate to="/setup" replace />;
  const ssoError = params.get('error');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  return (
    <AuthShell>
      <section className="auth-card" aria-labelledby="signin-h">
        <h1 id="signin-h">Sign in</h1>
        {ssoError && (
          <p className="error" role="alert">
            {ssoError}
          </p>
        )}
        {config.data?.oidc.enabled && (
          <>
            <a className="btn btn-outline btn-block btn-lg" href="/api/auth/oidc/start">
              <MicrosoftIcon />
              {config.data.oidc.label}
            </a>
            <div className="divider">
              <span>{adminsOnly ? 'admins can also use a password' : 'or with a local account'}</span>
            </div>
          </>
        )}
        <form onSubmit={submit} className="stack" hidden={adminsOnly && !showPassword}>
          <Field label="Username or email">
            <input
              required
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              autoComplete="username"
            />
          </Field>
          <Field label="Password">
            <input
              required
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="current-password"
            />
          </Field>
          <ErrorNote error={login.error} />
          <button className="btn btn-primary btn-block btn-lg" disabled={login.isPending}>
            Sign in
          </button>
        </form>
        {adminsOnly && !showPassword && (
          <button type="button" className="btn btn-block" onClick={() => setShowPassword(true)}>
            Admin sign-in with a password
          </button>
        )}
        {!adminsOnly && <p className="muted small">Forgot your password? Ask whoever invited you for a reset link.</p>}
      </section>
    </AuthShell>
  );
}
