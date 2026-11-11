import type { Lang } from '../i18n.ts';
import type { EntitySpan } from './gliner.ts';

export type Backend = 'webgpu' | 'wasm';

export type Request =
  | { type: 'init'; backend: Backend; threads: number; lang: Lang }
  | { type: 'load'; id: number }
  | { type: 'detect'; id: number; text: string; threshold: number }
  | { type: 'cancel' };

export type Response =
  | { type: 'ready'; backend: Backend; threads: number }
  | { type: 'download'; id: number; file: string; loaded: number; total: number; cached: boolean }
  | { type: 'progress'; id: number; stage: 'compile' | 'detect'; done: number; total: number }
  | { type: 'done'; id: number; entities?: EntitySpan[]; ms: number }
  | { type: 'error'; id: number; message: string; cancelled: boolean };
