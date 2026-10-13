// Labels to stick on or beside breakers: a sticker sheet with one label per circuit, or strips
// cut to the panel's breaker spacing that line up with a whole column of breakers.

import {
  ampsLabel,
  breakerTags,
  circuitLabel,
  panelDirectory,
  type BreakerDto,
  type DirectoryEntry,
  type PaperSize,
  type PanelDetail,
} from '@cbt/core';
import { FAINT, INK, MUTED, Pdf, RULE, panelQrUrl, type Font } from './document';

const PT_PER_IN = 72;
const PT_PER_MM = 72 / 25.4;

/** A sticker sheet layout, from the manufacturer's template. */
interface SheetLayout {
  name: string;
  columns: number;
  rows: number;
  width: number;
  height: number;
  left: number;
  top: number;
  pitchX: number;
  pitchY: number;
}

/**
 * Small return-address labels: about the size of a breaker's label area. Avery 5167 on US
 * Letter (80 per sheet, ½" × 1¾") and Avery L7651 on A4 (65 per sheet, 38.1 × 21.2 mm).
 */
export const LABEL_SHEETS: Record<PaperSize, SheetLayout> = {
  letter: {
    name: 'Avery 5167',
    columns: 4,
    rows: 20,
    width: 1.75 * PT_PER_IN,
    height: 0.5 * PT_PER_IN,
    left: 0.3 * PT_PER_IN,
    top: 0.5 * PT_PER_IN,
    pitchX: 2.0625 * PT_PER_IN,
    pitchY: 0.5 * PT_PER_IN,
  },
  a4: {
    name: 'Avery L7651',
    columns: 5,
    rows: 13,
    width: 38.1 * PT_PER_MM,
    height: 21.2 * PT_PER_MM,
    left: 4.7 * PT_PER_MM,
    top: 10.7 * PT_PER_MM,
    pitchX: 40.6 * PT_PER_MM,
    pitchY: 21.2 * PT_PER_MM,
  },
};

export const labelsPerSheet = (paper: PaperSize) => LABEL_SHEETS[paper].columns * LABEL_SHEETS[paper].rows;

const labelText = (b: BreakerDto) =>
  b.label.trim() || (b.device === 'surge' ? 'Surge protector' : b.isSpare ? 'Spare' : '');

/** Amps and markers, e.g. "2P 30A · GFCI". */
const detailText = (b: BreakerDto) => [ampsLabel(b), ...breakerTags(b)].join(' · ');

/** Write a circuit's label into a box: number on the left, label, then rating and markers below. */
function drawLabel(pdf: Pdf, panel: PanelDetail, b: BreakerDto, x: number, y: number, w: number, h: number) {
  const pad = Math.min(4, h * 0.12);
  const numStyle = { font: 'mono' as Font, size: Math.min(9, h * 0.3) };
  const num = circuitLabel(panel, b).replace(/ \+ /g, '+');
  const numW = Math.min(pdf.widthOf(num, numStyle), w * 0.38);
  pdf.line(num, x + pad, y + pad, { ...numStyle, width: numW });

  const textX = x + pad + numW + 4;
  const textW = w - (textX - x) - pad;
  const detailStyle = { font: 'body' as Font, size: Math.min(6.5, h * 0.2), color: MUTED };
  const detailH = pdf.lineHeight(detailStyle);
  const labelStyle = { font: 'semi' as Font, size: Math.min(8.5, h * 0.27), color: INK };
  const label = labelText(b);
  const room = Math.max(1, Math.floor((h - pad * 2 - detailH) / pdf.lineHeight(labelStyle)));
  if (label) pdf.paragraph(label, textX, y + pad, textW, labelStyle, 0, room);
  else pdf.line('Unlabelled', textX, y + pad, { ...labelStyle, color: FAINT, width: textW });
  pdf.line(detailText(b), textX, y + h - pad - detailH, { ...detailStyle, width: textW });
}

/**
 * One sticker per circuit, in panel order, on a label sheet. `skip` leaves the first labels
 * blank so a partly used sheet can go through the printer again.
 */
