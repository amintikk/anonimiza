// PDF in, PDF out. Reading keeps where every character of the extracted text is on its page; writing renders
// each page, covers every detection with a box that carries its marker, and builds a new PDF from those images.
// The pages become images on purpose: a box drawn over text in the original file would leave the text under it,
// still selectable and searchable. Images inside the PDF (signatures, photos, stamps) are not looked at.
import type { PDFDocumentProxy, TextItem, TextStyle } from 'pdfjs-dist/types/src/display/api';
import { tidyIndices } from './tidy.ts';

interface Item {
  page: number; // 1-based
  str: string; // NFC, as it appears in the extracted text
  transform: number[];
  width: number;
  ascent: number;
  descent: number;
  family: string;
  vertical: boolean;
}

/** Where each character of the extracted text comes from: item index and offset in it, or -1 for line breaks. */
export interface PdfLayout {
  items: Item[];
  item: Int32Array;
  offset: Int32Array;
}

export interface PdfSource {
  bytes: Uint8Array;
  text: string;
  layout: PdfLayout;
}

async function open(bytes: Uint8Array): Promise<{ doc: PDFDocumentProxy; destroy: () => Promise<void>; pdfjs: typeof import('pdfjs-dist') }> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({
    data: bytes.slice(), // pdf.js takes ownership of the buffer; keep ours for writing the output
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    useSystemFonts: false,
  });
  const doc = await task.promise;
  if (!doc.numPages) {
    await task.destroy();
    throw new PdfError('empty');
  }
  return { doc, destroy: () => task.destroy(), pdfjs };
}

/** A PDF that opens but cannot be read as pages (no pages at all). */
export class PdfError extends Error {}

/** The text of a PDF, line by line, and where each character is. */
export async function readPdf(bytes: Uint8Array): Promise<PdfSource> {
  const { doc, destroy } = await open(bytes);
  const items: Item[] = [];
  const chars: string[] = [];
  const itemOf: number[] = [];
  const offOf: number[] = [];
  const push = (c: string, it: number, off: number) => {
    chars.push(c);
    itemOf.push(it);
    offOf.push(off);
  };
  const trimEnd = (from: number) => {
    while (chars.length > from && /\s/.test(chars.at(-1)!)) (chars.pop(), itemOf.pop(), offOf.pop());
  };
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const styles = content.styles as Record<string, TextStyle>;
      if (p > 1) trimEnd(0), push('\n', -1, -1), push('\n', -1, -1);
      const pageStart = chars.length;
      let lineStart = chars.length;
      let lastY: number | null = null;
      for (const raw of content.items) {
        if (!('str' in raw)) continue;
        const item = raw as TextItem;
        const y = item.transform[5] as number;
        // A jump in the baseline without an explicit end of line still starts a new line.
        if (lastY !== null && Math.abs(y - lastY) > 2 && chars.length > lineStart && chars.at(-1) !== '\n') {
          trimEnd(lineStart);
          push('\n', -1, -1);
          lineStart = chars.length;
        }
        const str = item.str.normalize('NFC');
        const st = styles[item.fontName];
        const idx = items.length;
        items.push({ page: p, str, transform: item.transform as number[], width: item.width, ascent: st?.ascent || 0.8, descent: st?.descent || -0.2, family: st?.fontFamily || 'sans-serif', vertical: !!st?.vertical });
        for (let i = 0; i < str.length; i++) {
          const c = str[i]!;
          if (c === '\r') continue;
          push(c === '\u0085' ? '\n' : c, idx, i);
        }
        if (item.hasEOL) {
          trimEnd(lineStart);
          push('\n', -1, -1);
          lineStart = chars.length;
        }
        lastY = y;
      }
      trimEnd(pageStart);
      // Leading blank lines of the page.
      while (chars.length > pageStart && /\s/.test(chars[pageStart]!)) (chars.splice(pageStart, 1), itemOf.splice(pageStart, 1), offOf.splice(pageStart, 1));
      page.cleanup();
    }
  } finally {
    await destroy();
  }
  // Same tidying as for other files.
  const kept = tidyIndices(chars);
  const outC = kept.map((i) => chars[i]!), outI = kept.map((i) => itemOf[i]!), outO = kept.map((i) => offOf[i]!);
  return { bytes, text: outC.join(''), layout: { items, item: Int32Array.from(outI), offset: Int32Array.from(outO) } };
}

