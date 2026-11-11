/// <reference lib="webworker" />
// Inference worker: loads the tokenizer and the GLiNER model, and runs it on the texts it receives.
// Text arrives by postMessage and results go back the same way; nothing is sent over the network.
import { Tokenizer } from '@huggingface/tokenizers';
import { setLang, t } from '../i18n.ts';
import { Cancelled, detect, type OrtLike, type OrtSession } from './gliner.ts';
import { MODEL_FILES, modelFor } from './models.ts';
import type { Backend, Request, Response } from './protocol.ts';
import { fetchFile } from './store.ts';

type Ort = typeof import('onnxruntime-web');
const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: Response) => ctx.postMessage(m);

let ort: Ort;
let backend: Backend = 'wasm';
let cancelled = false;
let queue: Promise<void> = Promise.resolve();
let session: OrtSession | null = null;
let tokenize: ((w: string) => number[]) | null = null;

async function init(want: Backend, threads: number): Promise<void> {
  backend = want;
  ort = (want === 'webgpu' ? await import('onnxruntime-web/webgpu') : await import('onnxruntime-web/wasm')) as Ort;
  ort.env.wasm.wasmPaths = new URL('/ort/', ctx.location.origin).href;
  ort.env.wasm.numThreads = ctx.crossOriginIsolated ? threads : 1;
  ort.env.logLevel = 'error';
  post({ type: 'ready', backend, threads: ort.env.wasm.numThreads });
}

async function load(id: number): Promise<void> {
  if (session && tokenize) return;
  const progress = (file: string, total: number) => (loaded: number, cached: boolean) => post({ type: 'download', id, file, loaded, total, cached });
  const dec = new TextDecoder();
  const tf = MODEL_FILES.tokenizer;
  const cf = MODEL_FILES.tokenizerConfig;
  const tokJson = JSON.parse(dec.decode(await fetchFile(tf, progress(tf.file, tf.bytes))));
  const tokCfg = JSON.parse(dec.decode(await fetchFile(cf, progress(cf.file, cf.bytes))));
  const tk = new Tokenizer(tokJson, tokCfg);
  const cache = new Map<string, number[]>();
  tokenize = (w) => {
    let ids = cache.get(w);
    if (!ids) {
      ids = tk.encode(w, { add_special_tokens: false }).ids;
      if (cache.size < 50_000) cache.set(w, ids);
    }
    return ids;
  };
  const mf = modelFor(backend);
  const bytes = await fetchFile(mf, progress(mf.file, mf.bytes));
  post({ type: 'progress', id, stage: 'compile', done: 0, total: 1 });
  session = (await ort.InferenceSession.create(bytes, {
    executionProviders: [backend],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,
  })) as unknown as OrtSession;
}

async function handle(m: Request): Promise<void> {
  if (m.type === 'init' || m.type === 'cancel') return;
  const started = performance.now();
  try {
    if (m.type === 'load') {
      await load(m.id);
      post({ type: 'done', id: m.id, ms: performance.now() - started });
      return;
    }
    await load(m.id);
    cancelled = false;
    const entities = await detect(ort as unknown as OrtLike, session!, tokenize!, m.text, {
      threshold: m.threshold,
      onProgress: (done, total) => post({ type: 'progress', id: m.id, stage: 'detect', done, total }),
      isCancelled: () => cancelled,
    });
    post({ type: 'done', id: m.id, entities, ms: performance.now() - started });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    post({ type: 'error', id: m.id, message: message || t('Error desconocido'), cancelled: e instanceof Cancelled });
  }
}

ctx.onmessage = (ev: MessageEvent<Request>) => {
  const m = ev.data;
  if (m.type === 'cancel') {
    cancelled = true;
    return;
  }
  // One job at a time: they share one session.
  if (m.type === 'init') setLang(m.lang);
  queue = queue.then(() => (m.type === 'init' ? init(m.backend, m.threads) : handle(m)));
};
