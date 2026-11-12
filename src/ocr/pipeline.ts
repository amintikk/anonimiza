// Text reading for scanned pages: PP-OCRv6 small, as RapidOCR runs it, in TypeScript. Detection finds the text
// lines (DB: a probability map, thresholded, grouped into boxes); recognition reads each box (CTC over a
// character list). The models run through onnxruntime-web in a worker; this file only prepares tensors and
// decodes their output, so it can also be tested in Node.
import { cropBox, convexHull, dist, insideQuad, minAreaRect, offsetQuad, orderQuad, roundEven, shortSide, type Pt } from './geometry.ts';

/** An image as RGB bytes, row-major. */
export interface RgbImage {
  width: number;
  height: number;
  rgb: Uint8Array;
}

/** One line of text: its four corners in the image (top-left, top-right, bottom-right, bottom-left). */
export interface OcrLine {
  text: string;
  score: number;
  box: Pt[];
  /** Boxes with the same number are one visual line of the page. */
  line: number;
}

/** Runs one model: a float32 input of the given shape, returns the first output. */
export type Runner = (data: Float32Array, dims: number[]) => Promise<{ data: Float32Array; dims: number[] }>;

const DET_MAX_SIDE = 2000; // larger pages are reduced first
const DET_LIMIT_MIN = 736; // the detector works on images whose shorter side is at least this
const DB_THRESH = 0.3; // probability above which a pixel is text
const BOX_THRESH = 0.5; // mean probability needed to keep a box
const UNCLIP = 1.6; // how much a box grows, relative to its area over its perimeter
const REC_H = 48;
// One line per call: batching lines of similar width was measured slower (padding costs more than the saved calls).
const REC_BATCH = 1;
const TEXT_SCORE = 0.5; // minimum mean probability of a recognised line
const MAX_BOXES = 1000;

/** Detector input size: largest side at most 2000, then shorter side at least 736, both multiples of 32. */
export function detectorSize(h: number, w: number): { H: number; W: number } {
  const round32 = (v: number) => roundEven(Math.trunc(v) / 32) * 32;
  let H = h, W = w;
  const mx = Math.max(H, W);
  if (mx > DET_MAX_SIDE) {
    const r = DET_MAX_SIDE / mx;
    H = round32(H * r);
    W = round32(W * r);
  } else {
    H = round32(H);
    W = round32(W);
  }
  const mn = Math.min(H, W);
  if (mn < DET_LIMIT_MIN) {
    const r = DET_LIMIT_MIN / mn;
    H = round32(H * r);
    W = round32(W * r);
  }
  return { H, W };
}

/** Bilinear resize (OpenCV's INTER_LINEAR) of an RGB byte image into floats, row-major. */
export function resizeRgb(src: ArrayLike<number>, sw: number, sh: number, dw: number, dh: number): Float32Array {
  const out = new Float32Array(dw * dh * 3);
  const fx = sw / dw, fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(Math.max((y + 0.5) * fy - 0.5, 0), sh - 1);
    const y0 = Math.floor(sy), y1 = Math.min(y0 + 1, sh - 1), wy = sy - y0;
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(Math.max((x + 0.5) * fx - 0.5, 0), sw - 1);
      const x0 = Math.floor(sx), x1 = Math.min(x0 + 1, sw - 1), wx = sx - x0;
      const o = (y * dw + x) * 3;
      for (let c = 0; c < 3; c++) {
        const a = src[(y0 * sw + x0) * 3 + c]!, b = src[(y0 * sw + x1) * 3 + c]!;
        const d = src[(y1 * sw + x0) * 3 + c]!, e = src[(y1 * sw + x1) * 3 + c]!;
        out[o + c] = (a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy;
      }
    }
  }
  return out;
}

/** HWC RGB floats (0..255) to the model's NCHW BGR tensor, scaled to [-1, 1]. */
function toTensor(hwc: Float32Array, h: number, w: number): Float32Array {
  const t = new Float32Array(3 * h * w);
  const plane = h * w;
  for (let i = 0; i < plane; i++) {
    const r = hwc[i * 3]!, g = hwc[i * 3 + 1]!, b = hwc[i * 3 + 2]!;
    t[i] = (b / 255 - 0.5) / 0.5;
    t[plane + i] = (g / 255 - 0.5) / 0.5;
    t[2 * plane + i] = (r / 255 - 0.5) / 0.5;
  }
  return t;
}

