// Plane geometry for the OCR pipeline: convex hulls, the smallest rotated rectangle, the offset of a text box,
// and cropping a rotated box out of an image. Pure functions, no DOM, so they run in tests too.

export type Pt = { x: number; y: number };

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Round half to even, as Python's round() and numpy do (the detector's sizes depend on it). */
export function roundEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Convex hull (monotone chain), counter-clockwise. */
export function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * The smallest rectangle that contains a convex polygon, as its four corners (any order).
 * Tries every edge direction of the hull, as OpenCV's minAreaRect does.
 */
export function minAreaRect(hull: Pt[]): Pt[] {
  let best: { area: number; quad: Pt[] } | null = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const th = Math.atan2(b.y - a.y, b.x - a.x);
    const c = Math.cos(-th);
    const s = Math.sin(-th);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of hull) {
      const x = p.x * c - p.y * s;
      const y = p.x * s + p.y * c;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const area = (x1 - x0) * (y1 - y0);
    if (!best || area < best.area) {
      const back = (x: number, y: number): Pt => ({ x: x * Math.cos(th) - y * Math.sin(th), y: x * Math.sin(th) + y * Math.cos(th) });
      best = { area, quad: [back(x0, y0), back(x1, y0), back(x1, y1), back(x0, y1)] };
    }
  }
  return best?.quad ?? [];
}

/**
 * Corners in the order the detector uses: [top-left, top-right, bottom-right, bottom-left].
 * Points are sorted by x; the two on the left, then the two on the right, are sorted by y.
 */
export function orderQuad(q: Pt[]): Pt[] {
  const byX = [...q].sort((a, b) => a.x - b.x);
  const [l0, l1] = byX.slice(0, 2).sort((a, b) => a.y - b.y) as [Pt, Pt];
  const [r0, r1] = byX.slice(2, 4).sort((a, b) => a.y - b.y) as [Pt, Pt];
  return [l0, r0, r1, l1];
}

/** Side lengths and unit directions of an ordered quad. */
function frame(q: Pt[]): { cx: number; cy: number; w: number; h: number; ux: number; uy: number; vx: number; vy: number } {
  const [tl, tr, , bl] = q as [Pt, Pt, Pt, Pt];
  const w = dist(tl, tr);
  const h = dist(tl, bl);
  const ux = (tr.x - tl.x) / (w || 1);
  const uy = (tr.y - tl.y) / (w || 1);
  const vx = (bl.x - tl.x) / (h || 1);
  const vy = (bl.y - tl.y) / (h || 1);
  const cx = (tl.x + tr.x + q[2]!.x + bl.x) / 4;
  const cy = (tl.y + tr.y + q[2]!.y + bl.y) / 4;
  return { cx, cy, w, h, ux, uy, vx, vy };
}

/** Length of the shorter side of an ordered quad. */
export const shortSide = (q: Pt[]): number => {
  const f = frame(q);
  return Math.min(f.w, f.h);
};

/** Grows a rectangle by `d` on every side (the text box is widened the way DB unclipping does). */
export function offsetQuad(q: Pt[], d: number): Pt[] {
  const f = frame(q);
  const w = f.w + 2 * d;
  const h = f.h + 2 * d;
  const at = (sx: number, sy: number): Pt => ({
    x: f.cx + f.ux * sx * (w / 2) + f.vx * sy * (h / 2),
    y: f.cy + f.uy * sx * (w / 2) + f.vy * sy * (h / 2),
  });
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
}

/** True when the pixel centre lies inside the convex quad (corners in any consistent order). */
export function insideQuad(q: Pt[], x: number, y: number): boolean {
  let pos = 0, neg = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!, b = q[(i + 1) % 4]!;
    const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (c > 0) pos++;
    else if (c < 0) neg++;
    if (pos && neg) return false;
  }
  return true;
}

/**
 * Crops a box (corners in the detector's order) out of an RGB image, without interpolating the corners
 * outside the image. Returns RGB floats, height first. Boxes that are tall rather than wide are turned
 * a quarter turn, as the reference does.
 */
export function cropBox(rgb: Uint8Array, width: number, height: number, box: Pt[]): { data: Float32Array; w: number; h: number } | null {
  const [p0, p1, p2, p3] = box as [Pt, Pt, Pt, Pt];
  let w = Math.trunc(Math.max(dist(p0, p1), dist(p2, p3)));
  let h = Math.trunc(Math.max(dist(p0, p3), dist(p1, p2)));
  if (w <= 0 || h <= 0) return null;
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const sx = p0.x + u * (p1.x - p0.x) + v * (p3.x - p0.x) - 0.5;
      const sy = p0.y + u * (p1.y - p0.y) + v * (p3.y - p0.y) - 0.5;
      const x0 = Math.min(Math.max(Math.floor(sx), 0), width - 1), x1 = Math.min(x0 + 1, width - 1);
      const y0 = Math.min(Math.max(Math.floor(sy), 0), height - 1), y1 = Math.min(y0 + 1, height - 1);
      const fx = Math.min(Math.max(sx - Math.floor(sx), 0), 1), fy = Math.min(Math.max(sy - Math.floor(sy), 0), 1);
      const o = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) {
        const a = rgb[(y0 * width + x0) * 3 + c]!, b = rgb[(y0 * width + x1) * 3 + c]!;
        const d = rgb[(y1 * width + x0) * 3 + c]!, e = rgb[(y1 * width + x1) * 3 + c]!;
        out[o + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
      }
    }
  }
  if (h / w < 1.5) return { data: out, w, h };
  // A quarter turn counter-clockwise, as numpy's rot90: the new row i is the old column w-1-i.
  const rot = new Float32Array(w * h * 3);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < h; x++) {
      const src = ((x * w) + (w - 1 - y)) * 3;
      const dst = (y * h + x) * 3;
      rot[dst] = out[src]!;
      rot[dst + 1] = out[src + 1]!;
      rot[dst + 2] = out[src + 2]!;
    }
  [w, h] = [h, w];
  return { data: rot, w, h };
}
