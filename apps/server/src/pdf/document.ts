import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PaperSize } from '@cbt/core';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

// Points (1/72 in). Letter is 8.5 × 11 in, A4 210 × 297 mm.
const PAPER: Record<PaperSize, [number, number]> = { letter: [612, 792], a4: [595.28, 841.89] };

// Everything prints in grays so it reads the same on a black-and-white printer.
export const INK = '#111111';
export const MUTED = '#4a4a4a';
export const FAINT = '#8c8c8c';
export const RULE = '#b8b8b8';
export const FILL = '#efefef';

const FONT_FILES = {
  body: 'Archivo-Regular.ttf',
  semi: 'Archivo-SemiBold.ttf',
  bold: 'Archivo-Bold.ttf',
  mono: 'JetBrainsMono-Medium.ttf',
} as const;
export type Font = keyof typeof FONT_FILES;

/** Next to the bundle in the image (dist/fonts), or in assets/ when running from source. */
function fontsDir(): string {
  const candidates = [new URL('./fonts/', import.meta.url), new URL('../../assets/fonts/', import.meta.url)];
  const found = candidates.find((u) => fs.existsSync(new URL(FONT_FILES.body, u)));
  return fileURLToPath(found ?? candidates[1]!);
}

let fontData: Record<Font, Buffer> | null = null;
function fonts(): Record<Font, Buffer> {
  if (!fontData) {
    const dir = fontsDir();
    fontData = Object.fromEntries(
      Object.entries(FONT_FILES).map(([k, file]) => [k, fs.readFileSync(`${dir}/${file}`)]),
    ) as Record<Font, Buffer>;
  }
  return fontData;
}

/** What every printout needs to know besides its own content. */
export interface PrintContext {
  appName: string;
  /** Printed at the bottom of every page. */
  note: string;
  /** Base address for QR codes; null prints none. */
  qrBase: string | null;
  /** Whether QR codes may point at a panel's public page (when it has one). */
  publicPanels: boolean;
  /** Why there is no QR code when one was wanted, as advice for whoever prints. */
  qrHint: string | null;
  timeZone: string;
  now: Date;
}

/** Where a panel's QR code leads: its public page when shared, otherwise the panel in the app. */
export function panelQrUrl(
  ctx: Pick<PrintContext, 'qrBase' | 'publicPanels'>,
  panel: { id: number; publicPath: string | null },
): string | null {
  if (!ctx.qrBase) return null;
  return ctx.publicPanels && panel.publicPath ? `${ctx.qrBase}${panel.publicPath}` : `${ctx.qrBase}/panels/${panel.id}`;
}

export function formatDate(iso: string | Date, ctx: Pick<PrintContext, 'timeZone'>): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: ctx.timeZone }).format(d);
}

