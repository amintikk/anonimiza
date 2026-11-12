/// <reference lib="webworker" />
// OCR worker: loads the three PP-OCRv6 files (through the same cache and checks as the models) and reads the
// pages it receives. The page pixels arrive by transfer; nothing leaves the browser.
import { MODEL_FILES } from '../engine/models.ts';
import { fetchFile } from '../engine/store.ts';
import { readPage, type OcrLine, type Runner, type RgbImage } from './pipeline.ts';

type Ort = typeof import('onnxruntime-web/wasm');
export type OcrRequest =
  | { type: 'load'; id: number }
  | { type: 'page'; id: number; width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> };
export type OcrResponse =
  | { type: 'download'; id: number; file: string; loaded: number; total: number; cached: boolean }
  | { type: 'lines'; id: number; lines: OcrLine[] }
  | { type: 'error'; id: number; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: OcrResponse) => ctx.postMessage(m);

interface Engine {
  det: Runner;
  rec: Runner;
  dict: string[];
}
let engine: Promise<Engine> | null = null;

async function runner(ort: Ort, bytes: Uint8Array): Promise<Runner> {
  const s = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 });
  return async (data, dims) => {
    const out = await s.run({ [s.inputNames[0]!]: new ort.Tensor('float32', data, dims) });
    const t = out[s.outputNames[0]!]!;
    return { data: t.data as Float32Array, dims: [...t.dims] };
  };
}

function load(id: number): Promise<Engine> {
  engine ??= (async () => {
    const progress = (file: string, total: number) => (loaded: number, cached: boolean) => post({ type: 'download', id, file, loaded, total, cached });
    const dict = JSON.parse(new TextDecoder().decode(await fetchFile(MODEL_FILES.ocrDict, progress(MODEL_FILES.ocrDict.file, MODEL_FILES.ocrDict.bytes))));
    const det = await fetchFile(MODEL_FILES.ocrDet, progress(MODEL_FILES.ocrDet.file, MODEL_FILES.ocrDet.bytes));
    const rec = await fetchFile(MODEL_FILES.ocrRec, progress(MODEL_FILES.ocrRec.file, MODEL_FILES.ocrRec.bytes));
    const ort = (await import('onnxruntime-web/wasm')) as Ort;
    ort.env.wasm.wasmPaths = new URL('/ort/', ctx.location.origin).href;
    ort.env.wasm.numThreads = ctx.crossOriginIsolated ? Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4)) : 1;
    ort.env.logLevel = 'error';
    return { det: await runner(ort, det), rec: await runner(ort, rec), dict };
  })();
  engine.catch(() => (engine = null)); // a failed load is retried on the next page
  return engine;
}

let queue: Promise<void> = Promise.resolve();

async function handle(m: OcrRequest): Promise<void> {
  try {
    const e = await load(m.id);
    if (m.type === 'load') {
      post({ type: 'lines', id: m.id, lines: [] });
      return;
    }
    const rgb = new Uint8Array(m.width * m.height * 3);
    const src = m.rgba;
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
      rgb[i] = src[j]!;
      rgb[i + 1] = src[j + 1]!;
      rgb[i + 2] = src[j + 2]!;
    }
    const img: RgbImage = { width: m.width, height: m.height, rgb };
    post({ type: 'lines', id: m.id, lines: await readPage(img, e.det, e.rec, e.dict) });
  } catch (err) {
    post({ type: 'error', id: m.id, message: err instanceof Error ? err.message : String(err) });
  }
}

ctx.onmessage = (ev: MessageEvent<OcrRequest>) => {
  queue = queue.then(() => handle(ev.data));
};
