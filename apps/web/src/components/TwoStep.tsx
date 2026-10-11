import type { MeResponse, TotpSetup } from '@cbt/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuthConfig } from '../auth';
import { ErrorNote, Field } from './ui';

/** Account section for two-step sign-in with an authenticator app. */
export function TwoStepSettings({ me }: { me: MeResponse }) {
  const qc = useQueryClient();
  const appName = useAuthConfig().data?.appName ?? 'Circuit Breaker Tracker';
  const [setup, setSetup] = useState<TotpSetup | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [action, setAction] = useState<'off' | 'codes' | null>(null);
  const [password, setPassword] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['me'] });

  const start = useMutation({
    mutationFn: () => api.post<TotpSetup>('/api/me/totp/setup'),
    onSuccess: (s) => setSetup(s),
  });
  const enable = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/api/me/totp/enable', { code }),
    onSuccess: (r) => {
      setSetup(null);
      setCode('');
      setCodes(r.recoveryCodes);
      void refresh();
    },
  });
  const confirm = useMutation({
    mutationFn: (): Promise<{ recoveryCodes?: string[] }> =>
      action === 'off'
        ? api.post('/api/me/totp/disable', { password })
        : api.post('/api/me/totp/recovery-codes', { password }),
    onSuccess: async (r) => {
      setPassword('');
      setAction(null);
      if (r.recoveryCodes) setCodes(r.recoveryCodes);
      await refresh();
    },
  });

  if (!me.hasPassword) return null;

  const download = () => {
    const text = `${appName} recovery codes for ${me.realUser.username}\nEach code works once.\n\n${codes!.join('\n')}\n`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = 'recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="panel stack" aria-labelledby="twostep-h">
      <h2 id="twostep-h" className="h-caps">
        Two-step sign-in
      </h2>

      {codes ? (
        <>
          <p>
            <strong>Save these recovery codes now.</strong> Each one lets you sign in once if you lose your phone. They
            will not be shown again.
          </p>
          <ul className="recovery-codes mono" aria-label="Recovery codes">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="row">
            <button type="button" className="btn" onClick={download}>
              Download as a text file
            </button>
            <button type="button" className="btn btn-dark" onClick={() => setCodes(null)}>
              I have saved them
            </button>
          </div>
        </>
      ) : me.totp ? (
        <>
          <p>
            <span className="badge badge-ok">On</span> Signing in with your password also asks for a code from your
            authenticator app. {me.recoveryCodesLeft} recovery code{me.recoveryCodesLeft === 1 ? '' : 's'} left.
          </p>
          {action ? (
            <form
              className="stack"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                confirm.mutate();
              }}
            >
              <Field label="Your password, to confirm">
                <input
                  type="password"
                  required
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </Field>
              <ErrorNote error={confirm.error} />
              <div className="row">
                <button className={action === 'off' ? 'btn btn-danger' : 'btn btn-dark'} disabled={confirm.isPending}>
                  {action === 'off' ? 'Turn off two-step sign-in' : 'Make new recovery codes'}
                </button>
                <button type="button" className="btn" onClick={() => setAction(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="row">
              <button type="button" className="btn" onClick={() => setAction('codes')}>
                New recovery codes
              </button>
              <button type="button" className="btn btn-danger" onClick={() => setAction('off')}>
                Turn off
              </button>
            </div>
          )}
        </>
      ) : setup ? (
        <form
          className="stack"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            enable.mutate();
          }}
        >
          <p>
            Scan this with an authenticator app (Microsoft Authenticator, Google Authenticator, 1Password, Bitwarden…),
            then enter the 6-digit code it shows.
          </p>
          <img
            className="totp-qr"
            src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`}
            alt="QR code for your authenticator app"
            width={180}
            height={180}
          />
          <p className="small muted">
            Can&apos;t scan it? Enter this key instead:{' '}
            <code className="mono">{setup.secret.match(/.{1,4}/g)!.join(' ')}</code>
          </p>
          <Field label="Code from the app">
            <input
              required
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <ErrorNote error={enable.error} />
          <div className="row">
            <button className="btn btn-dark" disabled={enable.isPending}>
              Turn on
            </button>
            <button type="button" className="btn" onClick={() => setSetup(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <p>
            Off. Turn it on to ask for a code from an authenticator app on your phone whenever you sign in with your
            password. Microsoft sign-in uses your organisation&apos;s own protection instead.
          </p>
          <ErrorNote error={start.error} />
          <div>
            <button type="button" className="btn btn-dark" onClick={() => start.mutate()} disabled={start.isPending}>
              Set up two-step sign-in
            </button>
          </div>
        </>
      )}
    </section>
  );
}
