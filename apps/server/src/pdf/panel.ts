import {
  DIRECTORY_TAGS,
  ampsLabel,
  breakerTags,
  circuitLabel,
  columnsFor,
  generatorRating,
  isRelayPanel,
  nameplateText,
  panelDirectory,
  phaseOf,
  type BreakerDto,
  type DirectoryEntry,
  type DirectoryTag,
  type PanelDetail,
} from '@cbt/core';
import { FAINT, FILL, INK, MUTED, Pdf, RULE, formatDate, panelQrUrl, type Font } from './document';

type Breaker = BreakerDto & { key: string };

/** What a breaker serves, in words. Locations the reader cannot see are counted, not named. */
export function servesText(b: BreakerDto): string {
  const parts: string[] = [];
  // Relays: the circuit they switch and what controls them.
  if (b.source) parts.push(`Fed by ${b.source.panelName} ${b.source.circuit}`);
  if (b.control) parts.push(b.control);
  for (const r of b.switchedBy) parts.push(`Switched by ${r.panelName} relay ${r.relay}`);
  if (b.hiddenSwitchedBy) parts.push(`Switched by ${b.hiddenSwitchedBy} relay${b.hiddenSwitchedBy === 1 ? '' : 's'}`);
  for (const f of b.feeds) parts.push(`Feeds ${f.panelName}`);
  for (const d of b.feedsDevices) parts.push(`Feeds ${d.name}`);
  if (b.hiddenFeeds) parts.push(`Feeds ${b.hiddenFeeds} other panel${b.hiddenFeeds === 1 ? '' : 's'}`);
  let hidden = 0;
  for (const s of b.serves) {
    if (!s.name) {
      hidden++;
      continue;
    }
    const name = s.kind === 'room' ? s.name : `All of ${s.name}`;
    parts.push(s.note ? `${name} (${s.note})` : name);
  }
  if (hidden) parts.push(`${hidden} more not shown`);
  return parts.join(', ');
}

function mainText(panel: PanelDetail): string | null {
  if (isRelayPanel(panel)) return null; // relay panels have no main
  const kind = panel.mainType === 'lugs' ? 'lugs' : 'breaker';
  if (panel.mainAmps) return `${panel.mainAmps} A main ${kind}`;
  return panel.mainType === 'lugs' ? 'Main lugs' : null;
}

function facts(panel: PanelDetail, pdf: Pdf): string {
  const relay = isRelayPanel(panel);
  return [
    relay ? [panel.controlSystem, 'relay panel'].filter(Boolean).join(' ') : mainText(panel),
    panel.voltage,
    `${panel.spaces} ${relay ? 'relays' : 'spaces'}`,
    [panel.manufacturer, panel.model].filter(Boolean).join(' '),
    nameplateText(panel.nameplate, panel.mainType === 'lugs' ? null : panel.mainAmps),
    `Updated ${formatDate(panel.updatedAt, pdf.ctx)}`,
  ]
    .filter(Boolean)
    .join('  ·  ');
}

/** "On generator GEN-1 (250 kW diesel) through ATS-1", or through the panel feeding it. */
export function generatorText(panel: PanelDetail): string | null {
  const g = panel.generator;
  if (!g) return null;
  const how = g.via ? `through ${g.via.panelName}` : g.transferSwitch ? `through ${g.transferSwitch}` : '';
  return `On generator ${g.name} (${generatorRating(g)})${how ? ` ${how}` : ''}`;
}

