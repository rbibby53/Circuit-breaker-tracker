import type { PanelDetail } from '@cbt/core';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useAuthConfig } from '../auth';
import { useConfirm } from '../components/ConfirmDialog';
import { ErrorNote } from '../components/ui';

/** Turn the panel's public page (opened from its QR code without signing in) on or off. */
export function SharePanel({ panel }: { panel: PanelDetail }) {
  const config = useAuthConfig();
  const confirm = useConfirm();
  const [publicPath, setPublicPath] = useState(panel.publicPath);
  const [copied, setCopied] = useState(false);
  const allowed = config.data?.publicPanels ?? true;
  const url = publicPath ? `${window.location.origin}${publicPath}` : null;

  const change = useMutation({
    mutationFn: (body: { enabled: boolean; renew?: boolean }) =>
      api.put<{ publicPath: string | null }>(`/api/panels/${panel.id}/public`, body),
    onSuccess: (r) => {
      setPublicPath(r.publicPath);
      setCopied(false);
    },
  });

  return (
    <div className="subtle-box stack-sm">
      <span className="strong">QR code and public page</span>
      {!allowed ? (
        <span className="small">
          An admin has turned off public panel pages in Settings, so QR codes ask people to sign in.
        </span>
      ) : panel.canShare ? (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={change.isPending ? change.variables.enabled : !!publicPath}
              disabled={change.isPending}
              onChange={(e) => change.mutate({ enabled: e.target.checked })}
            />
            <span>
              <span className="strong">Anyone with the QR code can see this panel without signing in</span>
              <span className="field-hint">
                They see breaker labels, rooms, notes and markers, read-only, and can sign in from there to edit.
                Printed sheets and door cards point their QR code at this page; reprint any made before.
              </span>
            </span>
          </label>
          {url && (
            <div className="row">
              <code className="small share-url">{url}</code>
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  await navigator.clipboard?.writeText(url);
                  setCopied(true);
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <a className="btn btn-sm" href={publicPath!} target="_blank" rel="noopener">
                Open
              </a>
              <button
                type="button"
                className="btn btn-sm btn-link"
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Make a new link?',
                    message:
                      'The current link and any QR codes printed with it stop working. Reprint the panel afterwards.',
                    confirmLabel: 'Make a new link',
                    danger: true,
                  });
                  if (ok) change.mutate({ enabled: true, renew: true });
                }}
              >
                Make a new link
              </button>
            </div>
          )}
          <ErrorNote error={change.error} />
        </>
      ) : (
        <span className="small">
          {publicPath
            ? 'Anyone with the QR code can see this panel without signing in.'
            : 'The QR code asks people to sign in. A manager can make this panel public.'}
        </span>
      )}
    </div>
  );
}
