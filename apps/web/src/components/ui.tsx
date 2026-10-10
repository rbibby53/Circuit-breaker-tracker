import { useState, type ReactNode } from 'react';
import { errorMessage } from '../api';

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {errorMessage(error)}
    </p>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** A created invite or reset link, with a copy button. */
export function LinkBox({ url, expiresAt, onClose }: { url: string; expiresAt: string; onClose?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="linkbox" role="status">
      <span className="field-label">Copy this link and send it however you like</span>
      <div className="linkbox-row">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Link" />
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            await navigator.clipboard?.writeText(url).catch(() => undefined);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        {onClose && (
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        )}
      </div>
      <span className="field-hint">Works once. Expires {formatDate(expiresAt)}.</span>
    </div>
  );
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return 'Just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} days ago`;
  return new Date(iso).toLocaleDateString();
}
