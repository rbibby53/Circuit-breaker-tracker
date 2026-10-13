// Spreadsheet import: read a CSV file or cells pasted from a spreadsheet, work out which column
// is which, turn each row into a breaker, and merge them into a panel's existing breakers. The
// web app shows the result for review before anything is saved, then saves each panel through
// the normal panel save, so validation and history work as for any edit.

import { BACKUPS, PROTECTIONS, isListLayout, type Backup, type PanelLayout, type Protection, type Slot } from './panel';
import { vaFromText } from './voltage';

/** Most rows read from one file. */
export const MAX_IMPORT_ROWS = 20000;

export const IMPORT_FIELDS = [
  'panel',
  'location',
  'voltage',
  'section',
  'circuit',
  'label',
  'amps',
  'poles',
  'loadVa',
  'loadKva',
  'demandPct',
  'serves',
  'tags',
  'notes',
  'critical',
  'spare',
  'protection',
  'backup',
  'frame',
  'wire',
  'conduit',
  'starter',
  'hp',
  'control',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  panel: 'Panel name',
  location: 'Panel location',
  voltage: 'Panel voltage',
  section: 'Section',
  circuit: 'Circuit or unit',
  label: 'Label',
  amps: 'Amps',
  poles: 'Poles',
  loadVa: 'Load (VA)',
  loadKva: 'Load (kVA)',
  demandPct: 'Demand %',
  serves: 'Serves (rooms)',
  tags: 'Tags',
  notes: 'Notes',
  critical: 'Critical',
  spare: 'Spare',
  protection: 'Protection (GFCI, AFCI)',
  backup: 'Backup power',
  frame: 'Frame (A)',
  wire: 'Wire',
  conduit: 'Conduit',
  starter: 'Starter',
  hp: 'HP',
  control: 'Control',
};

