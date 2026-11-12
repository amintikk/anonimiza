// Main-thread handle on the OCR worker: one page at a time.
import type { OcrLine } from './pipeline.ts';
import type { OcrRequest, OcrResponse } from './ocr.worker.ts';

export interface OcrPage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

export class OcrClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve(v: OcrLine[]): void; reject(e: Error): void; onBytes?: (file: string, loaded: number, total: number, cached: boolean) => void }>();

  private ensure(): Worker {
    if (this.worker) return this.worker;
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
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'OCR'));
      this.pending.clear();
      this.worker = null;
    };
    this.worker = w;
    return w;
  }

  /** Downloads the OCR files if they are missing (they stay in the browser afterwards). */
  load(onBytes?: (file: string, loaded: number, total: number, cached: boolean) => void): Promise<void> {
    return this.call({ type: 'load', id: this.nextId++ } as OcrRequest, onBytes).then(() => undefined);
  }

  read(page: OcrPage, onBytes?: (file: string, loaded: number, total: number, cached: boolean) => void): Promise<OcrLine[]> {
    return this.call({ type: 'page', id: this.nextId++, width: page.width, height: page.height, rgba: page.rgba }, onBytes, [page.rgba.buffer]);
  }

  private call(m: OcrRequest, onBytes?: (file: string, loaded: number, total: number, cached: boolean) => void, transfer: Transferable[] = []): Promise<OcrLine[]> {
    const w = this.ensure();
    return new Promise((resolve, reject) => {
      this.pending.set(m.id, { resolve, reject, onBytes });
      w.postMessage(m, transfer);
    });
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
