// Panel layout engine: where breakers sit, what they occupy, and whether a layout is valid.
// The editor, thumbnails and the PDF all draw from these functions.

export const PANEL_LAYOUTS = ['residential', 'commercial', 'single', 'relay', 'switchboard', 'mcc'] as const;
export type PanelLayout = (typeof PANEL_LAYOUTS)[number];

/** Layouts that can be created today. Single column comes later. */
export const AVAILABLE_LAYOUTS: readonly PanelLayout[] = ['residential', 'commercial', 'switchboard', 'mcc', 'relay'];

export const LAYOUT_LABELS: Record<PanelLayout, string> = {
  residential: 'Residential load center',
  commercial: 'Commercial panelboard',
  single: 'Single column',
  relay: 'Lighting relay panel',
  switchboard: 'Switchboard / distribution board',
  mcc: 'Motor control center (MCC)',
};

/**
 * Switchboards, distribution boards and motor control centers number their feeders 1, 2, 3…
 * as units, one per row, rather than by pole position.
 */
export const isListLayout = (panel: { layout: PanelLayout }) =>
  panel.layout === 'switchboard' || panel.layout === 'mcc';

/** Common MCC starter sizes and control types, offered as suggestions. */
export const STARTER_SIZES = [
  'NEMA 00',
  'NEMA 0',
  'NEMA 1',
  'NEMA 2',
  'NEMA 3',
  'NEMA 4',
  'NEMA 5',
  'NEMA 6',
  'VFD',
  'Soft starter',
];
export const MCC_CONTROLS = ['FVNR', 'FVR', '2S1W', 'RVSS', 'VFD', 'HOA', 'Feeder'];

/** One section of a panel: two halves of a double-tub panel each numbered from 1, say. */
export interface PanelSection {
  name: string;
  spaces: number;
  /** Fed through the lugs of the section before it. */
  throughLugs: boolean;
}

/** Every section of a panel, the first being the panel itself. */
export function sectionsOf(panel: { spaces: number; sections?: readonly PanelSection[] }): PanelSection[] {
  return [{ name: 'Section 1', spaces: panel.spaces, throughLugs: false }, ...(panel.sections ?? [])];
}

/** The shape of one section, for laying out its breakers. */
export function sectionShape(
  panel: { layout: PanelLayout; spaces: number; sections?: readonly PanelSection[] },
  section: number,
): PanelShape {
  const list = sectionsOf(panel);
  return { layout: panel.layout, spaces: list[section - 1]?.spaces ?? 0 };
}

/**
 * A lighting control relay panel (such as an Acuity nLight relay panel): one numbered column
 * of relays. Each relay switches a branch circuit fed from a breaker in another panel.
 */
export const isRelayPanel = (panel: { layout: PanelLayout }) => panel.layout === 'relay';

/** Lighting control systems offered as suggestions; any text is still accepted. */
export const CONTROL_SYSTEMS = ['nLight', 'nLight AIR', 'Lutron', 'Wattstopper', 'Douglas', 'LC&D'];

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
/**
 * What sits in the spaces. A surge protector (SPD) installs like a breaker; some include
 * breakers (their rating is the amps), others protect only (amps 0).
 */
export const DEVICES = ['breaker', 'surge'] as const;
export type Device = (typeof DEVICES)[number];
export const DEVICE_LABELS: Record<Device, string> = { breaker: 'Breaker', surge: 'Surge protector' };

/** A surge protector with no breaker of its own, so no circuit and no rating. */
export const isSurgeOnly = (b: { device?: Device; amps: number }) => b.device === 'surge' && b.amps === 0;

export const SLOTS = ['full', 'A', 'B'] as const;
export type Slot = (typeof SLOTS)[number];

export const MAIN_TYPES = ['breaker', 'lugs'] as const;
export type MainType = (typeof MAIN_TYPES)[number];

/** Common service voltages offered as suggestions; any text is still accepted. */
export const VOLTAGE_PRESETS: Record<PanelLayout, string[]> = {
  residential: ['120/240 V split-phase', '120/208 V single-phase'],
  commercial: ['120/208 V 3-phase', '277/480 V 3-phase', '120/240 V 3-phase high-leg'],
  single: ['120/240 V split-phase', '120/208 V 3-phase', '277/480 V 3-phase'],
  relay: ['277 V', '120 V', '120/277 V', '277/480 V 3-phase', '120/208 V 3-phase'],
  switchboard: ['277/480 V 3-phase', '120/208 V 3-phase', '480 V 3-phase'],
  mcc: ['480 V 3-phase', '277/480 V 3-phase', '208 V 3-phase'],
};