export interface Cover {
  start: number;
  end: number;
  label: string;
}

/** Character range [from, to) of one item covered by one detection. */
interface Seg {
  cover: number;
  item: number;
  from: number;
  to: number;
}

const SCALE = 2; // 144 dpi
const JPEG_QUALITY = 0.86;

/** A new PDF with every cover drawn over the original pages. */
export async function redactPdf(src: PdfSource, covers: Cover[], onPage?: (n: number, total: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const { layout } = src;
  // Split each detection into runs of characters of the same item.
  const segs: Seg[] = [];
  covers.forEach((c, ci) => {
    let cur: Seg | null = null;
    for (let i = c.start; i < c.end; i++) {
      const it = layout.item[i]!;
      if (it < 0) continue;
      const off = layout.offset[i]!;
      if (cur && cur.item === it && off === cur.to) cur.to = off + 1;
      else segs.push((cur = { cover: ci, item: it, from: off, to: off + 1 }));
    }
  });
  const { doc, destroy, pdfjs } = await open(src.bytes);
  const pages: PageImage[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      onPage?.(p, doc.numPages);
      const page = await doc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext('2d', { alpha: false })!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      const boxes = mergeLines(segs.filter((x) => layout.items[x.item]!.page === p).map((x) => segBox(pdfjs.Util.transform(vp.transform, layout.items[x.item]!.transform) as number[], layout.items[x.item]!, x)));
      // One box per line of each detection; the marker goes on its widest box.
      const widest = new Map<number, Box>();
      for (const bx of boxes) if ((widest.get(bx.cover)?.x1 ?? 0) - (widest.get(bx.cover)?.x0 ?? 0) < bx.x1 - bx.x0) widest.set(bx.cover, bx);
      for (const bx of boxes) drawBox(ctx, bx, widest.get(bx.cover) === bx ? covers[bx.cover]!.label : '');
      const jpeg = new Uint8Array(await (await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', JPEG_QUALITY))).arrayBuffer());
      pages.push({ jpeg, px: [canvas.width, canvas.height], pt: [base.width, base.height] });
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
  } finally {
    await destroy();
  }
  return imagesToPdf(pages);
}

const measureCtx = (() => {
  let c: CanvasRenderingContext2D | null = null;
  return () => (c ??= document.createElement('canvas').getContext('2d')!);
})();

/** Fraction of the item's width taken by its first `n` characters, measured with a font of the same family. */
function widthRatio(item: Item, n: number): number {
  if (n <= 0) return 0;
  if (n >= item.str.length) return 1;
  const m = measureCtx();
  m.font = `100px ${item.family}`;
  const full = m.measureText(item.str).width;
  return full > 0 ? m.measureText(item.str.slice(0, n)).width / full : n / item.str.length;
}

/** A box over part of a line, in its own frame: origin (ox, oy) rotated by `angle`; horizontal text uses the page frame. */
interface Box {
  cover: number;
  ox: number;
  oy: number;
  angle: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

function segBox(tx: number[], item: Item, s: Seg): Box {
  const fh = Math.hypot(tx[2]!, tx[3]!);
  const angle = Math.atan2(tx[1]!, tx[0]!);
  const w = item.width * SCALE;
  const pad = fh * 0.06;
  let x0: number, x1: number, y0: number, y1: number;
  if (item.vertical) {
    // Vertical text: cover the whole item.
    (x0 = -pad), (x1 = fh + pad), (y0 = -pad), (y1 = item.width * SCALE + pad);
  } else {
    x0 = w * widthRatio(item, s.from) - pad;
    x1 = w * widthRatio(item, s.to) + pad;
    y0 = -fh * Math.min(Math.max(item.ascent, 0.72), 0.92) - pad;
    y1 = fh * 0.22 + pad;
  }
  // Horizontal, upright text is moved to the page frame, so that pieces of the same line can be joined.
  if (!item.vertical && Math.abs(angle) < 0.01) return { cover: s.cover, ox: 0, oy: 0, angle: 0, x0: x0 + tx[4]!, x1: x1 + tx[4]!, y0: y0 + tx[5]!, y1: y1 + tx[5]! };
  return { cover: s.cover, ox: tx[4]!, oy: tx[5]!, angle, x0, x1, y0, y1 };
}

/** Pieces of the same detection on the same line become one box (justified lines come in one piece per word). */
function mergeLines(boxes: Box[]): Box[] {
  const out: Box[] = [];
  for (const b of boxes) {
    const same = b.angle === 0 && out.find((o) => o.cover === b.cover && o.angle === 0 && Math.min(o.y1, b.y1) - Math.max(o.y0, b.y0) > 0.5 * Math.min(o.y1 - o.y0, b.y1 - b.y0));
    if (same) {
      same.x0 = Math.min(same.x0, b.x0);
      same.x1 = Math.max(same.x1, b.x1);
      same.y0 = Math.min(same.y0, b.y0);
      same.y1 = Math.max(same.y1, b.y1);
    } else out.push({ ...b });
  }
  return out;
}

const LABEL_FONT = (px: number) => `600 ${px}px Arial, Helvetica, "Liberation Sans", "DejaVu Sans", sans-serif`;

function drawBox(ctx: CanvasRenderingContext2D, b: Box, label: string): void {
  const h = b.y1 - b.y0;
  const { x0, x1 } = b;
  let size = h * 0.66, sx = 1, tw = 0;
  if (label) {
    // The box never grows: covering the text around it (a full stop, the end of a word) would change the document.
    // A long marker in a short box gets smaller letters first, then narrower ones.
    const room = () => x1 - x0 - h * 0.16;
    ctx.font = LABEL_FONT(size);
    tw = ctx.measureText(label).width;
    if (tw > room()) {
      size = Math.max(size * (room() / tw), h * 0.5);
      ctx.font = LABEL_FONT(size);
      tw = ctx.measureText(label).width;
    }
    if (tw * sx > room()) sx = room() / tw;
  }
  ctx.save();
  ctx.translate(b.ox, b.oy);
  ctx.rotate(b.angle);
  ctx.fillStyle = '#e3e3e3';
  ctx.beginPath();
  ctx.roundRect(x0, b.y0, x1 - x0, h, Math.min(h * 0.14, 6));
  ctx.fill();
  if (label) {
    ctx.font = LABEL_FONT(size);
    ctx.fillStyle = '#3c3c3c';
    ctx.textBaseline = 'middle';
    ctx.translate((x0 + x1) / 2 - (tw * sx) / 2, (b.y0 + b.y1) / 2 + h * 0.03);
    ctx.scale(sx, 1);
    ctx.fillText(label, 0, 0);
  }
  ctx.restore();
}

interface PageImage {
  jpeg: Uint8Array;
  px: [number, number];
  pt: [number, number];
}

/** A minimal PDF 1.4: one JPEG per page, filling it. No metadata from the original is carried over. */
export function imagesToPdf(pages: PageImage[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const write = (x: string | Uint8Array) => {
    const b = typeof x === 'string' ? enc.encode(x) : x;
    parts.push(b);
    size += b.length;
  };
  const obj = (n: number, body: string | (() => void)) => {
    offsets[n] = size;
    write(`${n} 0 obj\n`);
    if (typeof body === 'string') write(body);
    else body();
    write('\nendobj\n');
  };
  write('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const n = pages.length;
  const pageObj = (i: number) => 4 + i * 3;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`);
  obj(3, '<< /Producer (Anonimiza) >>');
  pages.forEach((pg, i) => {
    const [w, h] = pg.pt.map((v) => Number(v.toFixed(2))) as [number, number];
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    obj(pageObj(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${pageObj(i) + 2} 0 R >> >> /Contents ${pageObj(i) + 1} 0 R >>`);
    obj(pageObj(i) + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    obj(pageObj(i) + 2, () => {
      write(`<< /Type /XObject /Subtype /Image /Width ${pg.px[0]} /Height ${pg.px[1]} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`);
      write(pg.jpeg);
      write('\nendstream');
    });
  });
  const total = 4 + n * 3;
  const xref = size;
  let table = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  write(table);
  write(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}

/** What the OCR reader needs from the client, so this file does not depend on the worker. */
export interface OcrReader {
  /** Pages the reader can work on at the same time. */
  readonly parallel?: number;
  read(page: { width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> }, onBytes?: (file: string, loaded: number, total: number, cached: boolean) => void): Promise<{ text: string; score: number; box: { x: number; y: number }[]; line: number }[]>;
}

export type OcrEvent = { stage: 'download'; file: string; loaded: number; total: number; cached: boolean } | { stage: 'page'; page: number; pages: number };

/**
 * A PDF without selectable text, read with OCR: each page is drawn, its lines are read, and every line becomes an
 * item at its place on the page. The result has the same shape as readPdf(), so the same PDF can be written back
 * with the detections covered.
 */
export async function ocrPdf(bytes: Uint8Array, ocr: OcrReader, onEvent?: (e: OcrEvent) => void): Promise<PdfSource> {
  const { doc, destroy } = await open(bytes);
  const items: Item[] = [];
  const chars: string[] = [], itemOf: number[] = [], offOf: number[] = [];
  const push = (c: string, it: number, off: number) => {
    chars.push(c);
    itemOf.push(it);
    offOf.push(off);
  };
  // Pages are drawn one after another, and up to `inFlight` of them are read by the OCR at the same time. Their lines
  // are added in page order, so the result does not depend on which page finishes first.
  const inFlight = Math.max(1, Math.min(3, ocr.parallel ?? 1));
  type Job = { p: number; height: number; read: ReturnType<OcrReader['read']> };
  const commit = async (job: Job, done: number) => {
    const lines = await job.read;
    onEvent?.({ stage: 'page', page: Math.min(doc.numPages, done + 1), pages: doc.numPages });
    if (job.p > 1) (push('\n', -1, -1), push('\n', -1, -1));
    let prevLine = -1;
    for (const line of lines) {
      // Boxes of one visual line are joined with a space; a new line starts a new line of text.
      if (prevLine !== -1) (line.line === prevLine ? push(' ', -1, -1) : push('\n', -1, -1));
      prevLine = line.line;
      // Corners in image pixels at SCALE per point, with y pointing down; PDF space has y pointing up.
      const [tl, tr, , bl] = line.box as [{ x: number; y: number }, { x: number; y: number }, unknown, { x: number; y: number }];
      const fh = Math.max(1, Math.hypot(bl.x - tl.x, bl.y - tl.y) / SCALE);
      const width = Math.hypot(tr.x - tl.x, tr.y - tl.y) / SCALE;
      const str = line.text.normalize('NFC');
      const idx = items.length;
      items.push({ page: job.p, str, transform: [fh, 0, 0, fh, bl.x / SCALE, job.height - bl.y / SCALE], width, ascent: 0.8, descent: -0.2, family: 'sans-serif', vertical: false });
      for (let i = 0; i < str.length; i++) push(str[i]!, idx, i);
    }
  };
  const jobs: Job[] = [];
  let done = 0;
  try {
    onEvent?.({ stage: 'page', page: 1, pages: doc.numPages });
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext('2d', { alpha: false })!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const read = ocr.read({ width: canvas.width, height: canvas.height, rgba }, (file, loaded, total, cached) => onEvent?.({ stage: 'download', file, loaded, total, cached }));
      read.catch(() => {}); // a failure is raised when the page is committed, in order
      canvas.width = canvas.height = 0;
      page.cleanup();
      jobs.push({ p, height: base.height, read });
      while (jobs.length >= inFlight) await commit(jobs.shift()!, done++);
    }
    while (jobs.length) await commit(jobs.shift()!, done++);
  } finally {
    await destroy();
  }
  const keep = tidyIndices(chars);
  const text = keep.map((i) => chars[i]!).join('');
  return {
    bytes,
    text,
    layout: { items, item: Int32Array.from(keep, (i) => itemOf[i]!), offset: Int32Array.from(keep, (i) => offOf[i]!) },
  };
}

