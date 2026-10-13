import { COMMON_AMPS, VERIFY_LABELS, type VerifyStatus } from '@cbt/core';
import { useState } from 'react';

/**
 * Change many breakers at once: rating, poles, a tag, the field check, or move a range up or
 * down. Shown in place of the inspector while selecting.
 */
export function BulkBar({
  count,
  maxPoles,
  rowStep,
  onAmps,
  onPoles,
  onTag,
  onCheck,
  onShift,
  onSelectAll,
  onClear,
  onDone,
}: {
  count: number;
  maxPoles: number;
  /** Spaces in one row: 2 on two-column panels, so a move keeps breakers on their side. */
  rowStep: number;
  onAmps: (amps: number) => void;
  onPoles: (poles: number) => void;
  onTag: (tag: string, add: boolean) => void;
  onCheck: (status: VerifyStatus) => void;
  onShift: (delta: number) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onDone: () => void;
}) {
  const [amps, setAmps] = useState('');
  const [tag, setTag] = useState('');
  const [rows, setRows] = useState('1');
  const none = count === 0;
  return (
    <aside className="inspector bulk-bar" aria-label="Change selected breakers">
      <div className="stack-sm">
        <span className="eyebrow">Select mode</span>
        <h2>{count} selected</h2>
        <p className="muted small">
          Click breakers to add or remove them. Changes save like any other edit, with undo.
        </p>
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={onSelectAll}>
            Select all
          </button>
          <button type="button" className="btn btn-sm" disabled={none} onClick={onClear}>
            Clear
          </button>
          <button type="button" className="btn btn-sm btn-dark" onClick={onDone}>
            Done
          </button>
        </div>
      </div>

      <fieldset className="field" disabled={none}>
        <legend className="field-label">Field check</legend>
        <div className="segmented three">
          {(['verified', 'wrong', ''] as VerifyStatus[]).map((s) => (
            <button key={s || 'none'} type="button" onClick={() => onCheck(s)}>
              {s ? VERIFY_LABELS[s] : 'Not checked'}
            </button>
          ))}
        </div>
      </fieldset>

      <form
        className="bulk-row"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(amps);
          if (Number.isInteger(n) && n > 0) onAmps(n);
        }}
      >
        <label className="field">
          <span className="field-label">Amps</span>
          <input
            type="number"
            min={1}
            list="bulk-amps"
            value={amps}
            disabled={none}
            onChange={(e) => setAmps(e.target.value)}
          />
          <datalist id="bulk-amps">
            {COMMON_AMPS.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        <button className="btn btn-sm" disabled={none || !amps}>
          Set amps
        </button>
      </form>

      <fieldset className="field" disabled={none}>
        <legend className="field-label">Poles</legend>
        <div className="segmented three">
          {[1, 2, 3].map((p) => (
            <button key={p} type="button" disabled={p > maxPoles} onClick={() => onPoles(p)}>
              {p}-pole
            </button>
          ))}
        </div>
      </fieldset>

      <form
        className="bulk-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (tag.trim()) onTag(tag.trim(), true);
        }}
      >
        <label className="field">
          <span className="field-label">Tag</span>
          <input
            value={tag}
            maxLength={30}
            disabled={none}
            placeholder="e.g. Lights"
            onChange={(e) => setTag(e.target.value)}
          />
        </label>
        <button className="btn btn-sm" disabled={none || !tag.trim()}>
          Add
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={none || !tag.trim()}
          onClick={() => onTag(tag.trim(), false)}
        >
          Remove
        </button>
      </form>

      <div className="bulk-row">
        <label className="field">
          <span className="field-label">Move by rows</span>
          <input type="number" min={1} value={rows} disabled={none} onChange={(e) => setRows(e.target.value)} />
        </label>
        <button
          type="button"
          className="btn btn-sm"
          disabled={none}
          onClick={() => onShift(-Number(rows || 1) * rowStep)}
        >
          Up
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={none}
          onClick={() => onShift(Number(rows || 1) * rowStep)}
        >
          Down
        </button>
      </div>
    </aside>
  );
}
