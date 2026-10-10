import { INVITE_LIMIT_LABELS, KIND_LABELS, ROLE_LABELS, type InviteInfo } from '@cbt/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuthConfig, useMe } from '../auth';
import { AuthShell } from '../components/AuthShell';
import { ErrorNote, Field, formatDate } from '../components/ui';
import { MicrosoftIcon } from './Login';

const ROLE_BLURB = {
  viewer: 'see panels and print labels',
  editor: 'see and change panels, breakers and rooms',
  manager: 'change things and invite other people',
} as const;

export function InvitePage() {
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const config = useAuthConfig();
  const me = useMe();
  const info = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<InviteInfo>(`/api/invites/${token}`),
    retry: false,
  });
  const [form, setForm] = useState({ username: '', displayName: '', password: '' });

  const accept = useMutation({
    mutationFn: (body: object) => api.post(`/api/invites/${token}/accept`, body),
    onSuccess: async () => {
      // The invite is used up now; don't re-check it on the way out.
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'invite' });
      navigate('/');
    },
  });

  if (info.isLoading)
    return (
      <AuthShell>
        <div className="auth-card">Checking your invite…</div>
      </AuthShell>
    );
  if (info.error) {
    const msg = info.error instanceof ApiError ? info.error.message : 'This invite link is not valid.';
    return (
      <AuthShell>
        <section className="auth-card">
          <h1>Invite not available</h1>
          <p>{msg}</p>
        </section>
      </AuthShell>
    );
  }
  const i = info.data!;
  const signedIn = me.data && !me.data.viewingAs;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    accept.mutate(form);
  };

  return (
    <AuthShell>
      <section className="auth-card" aria-labelledby="invite-h">
        <span className="eyebrow">Invite from {i.invitedBy}</span>
        <h1 id="invite-h">You're invited to {i.locationPath.split(' › ').pop()}</h1>
        <dl className="facts">
          <dt>Where</dt>
          <dd>
            {i.locationPath} <span className="muted">({KIND_LABELS[i.locationKind].toLowerCase()})</span>
          </dd>
          <dt>Role</dt>
          <dd>
            {ROLE_LABELS[i.role]}: {ROLE_BLURB[i.role]}
            {i.inviteLimit && ` (can invite ${INVITE_LIMIT_LABELS[i.inviteLimit].toLowerCase()})`}
          </dd>
          <dt>Expires</dt>
          <dd>{formatDate(i.expiresAt)}</dd>
        </dl>

        {signedIn ? (
          <div className="stack">
            <p>
              You're signed in as <strong>{me.data!.realUser.displayName}</strong>. Accepting adds this access to your
              account.
            </p>
            <ErrorNote error={accept.error} />
            <button
              className="btn btn-primary btn-block btn-lg"
              onClick={() => accept.mutate({})}
              disabled={accept.isPending}
            >
              Accept invite
            </button>
          </div>
        ) : (
          <>
            {config.data?.oidc.enabled && (
              <>
                <a
                  className="btn btn-outline btn-block btn-lg"
                  href={`/api/auth/oidc/start?invite=${encodeURIComponent(token)}`}
                >
                  <MicrosoftIcon />
                  Accept with a Microsoft work account
                </a>
                <div className="divider">
                  <span>or create a local account</span>
                </div>
              </>
            )}
            <form onSubmit={submit} className="stack">
              <Field label="Your name">
                <input
                  required
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  autoComplete="name"
                />
              </Field>
              <Field label="Choose a username">
                <input
                  required
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  autoComplete="username"
                />
              </Field>
              <Field label="Create a password" hint="At least 10 characters.">
                <input
                  required
                  type="password"
                  minLength={10}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  autoComplete="new-password"
                />
              </Field>
              <ErrorNote error={accept.error} />
              <button className="btn btn-primary btn-block btn-lg" disabled={accept.isPending}>
                Create account
              </button>
            </form>
            <p className="muted small">
              Already have an account?{' '}
              <a href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>Sign in first</a>, then come back to
              this link.
            </p>
          </>
        )}
      </section>
    </AuthShell>
  );
}
