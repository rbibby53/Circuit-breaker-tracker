import {
  BACKUPS,
  BACKUP_LABELS,
  COMMON_AMPS,
  PROTECTIONS,
  PROTECTION_LABELS,
  allowsTandem,
  circuitLabel,
  circuitVolts,
  maxPoles,
  phasesOf,
  type BreakerDto,
  type Slot,
} from '@cbt/core';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useConfirm } from '../components/ConfirmDialog';
import type { TreeNode } from '../tree';
import { servesByFloor } from './serves';
import { ServesPicker } from './ServesPicker';
import { sizeOf, validStarts, type EditBreaker, type EditPanel, type Size } from './state';

interface Props {
  doc: EditPanel;
  breaker: EditBreaker;
  server: BreakerDto | undefined;
  byId: Map<number, TreeNode>;
  site: TreeNode | null;
  readOnly: boolean;
  onPatch: (patch: Partial<EditBreaker>, coalesce?: string) => void;
  onSize: (size: Size) => void;
  onMove: (position: number, slot?: Slot) => void;
  onRemove: () => void;
}

export function Inspector({ doc, breaker: b, server, byId, site, readOnly, onPatch, onSize, onMove, onRemove }: Props) {
  const [picking, setPicking] = useState(false);
  const confirm = useConfirm();
  const size = sizeOf(b);
  const groups = servesByFloor(byId, b.serves);
  const hidden = b.serves.filter((s) => s.hidden || !byId.has(s.locationId)).length;
  const feeds = server?.feeds ?? [];
  const sizes: { value: Size; label: string; disabled?: string }[] = [
    { value: '1', label: '1-pole' },
    { value: '2', label: '2-pole' },
    {
      value: '3',
      label: '3-pole',
      disabled: maxPoles(doc) < 3 ? 'Split-phase panels have no 3-pole breakers' : undefined,
    },
    {
      value: 'tandem',
      label: 'Tandem',
      disabled: allowsTandem(doc) ? undefined : 'Three-phase panelboards take no tandems',
    },
  ];
  const phases = phasesOf(doc, b);
  const volts = circuitVolts(doc.voltage, b.poles);
  const where = [
    `Circuit ${circuitLabel(doc, b)}`,
    phases.length ? `Phase ${phases.join(' ')}` : null,
    volts ? `${volts} V` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (readOnly) {
    return (
      <aside className="inspector" aria-label="Breaker details">
        <span className="eyebrow">{where}</span>
        <h2>{b.label || 'Unlabelled'}</h2>
        <dl className="facts">
          <dt>Size</dt>
          <dd>{size === 'tandem' ? 'Tandem (half space)' : `${b.poles}-pole`}</dd>
          <dt>Amps</dt>
          <dd>{b.amps}A</dd>
          <dt>Type</dt>
          <dd>{PROTECTION_LABELS[b.protection]}</dd>
          <dt>Flags</dt>
          <dd>
            {[b.critical && 'Critical', b.backup !== 'none' && `On ${BACKUP_LABELS[b.backup]}`, b.isSpare && 'Spare']
              .filter(Boolean)
              .join(', ') || 'None'}
          </dd>
          <dt>Serves</dt>
          <dd>
            {groups.flatMap((g) => g.items.map((i) => (g.floor ? `${g.floor} · ${i.label}` : i.label))).join(', ') ||
              'Not tagged'}
            {hidden > 0 && ` (+${hidden} outside your access)`}
          </dd>
        </dl>
        {feeds.length > 0 && <FeedsNote feeds={feeds} />}
        {b.notes && <p className="notes">{b.notes}</p>}
      </aside>
    );
  }

  return (
    <aside className="inspector" aria-label="Breaker details">
      <div className="stack-sm">
        <span className="eyebrow">{where}</span>
        <h2>{b.label || 'New breaker'}</h2>
      </div>

      <label className="field">
        <span className="field-label">Label</span>
        <input
          value={b.label}
          autoFocus={!b.label}
          placeholder="What does it power?"
          onChange={(e) => onPatch({ label: e.target.value }, `label:${b.key}`)}
        />
      </label>

      <fieldset className="field">
        <legend className="field-label">Size</legend>
        <div className="segmented four">
          {sizes.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={size === s.value}
              disabled={!!s.disabled}
              title={s.disabled}
              onClick={() => onSize(s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="two-col">
        <label className="field">
          <span className="field-label">Starts at space</span>
          <select value={b.position} onChange={(e) => onMove(Number(e.target.value))}>
            {validStarts(doc, b.key).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        {size === 'tandem' ? (
          <label className="field">
            <span className="field-label">Half</span>
            <select value={b.slot} onChange={(e) => onMove(b.position, e.target.value as Slot)}>
              <option value="A">A (top)</option>
              <option value="B">B (bottom)</option>
            </select>
          </label>
        ) : (
          <span />
        )}
      </div>

      <div className="two-col">
        <label className="field">
          <span className="field-label">Amps</span>
          <input
            type="number"
            min={1}
            max={4000}
            list="amp-sizes"
            value={b.amps}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isInteger(v) && v > 0) onPatch({ amps: v }, `amps:${b.key}`);
            }}
          />
          <datalist id="amp-sizes">
            {COMMON_AMPS.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span className="field-label">Protection</span>
          <select
            value={b.protection}
            onChange={(e) => onPatch({ protection: e.target.value as EditBreaker['protection'] })}
          >
            {PROTECTIONS.map((p) => (
              <option key={p} value={p}>
                {PROTECTION_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="flags">
        <legend className="field-label">Flags</legend>
        <label className="check">
          <input type="checkbox" checked={b.critical} onChange={(e) => onPatch({ critical: e.target.checked })} />
          <span>
            <span className="strong">Critical</span>
            <span className="muted small block">Printed in bold with a marker. Check before switching off.</span>
          </span>
        </label>
        <div className="field">
          <span className="field-label">Backup power</span>
          <div className="segmented three">
            {BACKUPS.map((k) => (
              <button key={k} type="button" aria-pressed={b.backup === k} onClick={() => onPatch({ backup: k })}>
                {BACKUP_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={b.isSpare} onChange={(e) => onPatch({ isSpare: e.target.checked })} />
          <span>
            <span className="strong">Spare</span>
            <span className="muted small block">A breaker is installed but nothing is connected.</span>
          </span>
        </label>
      </fieldset>

      <div className="field">
        <div className="row-between">
          <span className="field-label">Serves</span>
          {site && (
            <button type="button" className="btn btn-sm" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>
              {picking ? 'Done' : 'Choose rooms'}
            </button>
          )}
        </div>
        {picking && site ? (
          <ServesPicker site={site} serves={b.serves} onChange={(serves) => onPatch({ serves })} />
        ) : (
          <div className="serve-groups">
            {groups.length === 0 && hidden === 0 && <span className="muted small">Not tagged yet.</span>}
            {groups.map((g) => (
              <div key={g.floor} className="serve-group">
                {g.floor && <span className="serve-floor">{g.floor}</span>}
                {g.items.map((i) => (
                  <span key={i.locationId} className="tag">
                    {i.label}
                  </span>
                ))}
              </div>
            ))}
            {hidden > 0 && <span className="muted small">+{hidden} outside your access (kept as is)</span>}
          </div>
        )}
      </div>

      <label className="field">
        <span className="field-label">Notes</span>
        <textarea rows={2} value={b.notes} onChange={(e) => onPatch({ notes: e.target.value }, `notes:${b.key}`)} />
      </label>

      {feeds.length > 0 && <FeedsNote feeds={feeds} />}

      <button
        type="button"
        className="btn btn-danger"
        onClick={async () => {
          const ok = await confirm({
            title: `Remove ${b.label || 'this breaker'}?`,
            message: feeds.length
              ? `It feeds ${feeds.map((f) => f.panelName).join(', ')}, which will be unlinked. You can undo this.`
              : 'You can undo this.',
            confirmLabel: 'Remove',
            danger: true,
          });
          if (ok) onRemove();
        }}
      >
        Remove breaker
      </button>
    </aside>
  );
}

function FeedsNote({ feeds }: { feeds: BreakerDto['feeds'] }) {
  return (
    <p className="feeds-note">
      Feeds{' '}
      {feeds.map((f, i) => (
        <span key={f.panelId}>
          {i > 0 && ', '}
          <Link to={`/panels/${f.panelId}`}>{f.panelName}</Link>
        </span>
      ))}
    </p>
  );
}
