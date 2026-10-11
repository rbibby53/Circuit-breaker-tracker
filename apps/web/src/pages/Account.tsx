import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getTheme, setTheme, type Theme } from '../lib/theme';
import { useTitle } from '../lib/useTitle';
import { api } from '../api';
import { useAuthConfig, useCurrentUser } from '../auth';
import { Avatar } from '../components/Avatar';
import { TwoStepSettings } from '../components/TwoStep';
import { ErrorNote, Field } from '../components/ui';
import { MicrosoftIcon } from './Login';

export function AccountPage() {
  useTitle('Account');
  const me = useCurrentUser();
  const config = useAuthConfig();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [name, setName] = useState(me.realUser.displayName);
  const [email, setEmail] = useState(me.realUser.email ?? '');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [saved, setSaved] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme>(getTheme);

  const rename = useMutation({
    mutationFn: () => api.patch('/api/me', { displayName: name, email: email.trim() }),
    onSuccess: async () => {
      setSaved('Profile saved.');
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

      <section className="panel stack" aria-label="Appearance">
        <h2 className="h-caps">Appearance</h2>
        <div className="segmented three" role="group" aria-label="Theme">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={theme === t}
              onClick={() => {
                setTheme(t);
                setThemeState(t);
              }}
            >
              {t === 'system' ? 'Match device' : t === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
        <p className="muted small">Saved in this browser only.</p>
      </section>

      <form className="panel stack" onSubmit={submitName}>
        <h2 className="h-caps">Profile</h2>
        <div className="profile-row">
          <Avatar name={name || me.realUser.displayName} url={me.realUser.avatarUrl} light />
          <span className="muted small">
            {config.data?.gravatar
              ? 'Your picture comes from gravatar.com for your email address. Without one, your initials are shown.'
              : 'Pictures are turned off here, so your initials are shown.'}
          </span>
        </div>
        <Field label="Display name">
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email (optional)" hint="Used for your Gravatar picture. You can also sign in with it.">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </Field>
        <ErrorNote error={rename.error} />
        <div>
          <button className="btn btn-primary" disabled={rename.isPending}>
            Save profile
          </button>
        </div>
      </form>

      <form className="panel stack" onSubmit={submitPw}>
        <h2 className="h-caps">{me.hasPassword ? 'Change password' : 'Add a password'}</h2>
        {me.hasPassword && (
          <Field label="Current password">
            <input
              type="password"
              required
              value={pw.currentPassword}
              onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
              autoComplete="current-password"
            />
          </Field>
        )}
        <Field label="New password" hint="At least 10 characters.">
          <input
            type="password"
            required
            minLength={10}
            value={pw.newPassword}
            onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
            autoComplete="new-password"
          />
        </Field>
        <ErrorNote error={changePw.error} />
        <div>
          <button className="btn btn-primary" disabled={changePw.isPending}>
            Save password
          </button>
        </div>
      </form>

      <TwoStepSettings me={me} />

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
