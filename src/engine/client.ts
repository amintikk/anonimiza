import { lang, t } from '../i18n.ts';
import type { EntitySpan } from './gliner.ts';
import type { Backend, Request, Response } from './protocol.ts';

export interface EngineEvents {
  progress(stage: 'compile' | 'detect', done: number, total: number): void;
  download(file: string, loaded: number, total: number, cached: boolean): void;
}

type Pending = { resolve(v: { entities?: EntitySpan[]; ms: number }): void; reject(e: Error): void; events?: Partial<EngineEvents> };

export class CancelError extends Error {}

/** Main-thread handle on the inference worker. Switching backend restarts it. */
export class Engine {
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private ready: Promise<{ backend: Backend; threads: number }> | null = null;
  backend: Backend = 'wasm';
  threads = 1;

  start(backend: Backend, threads: number): Promise<{ backend: Backend; threads: number }> {
    this.stop();
    this.backend = backend;
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    this.ready = new Promise((resolve, reject) => {
      worker.onerror = (e) => {
        reject(new Error(e.message || t('No se pudo iniciar el motor de inferencia')));
        this.failAll(new Error(e.message || t('El motor de inferencia se detuvo')));
      };
      worker.onmessage = (ev: MessageEvent<Response>) => {
        const m = ev.data;
        if (m.type === 'ready') {
          this.threads = m.threads;
          resolve({ backend: m.backend, threads: m.threads });
          return;
        }
        const p = this.pending.get(m.id);
        if (!p) return;
        if (m.type === 'progress') p.events?.progress?.(m.stage, m.done, m.total);
        else if (m.type === 'download') p.events?.download?.(m.file, m.loaded, m.total, m.cached);
        else {
          this.pending.delete(m.id);
          if (m.type === 'done') p.resolve({ entities: m.entities, ms: m.ms });
          else p.reject(m.cancelled ? new CancelError(m.message) : new Error(m.message));
        }
      };
    });
    this.send({ type: 'init', backend, threads, lang });
    return this.ready;
  }

  get running(): boolean {
    return !!this.worker;
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.failAll(new CancelError(t('Motor reiniciado')));
  }

  private failAll(e: Error): void {
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
  }

  private send(m: Request): void {
    this.worker?.postMessage(m);
  }

  private async call(msg: { type: 'load' } | { type: 'detect'; text: string; threshold: number }, events?: Partial<EngineEvents>) {
    if (!this.ready) throw new Error(t('Motor no iniciado'));
    await this.ready;
    const id = this.nextId++;
    return new Promise<{ entities?: EntitySpan[]; ms: number }>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, events });
      this.send({ ...msg, id });
    });
  }

  load(events?: Partial<EngineEvents>) {
    return this.call({ type: 'load' }, events);
  }
  async detect(text: string, threshold: number, events?: Partial<EngineEvents>): Promise<EntitySpan[]> {
    return (await this.call({ type: 'detect', text, threshold }, events)).entities ?? [];
  }
  cancel(): void {
    this.send({ type: 'cancel' });
  }
}
