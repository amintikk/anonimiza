import assert from 'node:assert/strict';
import { test } from 'node:test';
import { convexHull, cropBox, minAreaRect, orderQuad, roundEven, shortSide, type Pt } from '../src/ocr/geometry.ts';
import { ctcDecode, detectorSize, readingOrder } from '../src/ocr/pipeline.ts';

const area = (q: Pt[]) => Math.hypot(q[1]!.x - q[0]!.x, q[1]!.y - q[0]!.y) * Math.hypot(q[3]!.x - q[0]!.x, q[3]!.y - q[0]!.y);

test('rounding matches Python: halves go to the even number', () => {
  assert.equal(roundEven(0.5), 0);
  assert.equal(roundEven(1.5), 2);
  assert.equal(roundEven(2.5), 2);
  assert.equal(roundEven(2.4), 2);
});

test('detector input: at most 2000 on the long side, at least 736 on the short one, multiples of 32', () => {
  assert.deepEqual(detectorSize(1684, 1190), { H: 1696, W: 1184 });
  assert.deepEqual(detectorSize(2339, 1654), { H: 1984, W: 1408 }); // 2000 / 32 = 62.5, rounded to even as Python does
  const small = detectorSize(300, 400);
  assert.ok(Math.min(small.H, small.W) >= 736);
  assert.equal(small.H % 32, 0);
  assert.equal(small.W % 32, 0);
});

test('the smallest rectangle of a rotated blob has the blob area', () => {
  const pts: Pt[] = [];
  const th = Math.PI / 12;
  for (let x = -20; x <= 20; x++)
    for (let y = -4; y <= 4; y++) pts.push({ x: 50 + x * Math.cos(th) - y * Math.sin(th), y: 30 + x * Math.sin(th) + y * Math.cos(th) });
  const q = orderQuad(minAreaRect(convexHull(pts)));
  assert.equal(q.length, 4);
  // Pixel centres run from -20 to 20 and from -4 to 4: a 40 x 8 rectangle.
  assert.ok(Math.abs(shortSide(q) - 8) < 0.5, `short side ${shortSide(q)}`);
  assert.ok(Math.abs(area(q) - 320) < 3, `area ${area(q)}`);
});

test('corners come out top-left, top-right, bottom-right, bottom-left whatever their input order', () => {
  const q = orderQuad([{ x: 10, y: 0 }, { x: 0, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 5 }]);
  assert.deepEqual(q, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }]);
});

test('cropping a box keeps its pixels, and a tall box is turned a quarter turn', () => {
  const w = 20, h = 10;
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgb[(y * w + x) * 3] = x * 10;
  const flat = cropBox(rgb, w, h, [{ x: 2, y: 2 }, { x: 12, y: 2 }, { x: 12, y: 6 }, { x: 2, y: 6 }])!;
  assert.equal(flat.w, 10);
  assert.equal(flat.h, 4);
  assert.ok(flat.data[0]! > 15 && flat.data[0]! < 35, `left edge red ${flat.data[0]}`);
  const tall = cropBox(rgb, w, h, [{ x: 2, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 9 }, { x: 2, y: 9 }])!;
  assert.equal(tall.w, 9, 'turned: the height becomes the width');
  assert.equal(tall.h, 2);
});

test('CTC: repeats and blanks are removed, the score is the mean of the kept steps', () => {
  // steps: char 1, char 1 (repeat), blank, char 2
  const C = 3;
  const data = new Float32Array([0.1, 0.8, 0.1, 0.1, 0.7, 0.2, 0.9, 0.05, 0.05, 0.1, 0.2, 0.7]);
  const r = ctcDecode(data, 4, C, ['', 'a', 'b']);
  assert.equal(r.text, 'ab');
  assert.equal(r.score, 0.75);
});

test('reading order: boxes that share their height are one line, left to right; lines top to bottom', () => {
  const box = (x: number, y: number, w: number, h: number): Pt[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  const out = readingOrder([box(200, 52, 80, 20), box(10, 50, 80, 20), box(10, 10, 60, 20)]);
  assert.deepEqual(out.map((o) => o.line), [0, 1, 1]);
  assert.equal(out[0]!.box[0]!.x, 10);
  assert.equal(out[1]!.box[0]!.x, 10);
  assert.equal(out[2]!.box[0]!.x, 200);
});
