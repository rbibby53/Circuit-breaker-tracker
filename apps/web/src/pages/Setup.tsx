import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuthConfig } from '../auth';
import { AuthShell } from '../components/AuthShell';
import { ErrorNote, Field } from '../components/ui';

export function SetupPage() {
  const config = useAuthConfig();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', displayName: '', password: '' });
  const setup = useMutation({
    mutationFn: () => api.post('/api/setup', form),
    onSuccess: async () => {
      await qc.invalidateQueries();
      navigate('/');
    },
  });

  if (config.data && !config.data.needsSetup) return <Navigate to="/" replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setup.mutate();
  };

  return (
    <AuthShell>
      <section className="auth-card" aria-labelledby="setup-h">
        <h1 id="setup-h">Welcome</h1>
        <p>Create the first admin account. Admins can see and change everything, and invite everyone else.</p>
        <form onSubmit={submit} className="stack">
          <Field label="Your name">
            <input required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} autoComplete="name" />
          </Field>
          <Field label="Username">
            <input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="username" />
          </Field>
          <Field label="Password" hint="At least 10 characters.">
            <input required type="password" minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
          </Field>
          <ErrorNote error={setup.error} />
          <button className="btn btn-primary btn-block" disabled={setup.isPending}>
            Create admin account
          </button>
        </form>
      </section>
    </AuthShell>
  );
}