/** Connected pixels of the thresholded map (8-connected, dilated 2x2 first), in order of their first pixel. */
function components(prob: Float32Array, H: number, W: number): Int32Array[] {
  const m = new Uint8Array(H * W);
  for (let i = 0; i < H * W; i++) m[i] = prob[i]! > DB_THRESH ? 1 : 0;
  // 2x2 dilation anchored like OpenCV's default for even kernels: a pixel takes its up and left neighbours.
  const d = new Uint8Array(H * W);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      d[i] = m[i]! | (y > 0 ? m[i - W]! : 0) | (x > 0 ? m[i - 1]! : 0) | (y > 0 && x > 0 ? m[i - W - 1]! : 0);
    }
  const seen = new Uint8Array(H * W);
  const out: Int32Array[] = [];
  const stack = new Int32Array(H * W);
  for (let s = 0; s < H * W && out.length < MAX_BOXES; s++) {
    if (!d[s] || seen[s]) continue;
    let top = 0, n = 0;
    stack[top++] = s;
    seen[s] = 1;
    const pix: number[] = [];
    while (top) {
      const i = stack[--top]!;
      pix.push(i);
      n++;
      const y = Math.floor(i / W), x = i - y * W;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy < 0 || xx < 0 || yy >= H || xx >= W) continue;
          const j = yy * W + xx;
          if (d[j] && !seen[j]) {
            seen[j] = 1;
            stack[top++] = j;
          }
        }
    }
    out.push(Int32Array.from(pix.slice(0, n)));
  }
  return out;
}

/** Text boxes from the probability map, in the detector's pixel grid. */
function boxesFromMap(prob: Float32Array, H: number, W: number): Pt[][] {
  const boxes: Pt[][] = [];
  for (const comp of components(prob, H, W)) {
    const pts: Pt[] = [];
    for (const i of comp) pts.push({ x: i % W, y: Math.floor(i / W) });
    const quad = orderQuad(minAreaRect(convexHull(pts)));
    if (quad.length !== 4 || shortSide(quad) < 3) continue;
    // Mean probability inside the box.
    let sum = 0, n = 0;
    const xs = quad.map((p) => p.x), ys = quad.map((p) => p.y);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++)
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H || !insideQuad(quad, x, y)) continue;
        sum += prob[y * W + x]!;
        n++;
      }
    if (!n || sum / n < BOX_THRESH) continue;
    // Grow the box by unclip (area x 1.6 / perimeter per side), then measure it again.
    const f = quad;
    const w = dist(f[0]!, f[1]!), h = dist(f[0]!, f[3]!);
    const grown = orderQuad(minAreaRect(offsetQuad(f, (w * h * UNCLIP) / (2 * (w + h)))));
    if (shortSide(grown) < 5) continue;
    boxes.push(grown);
  }
  return boxes;
}

/** Scales boxes from the detector's grid to the image, clamps them, and drops the tiny ones. */
function toImage(boxes: Pt[][], W: number, H: number, width: number, height: number): Pt[][] {
  const out: Pt[][] = [];
  for (const b of boxes) {
    const p = b.map((q) => ({
      x: Math.min(Math.max(roundEven((q.x / W) * width), 0), width),
      y: Math.min(Math.max(roundEven((q.y / H) * height), 0), height),
    }));
    const [p0, p1, , p3] = p as [Pt, Pt, Pt, Pt];
    if (Math.trunc(dist(p0, p1)) <= 3 || Math.trunc(dist(p0, p3)) <= 3) continue;
    out.push(p);
  }
  return out;
}

/**
 * Reading order: boxes that share most of their height are one visual line, read left to right; lines run top to
 * bottom. Returns the boxes and the line each one belongs to.
 */
