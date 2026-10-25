import { API_TOKEN_DAYS, type AdminApiTokenInfo, type ApiTokenInfo, type CreatedApiToken } from '@cbt/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useConfirm } from './ConfirmDialog';
import { ErrorNote, Field, relativeTime } from './ui';

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

/** "…x7Qa · expires 3 Feb 2027 · last used 2 h ago from 10.0.0.5" */
function facts(t: ApiTokenInfo): string {
  return [
    `…${t.hint}`,
    !t.expiresAt ? 'never expires' : `${t.expired ? 'expired' : 'expires'} ${day(t.expiresAt)}`,
    t.lastUsedAt
      ? `last used ${relativeTime(t.lastUsedAt).replace('Just now', 'just now')}${t.lastUsedIp ? ` from ${t.lastUsedIp}` : ''}`
      : 'never used',
  ].join(' · ');
}

function useRevoke(url: (t: ApiTokenInfo) => string, queryKey: string) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const revoke = useMutation({
    mutationFn: (t: ApiTokenInfo) => api.del(url(t)),
    onSuccess: () => qc.invalidateQueries({ queryKey: [queryKey] }),
  });
  const ask = async (t: ApiTokenInfo, whose = '') => {
    const ok = await confirm({
      title: `Revoke ${whose}${t.name}?`,
      message: 'Anything using this token stops working straight away. This cannot be undone.',
      confirmLabel: 'Revoke token',
      danger: true,
    });
    if (ok) revoke.mutate(t);
  };
  return { revoke, ask };
}

/** Under Your account: tokens for scripts, which read what you can see and change nothing. */
export function ApiTokensSection({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['api-tokens'], queryFn: () => api.get<ApiTokenInfo[]>('/api/me/tokens') });
  const [name, setName] = useState('');
  const [days, setDays] = useState<string>('90');
  const [made, setMade] = useState<CreatedApiToken | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api.post<CreatedApiToken>('/api/me/tokens', { name, days: days === 'never' ? null : Number(days) }),
    onSuccess: async (r) => {
      setMade(r);
      setName('');
      await qc.invalidateQueries({ queryKey: ['api-tokens'] });
    },
  });
  const { revoke, ask } = useRevoke((t) => `/api/me/tokens/${t.id}`, 'api-tokens');
  const tokens = list.data ?? [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <section className="panel stack" aria-labelledby="api-tokens-h">
      <h2 id="api-tokens-h" className="h-caps">
        API tokens
      </h2>
      <p className="muted small">
        For scripts and other tools. A token reads what you can see here, and cannot change anything, open your account
        or reach settings. Send it in an <code>Authorization: Bearer</code> header.
      </p>
      {enabled ? (
        <form className="form-row" onSubmit={submit}>
          <Field label="What is it for?">
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. SysON export"
            />
          </Field>
          <Field label="Expires">
            <select value={days} onChange={(e) => setDays(e.target.value)}>
              {API_TOKEN_DAYS.map((d) => (
                <option key={d} value={d}>
                  {d === 365 ? 'In a year' : `In ${d} days`}
                </option>
              ))}
              <option value="never">Never</option>
            </select>
          </Field>
          <button className="btn btn-dark" disabled={create.isPending}>
            Make token
          </button>
        </form>
      ) : (
        <p className="muted">An admin has turned API tokens off here, so they do not work for now.</p>
      )}
      <ErrorNote error={create.error} />
      {made && <NewToken made={made} onClose={() => setMade(null)} />}
      {tokens.length > 0 && (
        <ul className="session-list">
          {tokens.map((t) => (
            <li key={t.id}>
              <span className="cell-stack">
                <span className="strong">
                  {t.name} {t.expired && <span className="chip chip-dark">Expired</span>}
                </span>
                <span className="muted small">{facts(t)}</span>
              </span>
              <button type="button" className="btn btn-sm" disabled={revoke.isPending} onClick={() => ask(t)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={list.error ?? revoke.error} />
    </section>
  );
}

/** The new token, shown this once. */
function NewToken({ made, onClose }: { made: CreatedApiToken; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="linkbox" role="status">
      <span className="field-label">Copy your token for {made.info.name} now. It will not be shown again.</span>
      <div className="linkbox-row">
        <input readOnly value={made.token} onFocus={(e) => e.currentTarget.select()} aria-label="API token" />
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            await navigator.clipboard?.writeText(made.token).catch(() => undefined);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Done
        </button>
      </div>
      <span className="field-hint">Keep it out of code and shared files, like a password.</span>
    </div>
  );
}

/** Under Settings → Sign-in: everyone's tokens, for admins to see and revoke. */
export function AllApiTokens() {
  const list = useQuery({
    queryKey: ['admin-api-tokens'],
    queryFn: () => api.get<AdminApiTokenInfo[]>('/api/admin/tokens'),
  });
  const { revoke, ask } = useRevoke((t) => `/api/admin/tokens/${t.id}`, 'admin-api-tokens');
  const tokens = list.data ?? [];
  return (
    <div className="stack">
      <h3>API tokens people have made</h3>
      {tokens.length ? (
        <ul className="session-list">
          {tokens.map((t) => (
            <li key={t.id}>
              <span className="cell-stack">
                <span className="strong">
                  {t.user.displayName}: {t.name} {t.expired && <span className="chip chip-dark">Expired</span>}
                </span>
                <span className="muted small">{facts(t)}</span>
              </span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={revoke.isPending}
                onClick={() => ask(t, `${t.user.displayName}’s token `)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Nobody has made one yet.</p>
      )}
      <ErrorNote error={list.error ?? revoke.error} />
    </div>
  );
}
