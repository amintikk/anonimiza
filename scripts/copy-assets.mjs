// Copy the ONNX Runtime WebAssembly binaries and pdf.js data files next to the app, so nothing is
// loaded from a CDN (the Content-Security-Policy only allows this site and the models domain).
import { copyFileSync, cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ort = join(root, 'node_modules/onnxruntime-web/dist');
mkdirSync(join(root, 'public/ort'), { recursive: true });
for (const base of ['ort-wasm-simd-threaded', 'ort-wasm-simd-threaded.asyncify']) {
  for (const ext of ['mjs', 'wasm']) copyFileSync(join(ort, `${base}.${ext}`), join(root, 'public/ort', `${base}.${ext}`));
}
const pdf = join(root, 'node_modules/pdfjs-dist');
cpSync(join(pdf, 'cmaps'), join(root, 'public/pdfjs/cmaps'), { recursive: true });
cpSync(join(pdf, 'standard_fonts'), join(root, 'public/pdfjs/standard_fonts'), { recursive: true });
