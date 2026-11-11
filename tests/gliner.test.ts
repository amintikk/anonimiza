// Pre/post-processing against the original Python GLiNER (tests/fixtures/reference.json, made with tools/reference.py).
// The tokenizer and model comparison runs only when ANONIMIZA_MODELS points to a folder with the model files.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { decodeSpans, detect, encode, greedy, splitWords, windows, MODEL_LABELS, type OrtLike, type OrtSession } from '../src/engine/gliner.ts';

interface RefDoc { id: string; words: [string, number, number][]; input_ids: number[]; words_mask: number[]; entities: { start: number; end: number; label: string; score: number }[] }
const ref = JSON.parse(readFileSync(new URL('./fixtures/reference.json', import.meta.url), 'utf8')) as { labels: string[]; threshold: number; docs: RefDoc[] };
const texts = Object.fromEntries((JSON.parse(readFileSync(new URL('./data/documentos.json', import.meta.url), 'utf8')) as { docs: { id: string; text: string }[] }).docs.map((d) => [d.id, d.text]));

/** Python counts code points, JavaScript counts UTF-16 units: convert the reference offsets. */
function toUtf16(text: string, cp: number): number {
  return [...text].slice(0, cp).join('').length;
}

test('labels match the reference', () => assert.deepEqual([...MODEL_LABELS], ref.labels));

test('word split matches gliner WhitespaceTokenSplitter', () => {
  for (const d of ref.docs) {
    const text = texts[d.id]!;
    const got = splitWords(text).map((w) => [w.text, w.start, w.end]);
    const want = d.words.map(([w, s, e]) => [w, toUtf16(text, s), toUtf16(text, e)]);
    assert.deepEqual(got, want, d.id);
  }
});

test('windows cover every word once', () => {
  for (const n of [1, 255, 256, 257, 700, 1000]) {
    const ws = windows(n, 256, 48);
    const owned = new Array(n).fill(0);
    for (const w of ws) for (let i = w.ownFrom; i < w.ownTo; i++) owned[i]++;
    assert.ok(owned.every((x) => x === 1), `n=${n}`);
    assert.ok(ws.every((w) => w.to - w.from <= 256 && w.ownFrom >= w.from && w.ownTo <= w.to));
  }
});

test('greedy decoding keeps the best non-overlapping spans', () => {
  const logit = (p: number) => Math.log(p / (1 - p));
  // 3 words, max width 2, 1 class: spans (0,0)=.9 (0,1)=.95 (1,1)=.6 (2,2)=.4
  const L = [logit(0.9), logit(0.95), logit(0.6), -9, logit(0.4), -9];
  assert.deepEqual(decodeSpans(L, 3, 1, 0.5, 2).map((s) => [s.start, s.end]), [[0, 1]]);
  assert.deepEqual(greedy([{ start: 0, end: 0, score: 0.5 }, { start: 1, end: 2, score: 0.7 }, { start: 2, end: 3, score: 0.9 }]).map((s) => s.start), [0, 2]);
});

const dir = process.env.ANONIMIZA_MODELS;
const model = process.env.ANONIMIZA_MODEL ?? 'model_fp32.onnx';
const haveModels = !!dir && existsSync(join(dir, 'tokenizer.json'));

test('token ids and word mask match Python', { skip: !haveModels && 'set ANONIMIZA_MODELS to run' }, async () => {
  const { Tokenizer } = await import('@huggingface/tokenizers');
  const tk = new Tokenizer(JSON.parse(readFileSync(join(dir!, 'tokenizer.json'), 'utf8')), JSON.parse(readFileSync(join(dir!, 'tokenizer_config.json'), 'utf8')));
  const tokenize = (w: string) => tk.encode(w, { add_special_tokens: false }).ids;
  for (const d of ref.docs) {
    const enc = encode(d.words.map((w) => w[0]), ref.labels, tokenize);
    assert.deepEqual(enc.inputIds, d.input_ids, d.id);
    assert.deepEqual(enc.wordsMask, d.words_mask, d.id);
  }
});

test('entities match Python GLiNER', { skip: !(haveModels && existsSync(join(dir!, model))) && 'set ANONIMIZA_MODELS (and ANONIMIZA_MODEL) to run', timeout: 600_000 }, async () => {
  const ort = await import('onnxruntime-node');
  const { Tokenizer } = await import('@huggingface/tokenizers');
  const tk = new Tokenizer(JSON.parse(readFileSync(join(dir!, 'tokenizer.json'), 'utf8')), JSON.parse(readFileSync(join(dir!, 'tokenizer_config.json'), 'utf8')));
  const tokenize = (w: string) => tk.encode(w, { add_special_tokens: false }).ids;
  const session = (await ort.InferenceSession.create(join(dir!, model))) as unknown as OrtSession;
  const tolerance = Number(process.env.ANONIMIZA_TOLERANCE ?? 0.001);
  const minAgree = Number(process.env.ANONIMIZA_MIN_AGREE ?? 1);
  let same = 0, total = 0;
  for (const d of ref.docs) {
    const text = texts[d.id]!;
    const want = d.entities.map((e) => ({ ...e, start: toUtf16(text, e.start), end: toUtf16(text, e.end) }));
    const got = await detect(ort as unknown as OrtLike, session, tokenize, text, { threshold: ref.threshold });
    const key = (e: { start: number; end: number; label: string }) => `${e.start}:${e.end}:${e.label}`;
    const W = new Map(want.map((e) => [key(e), e.score]));
    for (const g of got) {
      const s = W.get(key(g));
      if (s !== undefined && Math.abs(s - g.score) <= tolerance) same++;
    }
    total += Math.max(got.length, want.length);
  }
  assert.ok(same / total >= minAgree, `${same}/${total} entities agree within ${tolerance}`);
});

test('review case end to end: nothing it should hide is left', { skip: !(haveModels && existsSync(join(dir!, 'gliner-pii-int8w.onnx'))) && 'set ANONIMIZA_MODELS (with gliner-pii-int8w.onnx) to run', timeout: 300_000 }, async () => {
  const ort = await import('onnxruntime-node');
  const { Tokenizer } = await import('@huggingface/tokenizers');
  const { findRules } = await import('../src/engine/rules.ts');
  const { buildDetections, assignMarkers, applyMarkers } = await import('../src/engine/anonymize.ts');
  const tk = new Tokenizer(JSON.parse(readFileSync(join(dir!, 'tokenizer.json'), 'utf8')), JSON.parse(readFileSync(join(dir!, 'tokenizer_config.json'), 'utf8')));
  const tokenize = (w: string) => tk.encode(w, { add_special_tokens: false }).ids;
  const session = (await ort.InferenceSession.create(join(dir!, 'gliner-pii-int8w.onnx'))) as unknown as OrtSession;
  const text = readFileSync(new URL('./data/caso-revision.txt', import.meta.url), 'utf8');
  const ents = await detect(ort as unknown as OrtLike, session, tokenize, text, { threshold: 0.3 });
  const dets = buildDetections(text, findRules(text), ents);
  const out = applyMarkers(text, dets, assignMarkers(text, dets, 'es').byId);
  const leaks = ['Montse', 'Nahia', 'Etxeberria', 'etxeberria', 'Uriarte', '14/03/1987', '48213907L', 'Major', '43500', 'Youssef', 'youssef', 'Idrissi',
    'X1234567L', '71530264K', 'Puig', 'Ferrer', 'ES91', 'Ebre', 'nahia.etxe87', '612 34 56 78', '977 44 12 03', '4821 KLM', 'Jordi'].filter((s) => out.includes(s));
  assert.deepEqual(leaks, [], out);
});
