import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuthConfig } from '../auth';
import { AuthShell } from '../components/AuthShell';
import { ErrorNote, Field } from '../components/ui';
import { useTitle } from '../lib/useTitle';

/** "Forgot your password?": a reset link by email, when the server can send email. */
export function ForgotPage() {
  useTitle('Forgot your password?');
  const config = useAuthConfig();
  const [params] = useSearchParams();
  const [login, setLogin] = useState(params.get('login') ?? '');
  const send = useMutation({ mutationFn: () => api.post('/api/auth/forgot', { login }) });

  if (config.data && !config.data.passwordResetEmail) return <Navigate to="/login" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send.mutate();
  };

  return (
    <AuthShell>
      <section className="auth-card" aria-labelledby="forgot-h">
        <h1 id="forgot-h">Forgot your password?</h1>
        {send.isSuccess ? (
          <div className="stack">
            <p className="notice" role="status">
              If that account has an email address, a link to set a new password is on its way. It works once. Check
              your junk mail folder if it doesn&apos;t arrive in a few minutes.
            </p>
            <p className="muted small">
              No email? Ask whoever invited you for a reset link. <Link to="/login">Back to sign in</Link>
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="stack">
            <p className="muted">We&apos;ll email a link to set a new password to the address on your account.</p>
            <Field label="Username or email">
              <input
                required
                autoFocus
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoComplete="username"
              />
            </Field>
            <ErrorNote error={send.error} />
            <button className="btn btn-primary btn-block btn-lg" disabled={send.isPending}>
              {send.isPending ? 'Sending…' : 'Email me a link'}
            </button>
            <p className="muted small">
              <Link to="/login">Back to sign in</Link>
            </p>
          </form>
        )}
      </section>
    </AuthShell>
  );
}
