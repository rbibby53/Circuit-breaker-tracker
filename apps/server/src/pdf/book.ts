import type { PanelDetail } from '@cbt/core';
import type { IndexBreaker, RoomIndex } from '../roomIndex';
import { FAINT, INK, MUTED, Pdf, RULE, printedLine, type Font } from './document';
import { drawPanelSheet } from './panel';

const ROW = 14;

/** Rooms grouped by floor, each with the breakers that serve it. */
export function drawRoomIndex(pdf: Pdf, index: RoomIndex): void {
  const footer = `${index.rootName} · room index`;
  let y = pdf.addPage(footer);
  pdf.line(index.rootPath, pdf.left, y, { font: 'body', size: 8.5, color: MUTED, width: pdf.contentWidth });
  y += 13;
  pdf.line('Room index', pdf.left, y, { font: 'bold', size: 20 });
  y += 28;
  y = pdf.paragraph(
    `Which breakers serve each room in ${index.rootName}. Breakers that cover a whole floor or site are listed once, under that floor or site.`,
    pdf.left,
    y,
    pdf.contentWidth,
    { font: 'body', size: 9, color: MUTED },
    2,
  );
  y += 10;

  const cols = {
    circuit: { x: pdf.left, w: 54 },
    label: { x: pdf.left + 58, w: pdf.contentWidth - 58 - 46 - 96 - 140 },
    amps: { x: pdf.right - 140 - 96 - 46, w: 42 },
    tags: { x: pdf.right - 140 - 96, w: 92 },
    panel: { x: pdf.right - 140, w: 140 },
  };

  let section = '';
  const ensure = (need: number) => {
    if (y + need <= pdf.bottom) return;
    y = pdf.addPage(footer);
    const where = section ? ` · ${section}` : '';
    pdf.line(`Room index: ${index.rootName}, continued${where}`, pdf.left, y, {
      font: 'semi',
      size: 9,
      color: MUTED,
      width: pdf.contentWidth,
    });
    y += 18;
  };

  const breakerRow = (b: IndexBreaker) => {
    ensure(ROW);
    pdf.line(b.circuit, cols.circuit.x, y, { font: 'mono', size: 8, width: cols.circuit.w });
    const w = pdf.line(b.label || 'Unlabelled', cols.label.x, y, {
      font: 'semi',
      size: 8.5,
      color: b.label ? INK : FAINT,
      width: cols.label.w,
    });
    if (b.note && cols.label.w - w > 24) {
      pdf.line(` (${b.note})`, cols.label.x + w, y + 0.5, {
        font: 'body',
        size: 8,
        color: MUTED,
        width: cols.label.w - w,
      });
    }
    pdf.line(b.amps, cols.amps.x, y + 0.5, { font: 'mono', size: 8 });
    let tx = cols.tags.x;
    for (const t of b.tags) {
      if (tx + pdf.tagWidth(t, 6) > cols.tags.x + cols.tags.w) break;
      tx += pdf.tag(t, tx, y + 0.5, 6, t === 'CRIT') + 2;
    }
    pdf.line(b.panelName, cols.panel.x, y + 0.5, { font: 'body', size: 8, color: MUTED, width: cols.panel.w });
    y += ROW;
  };

  const group = (title: string, breakers: IndexBreaker[], style: { font: Font; size: number }) => {
    ensure(ROW * 2 + 4);
    pdf.line(title, pdf.left + 8, y, { ...style, width: pdf.contentWidth - 8 });
    y += style.size + 7;
    if (!breakers.length) {
      pdf.line('Nothing recorded yet', cols.label.x, y, { font: 'body', size: 8, color: FAINT });
      y += ROW;
    }
    for (const b of breakers) breakerRow(b);
    y += 4;
  };

  for (const a of index.above) group(a.title, a.breakers, { font: 'semi', size: 10 });

  for (const s of index.sections) {
    section = '';
    ensure(22 + ROW * 2);
    section = s.title;
    y += 4;
    pdf.line(s.title, pdf.left, y, { font: 'bold', size: 12.5, width: pdf.contentWidth });
    y += 17;
    pdf.hline(pdf.left, pdf.right, y - 3, INK, 0.8);
    y += 4;
    if (s.whole.length) group(`Whole ${s.kind}`, s.whole, { font: 'semi', size: 9.5 });
    for (const r of s.rooms) group(r.name, r.breakers, { font: 'semi', size: 9.5 });
  }

  if (!index.above.length && !index.sections.length) {
    pdf.line('No rooms here yet.', pdf.left, y, { font: 'body', size: 9.5, color: MUTED });
  }
}