export function readingOrder(boxes: Pt[][]): { box: Pt[]; line: number }[] {
  const band = (b: Pt[]) => ({ top: Math.min(b[0]!.y, b[1]!.y), bottom: Math.max(b[2]!.y, b[3]!.y) });
  const lines: { top: number; bottom: number; boxes: Pt[][] }[] = [];
  for (const b of [...boxes].sort((a, c) => band(a).top - band(c).top)) {
    const { top, bottom } = band(b);
    const same = lines.find((l) => {
      const overlap = Math.min(l.bottom, bottom) - Math.max(l.top, top);
      return overlap > 0.5 * Math.min(l.bottom - l.top, bottom - top);
    });
    if (same) {
      same.boxes.push(b);
      same.top = Math.min(same.top, top);
      same.bottom = Math.max(same.bottom, bottom);
    } else lines.push({ top, bottom, boxes: [b] });
  }
  const out: { box: Pt[]; line: number }[] = [];
  lines.forEach((l, i) => {
    for (const box of l.boxes.sort((a, c) => a[0]!.x - c[0]!.x)) out.push({ box, line: i });
  });
  return out;
}

/** CTC decoding: best character per step, repeats and blanks removed. Index 0 is the blank. */
export function ctcDecode(data: Float32Array, T: number, C: number, chars: string[]): { text: string; score: number } {
  let text = '', sum = 0, n = 0, prev = -1;
  for (let t = 0; t < T; t++) {
    const o = t * C;
    let best = 0, bv = data[o]!;
    for (let c = 1; c < C; c++) {
      const v = data[o + c]!;
      if (v > bv) {
        bv = v;
        best = c;
      }
    }
    if (best !== 0 && best !== prev) {
      text += chars[best] ?? '';
      sum += bv;
      n++;
    }
    prev = best;
  }
  return { text, score: n ? Math.round((sum / n) * 1e5) / 1e5 : 0 };
}

/**
 * Reads every line of an RGB page. `det` and `rec` are the two models; `dict` is the character list of the
 * recogniser (without the blank and the space, which are added here as the model expects).
 */
export async function readPage(img: RgbImage, det: Runner, rec: Runner, dict: string[]): Promise<OcrLine[]> {
  const { width, height, rgb } = img;
  const { H, W } = detectorSize(height, width);
  const input = toTensor(resizeRgb(rgb, width, height, W, H), H, W);
  const map = await det(input, [1, 3, H, W]);
  const prob = map.data.subarray(0, H * W);
  const boxes = readingOrder(toImage(boxesFromMap(prob, H, W), W, H, width, height));

  const chars = ['', ...dict, ' '];
  // Lines are read narrowest first; with REC_BATCH > 1 they would be padded on the right, as the reference does.
  const crops: { order: number; box: Pt[]; line: number; data: Float32Array; w: number; h: number; rw: number }[] = [];
  boxes.forEach(({ box, line }, order) => {
    const c = cropBox(rgb, width, height, box);
    if (c) crops.push({ order, box, line, ...c, rw: Math.max(1, Math.ceil((REC_H * c.w) / c.h)) });
  });
  crops.sort((a, b) => a.rw - b.rw);
  const found: (OcrLine & { order: number })[] = [];
  for (let at = 0; at < crops.length; at += REC_BATCH) {
    const batch = crops.slice(at, at + REC_BATCH);
    const W = Math.max(...batch.map((c) => c.rw));
    const input = new Float32Array(batch.length * 3 * REC_H * W); // zeros: grey after normalising, as in padding
    batch.forEach((c, k) => {
      const t = toTensor(resizeRgb(c.data, c.w, c.h, c.rw, REC_H), REC_H, c.rw);
      const base = k * 3 * REC_H * W;
      for (let ch = 0; ch < 3; ch++)
        for (let y = 0; y < REC_H; y++)
          for (let x = 0; x < c.rw; x++) input[base + (ch * REC_H + y) * W + x] = t[(ch * REC_H + y) * c.rw + x]!;
    });
    const out = await rec(input, [batch.length, 3, REC_H, W]);
    const T = out.dims[1]!, C = out.dims[2]!;
    if (C !== chars.length) throw new Error(`recogniser: ${C} classes, ${chars.length} expected`);
    batch.forEach((c, k) => {
      const r = ctcDecode(out.data.subarray(k * T * C, (k + 1) * T * C), T, C, chars);
      const text = r.text.trim();
      if (text && r.score >= TEXT_SCORE) found.push({ text, score: r.score, box: c.box, line: c.line, order: c.order });
    });
  }
  // Back to reading order.
  return found.sort((a, b) => a.order - b.order).map(({ order: _order, ...l }) => l);
}
