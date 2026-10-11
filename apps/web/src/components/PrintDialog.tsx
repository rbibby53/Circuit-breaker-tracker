import { PAPER_SIZES, type PaperSize } from '@cbt/core';
import { useEffect, useRef, useState } from 'react';
import { useAuthConfig } from '../auth';

interface PrintStyle {
  value: string;
  title: string;
  description: string;
}

const PAPER_LABELS: Record<PaperSize, string> = { letter: 'US Letter', a4: 'A4' };
const PAPER_KEY = 'cbt-paper';

function rememberedPaper(): PaperSize | null {
  try {
    const v = localStorage.getItem(PAPER_KEY);
    return PAPER_SIZES.includes(v as PaperSize) ? (v as PaperSize) : null;
  } catch {
    return null;
  }
}

function rememberPaper(p: PaperSize): void {
  try {
    localStorage.setItem(PAPER_KEY, p);
  } catch {
    // Private windows may refuse storage; the default is fine.
  }
}

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/**
 * A Print button that opens a dialog to pick what to print and on which paper, then opens the
 * PDF in a new tab or downloads it.
 */
export function PrintButton({
  endpoint,
  csv,
  styles,
  subject,
  beforeOpen,
  warning,
}: {
  /** e.g. /api/panels/4/pdf */
  endpoint: string;
  /** The same data as a spreadsheet, e.g. /api/panels/4/csv */
  csv: string;
  styles: PrintStyle[];
  subject: string;
  /** Runs before the dialog opens, e.g. to save pending edits so the PDF includes them. */
  beforeOpen?: () => Promise<void>;
  /** Shown in the dialog, e.g. when the latest edits could not be saved. */
  warning?: string | null;
}) {
  const config = useAuthConfig();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [style, setStyle] = useState(styles[0]!.value);
  // Until someone picks a size, follow the admin's default.
  const [chosenPaper, setChosenPaper] = useState<PaperSize | null>(rememberedPaper);
  const paper = chosenPaper ?? config.data?.paperSize ?? 'letter';
  // Label sheet: blank labels to leave at the start of a partly used sheet.
  const [skip, setSkip] = useState(0);
  // Label strips: breaker spacing in inches.
  const [pitch, setPitch] = useState<'1' | '0.75'>('1');

  useEffect(() => {
    const d = dialog.current;
    if (open && d && !d.open) d.showModal();
    if (!open && d?.open) d.close();
  }, [open]);

  const show = async () => {
    setBusy(true);
    try {
      await beforeOpen?.();
    } finally {
      setBusy(false);
      setOpen(true);
    }
  };

  const url = (download: boolean) => {
    const q = new URLSearchParams({ style, paper, tz: timeZone() });
    if (style === 'labels' && skip > 0) q.set('skip', String(skip));
    if (style === 'strips') q.set('pitch', pitch);
    if (download) q.set('download', '1');
    return `${endpoint}?${q}`;
  };

  return (
    <>
      <button type="button" className="btn" onClick={() => void show()} disabled={busy}>
        {busy ? 'Saving…' : 'Print & export'}
      </button>
      <dialog
        ref={dialog}
        className="dialog print-dialog"
        aria-labelledby="print-title"
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
      >
        {open && (
          <div className="stack">
            <h2 id="print-title">Print or export {subject}</h2>
            {warning && <p className="error">{warning}</p>}
            <fieldset className="print-options">
              <legend className="field-label">What to print</legend>
              {styles.map((s) => (
                <label key={s.value} className="print-option">
                  <input
                    type="radio"
                    name="print-style"
                    value={s.value}
                    checked={style === s.value}
                    onChange={() => setStyle(s.value)}
                  />
                  <span className="stack-sm">
                    <span className="strong">{s.title}</span>
                    <span className="small muted">{s.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {style === 'labels' && (
              <label className="field">
                <span className="field-label">Labels already used on the sheet</span>
                <input
                  type="number"
                  min={0}
                  max={paper === 'a4' ? 64 : 79}
                  value={skip}
                  onChange={(e) => setSkip(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                />
                <span className="small muted">
                  Printing starts after them, going down each column, so a part-used sheet is not wasted.
                </span>
              </label>
            )}
            {style === 'strips' && (
              <div className="field">
                <span className="field-label" id="pitch-label">
                  Breaker spacing
                </span>
                <div className="segmented two" role="group" aria-labelledby="pitch-label">
                  {(
                    [
                      ['1', '1 inch (Homeline, Eaton BR, Siemens, GE)'],
                      ['0.75', '¾ inch (Square D QO, Eaton CH)'],
                    ] as const
                  ).map(([v, label]) => (
                    <button key={v} type="button" aria-pressed={pitch === v} onClick={() => setPitch(v)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="field">
              <span className="field-label" id="paper-label">
                Paper
              </span>
              <div className="segmented two" role="group" aria-labelledby="paper-label">
                {PAPER_SIZES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={paper === p}
                    onClick={() => {
                      setChosenPaper(p);
                      rememberPaper(p);
                    }}
                  >
                    {PAPER_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>
            <p className="small muted">
              Need it in a spreadsheet?{' '}
              <a href={csv} download onClick={() => setOpen(false)}>
                Download every breaker as CSV
              </a>
              , for Excel, Numbers or Google Sheets.
            </p>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Close
              </button>
              <a className="btn" href={url(true)} download onClick={() => setOpen(false)}>
                Download
              </a>
              <a
                className="btn btn-dark"
                href={url(false)}
                target="_blank"
                rel="noopener"
                onClick={() => setOpen(false)}
                autoFocus
              >
                Open PDF
              </a>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

export const PANEL_PRINT_STYLES: PrintStyle[] = [
  {
    value: 'sheet',
    title: 'Panel sheet',
    description: 'A full page laid out like the panel, with what every breaker serves, markers and notes.',
  },
  {
    value: 'door',
    title: 'Door card',
    description: 'A 4-inch-wide card to cut out and keep inside the panel door.',
  },
  {
    value: 'labels',
    title: 'Breaker labels (sticker sheet)',
    description:
      'One sticker per circuit: Avery 5167 on Letter (80 per sheet), Avery L7651 on A4 (65 per sheet). Print at 100%.',
  },
  {
    value: 'strips',
    title: 'Breaker label strips',
    description: 'Strips to cut out and stick beside each column of breakers, spaced to line up with them.',
  },
];

export function locationPrintStyles(name: string): PrintStyle[] {
  return [
    {
      value: 'book',
      title: 'Panel book',
      description: `A cover with contents, a sheet for every panel in ${name}, then the room index.`,
    },
    {
      value: 'index',
      title: 'Room index',
      description: 'Which breakers serve each room, grouped by floor.',
    },
  ];
}