/** Every panel under a location, then its room index, behind a cover with contents. */
export function drawBook(
  pdf: Pdf,
  root: { name: string; path: string; kindLabel: string },
  panels: PanelDetail[],
  index: RoomIndex | null,
): void {
  const entries: { title: string; detail: string; page: number }[] = [];
  const firstCap = 26;
  const laterCap = 40;
  const count = panels.length + (index ? 1 : 0);
  const coverPages = 1 + Math.max(0, Math.ceil((count - firstCap) / laterCap));
  for (let i = 0; i < coverPages; i++) pdf.addPage(root.name);

  for (const p of panels) {
    entries.push({ title: p.name, detail: p.locationPath, page: pdf.pageCount + 1 });
    drawPanelSheet(pdf, p);
  }
  if (index) {
    entries.push({ title: 'Room index', detail: 'Which breakers serve each room', page: pdf.pageCount + 1 });
    drawRoomIndex(pdf, index);
  }

  pdf.doc.switchToPage(0);
  let y = pdf.top;
  pdf.line(pdf.ctx.appName, pdf.left, y, { font: 'semi', size: 9, color: MUTED });
  y += 110;
  pdf.line(`${root.kindLabel} panel directory`, pdf.left, y, { font: 'semi', size: 12, color: MUTED });
  y += 20;
  pdf.line(root.name, pdf.left, y, { font: 'bold', size: 30, width: pdf.contentWidth });
  y += 42;
  if (root.path !== root.name) {
    pdf.line(root.path, pdf.left, y, { font: 'body', size: 10, color: MUTED, width: pdf.contentWidth });
    y += 16;
  }
  const summary = [`${panels.length} panel${panels.length === 1 ? '' : 's'}`, printedLine(pdf.ctx, false)].join(', ');
  pdf.line(summary[0]!.toUpperCase() + summary.slice(1), pdf.left, y, { font: 'body', size: 10, color: MUTED });
  y += 44;

  if (!entries.length) {
    pdf.paragraph(
      'Nothing to print here yet. Add a panel, or tag breakers with the rooms they serve.',
      pdf.left,
      y,
      pdf.contentWidth,
      { font: 'body', size: 10, color: MUTED },
    );
    return;
  }

  pdf.line('Contents', pdf.left, y, { font: 'bold', size: 11 });
  y += 18;
  pdf.hline(pdf.left, pdf.right, y - 4, INK, 0.8);
  let page = 0;
  let onPage = 0;
  for (const e of entries) {
    if (onPage >= (page === 0 ? firstCap : laterCap)) {
      page++;
      onPage = 0;
      pdf.doc.switchToPage(page);
      y = pdf.top;
      pdf.line('Contents, continued', pdf.left, y, { font: 'bold', size: 11 });
      y += 22;
    }
    const pageText = String(e.page);
    const pw = pdf.widthOf(pageText, { font: 'mono', size: 9 });
    pdf.line(pageText, pdf.right - pw, y + 1, { font: 'mono', size: 9 });
    const tw = pdf.line(e.title, pdf.left, y, { font: 'semi', size: 10, width: pdf.contentWidth * 0.5 });
    pdf.line(e.detail, pdf.left + tw + 10, y + 1.5, {
      font: 'body',
      size: 8.5,
      color: FAINT,
      width: pdf.contentWidth - tw - 10 - pw - 16,
    });
    y += 16;
    pdf.hline(pdf.left, pdf.right, y - 3.5, RULE, 0.3);
    onPage++;
  }
}
