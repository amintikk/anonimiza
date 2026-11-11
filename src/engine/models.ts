import type { Backend } from './protocol.ts';
import manifest from './models.json';

export interface FileMeta {
  file: string;
  bytes: number;
  sha256: string;
}

/** Files on the models domain; regenerate with tools/make_manifest.py after exporting new ones. */
export const MODEL_FILES: Record<'webgpu' | 'wasm' | 'tokenizer' | 'tokenizerConfig', FileMeta> = manifest;

/**
 * One variant per engine, chosen by measurement (README, "Variantes del modelo"):
 * fp16 on the GPU, 8-bit weights with fp32 activations on the CPU.
 */
export const modelFor = (b: Backend): FileMeta => (b === 'webgpu' ? MODEL_FILES.webgpu : MODEL_FILES.wasm);

/** Bytes to download for a backend (model + tokenizer). */
export const downloadSize = (b: Backend): number => modelFor(b).bytes + MODEL_FILES.tokenizer.bytes + MODEL_FILES.tokenizerConfig.bytes;
