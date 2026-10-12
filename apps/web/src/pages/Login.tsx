import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useTitle } from '../lib/useTitle';
import type { LoginResponse } from '@cbt/core';
import { api } from '../api';
import { useAuthConfig } from '../auth';
import { AuthShell } from '../components/AuthShell';
import { ErrorNote, Field } from '../components/ui';

/** The single sign-on button's icon: Microsoft's four squares, or a key for other providers. */
export function SsoIcon({ provider }: { provider: string | undefined }) {
  if (provider === 'Microsoft') {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <rect x="1" y="1" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="10" y="1" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="1" y="10" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="10" y="10" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <circle cx="6" cy="9" r="3.5" />
      <path d="M9.5 9H17M14 9v3M16.5 9v2.5" strokeLinecap="round" />
    </svg>
  );
}

/** "Authentik", or "single sign-on" when the provider has no name we know. */
export function ssoName(provider: string | undefined): string {
  return provider && provider !== 'single sign-on' ? provider : 'single sign-on';
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
  // Set when the password was right and two-step sign-in needs a code next.
  const [challenge, setChallenge] = useState<string | null>(null);
  const done = async () => {
    await qc.invalidateQueries();
    navigate(safeNext(params.get('next')));
  };
  const login = useMutation({
    mutationFn: () => api.post<LoginResponse>('/api/auth/login', form),
    onSuccess: async (r) => {
      if ('totpRequired' in r) setChallenge(r.challenge);
      else await done();
    },
  });

  if (config.data?.needsSetup) return <Navigate to="/setup" replace />;
  const ssoError = params.get('error');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };

  if (challenge) {
    return (
      <AuthShell>
        <CodeStep
          challenge={challenge}
          onDone={done}
          onRestart={() => {
            setChallenge(null);
            setForm((f) => ({ ...f, password: '' }));
            login.reset();
          }}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <section className="auth-card" aria-labelledby="signin-h">
        <h1 id="signin-h">Sign in</h1>
        {ssoError && (
          <p className="error" role="alert">
            {ssoError}
          </p>
        )}
        {params.get('reset') && (
          <p className="notice" role="status">
            Your new password is saved. Sign in with it and a code from your authenticator app.
          </p>
        )}
        {params.get('restored') && (
          <p className="notice" role="status">
            The app was restored from a backup, so everyone was signed out. Sign in with an account from the backup.
          </p>
        )}
        {config.data?.oidc.enabled && (
          <>
            <a className="btn btn-outline btn-block btn-lg" href="/api/auth/oidc/start">
              <SsoIcon provider={config.data.oidc.provider} />
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

/** Second step of a password sign-in: a code from the authenticator app, or a recovery code. */
function CodeStep({
  challenge,
  onDone,
  onRestart,
}: {
  challenge: string;
  onDone: () => Promise<void>;
  onRestart: () => void;
}) {
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const verify = useMutation({
    mutationFn: () => api.post('/api/auth/login/totp', { challenge, code }),
    onSuccess: onDone,
  });
  // These errors mean the attempt is over; the password has to be entered again.
  const expired = verify.error instanceof Error && /password again/.test(verify.error.message);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    verify.mutate();
  };
  return (
    <section className="auth-card" aria-labelledby="code-h">
      <h1 id="code-h">Two-step sign-in</h1>
      <p className="muted">
        {recovery
          ? 'Enter one of the recovery codes you saved when you turned on two-step sign-in. Each works once.'
          : 'Enter the 6-digit code from your authenticator app.'}
      </p>
      <form onSubmit={submit} className="stack">
        <Field label={recovery ? 'Recovery code' : 'Code'}>
          <input
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode={recovery ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            placeholder={recovery ? 'xxxx-xxxx-xx' : '123456'}
            maxLength={recovery ? 20 : 6}
          />
        </Field>
        <ErrorNote error={verify.error} />
        {expired ? (
          <button type="button" className="btn btn-primary btn-block btn-lg" onClick={onRestart}>
            Back to sign in
          </button>
        ) : (
          <button className="btn btn-primary btn-block btn-lg" disabled={verify.isPending}>
            Verify
          </button>
        )}
      </form>
      <div className="row">
        <button
          type="button"
          className="link-btn small"
          onClick={() => {
            setRecovery((v) => !v);
            setCode('');
            verify.reset();
          }}
        >
          {recovery ? 'Use a code from the app' : 'Lost your phone? Use a recovery code'}
        </button>
        <button type="button" className="link-btn small" onClick={onRestart}>
          Cancel
        </button>
      </div>
    </section>
  );
}
