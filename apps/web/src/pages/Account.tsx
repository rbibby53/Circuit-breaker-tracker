import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuthConfig, useCurrentUser } from '../auth';
import { ErrorNote, Field } from '../components/ui';
import { MicrosoftIcon } from './Login';

export function AccountPage() {
  const me = useCurrentUser();
  const config = useAuthConfig();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [name, setName] = useState(me.realUser.displayName);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [saved, setSaved] = useState<string | null>(null);

  const rename = useMutation({
    mutationFn: () => api.patch('/api/me', { displayName: name }),
    onSuccess: async () => {
      setSaved('Name saved.');
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const changePw = useMutation({
    mutationFn: () => api.post('/api/me/password', me.hasPassword ? pw : { newPassword: pw.newPassword }),
    onSuccess: async () => {
      setPw({ currentPassword: '', newPassword: '' });
      setSaved('Password changed. Other devices were signed out.');
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  const unlink = useMutation({
    mutationFn: (provider: string) => api.del(`/api/users/${me.realUser.id}/identities/${provider}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });

  if (me.viewingAs) {
    return (
      <main className="content narrow">
        <h1>Account</h1>
        <p>Exit view-as to change your own account.</p>
      </main>
    );
  }

  const submitName = (e: FormEvent) => {
    e.preventDefault();
    rename.mutate();
  };
  const submitPw = (e: FormEvent) => {
    e.preventDefault();
    changePw.mutate();
  };

  return (
    <main className="content narrow stack-lg">
      <div className="page-head">
        <div>
          <h1>Your account</h1>
          <p className="muted">Signed in as {me.realUser.username}.</p>
        </div>
      </div>
      {(saved || params.get('linked')) && (
        <p className="ok" role="status">
          {saved ?? 'Microsoft account linked.'}
        </p>
      )}

      <form className="panel stack" onSubmit={submitName}>
        <h2 className="h-caps">Name</h2>
        <Field label="Display name">
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <ErrorNote error={rename.error} />
        <div>
          <button className="btn btn-primary" disabled={rename.isPending}>
            Save name
          </button>
        </div>
      </form>

      <form className="panel stack" onSubmit={submitPw}>
        <h2 className="h-caps">{me.hasPassword ? 'Change password' : 'Add a password'}</h2>
        {me.hasPassword && (
          <Field label="Current password">
            <input type="password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} autoComplete="current-password" />
          </Field>
        )}
        <Field label="New password" hint="At least 10 characters.">
          <input type="password" required minLength={10} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} autoComplete="new-password" />
        </Field>
        <ErrorNote error={changePw.error} />
        <div>
          <button className="btn btn-primary" disabled={changePw.isPending}>
            Save password
          </button>
        </div>
      </form>

      {config.data?.oidc.enabled && (
        <section className="panel stack">
          <h2 className="h-caps">Single sign-on</h2>
          {me.identities.length ? (
            me.identities.map((i) => (
              <div key={i.provider} className="row-between">
                <span>Linked: {i.email ?? 'Microsoft account'}</span>
                <button className="btn btn-sm" onClick={() => unlink.mutate(i.provider)}>
                  Unlink
                </button>
              </div>
            ))
          ) : (
            <a className="btn btn-outline" href="/api/auth/oidc/start?link=1">
              <MicrosoftIcon />
              Link a Microsoft account
            </a>
          )}
          <ErrorNote error={unlink.error} />
        </section>
      )}
    </main>
  );
}
