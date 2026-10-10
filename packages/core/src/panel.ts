// Panel layout engine: where breakers sit, what they occupy, and whether a layout is valid.
// The editor, thumbnails and (later) the PDF all draw from these functions.

export const PANEL_LAYOUTS = ['residential', 'commercial', 'single'] as const;
export type PanelLayout = (typeof PANEL_LAYOUTS)[number];

/** Layouts that can be created today. Commercial 3-phase and single column come later. */
export const AVAILABLE_LAYOUTS: readonly PanelLayout[] = ['residential'];

export const LAYOUT_LABELS: Record<PanelLayout, string> = {
  residential: 'Residential load center',
  commercial: 'Commercial panelboard',
  single: 'Single column',
};

export const PROTECTIONS = ['standard', 'gfci', 'afci', 'dual'] as const;
export type Protection = (typeof PROTECTIONS)[number];
export const PROTECTION_LABELS: Record<Protection, string> = {
  standard: 'Standard',
  gfci: 'GFCI',
  afci: 'AFCI',
  dual: 'Dual function',
};

export const BACKUPS = ['none', 'ups', 'generator'] as const;
export type Backup = (typeof BACKUPS)[number];
export const BACKUP_LABELS: Record<Backup, string> = { none: 'None', ups: 'UPS', generator: 'Generator' };

/** `full` takes the whole space; `A`/`B` are the two halves of a tandem space. */
export const SLOTS = ['full', 'A', 'B'] as const;
export type Slot = (typeof SLOTS)[number];

export const MAIN_TYPES = ['breaker', 'lugs'] as const;
export type MainType = (typeof MAIN_TYPES)[number];

export const COMMON_AMPS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200];

export interface PanelShape {
  layout: PanelLayout;
  spaces: number;
}

export interface BreakerShape {
  key: string;
  position: number;
  slot: Slot;
  poles: number;
  label?: string;
}

export const MIN_SPACES = 2;
export const MAX_SPACES = 84;

/** Number of columns of spaces. */
export function columnsFor(panel: PanelShape): number {
  return panel.layout === 'single' ? 1 : 2;
}

/** Number of rows of spaces. */
export function rowsFor(panel: PanelShape): number {
  return Math.ceil(panel.spaces / columnsFor(panel));
}

/** Most poles a single breaker may have on this panel. Split-phase panels have no 3-pole breakers. */
export function maxPoles(panel: PanelShape): number {
  return panel.layout === 'commercial' ? 3 : 2;
}

/** Spaces between one pole and the next pole of the same breaker (straight down its column). */
function step(panel: PanelShape): number {
  return columnsFor(panel);
}

/** Every space number a breaker occupies, top to bottom. */
export function positionsOf(panel: PanelShape, b: Pick<BreakerShape, 'position' | 'poles'>): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.poles; i++) out.push(b.position + i * step(panel));
  return out;
}

/** Column (0 = left) and row (1-based) of a space. Odd numbers left, even right. */
export function cellOf(panel: PanelShape, position: number): { column: number; row: number } {
  const cols = columnsFor(panel);
  return { column: (position - 1) % cols, row: Math.ceil(position / cols) };
}

/** "6 + 8", "21A" or "5". */
export function circuitLabel(panel: PanelShape, b: Pick<BreakerShape, 'position' | 'poles' | 'slot'>): string {
  const suffix = b.slot === 'full' ? '' : b.slot;
  return positionsOf(panel, b)
    .map((p) => `${p}${suffix}`)
    .join(' + ');
}

export interface LayoutIssue {
  key: string | null;
  message: string;
}

const name = (b: BreakerShape) => (b.label?.trim() ? `"${b.label.trim()}"` : `the breaker at ${b.position}`);

export function validatePanelShape(panel: PanelShape): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  if (!Number.isInteger(panel.spaces) || panel.spaces < MIN_SPACES || panel.spaces > MAX_SPACES) {
    issues.push({ key: null, message: `A panel needs between ${MIN_SPACES} and ${MAX_SPACES} spaces.` });
  } else if (columnsFor(panel) === 2 && panel.spaces % 2 !== 0) {
    issues.push({ key: null, message: 'A two-column panel needs an even number of spaces.' });
  }
  return issues;
}

/** Everything wrong with a set of breakers on a panel. Empty means valid. */
export function validateLayout(panel: PanelShape, breakers: readonly BreakerShape[]): LayoutIssue[] {
  const issues = validatePanelShape(panel);
  if (issues.length) return issues;

  const taken = new Map<number, { full?: BreakerShape; A?: BreakerShape; B?: BreakerShape }>();
  const keys = new Set<string>();

  for (const b of breakers) {
    if (keys.has(b.key)) issues.push({ key: b.key, message: 'Duplicate breaker.' });
    keys.add(b.key);

    if (!Number.isInteger(b.poles) || b.poles < 1 || b.poles > maxPoles(panel)) {
      issues.push({
        key: b.key,
        message:
          b.poles === 3 && maxPoles(panel) === 2
            ? `${name(b)} is 3-pole, but this split-phase panel only takes 1- and 2-pole breakers.`
            : `${name(b)} must have between 1 and ${maxPoles(panel)} poles.`,
      });
      continue;
    }
    if (b.slot !== 'full' && b.poles !== 1) {
      issues.push({ key: b.key, message: `${name(b)}: tandem breakers are single-pole.` });
      continue;
    }
    const spots = positionsOf(panel, b);
    if (!Number.isInteger(b.position) || spots.some((p) => p < 1 || p > panel.spaces)) {
      issues.push({ key: b.key, message: `${name(b)} does not fit: this panel has ${panel.spaces} spaces.` });
      continue;
    }
    for (const p of spots) {
      const cell = taken.get(p) ?? {};
      const clash = b.slot === 'full' ? (cell.full ?? cell.A ?? cell.B) : (cell.full ?? cell[b.slot]);
      if (clash) {
        issues.push({ key: b.key, message: `Space ${p} is already used by ${name(clash)}.` });
        break;
      }
      cell[b.slot] = b;
      taken.set(p, cell);
    }
  }
  return issues;
}

/** What is free at a space: the whole space, or either tandem half. */
export function freeAt(
  panel: PanelShape,
  breakers: readonly BreakerShape[],
  position: number,
  ignoreKey?: string,
): { full: boolean; A: boolean; B: boolean } {
  let full = false;
  let A = false;
  let B = false;
  for (const b of breakers) {
    if (b.key === ignoreKey) continue;
    if (!positionsOf(panel, b).includes(position)) continue;
    if (b.slot === 'full') full = A = B = true;
    else if (b.slot === 'A') A = true;
    else B = true;
  }
  return { full: !full && !A && !B, A: !full && !A, B: !full && !B };
}

/**
 * Check a proposed change: `next` replaces the breaker with the same key (or is added).
 * Returns the first problem, or null when the change is fine.
 */
export function checkChange(panel: PanelShape, breakers: readonly BreakerShape[], next: BreakerShape): string | null {
  const others = breakers.filter((b) => b.key !== next.key);
  const issues = validateLayout(panel, [...others, next]);
  return issues.find((i) => i.key === next.key)?.message ?? issues[0]?.message ?? null;
}