/** What a new panel of each layout starts with. */
export const LAYOUT_DEFAULTS: Record<PanelLayout, { spaces: number; mainAmps: number; voltage: string }> = {
  residential: { spaces: 24, mainAmps: 200, voltage: '120/240 V split-phase' },
  commercial: { spaces: 42, mainAmps: 225, voltage: '120/208 V 3-phase' },
  single: { spaces: 12, mainAmps: 100, voltage: '120/240 V split-phase' },
  relay: { spaces: 16, mainAmps: 20, voltage: '277 V' },
  switchboard: { spaces: 12, mainAmps: 1200, voltage: '277/480 V 3-phase' },
  mcc: { spaces: 12, mainAmps: 600, voltage: '480 V 3-phase' },
};

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
  /** Switchboards and MCCs: the unit number as written, e.g. "2A". */
  unit?: string;
  /** Which section of the panel, from 1. */
  section?: number;
}

export const MIN_SPACES = 2;
/** Most spaces in one section of a panelboard or load center. */
export const MAX_SPACES = 84;
/** Most units on a switchboard or MCC. */
export const MAX_UNITS = 200;
/** Most sections in one panel. */
export const MAX_SECTIONS = 6;

/** The most spaces (or units) a panel of this layout can have in one section. */
export const maxSpacesFor = (layout: PanelLayout) =>
  layout === 'switchboard' || layout === 'mcc' ? MAX_UNITS : MAX_SPACES;

/** Number of columns of spaces. */
export function columnsFor(panel: PanelShape): number {
  return panel.layout === 'commercial' || panel.layout === 'residential' ? 2 : 1;
}

/** Number of rows of spaces. */
export function rowsFor(panel: PanelShape): number {
  return Math.ceil(panel.spaces / columnsFor(panel));
}

/** Most poles a single breaker may have on this panel. Split-phase panels have no 3-pole breakers. */
export function maxPoles(panel: PanelShape): number {
  return panel.layout === 'commercial' || isListLayout(panel) ? 3 : 2;
}

/** Three-phase panelboards take no tandem breakers. */
export function allowsTandem(panel: PanelShape): boolean {
  return panel.layout === 'residential';
}

export const PHASES = ['A', 'B', 'C'] as const;
export type Phase = (typeof PHASES)[number];

/** The phase a space sits on in a 3-phase panelboard: rows run A, B, C, A, B, C… Null otherwise. */
export function phaseOf(panel: PanelShape, position: number): Phase | null {
  if (panel.layout !== 'commercial') return null;
  return PHASES[(cellOf(panel, position).row - 1) % 3]!;
}

/** Phases a breaker is connected to, top to bottom. Empty when the panel has no phase labels. */
export function phasesOf(panel: PanelShape, b: Pick<BreakerShape, 'position' | 'poles'>): Phase[] {
  return positionsOf(panel, b).flatMap((p) => phaseOf(panel, p) ?? []);
}

/** Space counts a panel of this layout can have. */
export function spaceChoices(layout: PanelLayout): number[] {
  const out: number[] = [];
  for (let n = 1; n <= maxSpacesFor(layout); n++) {
    if (validatePanelShape({ layout, spaces: n }).length === 0) out.push(n);
  }
  return out;
}

/**
 * Circuit voltage from the panel's voltage text and the breaker's poles: on "120/208 V" a
 * 1-pole breaker is 120 V and a 2- or 3-pole one 208 V. Null when the text has no "low/high" pair.
 */
export function circuitVolts(voltage: string, poles: number): number | null {
  const m = /(\d{2,3})\s*\/\s*(\d{3})/.exec(voltage);
  if (!m) return null;
  return poles > 1 ? Number(m[2]) : Number(m[1]);
}

/** Spaces between one pole and the next pole of the same breaker (straight down its column). */
function step(panel: PanelShape): number {
  return columnsFor(panel);
}

/** Every space number a breaker occupies, top to bottom. A switchboard unit takes one row. */
export function positionsOf(panel: PanelShape, b: Pick<BreakerShape, 'position' | 'poles'>): number[] {
  if (isListLayout(panel)) return [b.position];
  const out: number[] = [];
  for (let i = 0; i < b.poles; i++) out.push(b.position + i * step(panel));
  return out;
}

/** Column (0 = left) and row (1-based) of a space. Odd numbers left, even right. */
export function cellOf(panel: PanelShape, position: number): { column: number; row: number } {
  const cols = columnsFor(panel);
  return { column: (position - 1) % cols, row: Math.ceil(position / cols) };
}

