// The web app's own model path (ONNX in TypeScript, onnxruntime-node instead of onnxruntime-web) over a gold file,
// in predict.py's output format, so score.ts can compare it with the Python runs.
// Usage: node tools/compare/predict_prod.ts <model dir> <model file> <gold.json> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import { Tokenizer } from '@huggingface/tokenizers';
import { detect, type OrtLike, type OrtSession } from '../../src/engine/gliner.ts';

const [dir, file, goldPath, out] = process.argv.slice(2);
const tk = new Tokenizer(JSON.parse(readFileSync(join(dir!, 'tokenizer.json'), 'utf8')), JSON.parse(readFileSync(join(dir!, 'tokenizer_config.json'), 'utf8')));
const tokenize = (w: string) => tk.encode(w, { add_special_tokens: false }).ids;
const session = (await ort.InferenceSession.create(join(dir!, file!), { intraOpNumThreads: 4, graphOptimizationLevel: 'all' })) as unknown as OrtSession;
const gold = JSON.parse(readFileSync(goldPath!, 'utf8')) as { docs: { id: string; text: string }[] };
const KIND = { person: 'person', organization: 'org', address: 'address' } as const;
let ms = 0, words = 0;
const docs = [];
for (const d of gold.docs) {
  words += d.text.match(/\w+(?:[-_]\w+)*|\S/gu)?.length ?? 0;
  const t0 = performance.now();
  const ents = await detect(ort as unknown as OrtLike, session, tokenize, d.text, { threshold: 0.1 });
  ms += performance.now() - t0;
  docs.push({ id: d.id, spans: ents.map((e) => ({ start: e.start, end: e.end, label: e.label, kind: KIND[e.label], score: Number(e.score.toFixed(5)) })) });
}
writeFileSync(out!, JSON.stringify({ model: `web:${file}`, labelset: 'base', floor: 0.1, seconds: Number((ms / 1000).toFixed(1)), words, docs }));
console.log(`${out}: ${docs.length} docs, ${words} words, ${(ms / 1000).toFixed(1)} s`);
