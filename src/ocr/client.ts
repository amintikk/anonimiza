// Main-thread handle on the OCR workers. Each worker reads one page at a time; a small pool reads several pages at
// once, which is faster on a multi-core machine than one worker with many threads (the models are small).
import type { OcrLine } from './pipeline.ts';
import type { OcrRequest, OcrResponse } from './ocr.worker.ts';

export interface OcrPage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

type Pending = { worker: number; resolve(v: OcrLine[]): void; reject(e: Error): void; onBytes?: (file: string, loaded: number, total: number, cached: boolean) => void };
type OnBytes = (file: string, loaded: number, total: number, cached: boolean) => void;

/** Workers and threads for this machine: about half the cores as workers (at most 3), the rest shared between them. */
export function ocrPoolShape(cores = navigator.hardwareConcurrency || 4): { size: number; threads: number } {
  const size = Math.max(1, Math.min(3, Math.floor(cores / 2)));
  return { size, threads: Math.max(1, Math.floor(cores / size)) };
}

export class OcrClient {
  private workers: (Worker | null)[];
  private busy: number[];
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(private readonly size = 1, private readonly threads = 1) {
    this.workers = Array.from({ length: size }, () => null);
    this.busy = Array.from({ length: size }, () => 0);
  }

  /** How many pages can be read at the same time. */
  get parallel(): number {
    return this.size;
  }

  private ensure(i: number): Worker {
    const have = this.workers[i];
    if (have) return have;
    const w = new Worker(new URL('./ocr.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<OcrResponse>) => {
      const m = ev.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === 'download') p.onBytes?.(m.file, m.loaded, m.total, m.cached);
      else if (m.type === 'lines') {
        this.pending.delete(m.id);
        p.resolve(m.lines);
      } else {
        this.pending.delete(m.id);
        p.reject(new Error(m.message));
      }
    };
    w.onerror = (e) => {
      for (const [id, p] of this.pending) {
        if (p.worker !== i) continue;
        p.reject(new Error(e.message || 'OCR'));
        this.pending.delete(id);
      }
      this.workers[i] = null;
      this.busy[i] = 0;
    };
    this.workers[i] = w;
    return w;
  }

  private least(): number {
    let best = 0;
    for (let i = 1; i < this.size; i++) if (this.busy[i]! < this.busy[best]!) best = i;
    return best;
  }

  /** Downloads the OCR files if they are missing (they stay in the browser afterwards), in every worker. */
  load(onBytes?: OnBytes): Promise<void> {
    return Promise.all(Array.from({ length: this.size }, (_, i) => this.call(i, { type: 'load', id: this.nextId++, threads: this.threads } as OcrRequest, onBytes))).then(() => undefined);
  }

  read(page: OcrPage, onBytes?: OnBytes): Promise<OcrLine[]> {
    const i = this.least();
    this.busy[i]!++;
    const done = () => {
      this.busy[i]!--;
    };
    const req = this.call(i, { type: 'page', id: this.nextId++, threads: this.threads, width: page.width, height: page.height, rgba: page.rgba }, onBytes, [page.rgba.buffer]);
    req.then(done, done);
    return req;
  }

  private call(i: number, m: OcrRequest, onBytes?: OnBytes, transfer: Transferable[] = []): Promise<OcrLine[]> {
    const w = this.ensure(i);
    return new Promise((resolve, reject) => {
      this.pending.set(m.id, { worker: i, resolve, reject, onBytes });
      w.postMessage(m, transfer);
    });
  }

  stop(): void {
    for (const w of this.workers) w?.terminate();
    this.workers = this.workers.map(() => null);
    this.busy = this.busy.map(() => 0);
    this.pending.clear();
  }
}
