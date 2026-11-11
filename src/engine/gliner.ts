// GLiNER (span mode "markerV0") pre- and post-processing, ported from the Python package `gliner`.
// Pure functions: the same code runs in the browser worker and in the Node tests.

/** Labels sent to the model. They must match tools/reference.py. */
export const MODEL_LABELS = ['person', 'organization', 'address'] as const;
export type ModelLabel = (typeof MODEL_LABELS)[number];

export const MAX_WIDTH = 12; // gliner_config.json: max_width
const ENT_TOKEN = '<<ENT>>';
const SEP_TOKEN = '<<SEP>>';
const CLS_ID = 1;
const SEP_ID = 2;

export interface Word {
  text: string;
  start: number; // character offsets in the source text
  end: number;
}

// gliner WhitespaceTokenSplitter: r"\w+(?:[-_]\w+)*|\S" with Python's Unicode \w and \s.
const WORD_RE = /[\p{L}\p{N}_]+(?:[-_][\p{L}\p{N}_]+)*|[^\s\x1c-\x1f\x85]/gu;

export function splitWords(text: string): Word[] {
  const out: Word[] = [];
  for (const m of text.matchAll(WORD_RE)) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

/** Token ids of one word, without special tokens (the tokenizer adds the SentencePiece "▁" itself). */
export type WordTokenizer = (word: string) => number[];

export interface Encoded {
  inputIds: number[];
  wordsMask: number[];
  numWords: number;
}

/**
 * Prompt + words → token ids and word mask, as GLiNER's processor does with
 * `is_split_into_words=True` and `subtoken_pooling="first"`.
 */
export function encode(words: readonly string[], labels: readonly string[], tokenize: WordTokenizer): Encoded {
  const prompt: string[] = [];
  for (const l of labels) prompt.push(ENT_TOKEN, l);
  prompt.push(SEP_TOKEN);
  const inputIds = [CLS_ID];
  const wordsMask = [0];
  let w = 0;
  const all = [...prompt, ...words];
  for (let i = 0; i < all.length; i++) {
    const ids = tokenize(all[i]!);
    const isText = i >= prompt.length;
    if (isText) w++;
    ids.forEach((id, j) => {
      inputIds.push(id);
      wordsMask.push(isText && j === 0 ? w : 0);
    });
  }
  inputIds.push(SEP_ID);
  wordsMask.push(0);
  return { inputIds, wordsMask, numWords: words.length };
}

/** All (start, end) word spans up to MAX_WIDTH, flattened, and which of them fit in the text. */
export function spanIndex(numWords: number, maxWidth = MAX_WIDTH): { idx: number[]; mask: boolean[] } {
  const idx: number[] = [];
  const mask: boolean[] = [];
  for (let i = 0; i < numWords; i++) {
    for (let j = 0; j < maxWidth; j++) {
      idx.push(i, i + j);
      mask.push(i + j < numWords);
    }
  }
  return { idx, mask };
}

export interface WordSpan {
  start: number; // first word (inclusive)
  end: number; // last word (inclusive)
  label: number; // index into the labels
  score: number;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * logits: [numWords, maxWidth, numClasses] (batch of one). Keeps spans above the threshold and resolves
 * overlaps greedily by score (flat_ner=True, multi_label=False), like gliner's SpanDecoder.
 */
export function decodeSpans(logits: ArrayLike<number>, numWords: number, numClasses: number, threshold: number, maxWidth = MAX_WIDTH): WordSpan[] {
  const cands: WordSpan[] = [];
  for (let i = 0; i < numWords; i++) {
    for (let k = 0; k < maxWidth && i + k < numWords; k++) {
      const base = (i * maxWidth + k) * numClasses;
      for (let c = 0; c < numClasses; c++) {
        const p = sigmoid(logits[base + c]!);
        if (p > threshold) cands.push({ start: i, end: i + k, label: c, score: p });
      }
    }
  }
  return greedy(cands);
}

/** Highest score first; drop any span that overlaps one already kept. */
export function greedy<T extends { start: number; end: number; score: number }>(cands: T[]): T[] {
  const kept: T[] = [];
  for (const s of [...cands].sort((a, b) => b.score - a.score)) {
    if (kept.every((k) => s.end < k.start || s.start > k.end)) kept.push(s);
  }
  return kept.sort((a, b) => a.start - b.start);
}

export interface Window {
  from: number; // first word of the window
  to: number; // one past the last word
  ownFrom: number; // entities starting in [ownFrom, ownTo) belong to this window
  ownTo: number;
}

/**
 * Long texts are split into overlapping windows of words. Each window "owns" the middle of its overlap
 * with the neighbours, so an entity cut by one window edge is taken from the window that sees it whole.
 */
export function windows(numWords: number, size: number, overlap: number): Window[] {
  if (numWords <= size) return [{ from: 0, to: numWords, ownFrom: 0, ownTo: numWords }];
  const step = size - overlap;
  const out: Window[] = [];
  for (let from = 0; ; from += step) {
    const to = Math.min(from + size, numWords);
    out.push({ from, to, ownFrom: from === 0 ? 0 : from + Math.floor(overlap / 2), ownTo: to });
    if (to === numWords) break;
  }
  for (let i = 0; i < out.length - 1; i++) out[i]!.ownTo = out[i + 1]!.ownFrom;
  return out;
}

/** Minimal slice of onnxruntime's API used here, so Node and the browser can share this file. */
export interface OrtTensor {
  data: unknown;
  dims: readonly number[];
}
export interface OrtLike {
  Tensor: new (type: string, data: unknown, dims: readonly number[]) => OrtTensor;
}
export interface OrtSession {
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}

export interface EntitySpan {
  start: number; // character offsets
  end: number;
  label: ModelLabel;
  score: number;
}

export interface DetectOptions {
  threshold: number;
  windowWords?: number;
  overlapWords?: number;
  /** Windows longer than this many tokens are split further (keeps memory and time bounded). */
  maxTokens?: number;
  onProgress?(done: number, total: number): void;
  isCancelled?(): boolean;
}

export class Cancelled extends Error {}

/** Run GLiNER over a text of any length and return character-level entities. */
export async function detect(ort: OrtLike, session: OrtSession, tokenize: WordTokenizer, text: string, opts: DetectOptions): Promise<EntitySpan[]> {
  const words = splitWords(text);
  if (!words.length) return [];
  const size = opts.windowWords ?? 256;
  const overlap = opts.overlapWords ?? 48;
  const maxTokens = opts.maxTokens ?? 512;
  const labels = MODEL_LABELS;
  const ws = windows(words.length, size, overlap);
  const found: WordSpan[] = [];
  for (let n = 0; n < ws.length; n++) {
    if (opts.isCancelled?.()) throw new Cancelled('cancelled');
    const w = ws[n]!;
    const spans = await runWindow(ort, session, tokenize, words.slice(w.from, w.to).map((x) => x.text), labels, opts.threshold, maxTokens);
    for (const s of spans) {
      const start = s.start + w.from;
      if (start >= w.ownFrom && start < w.ownTo) found.push({ ...s, start, end: s.end + w.from });
    }
    opts.onProgress?.(n + 1, ws.length);
  }
  return greedy(found).map((s) => ({ start: words[s.start]!.start, end: words[s.end]!.end, label: labels[s.label]!, score: s.score }));
}

async function runWindow(ort: OrtLike, session: OrtSession, tokenize: WordTokenizer, words: string[], labels: readonly string[], threshold: number, maxTokens: number): Promise<WordSpan[]> {
  const enc = encode(words, labels, tokenize);
  if (enc.inputIds.length > maxTokens && words.length > 16) {
    // Very token-dense text (long numbers, rare scripts): halve the window instead of truncating.
    const half = Math.ceil(words.length / 2);
    const a = await runWindow(ort, session, tokenize, words.slice(0, half), labels, threshold, maxTokens);
    const b = await runWindow(ort, session, tokenize, words.slice(half), labels, threshold, maxTokens);
    return [...a, ...b.map((s) => ({ ...s, start: s.start + half, end: s.end + half }))];
  }
  const L = enc.inputIds.length;
  const { idx, mask } = spanIndex(enc.numWords);
  const i64 = (a: number[]) => BigInt64Array.from(a, (x) => BigInt(x));
  const feeds = {
    input_ids: new ort.Tensor('int64', i64(enc.inputIds), [1, L]),
    attention_mask: new ort.Tensor('int64', new BigInt64Array(L).fill(1n), [1, L]),
    words_mask: new ort.Tensor('int64', i64(enc.wordsMask), [1, L]),
    text_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(enc.numWords)]), [1, 1]),
    span_idx: new ort.Tensor('int64', i64(idx), [1, idx.length / 2, 2]),
    span_mask: new ort.Tensor('bool', Uint8Array.from(mask, (m) => (m ? 1 : 0)), [1, mask.length]),
  };
  const out = await session.run(feeds);
  const logits = out.logits!;
  const numClasses = logits.dims[3]!;
  return decodeSpans(logits.data as Float32Array, enc.numWords, numClasses, threshold);
}
