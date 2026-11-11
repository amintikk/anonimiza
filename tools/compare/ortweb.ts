// Does a graph load and run in ONNX Runtime Web (WebAssembly, the browser fallback), and how fast and how big?
// Runs in Node with onnxruntime-web's WebAssembly build; no browser involved.
// Usage: [CURRENT=file,file] node tools/compare/ortweb.ts <current model dir> <gliner2 onnx dir>... (one line per check; CURRENT= skips the current model)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-web';
import { Tokenizer } from '@huggingface/tokenizers';
import { detect, type OrtLike, type OrtSession } from '../../src/engine/gliner.ts';

ort.env.wasm.numThreads = 4;
const [cur, ...g2dirs] = process.argv.slice(2);
const mb = (n: number) => `${Math.round(n / 2 ** 20)} MB`;
const gold = JSON.parse(readFileSync(join(import.meta.dirname, '../../tests/data/documentos-nuevo.json'), 'utf8')) as { docs: { text: string }[] };
// A 250-word piece of running text (from the frozen set: only timing, no scoring).
const words = gold.docs.map((d) => d.text).join('\n').split(/\s+/).slice(0, 250);
const text = words.join(' ');
const tk = new Tokenizer(JSON.parse(readFileSync(join(cur!, 'tokenizer.json'), 'utf8')), JSON.parse(readFileSync(join(cur!, 'tokenizer_config.json'), 'utf8')));
const tokenize = (w: string) => tk.encode(w, { add_special_tokens: false }).ids;

async function time<T>(f: () => Promise<T>, n = 3): Promise<{ ms: number; out: T }> {
  let out!: T;
  const t: number[] = [];
  for (let i = 0; i < n; i++) { const t0 = performance.now(); out = await f(); t.push(performance.now() - t0); }
  return { ms: t.sort((a, b) => a - b)[Math.floor(n / 2)]!, out };
}

async function load(path: string) {
  const buf = readFileSync(path);
  const t0 = performance.now();
  try {
    const s = await ort.InferenceSession.create(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return { s, ms: performance.now() - t0, size: buf.byteLength };
  } catch (e) {
    return { err: String((e as Error).message ?? e).slice(0, 160), size: buf.byteLength };
  }
}

// Current model: the app's own detect() over the 250 words, as the browser would run it.
for (const f of (process.env.CURRENT ?? 'gliner-pii-int8w.onnx,gliner-pii-fp16.onnx').split(',').filter(Boolean)) {
  const r = await load(join(cur!, f));
  if (!r.s) { console.log(`actual ${f}: NO CARGA (${r.err})`); continue; }
  const { ms, out } = await time(() => detect(ort as unknown as OrtLike, r.s as unknown as OrtSession, tokenize, text, { threshold: 0.3 }));
  console.log(`actual ${f}: ${mb(r.size)}, carga ${(r.ms / 1000).toFixed(1)} s, 250 palabras en ${(ms / 1000).toFixed(2)} s (${out.length} entidades), RSS ${mb(process.memoryUsage().rss)}`);
  await r.s.release();
}

// GLiNER2: its graphs with inputs of the size the same 250 words give (pre/post-processing not ported).
const nTok = words.reduce((n, w) => n + tokenize(w).length, 0) + 24; // + schema prompt with a few labels
const nWords = words.length;
for (const dir of g2dirs) {
  const enc = await load(join(dir, 'onnx/encoder.onnx'));
  if (!enc.s) { console.log(`gliner2 ${dir}: encoder NO CARGA (${enc.err})`); continue; }
  const ids = new BigInt64Array(nTok).map((_, i) => BigInt(5 + ((i * 7919) % 200000)));
  const feeds = { input_ids: new ort.Tensor('int64', ids, [1, nTok]), attention_mask: new ort.Tensor('int64', new BigInt64Array(nTok).fill(1n), [1, nTok]) };
  const e = await time(() => enc.s!.run(feeds));
  const hidden = e.out.hidden_states as ort.Tensor;
  const span = await load(join(dir, 'onnx/span_rep.onnx'));
  const nSpans = nWords * 8;
  const st = new BigInt64Array(nSpans), en = new BigInt64Array(nSpans);
  for (let i = 0; i < nWords; i++) for (let j = 0; j < 8; j++) { st[i * 8 + j] = BigInt(i); en[i * 8 + j] = BigInt(Math.min(i + j, nWords - 1)); }
  const wordsHidden = new ort.Tensor('float32', (hidden.data as Float32Array).slice(0, nWords * 768), [1, nWords, 768]);
  const s = await time(() => span.s!.run({ hidden_states: wordsHidden, span_start_idx: new ort.Tensor('int64', st, [1, nSpans]), span_end_idx: new ort.Tensor('int64', en, [1, nSpans]) }));
  const heads = (await load(join(dir, 'onnx/span_rep.onnx'))).size + (await load(join(dir, 'onnx/count_embed.onnx'))).size + (await load(join(dir, 'onnx/classifier.onnx'))).size;
  console.log(`gliner2 ${dir.split('/').pop()}: encoder ${mb(enc.size)} + cabezas ${mb(heads)}, carga ${(enc.ms / 1000).toFixed(1)} s, ${nTok} tokens: encoder ${(e.ms / 1000).toFixed(2)} s + span_rep ${(s.ms / 1000).toFixed(2)} s, RSS ${mb(process.memoryUsage().rss)}`);
  await enc.s.release();
}