function fedText(panel: PanelDetail): string | null {
  const f = panel.feedChain[0];
  if (!f) return null;
  if (f.kind === 'device') {
    // A transformer or disconnect: name it, and the breaker above it when there is one.
    const up = panel.feedChain.find((x) => x.kind === 'panel');
    const above = up?.kind === 'panel' ? `, fed from ${up.panelName} circuit ${up.circuit} (${up.amps} A)` : '';
    return `Fed from ${f.name}${f.rating ? ` (${f.rating})` : ''}${above}, in ${f.locationPath}`;
  }
  const label = f.label ? ` "${f.label}"` : '';
  return `Fed from ${f.panelName}, circuit ${f.circuit}${label} (${f.amps} A), in ${f.locationPath}`;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Geometry {
  num: { x: number; w: number };
  amps: { x: number; w: number };
  desc: { x: number; w: number };
}

/** Left column mirrors the right one so the numbers meet in the middle, as on the panel. */
function geometry(x: number, w: number, mirrored: boolean, numW: number, ampsW: number): Geometry {
  const descW = w - numW - ampsW;
  return mirrored
    ? { desc: { x, w: descW }, amps: { x: x + descW, w: ampsW }, num: { x: x + descW + ampsW, w: numW } }
    : { num: { x, w: numW }, amps: { x: x + numW, w: ampsW }, desc: { x: x + numW + ampsW, w: descW } };
}

interface ScheduleStyle {
  numW: number;
  ampsW: number;
  /** Print what each breaker serves under its label. */
  serves: boolean;
  maxLabel: number;
  /** Door cards skip GFCI/AFCI markers (the breaker shows those) and the pole count, to save room. */
  compact: boolean;
}

interface ScheduleInfo {
  used: Set<DirectoryTag>;
  /** Most poles on any one breaker. */
  maxPoles: number;
  tandem: boolean;
  phased: boolean;
  compact: boolean;
}

const COMPACT_TAGS: DirectoryTag[] = ['SPARE', 'CRIT', 'UPS', 'GEN', 'SPD'];

/** Draw the panel's breakers as a grid shaped like the panel. Returns the tags used. */
function drawSchedule(
  pdf: Pdf,
  panel: PanelDetail,
  x: number,
  y: number,
  width: number,
  rowH: number,
  style: ScheduleStyle,
): ScheduleInfo {
  const breakers: Breaker[] = panel.breakers.map((b) => ({ ...b, key: String(b.id) }));
  const dir = panelDirectory(panel, breakers);
  const used = new Set<DirectoryTag>();
  let maxPoles = 1;
  let tandem = false;
  const cols = dir.columns.length;
  // Three-phase panelboards get a phase column between the two halves, like a bus bar.
  const phased = cols === 2 && panel.layout === 'commercial';
  const phaseW = phased ? (style.compact ? 11 : 15) : 0;
  const colW = (width - phaseW) / cols;
  const colX = (c: number) => x + c * (colW + phaseW);
  const height = dir.rows * rowH;

  const numSize = clamp(rowH * 0.45, 5.5, style.compact ? 8 : 9);
  const ampsSize = clamp(rowH * 0.4, 5, 8);
  const labelSize = clamp(rowH * 0.44, 5.5, style.maxLabel);
  const servesSize = clamp(rowH * 0.34, 5, 7.5);
  const tagSize = clamp(rowH * 0.27, 4.5, 6.5);
  const pad = clamp(rowH * 0.2, 2.5, 5);

  dir.columns.forEach((entries, c) => {
    const g = geometry(colX(c), colW, cols === 2 && c === 0, style.numW, style.ampsW);
    pdf.doc.save().rect(g.num.x, y, g.num.w, height).fill(FILL).restore();
    pdf.vline(g.amps.x, y, y + height);
    pdf.vline(g.amps.x + g.amps.w, y, y + height);

    for (const e of entries) {
      const top = y + (e.row - 1) * rowH;
      const h = e.span * rowH;
      if (e.row > 1) pdf.hline(colX(c), colX(c) + colW, top, RULE, 0.6);
      drawEntry(e, top, h);
    }

    function numberAt(text: string, top: number, h: number, size = numSize, color = INK) {
      const lh = pdf.lineHeight({ font: 'mono', size });
      pdf.line(text, g.num.x, top + (h - lh) / 2, { font: 'mono', size, color, width: g.num.w, align: 'center' });
    }

    function ampsAt(b: Breaker, top: number, h: number) {
      const s = { font: 'mono' as Font, size: ampsSize };
      const text = style.compact ? (b.amps === 0 && b.device === 'surge' ? 'SPD' : `${b.amps}A`) : ampsLabel(b);
      pdf.line(text, g.amps.x, top + (h - pdf.lineHeight(s)) / 2, { ...s, width: g.amps.w, align: 'center' });
    }

    function describe(b: Breaker, top: number, h: number, allowServes: boolean) {
      const tags = breakerTags(b).filter((t) => !style.compact || COMPACT_TAGS.includes(t));
      tags.forEach((t) => used.add(t));
      const tagH = tagSize * 1.35;
      const tagsW = tags.reduce((n, t) => n + pdf.tagWidth(t, tagSize) + 2, 0);
      const innerX = g.desc.x + pad;
      const innerW = g.desc.w - pad * 2;
      const labelW = innerW - (tagsW ? tagsW + 3 : 0);
      const label = b.label.trim() || (b.device === 'surge' ? 'Surge protector' : b.isSpare ? 'Spare' : 'Unlabelled');
      const labelStyle = { font: 'semi' as Font, size: labelSize, color: b.label.trim() ? INK : FAINT };
      const servesStyle = { font: 'body' as Font, size: servesSize, color: MUTED };
      const lhL = pdf.lineHeight(labelStyle);
      const lhS = pdf.lineHeight(servesStyle) + 0.8;
      const serves = allowServes && style.serves ? servesText(b) : '';
      const room = Math.floor((h - pad - lhL) / lhS);

      let labelTop: number;
      if (serves && room >= 1) {
        const lines = pdf.wrap(serves, innerW, servesStyle, Math.min(room, 4));
        const groupH = lhL + 1 + lines.length * lhS;
        labelTop = top + (h - groupH) / 2;
        lines.forEach((l, i) => pdf.line(l, innerX, labelTop + lhL + 1 + i * lhS, servesStyle));
        pdf.line(label, innerX, labelTop, { ...labelStyle, width: labelW });
      } else {
        labelTop = top + (h - lhL) / 2;
        const w = pdf.line(label, innerX, labelTop, { ...labelStyle, width: labelW });
        if (serves && labelW - w > 30) {
          pdf.line(`  ${serves}`, innerX + w, labelTop + (lhL - pdf.lineHeight(servesStyle)) / 2, {
            ...servesStyle,
            width: labelW - w,
          });
        }
      }
      let tx = innerX + innerW - tagsW + 2;
      for (const t of tags) {
        tx += pdf.tag(t, tx, labelTop + (lhL - tagH) / 2, tagSize, t === 'CRIT') + 2;
      }
    }

    function drawEntry(e: DirectoryEntry<Breaker>, top: number, h: number) {
      if (e.type === 'empty') {
        numberAt(String(e.numbers[0]), top, h, numSize, FAINT);
        return;
      }
      if (e.type === 'breaker') {
        maxPoles = Math.max(maxPoles, e.numbers.length);
        e.numbers.forEach((n, i) => numberAt(String(n), top + i * rowH, rowH));
        if (e.numbers.length > 1) {
          // A tie bar beside the numbers, like the handle tie on a multi-pole breaker.
          const inset = style.compact ? 1.5 : 2.5;
          const bx = cols === 2 && c === 0 ? g.num.x + inset : g.num.x + g.num.w - inset;
          pdf.vline(bx, top + rowH * 0.3, top + h - rowH * 0.3, INK, 1);
        }
        ampsAt(e.breaker, top, h);
        describe(e.breaker, top, h, true);
        return;
      }
      tandem = true;
      const half = h / 2;
      pdf.doc
        .save()
        .moveTo(Math.min(g.num.x, g.desc.x), top + half)
        .lineTo(Math.max(g.num.x + g.num.w, g.desc.x + g.desc.w), top + half)
        .lineWidth(0.4)
        .dash(1.5, { space: 1.5 })
        .strokeColor(RULE)
        .stroke()
        .undash()
        .restore();
      const parts: [Breaker | null, 'A' | 'B', number][] = [
        [e.a, 'A', top],
        [e.b, 'B', top + half],
      ];
      for (const [b, slot, t] of parts) {
        numberAt(`${e.numbers[0]}${slot}`, t, half, numSize * 0.85, b ? INK : FAINT);
        if (!b) continue;
        ampsAt(b, t, half);
        describe(b, t, half, true);
      }
    }
  });

  if (phased) {
    const px = x + colW;
    pdf.doc.save().rect(px, y, phaseW, height).fill('#d6d6d6').restore();
    const size = clamp(rowH * 0.42, 5, style.compact ? 7 : 8.5);
    const lh = pdf.lineHeight({ font: 'bold', size });
    for (let r = 1; r <= dir.rows; r++) {
      const top = y + (r - 1) * rowH;
      if (r > 1) pdf.hline(px, px + phaseW, top, '#bdbdbd', 0.4);
      pdf.line(phaseOf(panel, (r - 1) * 2 + 1) ?? '', px, top + (rowH - lh) / 2, {
        font: 'bold',
        size,
        width: phaseW,
        align: 'center',
      });
    }
    pdf.vline(px + phaseW, y, y + height, INK, 1);
  }
  pdf.doc.save().lineWidth(1).rect(x, y, width, height).stroke(INK).restore();
  if (cols === 2) pdf.vline(x + colW, y, y + height, INK, 1);
  return { used, maxPoles, tandem, phased, compact: style.compact };
}

/** The key under a schedule: only the markers this panel uses. Returns the y below it. */
function drawKey(pdf: Pdf, x: number, y: number, width: number, info: ScheduleInfo, size: number): number {
  const items: { tag?: DirectoryTag; text: string }[] = DIRECTORY_TAGS.filter((t) => info.used.has(t.tag)).map((t) => ({
    tag: t.tag,
    text: t.meaning,
  }));
  if (info.phased) items.push({ text: 'A / B / C (middle column) = the phase each row is on' });
  if (info.maxPoles > 1) {
    const kinds = info.maxPoles > 2 ? 'two- or three-pole breaker' : 'two-pole breaker';
    items.push({
      text: info.compact
        ? `A bar ties the spaces of a ${kinds}`
        : `${info.maxPoles > 2 ? '2P / 3P' : '2P'} = ${kinds}, its spaces tied by a bar`,
    });
  }
  if (info.tandem) items.push({ text: 'A / B = the two halves of a tandem breaker' });
  if (!items.length) return y;
  const s = { font: 'body' as Font, size, color: MUTED };
  const lh = size * 1.6;
  let cx = x;
  for (const it of items) {
    const tw = it.tag ? pdf.tagWidth(it.tag, size * 0.9) + 3 : 0;
    const w = tw + pdf.widthOf(it.text, s) + 12;
    if (cx > x && cx + w > x + width) {
      cx = x;
      y += lh;
    }
    if (it.tag) pdf.tag(it.tag, cx, y - size * 0.05, size * 0.9, it.tag === 'CRIT');
    pdf.line(it.text, cx + tw, y, { ...s, width: x + width - cx - tw });
    cx += w;
  }
  return y + lh;
}

/** A full-page directory for one panel, with notes after it when there are any. */
export function drawPanelSheet(pdf: Pdf, panel: PanelDetail): void {
  let y = pdf.addPage(panel.name);
  const qrSize = 62;
  const qrUrl = panelQrUrl(pdf.ctx, panel);
  const textW = pdf.contentWidth - (qrUrl ? qrSize + 20 : 0);
  if (qrUrl) {
    pdf.qr(qrUrl, pdf.right - qrSize, y, qrSize);
    pdf.line('Scan to open', pdf.right - qrSize, y + qrSize + 3, {
      font: 'body',
      size: 6.5,
      color: FAINT,
      width: qrSize,
      align: 'center',
    });
  }
  pdf.line(panel.locationPath, pdf.left, y, { font: 'body', size: 8.5, color: MUTED, width: textW });
  y += 13;
  pdf.line(panel.name, pdf.left, y, { font: 'bold', size: 20, width: textW });
  y += 28;
  y = pdf.paragraph(facts(panel, pdf), pdf.left, y, textW, { font: 'body', size: 9 }, 2, 2);
  const fed = fedText(panel);
  if (fed) y = pdf.paragraph(fed, pdf.left, y + 1, textW, { font: 'body', size: 9, color: MUTED }, 2, 2);
  const gen = generatorText(panel);
  if (gen) y = pdf.paragraph(gen, pdf.left, y + 1, textW, { font: 'semi', size: 9 }, 2, 2);
  if (qrUrl) y = Math.max(y, pdf.top + qrSize + 14);
  y += 8;

  const keyRoom = 34;
  const rows = Math.ceil(panel.spaces / columnsFor(panel));
  const rowH = Math.min(34, (pdf.bottom - keyRoom - y) / rows);
  const info = drawSchedule(pdf, panel, pdf.left, y, pdf.contentWidth, rowH, {
    numW: 24,
    ampsW: 40,
    serves: true,
    maxLabel: 9.5,
    compact: false,
  });
  y += rows * rowH + 9;
  y = drawKey(pdf, pdf.left, y, pdf.contentWidth, info, 7);
  drawNotes(pdf, panel, y + 8);
}

function drawNotes(pdf: Pdf, panel: PanelDetail, startY: number): void {
  const notes: { title: string; text: string }[] = [];
  if (panel.notes.trim()) notes.push({ title: 'Panel', text: panel.notes.trim() });
  for (const b of panel.breakers) {
    if (!b.notes.trim()) continue;
    notes.push({ title: `${circuitLabel(panel, b)}  ${b.label || 'Unlabelled'}`, text: b.notes.trim() });
  }
  if (!notes.length) return;

  const head = { font: 'semi' as Font, size: 8.5 };
  const body = { font: 'body' as Font, size: 8.5, color: MUTED };
  const lh = pdf.lineHeight(body) + 2;
  let y = startY;
  const heading = (text: string) => {
    pdf.line(text, pdf.left, y, { font: 'bold', size: 11 });
    y += 18;
  };
  if (y + 18 + lh * 3 > pdf.bottom) y = pdf.addPage(panel.name);
  heading('Notes');
  for (const n of notes) {
    const lines = pdf.wrap(n.text, pdf.contentWidth - 150, body);
    const need = Math.max(1, lines.length) * lh + 6;
    if (y + Math.min(need, lh * 3) > pdf.bottom) {
      y = pdf.addPage(panel.name);
      heading(`${panel.name}: notes, continued`);
    }
    pdf.line(n.title, pdf.left, y, { ...head, width: 142 });
    for (const l of lines) {
      if (y + lh > pdf.bottom) {
        y = pdf.addPage(panel.name);
        heading(`${panel.name}: notes, continued`);
      }
      pdf.line(l, pdf.left + 150, y, body);
      y += lh;
    }
    y += 6;
  }
}

/** Card size: 4 in wide, up to 10 in tall, which fits inside most residential panel doors. */
const CARD_W = 288;
const CARD_MAX_H = 720;

/** A narrow card to cut out and slip inside the panel door. */
export function drawDoorCard(pdf: Pdf, panel: PanelDetail): void {
  const top = pdf.addPage(`${panel.name} · door card`);
  const x = pdf.left;
  const pad = 10;
  const inner = CARD_W - pad * 2;
  let y = top + pad;

  const qrUrl = panelQrUrl(pdf.ctx, panel);
  const qrSize = 40;
  const headW = inner - (qrUrl ? qrSize + 8 : 0);
  if (qrUrl) pdf.qr(qrUrl, x + pad + inner - qrSize, y, qrSize);
  pdf.line(panel.name, x + pad, y, { font: 'bold', size: 12, width: headW });
  y += 16;
  pdf.line(panel.locationPath, x + pad, y, { font: 'body', size: 6.5, color: MUTED, width: headW });
  y += 9;
  const small = [mainText(panel), panel.voltage, `Updated ${formatDate(panel.updatedAt, pdf.ctx)}`]
    .filter(Boolean)
    .join(' · ');
  pdf.line(small, x + pad, y, { font: 'body', size: 6.5, color: MUTED, width: headW });
  y += 9;
  if (qrUrl) y = Math.max(y, top + pad + qrSize + 6);
  y += 4;

  const maxH = Math.min(CARD_MAX_H, pdf.bottom - top);
  const keyRoom = 30;
  const rows = Math.ceil(panel.spaces / columnsFor(panel));
  const rowH = Math.min(20, (top + maxH - pad - keyRoom - y) / rows);
  const info = drawSchedule(pdf, panel, x + pad, y, inner, rowH, {
    numW: 17,
    ampsW: 24,
    serves: false,
    maxLabel: 7.5,
    compact: true,
  });
  y += rows * rowH + 6;
  y = drawKey(pdf, x + pad, y, inner, info, 5.5);
  const cardH = Math.min(maxH, y - top + pad - 4);

  pdf.doc.save().lineWidth(0.6).dash(4, { space: 3 }).rect(x, top, CARD_W, cardH).stroke(FAINT).undash().restore();

  const hx = x + CARD_W + 24;
  const hw = pdf.right - hx;
  let hy = top + 4;
  pdf.line('Door card', hx, hy, { font: 'bold', size: 11, width: hw });
  hy += 17;
  const inches = (cardH / 72).toFixed(1).replace(/\.0$/, '');
  hy = pdf.paragraph(
    `Print at actual size (100%, not "fit to page"). The card is 4 × ${inches} in. Cut along the dashed line and slip it inside the panel door.`,
    hx,
    hy,
    hw,
    { font: 'body', size: 8.5, color: MUTED },
    2.5,
  );
  if (pdf.ctx.qrHint) {
    pdf.paragraph(pdf.ctx.qrHint, hx, hy + 8, hw, { font: 'body', size: 7.5, color: FAINT }, 2);
  }
}
