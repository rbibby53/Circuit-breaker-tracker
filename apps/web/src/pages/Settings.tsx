import {
  SETTING_DEFS,
  SETTING_GROUPS,
  type AdminSetting,
  type AdminSettingsResponse,
  type BackupList,
  type LogLines,
  type RestoreUpload,
  type SettingDef,
  type SettingKey,
  type SettingValue,
} from '@cbt/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useCurrentUser } from '../auth';
import { AllApiTokens } from '../components/ApiTokens';
import { useConfirm } from '../components/ConfirmDialog';
import { GroupAccess } from '../components/GroupAccess';
import { ErrorNote, formatDate } from '../components/ui';
import { useTitle } from '../lib/useTitle';

export function SettingsPage() {
  useTitle('Settings');
  const me = useCurrentUser();
  // A backup staged for restore, from an upload or from the saved backups list.
  const [pending, setPending] = useState<RestoreUpload | null>(null);
  const data = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api.get<AdminSettingsResponse>('/api/admin/settings'),
    retry: false,
  });

  if (!me.user.isAdmin) {
    return (
      <main className="content narrow">
        <h1>Settings</h1>
        <div className="empty">
          <p>Only admins can change settings.</p>
        </div>
      </main>
    );
  }
  if (data.isLoading) return <div className="page-loading">Loading…</div>;
  if (data.error || !data.data) return <ErrorNote error={data.error} />;
  const s = data.data;
  const byKey = new Map(s.settings.map((x) => [x.key, x]));

  return (
    <main className="content narrow stack-lg">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">
            Changes apply straight away; no restart needed. Anything set by a Docker environment variable is shown
            locked and wins over what is saved here.
          </p>
        </div>
      </div>

      <nav className="settings-jump" aria-label="Settings sections">
        {SETTING_GROUPS.map((g) => (
          <a key={g.id} href={`#settings-${g.id}`}>
            {g.title}
          </a>
        ))}
        <a href="#backup-h">Backup and restore</a>
        <a href="#about-h">About</a>
      </nav>

      {SETTING_GROUPS.map((g) => (
        <SettingsGroup
          key={g.id}
          id={g.id}
          title={g.title}
          defs={SETTING_DEFS.filter((d) => d.group === g.id)}
          current={byKey}
          after={
            g.id === 'sso' ? <GroupAccess provider={s.ssoProvider} /> : g.id === 'signin' ? <AllApiTokens /> : undefined
          }
          extra={
            g.id === 'sso' ? (
              <SsoStatus data={s} />
            ) : g.id === 'logging' ? (
              <LogViewer />
            ) : g.id === 'backups' ? (
              <SavedBackups onRestore={setPending} />
            ) : null
          }
        />
      ))}

      <section className="panel stack" aria-labelledby="backup-h">
        <h2 id="backup-h" className="h-caps">
          Backup
        </h2>
        <p>
          Download a complete copy of the database: every location, panel, breaker, person and change. It is safe to
          take while people are using the app. Keep it somewhere private, since it includes account details.
        </p>
        <div>
          <a className="btn btn-dark" href="/api/admin/backup" download>
            Download backup
          </a>
        </div>
        <RestoreBackup pending={pending} setPending={setPending} />
      </section>

      <section className="panel stack" aria-labelledby="about-h">
        <h2 id="about-h" className="h-caps">
          About
        </h2>
        <dl className="facts about">
          <dt>Version</dt>
          <dd>{s.about.version}</dd>
          <dt>Database</dt>
          <dd>
            {formatBytes(s.about.databaseBytes)} in <code>{s.about.dataDir}</code>
          </dd>
          <dt>Contents</dt>
          <dd>
            {s.about.counts.users} people · {s.about.counts.locations} locations · {s.about.counts.panels} panels ·{' '}
            {s.about.counts.breakers} breakers
          </dd>
          <dt>Running since</dt>
          <dd>{new Date(s.about.startedAt).toLocaleString()}</dd>
          <dt>Node.js</dt>
          <dd>{s.about.nodeVersion}</dd>
        </dl>
        <p className="muted small">
          Docker only needs the port (<code>PORT</code>, default 2757) and a volume for <code>/data</code>. Everything
          above can be set here instead.
        </p>
      </section>
    </main>
  );
}

