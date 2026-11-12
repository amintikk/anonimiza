// Runs the browser's OCR pipeline (src/ocr/pipeline.ts) in Node on raw RGB pages, to measure it.
// Usage: node tools/ocr_eval.ts <pages dir> <prefix> <models dir> <out prefix> [pages]
// Writes <out prefix>-<n>.txt per page (one line of text per line) in the layout tools/compare/score.py reads.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import { readPage, type Runner } from '../src/ocr/pipeline.ts';

const [pages, prefix, models, out, count = '9'] = process.argv.slice(2);
const dict = JSON.parse(readFileSync(join(models!, 'ocr-rec-dict.json'), 'utf8')) as string[];

async function session(file: string): Promise<Runner> {
  const s = await ort.InferenceSession.create(join(models!, file), { intraOpNumThreads: 4, graphOptimizationLevel: 'all' });
  return async (data, dims) => {
    const r = await s.run({ [s.inputNames[0]!]: new ort.Tensor('float32', data, dims) });
    const t = r[s.outputNames[0]!]!;
    return { data: t.data as Float32Array, dims: [...t.dims] };
  };
}

const det = await session('ocr-det.onnx');
const rec = await session('ocr-rec.onnx');
let ms = 0;
for (let i = 1; i <= Number(count); i++) {
  const meta = JSON.parse(readFileSync(join(pages!, `${prefix}-${i}.json`), 'utf8')) as { width: number; height: number };
  const rgb = new Uint8Array(readFileSync(join(pages!, `${prefix}-${i}.rgb`)));
  const t0 = Date.now();
  const lines = await readPage({ ...meta, rgb }, det, rec, dict);
  ms += Date.now() - t0;
  writeFileSync(`${out}-${i}.txt`, lines.map((l) => l.text).join('\n'));
  console.log(`page ${i}: ${lines.length} lines, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
console.log(`total ${(ms / 1000).toFixed(1)} s`);