export function drawLabelSheet(pdf: Pdf, paper: PaperSize, panel: PanelDetail, skip: number): void {
  const layout = LABEL_SHEETS[paper];
  const perSheet = layout.columns * layout.rows;
  const breakers = [...panel.breakers].sort((a, b) => a.position - b.position || a.slot.localeCompare(b.slot));
  let slot = skip % perSheet;
  pdf.addPage(null);
  for (const b of breakers) {
    if (slot === perSheet) {
      pdf.addPage(null);
      slot = 0;
    }
    // Down each column, then across: the order breakers are usually read in.
    const col = Math.floor(slot / layout.rows);
    const row = slot % layout.rows;
    drawLabel(
      pdf,
      panel,
      b,
      layout.left + col * layout.pitchX,
      layout.top + row * layout.pitchY,
      layout.width,
      layout.height,
    );
    slot++;
  }
  if (breakers.length === 0) {
    pdf.paragraph('This panel has no breakers yet.', pdf.left, pdf.top, pdf.contentWidth, {
      font: 'body',
      size: 11,
      color: MUTED,
    });
  }
}

/** Common breaker spacings: ¾" (Square D QO, Eaton CH) and 1" (Homeline, Eaton BR, Siemens, GE). */
export const STRIP_PITCHES = ['0.75', '1'] as const;
export type StripPitch = (typeof STRIP_PITCHES)[number];

const STRIP_WIDTH = 1.75 * PT_PER_IN;
const STRIP_GAP = 0.3 * PT_PER_IN;

/**
 * Strips to cut out and stick beside each column of breakers, one box per space at the real
 * spacing, so every label sits next to its breaker. Long columns continue on another strip.
 */
export function drawLabelStrips(pdf: Pdf, panel: PanelDetail, pitch: StripPitch): void {
  const space = Number(pitch) * PT_PER_IN;
  const dir = panelDirectory(
    panel,
    panel.breakers.map((b) => ({ ...b, key: String(b.id) })),
  );
  const sides = dir.columns.length === 2 ? ['Left side (odd)', 'Right side (even)'] : ['Breakers'];
  const headStyle = { font: 'semi' as Font, size: 7.5, color: MUTED };
  const startPage = () => {
    let y = pdf.addPage(`${panel.name} · label strips`);
    pdf.line(`${panel.name} — label strips`, pdf.left, y, { font: 'bold', size: 13 });
    y += 17;
    pdf.line(
      `Print at 100% (actual size). Boxes are ${pitch === '1' ? '1"' : '¾"'} apart to match the breakers; cut along the dashed lines.`,
      pdf.left,
      y,
      { font: 'body', size: 8, color: MUTED, width: pdf.contentWidth },
    );
  };
  // Text can only be measured once there is a page.
  startPage();
  const headH = pdf.lineHeight(headStyle) + 4;

  // Split each column into strips that fit the page height, never through a breaker.
  type Entry = DirectoryEntry<BreakerDto & { key: string }>;
  type Strip = { side: string; entries: Entry[]; part: number };
  const strips: Strip[] = [];
  const intro = 40;
  const maxRows = Math.max(1, Math.floor((pdf.bottom - pdf.top - intro - headH) / space));
  dir.columns.forEach((entries, c) => {
    let current: Entry[] = [];
    let rows = 0;
    let part = 1;
    for (const e of entries) {
      if (rows + e.span > maxRows && current.length) {
        strips.push({ side: sides[c]!, entries: current, part: part++ });
        current = [];
        rows = 0;
      }
      current.push(e);
      rows += e.span;
    }
    if (current.length) strips.push({ side: sides[c]!, entries: current, part });
  });
  const parts = new Map<string, number>();
  for (const s of strips) parts.set(s.side, Math.max(parts.get(s.side) ?? 0, s.part));

  const perPage = Math.max(1, Math.floor((pdf.contentWidth + STRIP_GAP) / (STRIP_WIDTH + STRIP_GAP)));
  for (let i = 0; i < strips.length; i++) {
    if (i > 0 && i % perPage === 0) startPage();
    const s = strips[i]!;
    const x = pdf.left + (i % perPage) * (STRIP_WIDTH + STRIP_GAP);
    let y = pdf.top + intro;
    const total = parts.get(s.side)!;
    pdf.line(total > 1 ? `${s.side} · ${s.part} of ${total}` : s.side, x, y, { ...headStyle, width: STRIP_WIDTH });
    y += headH;
    const height = s.entries.reduce((n, e) => n + e.span, 0) * space;
    // Cut line around the strip.
    pdf.doc
      .save()
      .dash(3, { space: 2 })
      .lineWidth(0.5)
      .strokeColor(FAINT)
      .rect(x, y, STRIP_WIDTH, height)
      .stroke()
      .restore();
    for (const e of s.entries) {
      const h = e.span * space;
      if (e.type === 'breaker') drawLabel(pdf, panel, e.breaker, x, y, STRIP_WIDTH, h);
      else if (e.type === 'tandem') {
        if (e.a) drawLabel(pdf, panel, e.a, x, y, STRIP_WIDTH, h / 2);
        if (e.b) drawLabel(pdf, panel, e.b, x, y + h / 2, STRIP_WIDTH, h / 2);
        pdf.hline(x + 4, x + STRIP_WIDTH - 4, y + h / 2, RULE, 0.3);
      } else {
        pdf.line(String(e.numbers[0]), x + 4, y + 4, { font: 'mono', size: 8, color: FAINT });
      }
      pdf.hline(x, x + STRIP_WIDTH, y + h, RULE, 0.4);
      y += h;
    }
  }
}