function SettingsGroup({
  id,
  title,
  defs,
  current,
  extra,
  after,
}: {
  id: string;
  title: string;
  defs: SettingDef[];
  current: Map<SettingKey, AdminSetting>;
  /** Shown inside the settings form, before the save button. */
  extra: React.ReactNode;
  /** Shown below the form, for parts with forms of their own. */
  after?: React.ReactNode;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Partial<Record<SettingKey, SettingValue | null>>>({});
  const [saved, setSaved] = useState(false);
  const dirty = Object.keys(draft).length > 0;

  const save = useMutation({
    mutationFn: () => api.patch('/api/admin/settings', draft),
    onSuccess: async () => {
      setDraft({});
      setSaved(true);
      await qc.invalidateQueries({ queryKey: ['admin-settings'] });
      await qc.invalidateQueries({ queryKey: ['auth-config'] });
    },
  });

  const change = (key: SettingKey, value: SettingValue | null) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <section className="panel stack" id={`settings-${id}`}>
      <form className="stack" onSubmit={submit} aria-label={title}>
        <h2 className="h-caps">{title}</h2>
        {defs.map((def) => (
          <SettingField
            key={def.key}
            def={def}
            setting={current.get(def.key)!}
            draft={draft[def.key]}
            onChange={(v) => change(def.key, v)}
          />
        ))}
        {extra}
        <ErrorNote error={save.error} />
        <div className="row">
          <button className="btn btn-primary" disabled={!dirty || save.isPending}>
            Save {title.toLowerCase()}
          </button>
          {dirty && (
            <button type="button" className="btn" onClick={() => setDraft({})}>
              Undo changes
            </button>
          )}
          {saved && !dirty && (
            <span className="ok" role="status">
              Saved
            </span>
          )}
        </div>
      </form>
      {after}
    </section>
  );
}