// Header names (lower case, letters and digits only) for each field. This app's own CSV export
// reads straight back in.
const ALIASES: Record<ImportField, string[]> = {
  panel: ['panel', 'panelname', 'panelboard', 'pnl', 'board', 'panelid'],
  location: ['location', 'panellocation', 'panelroom'],
  voltage: ['voltage', 'panelvoltage', 'volts', 'system'],
  section: ['section', 'sec', 'panelsection'],
  circuit: [
    'circuit',
    'ckt',
    'cct',
    'circuitno',
    'cktno',
    'circuitnumber',
    'cktnum',
    'no',
    'number',
    'unit',
    'unitno',
    'space',
    'position',
    'pos',
  ],
  label: [
    'label',
    'description',
    'desc',
    'load',
    'loaddescription',
    'circuitdescription',
    'designation',
    'name',
    'servesdescription',
    'loadname',
  ],
  amps: [
    'amps',
    'amp',
    'a',
    'trip',
    'tripamps',
    'tripa',
    'rating',
    'size',
    'breaker',
    'breakersize',
    'bkr',
    'bkrsize',
    'ocpd',
  ],
  poles: ['poles', 'pole', 'p', 'nopoles'],
  loadVa: ['loadva', 'va', 'connectedva', 'connectedload', 'connectedloadva', 'watts', 'w'],
  loadKva: ['kva', 'loadkva', 'connectedkva'],
  demandPct: ['demand', 'demandpct', 'demandfactor', 'df'],
  serves: ['serves', 'room', 'rooms', 'area', 'areaserved', 'roomsserved', 'servesrooms'],
  tags: ['tags', 'tag'],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks'],
  critical: ['critical', 'crit'],
  spare: ['spare'],
  protection: ['protection', 'gfciafci', 'gfci', 'afci'],
  backup: ['backup', 'backuppower', 'emergency'],
  frame: ['frame', 'framea', 'frameamps', 'framesize'],
  wire: ['wire', 'wiresize', 'conductor', 'conductors', 'feeder', 'feederwire'],
  conduit: ['conduit', 'conduitsize', 'raceway'],
  starter: ['starter', 'startersize', 'nemasize'],
  hp: ['hp', 'horsepower', 'motorhp'],
  control: ['control', 'controltype'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Rows of cells from CSV text or cells copied from a spreadsheet (tab-separated). Quoted cells
 * may hold commas, quotes ("") and line breaks. Fully empty rows are dropped.
 */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  const sep = tabs >= commas && tabs >= semis && tabs > 0 ? '\t' : semis > commas ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // This app's export keeps text that looks like a formula as text with a leading quote.
  return rows.map((r) => r.map((c) => c.replace(/^'(?=[=+\-@])/, '').trim())).filter((r) => r.some((c) => c !== ''));
}

/** The likely field of each column from its header, each field used once. */
export function guessMapping(headers: readonly string[]): (ImportField | null)[] {
  const used = new Set<ImportField>();
  return headers.map((h) => {
    const n = norm(h);
    if (!n) return null;
    const hit = IMPORT_FIELDS.find((f) => !used.has(f) && ALIASES[f].includes(n));
    // "Load (VA)" style headers, or a header naming a field followed by words, e.g. "Circuit #".
    const loose =
      hit ??
      (/kva/.test(n) && !used.has('loadKva')
        ? 'loadKva'
        : /va$|^va/.test(n) && !used.has('loadVa')
          ? 'loadVa'
          : IMPORT_FIELDS.find((f) => !used.has(f) && ALIASES[f].some((a) => a.length >= 4 && n.startsWith(a))));
    if (!loose) return null;
    used.add(loose);
    return loose;
  });
}

/** Whether the first row looks like headers rather than data. */
export function looksLikeHeader(row: readonly string[]): boolean {
  return guessMapping(row).filter(Boolean).length >= 2 && !row.some((c) => /^\d+$/.test(c));
}

export interface ParsedCircuit {
  section: number | null;
  /** Space numbers in the order written, e.g. [1, 3, 5]. Empty for a unit like "2A". */
  positions: number[];
  /** Tandem half (21A) on a load center. */
  slot: Slot;
  /** As written (without any section), used as the unit number on a switchboard or MCC. */
  unit: string;
}

/**
 * A circuit number as schedules write it: "5", "1,3,5", "1-3-5", "1/3/5", "1 + 3 + 5", "21A",
 * with an optional section ("S2 · 1 + 3", "Sec 2-1"), or a unit number like "2A".
 */
export function parseCircuit(text: string): ParsedCircuit | null {
  let t = text.trim();
  if (!t) return null;
  let section: number | null = null;
  const sec = /^(?:s|sec|section)\s*(\d)\s*(?:·|:|-|\/|\s)\s*/i.exec(t);
  if (sec) {
    section = Number(sec[1]);
    t = t.slice(sec[0].length);
  }
  t = t.replace(/^(?:ckt|cct|circuit|unit|no\.?|#)\s*/i, '');
  const tandem = /^(\d{1,3})\s*([AB])$/i.exec(t);
  if (tandem) {
    return { section, positions: [Number(tandem[1])], slot: tandem[2]!.toUpperCase() as Slot, unit: t.toUpperCase() };
  }
  if (/^\d{1,3}(\s*(?:,|-|\/|\+|&|\s)\s*\d{1,3})*$/.test(t)) {
    const positions = t.split(/\s*(?:,|-|\/|\+|&|\s)\s*/).map(Number);
    return { section, positions, slot: 'full', unit: t.replace(/\s+/g, '') };
  }
  // A unit number like "2A", "M1" or "3-2".
  if (/^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/.test(t)) return { section, positions: [], slot: 'full', unit: t };
  return null;
}

/** Amps and maybe poles: "20", "20A", "20/1", "100/3", "3P 100A", "1P-20A", "100AT". */
export function parseAmps(text: string): { amps: number | null; poles: number | null } {
  const t = text.trim();
  if (!t) return { amps: null, poles: null };
  const split = /^(\d{1,4})\s*a?t?\s*\/\s*([123])\s*p?$/i.exec(t);
  if (split) return { amps: Number(split[1]), poles: Number(split[2]) };
  const poles = /\b([123])\s*-?\s*p(?:ole)?\b/i.exec(t);
  const rest = poles ? t.replace(poles[0], ' ') : t;
  const amps = /(\d{1,4})\s*(?:a|amp|amps)?\b/i.exec(rest);
  return { amps: amps ? Number(amps[1]) : null, poles: poles ? Number(poles[1]) : null };
}

const YES = /^(y|yes|true|x|1|✓|✔|crit|critical)$/i;

export interface ImportedBreaker {
  /** Row number in the file (1 = first row), for messages. */
  line: number;
  section: number;
  position: number;
  poles: number;
  slot: Slot;
  /** The circuit as written: a switchboard or MCC reads it as the unit number. */
  unit: string;
  /** Fields the row gives a value for; the rest are left as they are. */
  given: Set<keyof ImportedValues>;
  /** Only the fields in `given` are set. */
  values: Partial<ImportedValues>;
  /** Room text as written, resolved by the caller. */
  serves: string[];
}

export interface ImportedValues {
  label: string;
  amps: number;
  notes: string;
  isSpare: boolean;
  critical: boolean;
  protection: Protection;
  backup: Backup;
  loadVa: number | null;
  demandPct: number | null;
  tags: string[];
  frameAmps: number | null;
  wire: string;
  conduit: string;
  starter: string;
  hp: number | null;
  control: string;
}

export interface ImportIssue {
  line: number;
  message: string;
  /** Errors skip the row; warnings are notes on what was assumed. */
  level: 'error' | 'warning';
}

export interface ImportedPanel {
  name: string;
  location: string;
  voltage: string;
  breakers: ImportedBreaker[];
  issues: ImportIssue[];
}

export interface ImportOptions {
  /** Panel name for rows without one (no panel column, or a blank cell). */
  panelName: string;
  /** Rating for breakers the file gives none, since many schedules leave them blank. */
  defaultAmps: number;
}

const num = (s: string) => {
  const n = Number(s.replace(/,/g, '').replace(/%$/, ''));
  return s.trim() && Number.isFinite(n) ? n : null;
};

/**
 * Group the rows of a file by panel and read each into a breaker. `rows` excludes the header.
 * Blank rows, "SPACE" rows and rows with no circuit number are skipped, with a note when they
 * held something.
 */
export function readRows(
  rows: readonly (readonly string[])[],
  mapping: readonly (ImportField | null)[],
  options: ImportOptions,
  firstLine = 2,
): ImportedPanel[] {
  const col = (f: ImportField) => mapping.indexOf(f);
  const get = (r: readonly string[], f: ImportField) => {
    const i = col(f);
    return i < 0 ? '' : (r[i] ?? '').trim();
  };
  const panels = new Map<string, ImportedPanel>();
  rows.slice(0, MAX_IMPORT_ROWS).forEach((r, index) => {
    const line = firstLine + index;
    const name = get(r, 'panel') || options.panelName.trim();
    if (!name) return;
    const key = name.toLowerCase();
    let panel = panels.get(key);
    if (!panel) {
      panel = { name, location: '', voltage: '', breakers: [], issues: [] };
      panels.set(key, panel);
    }
    panel.location ||= get(r, 'location');
    panel.voltage ||= get(r, 'voltage');
    const issue = (message: string, level: ImportIssue['level'] = 'error') =>
      panel.issues.push({ line, message, level });

    const label = get(r, 'label');
    const circuitText = get(r, 'circuit');
    const circuit = parseCircuit(circuitText);
    if (!circuit) {
      if (circuitText) issue(`Circuit "${circuitText}" is not a circuit or unit number; row skipped.`);
      else if (label) issue(`"${label}" has no circuit number; row skipped.`);
      return;
    }
    // A space: nothing installed.
    if (/^(space|spc|-+|blank|empty)$/i.test(label) && !get(r, 'amps')) return;

    const values: Partial<ImportedValues> = {};
    const given = new Set<keyof ImportedValues>();
    const set = <K extends keyof ImportedValues>(k: K, v: ImportedValues[K]) => {
      values[k] = v;
      given.add(k);
    };
    if (label) set('label', label.slice(0, 80));

    const ampsText = get(r, 'amps');
    const parsed = parseAmps(ampsText);
    if (ampsText && parsed.amps === null) issue(`Amps "${ampsText}" is not a number; left as is.`, 'warning');
    if (parsed.amps !== null) {
      if (parsed.amps < 1 || parsed.amps > 4000) {
        issue(`${parsed.amps} A is not a breaker rating; row skipped.`);
        return;
      }
      set('amps', parsed.amps);
    }
    const polesText = get(r, 'poles');
    const polesCol = polesText ? parseAmps(polesText.replace(/^(\d)$/, '$1P')).poles : null;
    if (polesText && polesCol === null) {
      issue(`Poles "${polesText}" should be 1, 2 or 3; row skipped.`);
      return;
    }

    // Poles: from the poles column, else the amps cell (20/1), else the circuit numbers (1,3,5).
    const fromPositions = circuit.positions.length > 1 ? circuit.positions.length : null;
    const poles = polesCol ?? parsed.poles ?? fromPositions ?? 1;
    if (poles > 3) {
      issue(`Circuit ${circuitText} lists more than 3 spaces; row skipped.`);
      return;
    }
    if (fromPositions && fromPositions !== poles) {
      issue(
        `Circuit ${circuitText} lists ${fromPositions} spaces but the row says ${poles}-pole; used ${poles}.`,
        'warning',
      );
    }

    const sectionText = get(r, 'section');
    const sectionNum = sectionText ? num(sectionText.replace(/^\D+/, '')) : null;
    const section = circuit.section ?? (sectionNum && sectionNum >= 1 && sectionNum <= 6 ? sectionNum : 1);

    const va = get(r, 'loadVa');
    const kva = get(r, 'loadKva');
    if (va) {
      const n = num(va) ?? vaFromText(va);
      if (n === null || n < 0) issue(`Load "${va}" is not a number of VA; left as is.`, 'warning');
      else set('loadVa', Math.round(n));
    } else if (kva) {
      const n = num(kva.replace(/\s*kva$/i, ''));
      if (n === null || n < 0) issue(`Load "${kva}" is not a number of kVA; left as is.`, 'warning');
      else set('loadVa', Math.round(n * 1000));
    }
    const demand = get(r, 'demandPct');
    if (demand) {
      const n = num(demand);
      // 0.8 reads as 80%.
      const pct = n === null ? null : n > 0 && n <= 1 && /\./.test(demand) ? Math.round(n * 100) : Math.round(n);
      if (pct === null || pct < 0 || pct > 200) issue(`Demand "${demand}" is not a percentage; left as is.`, 'warning');
      else set('demandPct', pct);
    }
    const notes = get(r, 'notes');
    if (notes) set('notes', notes.slice(0, 1000));
    const tags = get(r, 'tags');
    if (tags) {
      set(
        'tags',
        [
          ...new Set(
            tags
              .split(/[;,]/)
              .map((t) => t.trim().slice(0, 30))
              .filter(Boolean),
          ),
        ].slice(0, 10),
      );
    }
    const critical = get(r, 'critical');
    if (critical) set('critical', YES.test(critical));
    const spareText = get(r, 'spare');
    if (spareText) set('isSpare', YES.test(spareText) || /^spare$/i.test(spareText));
    else if (/^spare\b/i.test(label)) set('isSpare', true);
    const protection = get(r, 'protection')
      .toLowerCase()
      .replace(/[^a-z/]/g, '');
    if (protection) {
      const p =
        PROTECTIONS.find((x) => x === protection || x.replace('-', '/') === protection) ??
        (/gfci/.test(protection) && /afci/.test(protection)
          ? 'dual'
          : /gfci|gfi/.test(protection)
            ? 'gfci'
            : /afci/.test(protection)
              ? 'afci'
              : null);
      if (p) set('protection', p as Protection);
      else if (!/^(no|none|standard|std)$/.test(protection))
        issue(`Protection "${get(r, 'protection')}" is not GFCI or AFCI.`, 'warning');
      else set('protection', 'standard');
    }
    const backup = get(r, 'backup').toLowerCase();
    if (backup) {
      const b = /ups/.test(backup)
        ? 'ups'
        : /gen|emerg|yes/.test(backup)
          ? 'generator'
          : /none|no/.test(backup)
            ? 'none'
            : null;
      if (b && (BACKUPS as readonly string[]).includes(b)) set('backup', b as Backup);
    }
    const frame = get(r, 'frame');
    if (frame) {
      const n = parseAmps(frame).amps;
      if (n) set('frameAmps', n);
    }
    for (const k of ['wire', 'conduit', 'starter', 'control'] as const) {
      const v = get(r, k);
      if (v) set(k, v.slice(0, k === 'wire' ? 80 : k === 'control' ? 120 : 40));
    }
    const hp = get(r, 'hp');
    if (hp) {
      const n = num(hp.replace(/\s*hp$/i, ''));
      if (n === null) issue(`HP "${hp}" is not a number; left as is.`, 'warning');
      else set('hp', n);
    }

    const serves = get(r, 'serves')
      .split(/;|\n/)
      .map((s) => s.trim())
      .filter((s) => s && !/more not shown$/.test(s));

    panel.breakers.push({
      line,
      section,
      position: circuit.positions.length ? Math.min(...circuit.positions) : 0,
      poles,
      slot: circuit.slot,
      unit: circuit.unit,
      given,
      values,
      serves,
    });
  });
  for (const p of panels.values()) {
    const missing = p.breakers.filter((b) => !b.given.has('amps') && !b.values.isSpare).length;
    if (missing && options.defaultAmps) {
      p.issues.push({
        line: 0,
        level: 'warning',
        message: `${missing} ${missing === 1 ? 'breaker has' : 'breakers have'} no rating; new ones get ${options.defaultAmps} A and stay "Not checked".`,
      });
    }
  }
  return [...panels.values()];
}

/** The parts of an editor breaker an import can set. */
export interface MergeBreaker extends ImportedValues {
  key: string;
  id?: number;
  section: number;
  position: number;
  poles: number;
  slot: Slot;
  unit: string;
  serves: { locationId: number; note: string; hidden?: boolean }[];
}

export type ImportChange =
  | { kind: 'new'; key: string; line: number; circuit: string; label: string }
  | { kind: 'changed'; key: string; line: number; circuit: string; label: string; fields: string[] }
  | { kind: 'same'; key: string; line: number; circuit: string; label: string }
  | { kind: 'removed'; key: string; circuit: string; label: string };

const FIELD_NAMES: Partial<Record<keyof MergeBreaker, string>> = {
  label: 'label',
  amps: 'amps',
  poles: 'poles',
  notes: 'notes',
  isSpare: 'spare',
  critical: 'critical',
  protection: 'protection',
  backup: 'backup',
  loadVa: 'load',
  demandPct: 'demand',
  tags: 'tags',
  frameAmps: 'frame',
  wire: 'wire',
  conduit: 'conduit',
  starter: 'starter',
  hp: 'HP',
  control: 'control',
  serves: 'rooms',
  position: 'position',
  slot: 'slot',
};

/** A field's value for telling whether an import changed it: rooms in any order. */
function comparable(k: keyof MergeBreaker, v: unknown): string {
  if (k !== 'serves') return JSON.stringify(v ?? null);
  return JSON.stringify((v as MergeBreaker['serves']).map((s) => `${s.locationId}:${s.note}`).sort());
}

/**
 * Merge imported breakers into a panel's breakers. A row matches the breaker at the same section
 * and position (or, on a switchboard or MCC, the same unit number) and only changes what the row
 * gives. Rows matching nothing become new breakers from `make`. With `replace`, breakers the file
 * does not list are removed.
 */
export function mergeBreakers<T extends MergeBreaker>(
  panel: { layout: PanelLayout },
  existing: readonly T[],
  rows: readonly ImportedBreaker[],
  resolveServes: (row: ImportedBreaker) => { locationId: number; note: string }[] | null,
  make: (row: ImportedBreaker) => T,
  replace: boolean,
): { breakers: T[]; changes: ImportChange[] } {
  const list = isListLayout(panel);
  let nextUnit = Math.max(0, ...existing.map((b) => b.position)) + 1;
  // On a switchboard or MCC the circuit is a unit: "3" is unit 3, "2A" is numbered after the last.
  const asRow = (row: ImportedBreaker): ImportedBreaker => {
    if (!list) return { ...row, unit: '' };
    const plain = /^\d+$/.test(row.unit);
    return {
      ...row,
      slot: 'full',
      poles: row.poles,
      position: plain ? Number(row.unit) : 0,
      unit: plain ? '' : row.unit,
    };
  };
  const keyOf = (b: { section: number; position: number; unit: string; slot: Slot }) =>
    list ? `${b.section}:${b.unit.trim().toLowerCase() || b.position}` : `${b.section}:${b.position}:${b.slot}`;
  const byKey = new Map(existing.map((b) => [keyOf(b), b]));
  const touched = new Set<string>();
  const out = new Map(existing.map((b) => [b.key, b]));
  const changes: ImportChange[] = [];
  const circuitOf = (b: { section: number; position: number; poles: number; unit: string; slot: Slot }) => {
    const prefix = b.section > 1 ? `S${b.section} · ` : '';
    if (list) return prefix + (b.unit || String(b.position));
    return prefix + String(b.position) + (b.slot === 'full' ? '' : b.slot) + (b.poles > 1 ? ` (${b.poles}P)` : '');
  };

  for (const given of rows) {
    const row = asRow(given);
    const match = byKey.get(keyOf(row));
    const serves = resolveServes(row);
    if (match && !touched.has(match.key)) {
      touched.add(match.key);
      const next = { ...match } as T;
      for (const k of row.given) (next as MergeBreaker)[k] = row.values[k] as never;
      if (!list && row.poles !== match.poles) next.poles = row.poles;
      if (serves) next.serves = [...serves, ...match.serves.filter((s) => s.hidden)];
      if (next.loadVa === null) next.demandPct = null;
      const fields = (Object.keys(FIELD_NAMES) as (keyof MergeBreaker)[]).filter(
        (k) => comparable(k, next[k]) !== comparable(k, match[k]),
      );
      out.set(match.key, next);
      changes.push(
        fields.length
          ? {
              kind: 'changed',
              key: match.key,
              line: row.line,
              circuit: circuitOf(next),
              label: next.label,
              fields: fields.map((k) => FIELD_NAMES[k]!),
            }
          : { kind: 'same', key: match.key, line: row.line, circuit: circuitOf(next), label: next.label },
      );
      continue;
    }
    const fresh = make(list && !row.position ? { ...row, position: nextUnit++ } : row);
    if (list) nextUnit = Math.max(nextUnit, fresh.position + 1);
    if (serves) fresh.serves = serves;
    touched.add(fresh.key);
    out.set(fresh.key, fresh);
    byKey.set(keyOf(fresh), fresh);
    changes.push({ kind: 'new', key: fresh.key, line: row.line, circuit: circuitOf(fresh), label: fresh.label });
  }
  if (replace) {
    for (const b of existing) {
      if (touched.has(b.key)) continue;
      out.delete(b.key);
      changes.push({ kind: 'removed', key: b.key, circuit: circuitOf(b), label: b.label });
    }
  }
  return { breakers: [...out.values()], changes };
}

/** Smallest standard size that holds `highest` spaces on a new panel of this layout. */
export function spacesToFit(layout: PanelLayout, highest: number): number {
  if (isListLayout({ layout })) return Math.max(1, highest);
  const sizes =
    layout === 'commercial'
      ? [18, 24, 30, 42, 54, 66, 84]
      : layout === 'residential'
        ? [12, 16, 20, 24, 30, 40, 42, 60, 84]
        : [];
  return sizes.find((s) => s >= highest) ?? Math.max(2, highest + (highest % 2));
}

export interface PlaceCandidate {
  id: number;
  name: string;
  /** "KSU › Main campus › Science Hall › Floor 1 › Lab 110" */
  path: string;
}

const pathKey = (s: string) =>
  s
    .split(/\s*(?:›|>|\/|\\)\s*/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .join('›');

/**
 * The location a cell names: a full or partial path ending in the location's name, its name
 * alone, or a room number in the text ("RECEPT ROOM 3002" → 3002). Null when none or several.
 */
export function matchPlace(text: string, places: readonly PlaceCandidate[]): PlaceCandidate | null {
  const t = text.trim();
  if (!t) return null;
  const key = pathKey(t);
  const unique = (found: PlaceCandidate[]) => (found.length === 1 ? found[0]! : null);
  const exact = places.filter((p) => pathKey(p.path) === key);
  if (exact.length) return unique(exact);
  const tail = places.filter((p) => pathKey(p.path).endsWith(`›${key}`) || pathKey(p.name) === key);
  if (tail.length) return unique(tail);
  const numbers = t.match(/\b\d{3,5}[A-Za-z]?\b/g);
  if (numbers?.length === 1) {
    const n = numbers[0]!.replace(/^0+/, '').toLowerCase();
    return unique(
      places.filter((p) =>
        (p.name.match(/\b\d{3,5}[A-Za-z]?\b/g) ?? []).some((x) => x.replace(/^0+/, '').toLowerCase() === n),
      ),
    );
  }
  return null;
}

/** "Lab 110 (bench outlets)": a location and a note, as this app's export writes them. */
export function splitServe(text: string): { place: string; note: string } {
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(text);
  return m && m[1] ? { place: m[1], note: m[2]!.slice(0, 120) } : { place: text, note: '' };
}