/**
 * Square stickers for panel doors: Avery 22806 on US Letter (12 per sheet, 2" squares) and
 * 51 mm squares, 3 × 5, on A4.
 */
export const QR_SHEETS: Record<PaperSize, SheetLayout> = {
  letter: {
    name: 'Avery 22806',
    columns: 3,
    rows: 4,
    width: 2 * PT_PER_IN,
    height: 2 * PT_PER_IN,
    left: 0.625 * PT_PER_IN,
    top: 0.625 * PT_PER_IN,
    pitchX: 2.625 * PT_PER_IN,
    pitchY: 2.5833 * PT_PER_IN,
  },
  a4: {
    name: '51 mm square labels',
    columns: 3,
    rows: 5,
    width: 51 * PT_PER_MM,
    height: 51 * PT_PER_MM,
    left: 18.5 * PT_PER_MM,
    top: 11 * PT_PER_MM,
    pitchX: 61 * PT_PER_MM,
    pitchY: 56 * PT_PER_MM,
  },
};

/** One door sticker: the panel's name, a QR code to its page (or field mode), and what scanning does. */
function drawQrLabel(pdf: Pdf, panel: PanelDetail, x: number, y: number, w: number, h: number) {
  const pad = w * 0.07;
  const nameStyle = { font: 'semi' as Font, size: Math.min(13, w * 0.1), color: INK };
  pdf.line(panel.name, x + pad, y + pad, { ...nameStyle, width: w - pad * 2 });
  const room = panel.locationPath.split(' › ').slice(-2).join(' › ');
  const smallStyle = { font: 'body' as Font, size: Math.min(6.5, w * 0.05), color: MUTED };
  const nameH = pdf.lineHeight(nameStyle);
  pdf.line(room, x + pad, y + pad + nameH, { ...smallStyle, width: w - pad * 2 });
  const top = y + pad + nameH + pdf.lineHeight(smallStyle) + 4;
  const footH = pdf.lineHeight(smallStyle) * 2 + 2;
  const size = Math.min(w - pad * 2, y + h - pad - footH - top - 4);
  const url = panelQrUrl(pdf.ctx, panel);
  if (url) pdf.qr(url, x + (w - size) / 2, top, size);
  else {
    pdf.paragraph(pdf.ctx.qrHint ?? 'QR codes are turned off in Settings.', x + pad, top, w - pad * 2, {
      ...smallStyle,
      color: FAINT,
    });
  }
  const foot =
    url && panel.publicPath
      ? 'Scan for the circuit list, or to report a problem'
      : 'Scan to check circuits or report a problem';
  pdf.paragraph(foot, x + pad, y + h - pad - footH, w - pad * 2, smallStyle, 1, 2);
}

/** A sheet of door stickers, one per panel, in the order given. `skip` leaves the first ones blank. */
export function drawQrLabels(pdf: Pdf, paper: PaperSize, panels: PanelDetail[], skip: number): void {
  const layout = QR_SHEETS[paper];
  const perSheet = layout.columns * layout.rows;
  let slot = skip % perSheet;
  pdf.addPage(null);
  for (const panel of panels) {
    if (slot === perSheet) {
      pdf.addPage(null);
      slot = 0;
    }
    const col = slot % layout.columns;
    const row = Math.floor(slot / layout.columns);
    drawQrLabel(
      pdf,
      panel,
      layout.left + col * layout.pitchX,
      layout.top + row * layout.pitchY,
      layout.width,
      layout.height,
    );
    slot++;
  }
  if (panels.length === 0) {
    pdf.paragraph('There are no panels here yet.', pdf.left, pdf.top, pdf.contentWidth, {
      font: 'body',
      size: 11,
      color: MUTED,
    });
  }
}