/**
 * "6 + 8", "21A" or "5"; a switchboard or MCC unit's number ("2A"); with "S2 · " in front for
 * circuits in a panel's second (or later) section.
 */
export function circuitLabel(
  panel: PanelShape,
  b: Pick<BreakerShape, 'position' | 'poles' | 'slot'> & { unit?: string; section?: number },
): string {
  const prefix = b.section && b.section > 1 ? `S${b.section} · ` : '';
  if (isListLayout(panel)) return `${prefix}${b.unit?.trim() || b.position}`;
  const suffix = b.slot === 'full' ? '' : b.slot;
  return (
    prefix +
    positionsOf(panel, b)
      .map((p) => `${p}${suffix}`)
      .join(' + ')
  );
}

export interface LayoutIssue {
  key: string | null;
  message: string;
}

const name = (b: BreakerShape) => (b.label?.trim() ? `"${b.label.trim()}"` : `the breaker at ${b.position}`);

export function validatePanelShape(panel: PanelShape): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  if (isListLayout(panel)) {
    if (!Number.isInteger(panel.spaces) || panel.spaces < 1 || panel.spaces > MAX_UNITS) {
      issues.push({ key: null, message: `A switchboard or MCC has between 1 and ${MAX_UNITS} units.` });
    }
    return issues;
  }
  if (!Number.isInteger(panel.spaces) || panel.spaces < MIN_SPACES || panel.spaces > MAX_SPACES) {
    issues.push({
      key: null,
      message: `A section needs between ${MIN_SPACES} and ${MAX_SPACES} spaces. For more, add another section under Panel settings.`,
    });
  } else if (panel.layout === 'commercial' && (panel.spaces % 6 !== 0 || panel.spaces < 12)) {
    issues.push({
      key: null,
      message:
        'A three-phase panelboard needs a multiple of 6 spaces, at least 12 (for example 30, 42 or 84), so each phase gets the same number of rows.',
    });
  } else if (columnsFor(panel) === 2 && panel.spaces % 2 !== 0) {
    issues.push({ key: null, message: 'A two-column panel needs an even number of spaces.' });
  }
  return issues;
}

/**
 * Everything wrong with the breakers of a panel with sections: each section is checked on its
 * own, with its own numbering.
 */
export function validateSections(
  panel: { layout: PanelLayout; spaces: number; sections?: readonly PanelSection[] },
  breakers: readonly BreakerShape[],
): LayoutIssue[] {
  const list = sectionsOf(panel);
  if (list.length > MAX_SECTIONS) return [{ key: null, message: `A panel can have up to ${MAX_SECTIONS} sections.` }];
  const issues: LayoutIssue[] = [];
  for (const b of breakers) {
    const n = b.section ?? 1;
    if (!Number.isInteger(n) || n < 1 || n > list.length) {
      issues.push({ key: b.key, message: `${name(b)} is in a section this panel does not have.` });
    }
  }
  list.forEach((_, i) => {
    const shape = sectionShape(panel, i + 1);
    const here = breakers.filter((b) => (b.section ?? 1) === i + 1);
    for (const issue of validateLayout(shape, here)) {
      issues.push(i === 0 ? issue : { ...issue, message: `${list[i]!.name}: ${issue.message}` });
    }
  });
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
    if (b.slot !== 'full' && !allowsTandem(panel)) {
      issues.push({ key: b.key, message: `${name(b)} is a tandem, but three-phase panelboards take no tandems.` });
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

/** "42 spaces", "42 + 42 spaces" for a panel with sections, "12 units" or "16 relays". */
export function spacesText(panel: { layout: PanelLayout; spaces: number; sections?: readonly PanelSection[] }): string {
  if (panel.layout === 'relay') return `${panel.spaces} relays`;
  if (isListLayout(panel)) return `${panel.spaces} ${panel.spaces === 1 ? 'unit' : 'units'}`;
  return `${sectionsOf(panel)
    .map((s) => s.spaces)
    .join(' + ')} spaces`;
}

/** Field verification of a circuit: not checked yet, checked and right, or found wrong. */
export const VERIFY_STATUSES = ['', 'verified', 'wrong'] as const;
export type VerifyStatus = (typeof VERIFY_STATUSES)[number];
export const VERIFY_LABELS: Record<VerifyStatus, string> = {
  '': 'Not checked',
  verified: 'Verified',
  wrong: 'Wrong',
};