function SettingField({
  def,
  setting,
  draft,
  onChange,
}: {
  def: SettingDef;
  setting: AdminSetting;
  draft: SettingValue | null | undefined;
  onChange: (v: SettingValue | null) => void;
}) {
  const locked = setting.source === 'env';
  const value = draft === undefined ? setting.value : draft === null ? def.default : draft;
  const id = `setting-${def.key}`;
  const hint = (
    <span className="field-hint">
      {def.description}
      {locked && (
        <>
          {' '}
          <span className="locked">
            Set by Docker: <code>{def.env}</code>
          </span>
        </>
      )}
    </span>
  );

  if (def.type === 'boolean') {
    return (
      <div className="field">
        <label className="check" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            disabled={locked}
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="strong">{def.label}</span>
        </label>
        {hint}
      </div>
    );
  }

  let input: React.ReactNode;
  if (def.type === 'enum') {
    input = (
      <select id={id} disabled={locked} value={String(value)} onChange={(e) => onChange(e.target.value)}>
        {def.options!.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else if (def.type === 'int') {
    input = (
      <input
        id={id}
        type="number"
        min={def.min}
        max={def.max}
        disabled={locked}
        value={String(value)}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
      />
    );
  } else if (def.type === 'secret') {
    input = (
      <input
        id={id}
        type="password"
        autoComplete="new-password"
        disabled={locked}
        placeholder={setting.hasValue ? 'Saved. Type a new one to replace it.' : ''}
        value={typeof draft === 'string' ? draft : ''}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  } else {
    input = (
      <input
        id={id}
        type={def.type === 'url' ? 'url' : 'text'}
        disabled={locked}
        maxLength={def.maxLength}
        value={String(value)}
        placeholder={def.key === 'publicUrl' ? window.location.origin : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {def.label}
      </label>
      <div className="setting-row">
        {input}
        {def.key === 'publicUrl' && !locked && (
          <button type="button" className="btn btn-sm" onClick={() => onChange(window.location.origin)}>
            Use this address
          </button>
        )}
        {!locked && (setting.source === 'saved' || (def.type === 'secret' && setting.hasValue)) && draft !== null && (
          <button type="button" className="btn btn-sm btn-link" onClick={() => onChange(null)}>
            {def.type === 'secret' ? 'Clear' : 'Reset to default'}
          </button>
        )}
      </div>
      {hint}
    </div>
  );
}

function SsoStatus({ data }: { data: AdminSettingsResponse }) {
  const check = useMutation({
    mutationFn: () => api.post<{ ok: boolean; issuer?: string; message?: string }>('/api/admin/sso-check'),
  });
  return (
    <div className="subtle-box">
      <span className="strong">Single sign-on is {data.ssoEnabled ? 'on' : 'off'}.</span>
      {data.redirectUri ? (
        <span className="small">
          Redirect URI to register with your identity provider: <code>{data.redirectUri}</code>
          <br />
          Microsoft: add it under Authentication with platform Web. Authentik: add it to the provider&apos;s Redirect
          URIs (strict).
        </span>
      ) : (
        <span className="small">Set the public address under General first; it is needed for the redirect URI.</span>
      )}
      {data.ssoEnabled && (
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={() => check.mutate()} disabled={check.isPending}>
            Test connection
          </button>
          {check.data?.ok && <span className="ok">Connected to {check.data.issuer}</span>}
          {check.data && !check.data.ok && <span className="error">{check.data.message}</span>}
        </div>
      )}
      <ErrorNote error={check.error} />
    </div>
  );
}

/** Upload a backup, see what is in it, then restore it after confirming. */
function RestoreBackup({
  pending,
  setPending,
}: {
  pending: RestoreUpload | null;
  setPending: (p: RestoreUpload | null) => void;
}) {
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Bring the confirmation into view when a saved backup is picked further up the page.
  useEffect(() => {
    if (pending) box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [pending]);

  const upload = useMutation({
    mutationFn: (file: File) => api.upload<RestoreUpload>('/api/admin/restore', file),
    onSuccess: (r) => setPending(r),
  });
  const discard = () => {
    if (pending) void api.del(`/api/admin/restore/${pending.id}`).catch(() => undefined);
    setPending(null);
    upload.reset();
    if (input.current) input.current.value = '';
  };
  const apply = useMutation({
    mutationFn: (id: string) => api.post<{ ok: true; safetyCopy: string }>(`/api/admin/restore/${id}`),
    // Everyone is signed out by a restore; the sign-in page explains why.
    onSuccess: () => window.location.assign('/login?restored=1'),
  });

  const c = pending?.summary.counts;
  return (
    <div className="subtle-box stack-sm" ref={box}>
      <span className="strong">Restore from a backup</span>
      {!pending ? (
        <>
          <span className="small">
            Pick a <code>.db</code> file downloaded here. You will see what is in it before anything changes.
          </span>
          <input
            ref={input}
            type="file"
            accept=".db,.sqlite,.sqlite3,application/vnd.sqlite3,application/octet-stream"
            aria-label="Backup file"
            disabled={upload.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
            }}
          />
          {upload.isPending && <span className="small muted">Checking the backup…</span>}
          <ErrorNote error={upload.error} />
        </>
      ) : (
        <>
          <span className="small">
            This backup has {c!.users} {c!.users === 1 ? 'person' : 'people'}, {c!.locations} locations, {c!.panels}{' '}
            panels and {c!.breakers} breakers
            {pending.summary.lastChange ? `, last changed ${formatDate(pending.summary.lastChange)}` : ''} (
            {formatBytes(pending.summary.bytes)}).
          </span>
          <span className="small">
            Restoring replaces <strong>everything</strong> in the app with it. The current data is saved first as{' '}
            <code>breakers-before-restore-….db</code> in the data folder. Everyone, including you, is signed out and
            signs in with an account from the backup.
          </span>
          <ErrorNote error={apply.error} />
          <div className="row">
            <button type="button" className="btn" onClick={discard} disabled={apply.isPending}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={apply.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: 'Restore this backup?',
                  message: 'Everything in the app is replaced with the backup and everyone is signed out.',
                  confirmLabel: 'Restore',
                  danger: true,
                });
                if (ok) apply.mutate(pending.id);
              }}
            >
              {apply.isPending ? 'Restoring…' : 'Restore this backup'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const LOG_FILTERS = [
  { value: 'debug', label: 'Everything' },
  { value: 'info', label: 'Info and above' },
  { value: 'warn', label: 'Warnings and errors' },
  { value: 'error', label: 'Errors only' },
] as const;

/** The server's recent log lines, so nobody needs the Docker console to see what happened. */
function LogViewer() {
  const [filter, setFilter] = useState<(typeof LOG_FILTERS)[number]['value']>('info');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLPreElement>(null);
  const logs = useQuery({
    queryKey: ['logs', filter],
    queryFn: () => api.get<LogLines>(`/api/admin/logs?level=${filter}`),
    enabled: open,
    refetchInterval: open ? 10_000 : false,
  });
  // Newest lines are at the bottom; keep them in view as they arrive.
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [logs.data]);
  const lines = logs.data?.lines ?? [];
  return (
    <div className="subtle-box stack-sm">
      <div className="row-between">
        <span className="strong">Recent log</span>
        <button type="button" className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show recent log'}
        </button>
      </div>
      {open && (
        <>
          <div className="log-tools">
            <label className="small">
              Show
              <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                {LOG_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-sm" onClick={() => void logs.refetch()}>
              Refresh
            </button>
          </div>
          <pre ref={box} className="log-view" aria-label="Recent log lines" tabIndex={0}>
            {lines.length
              ? lines.map((l, i) => (
                  <span key={i} className={`log-${l.level}`}>
                    {l.text}
                    {'\n'}
                  </span>
                ))
              : logs.isLoading
                ? 'Loading…'
                : 'Nothing logged at this level since the server started.'}
          </pre>
          {logs.data && (
            <span className="small muted">
              The last {logs.data.capacity} lines since the server started, logged at the {logs.data.level} level. The
              container log has everything.
            </span>
          )}
          <ErrorNote error={logs.error} />
        </>
      )}
    </div>
  );
}

/** The copies in the backups folder, newest first, with "Back up now". */
function SavedBackups({ onRestore }: { onRestore: (p: RestoreUpload) => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const list = useQuery({ queryKey: ['backups'], queryFn: () => api.get<BackupList>('/api/admin/backups') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['backups'] });
  const now = useMutation({ mutationFn: () => api.post('/api/admin/backups'), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: (name: string) => api.del(`/api/admin/backups/${name}`),
    onSuccess: refresh,
  });
  const stage = useMutation({
    mutationFn: (name: string) => api.post<RestoreUpload>(`/api/admin/backups/${name}/restore`),
    onSuccess: onRestore,
  });
  const b = list.data;
  return (
    <div className="subtle-box stack-sm">
      <div className="row-between">
        <span className="strong">Saved backups</span>
        <button type="button" className="btn btn-sm btn-dark" onClick={() => now.mutate()} disabled={now.isPending}>
          {now.isPending ? 'Saving…' : 'Back up now'}
        </button>
      </div>
      {b && (
        <span className="small muted">
          In <code>{b.dir}</code>.{' '}
          {b.nextAt ? `Next automatic backup ${new Date(b.nextAt).toLocaleString()}.` : 'Automatic backups are off.'}
        </span>
      )}
      {b?.lastError && (
        <p className="error small" role="alert">
          The last automatic backup failed: {b.lastError}
        </p>
      )}
      {b && b.files.length === 0 && <span className="small muted">No backups saved yet.</span>}
      {b && b.files.length > 0 && (
        <ul className="backup-list">
          {b.files.map((f) => (
            <li key={f.name}>
              <span className="cell-stack">
                <span>{new Date(f.createdAt).toLocaleString()}</span>
                <span className="muted small">
                  {f.name} · {formatBytes(f.bytes)}
                </span>
              </span>
              <span className="row">
                <a className="btn btn-sm" href={`/api/admin/backups/${f.name}`} download>
                  Download
                </a>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={stage.isPending}
                  onClick={() => stage.mutate(f.name)}
                >
                  Restore…
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={async () => {
                    const ok = await confirm({
                      title: 'Delete this backup?',
                      message: `${f.name} is removed from the backups folder.`,
                      confirmLabel: 'Delete',
                      danger: true,
                    });
                    if (ok) remove.mutate(f.name);
                  }}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote error={list.error ?? now.error ?? remove.error ?? stage.error} />
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