/** A time zone name the client sent, if it is one this server knows. */
export function safeTimeZone(tz: unknown): string {
  if (typeof tz !== 'string' || tz.length > 64) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

interface TextStyle {
  font: Font;
  size: number;
  color?: string;
}

/**
 * A thin layer over PDFKit. Text is always placed explicitly, one line at a time, so nothing
 * ever flows onto a new page by surprise; callers check space and add pages themselves.
 */
export class Pdf {
  readonly doc: PDFKit.PDFDocument;
  readonly width: number;
  readonly height: number;
  readonly margin = 36;
  readonly footerHeight = 20;
  /** Left-hand footer text for each page, by page index. */
  private readonly footers: string[] = [];

  constructor(
    paper: PaperSize,
    title: string,
    readonly ctx: PrintContext,
  ) {
    [this.width, this.height] = PAPER[paper];
    this.doc = new PDFDocument({
      size: [this.width, this.height],
      margin: this.margin,
      autoFirstPage: false,
      bufferPages: true,
      info: { Title: title, Creator: ctx.appName, Producer: ctx.appName },
    });
    for (const [name, data] of Object.entries(fonts())) this.doc.registerFont(name, data);
  }

  get left(): number {
    return this.margin;
  }
  get right(): number {
    return this.width - this.margin;
  }
  get top(): number {
    return this.margin;
  }
  /** Lowest y content may reach; the footer sits below it. */
  get bottom(): number {
    return this.height - this.margin - this.footerHeight;
  }
  get contentWidth(): number {
    return this.right - this.left;
  }

  /** Start a page whose footer reads `footer` on the left. Returns the top y. */
  addPage(footer: string): number {
    this.doc.addPage();
    this.footers.push(footer);
    return this.top;
  }

  get pageCount(): number {
    return this.footers.length;
  }

  private use(s: TextStyle): void {
    this.doc
      .font(s.font)
      .fontSize(s.size)
      .fillColor(s.color ?? INK);
  }

  widthOf(text: string, s: TextStyle): number {
    this.use(s);
    return this.doc.widthOfString(text);
  }

  lineHeight(s: TextStyle): number {
    this.use(s);
    return this.doc.currentLineHeight();
  }

  /** Shorten `text` with an ellipsis until it fits `width`. */
  fit(text: string, width: number, s: TextStyle): string {
    this.use(s);
    if (this.doc.widthOfString(text) <= width) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (this.doc.widthOfString(`${text.slice(0, mid).trimEnd()}…`) <= width) lo = mid;
      else hi = mid - 1;
    }
    return lo === 0 ? '' : `${text.slice(0, lo).trimEnd()}…`;
  }

  /** Draw one line of text with its top at `y`, cut to `width`. Returns the width drawn. */
  line(
    text: string,
    x: number,
    y: number,
    s: TextStyle & { width?: number; align?: 'left' | 'center' | 'right' },
  ): number {
    const shown = s.width !== undefined ? this.fit(text, s.width, s) : text;
    if (!shown) return 0;
    this.use(s);
    const w = this.doc.widthOfString(shown);
    let at = x;
    if (s.width !== undefined && s.align === 'center') at = x + (s.width - w) / 2;
    if (s.width !== undefined && s.align === 'right') at = x + s.width - w;
    this.doc.text(shown, at, y, { lineBreak: false });
    return w;
  }

  /** Break text into lines that fit `width`; the last allowed line gets an ellipsis if cut. */
  wrap(text: string, width: number, s: TextStyle, maxLines = Infinity): string[] {
    this.use(s);
    const out: string[] = [];
    for (const para of text.split(/\r?\n/)) {
      let current = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = current ? `${current} ${word}` : word;
        if (this.doc.widthOfString(next) <= width) current = next;
        else {
          if (current) out.push(current);
          current = this.doc.widthOfString(word) <= width ? word : this.fit(word, width, s);
        }
      }
      out.push(current);
    }
    while (out.length > 1 && out[out.length - 1] === '') out.pop();
    if (out.length > maxLines) {
      const kept = out.slice(0, maxLines);
      kept[maxLines - 1] = this.fit(`${kept[maxLines - 1]} ${out.slice(maxLines).join(' ')}`, width, s);
      return kept;
    }
    return out;
  }

  /** Draw wrapped lines from `y`; returns the y below the last line. */
  paragraph(text: string, x: number, y: number, width: number, s: TextStyle, gap = 1.5, maxLines?: number): number {
    const lh = this.lineHeight(s) + gap;
    for (const l of this.wrap(text, width, s, maxLines)) {
      this.line(l, x, y, s);
      y += lh;
    }
    return y;
  }

  hline(x1: number, x2: number, y: number, color = RULE, width = 0.5): void {
    this.doc.save().moveTo(x1, y).lineTo(x2, y).lineWidth(width).strokeColor(color).stroke().restore();
  }

  vline(x: number, y1: number, y2: number, color = RULE, width = 0.5): void {
    this.doc.save().moveTo(x, y1).lineTo(x, y2).lineWidth(width).strokeColor(color).stroke().restore();
  }

  /** A small boxed marker such as CRIT. Solid boxes stand out more than outlined ones. */
  tag(text: string, x: number, y: number, size: number, solid: boolean): number {
    const s: TextStyle = { font: 'bold', size };
    const w = this.widthOf(text, s) + size * 0.7;
    const h = size * 1.35;
    this.doc.save().lineWidth(0.6);
    if (solid) this.doc.rect(x, y, w, h).fillAndStroke(INK, INK);
    else this.doc.rect(x, y, w, h).stroke(INK);
    this.doc.restore();
    this.line(text, x + size * 0.35, y + size * 0.2, { ...s, color: solid ? '#ffffff' : INK });
    return w;
  }

  tagWidth(text: string, size: number): number {
    return this.widthOf(text, { font: 'bold', size }) + size * 0.7;
  }

  /** A QR code made of vector squares, so it stays sharp at any print size. */
  qr(url: string, x: number, y: number, size: number): void {
    const code = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const n = code.modules.size;
    const cell = size / n;
    this.doc.save();
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (code.modules.get(r, c)) this.doc.rect(x + c * cell, y + r * cell, cell, cell);
      }
    }
    this.doc.fill(INK).restore();
  }

  /** Write footers on every page and return the finished file. */
  async finish(): Promise<Buffer> {
    const total = this.pageCount;
    const printed = `Printed ${formatDate(this.ctx.now, this.ctx)}`;
    const s: TextStyle = { font: 'body', size: 7, color: FAINT };
    const y = this.height - this.margin - 8;
    for (let i = 0; i < total; i++) {
      this.doc.switchToPage(i);
      this.hline(this.left, this.right, y - 5, RULE, 0.4);
      const right = total > 1 ? `${printed} · Page ${i + 1} of ${total}` : printed;
      const rightW = this.widthOf(right, s);
      this.line(right, this.right - rightW, y, s);
      const leftText = [this.footers[i], this.ctx.note].filter(Boolean).join(' · ');
      this.line(leftText, this.left, y, { ...s, width: this.contentWidth - rightW - 16 });
    }
    const chunks: Buffer[] = [];
    this.doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => {
      this.doc.on('end', () => resolve(Buffer.concat(chunks)));
      this.doc.on('error', reject);
    });
    this.doc.end();
    return done;
  }
}
