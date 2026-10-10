import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTitle } from '../lib/useTitle';
import { api } from '../api';
import { AuthShell } from '../components/AuthShell';
import { ErrorNote, Field } from '../components/ui';

export function ResetPage() {
  useTitle('Reset password');
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const info = useQuery({
    queryKey: ['reset', token],
    queryFn: () => api.get<{ username: string; displayName: string }>(`/api/reset/${token}`),
    retry: false,
  });
  const [password, setPassword] = useState('');
  const reset = useMutation({
    mutationFn: () => api.post(`/api/reset/${token}`, { password }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      navigate('/');
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    reset.mutate();
  };

  return (
    <AuthShell>
      <section className="auth-card" aria-labelledby="reset-h">
        <h1 id="reset-h">Set a new password</h1>
        {info.error ? (
          <ErrorNote error={info.error} />
        ) : (
          <form onSubmit={submit} className="stack">
            {info.data && (
              <p>
                For <strong>{info.data.displayName}</strong> ({info.data.username}).
              </p>
            )}
            <Field label="New password" hint="At least 10 characters. You'll be signed out everywhere else.">
              <input
                required
                type="password"
                minLength={10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <ErrorNote error={reset.error} />
            <button className="btn btn-primary btn-block btn-lg" disabled={reset.isPending || !info.data}>
              Save password and sign in
            </button>
          </form>
        )}
      </section>
    </AuthShell>
  );
}
