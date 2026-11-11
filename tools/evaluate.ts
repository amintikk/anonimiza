// Measure detection quality on tests/data/documentos.json with the same code the web app runs.
// Usage: node tools/evaluate.ts <dir with model .onnx + tokenizer.json> <model file> [threshold] [--json out.json]
// Runs the model with onnxruntime-node (CPU); the browser runs the same graph with onnxruntime-web.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ort from 'onnxruntime-node';
import { Tokenizer } from '@huggingface/tokenizers';
import { buildDetections, type Detection, type Kind } from '../src/engine/anonymize.ts';
import { detect, type OrtLike, type OrtSession } from '../src/engine/gliner.ts';
import { findRules } from '../src/engine/rules.ts';

const [dir, file, th, ...rest] = process.argv.slice(2);
if (!dir || !file) throw new Error('usage: node tools/evaluate.ts <model dir> <model file> [threshold] [--json out.json]');
const threshold = Number(th ?? 0.3);
const jsonOut = rest[0] === '--json' ? rest[1] : undefined;

const GOLD_KIND: Record<string, Kind> = {
  PERSONA: 'person', ORGANIZACION: 'org', DIRECCION: 'address', DNI: 'dni', NIE: 'nie', CIF: 'cif', NSS: 'nss',
  IBAN: 'iban', TARJETA: 'card', TELEFONO: 'phone', EMAIL: 'email', IP: 'ip',
};

interface Gold { start: number; end: number; kind: Kind }
interface Doc { id: string; text: string; pii: [string, string][] }

/** Every occurrence of each annotated string; longer strings first, shorter ones only where still free. */
export function goldSpans(d: Doc): Gold[] {
  const taken = new Uint8Array(d.text.length);
  const out: Gold[] = [];
  for (const [s, k] of [...d.pii].sort((a, b) => b[0].length - a[0].length)) {
    for (let i = d.text.indexOf(s); i !== -1; i = d.text.indexOf(s, i + s.length)) {
      if (taken.subarray(i, i + s.length).some((x) => x)) continue;
      taken.fill(1, i, i + s.length);
      out.push({ start: i, end: i + s.length, kind: GOLD_KIND[k]! });
    }
  }
  return out;
}

const docs = (JSON.parse(readFileSync(join(import.meta.dirname, '../tests/data/documentos.json'), 'utf8')) as { docs: Doc[] }).docs;
const tk = new Tokenizer(JSON.parse(readFileSync(join(dir, 'tokenizer.json'), 'utf8')), JSON.parse(readFileSync(join(dir, 'tokenizer_config.json'), 'utf8')));
const tokenize = (w: string) => tk.encode(w, { add_special_tokens: false }).ids;
const session = (await ort.InferenceSession.create(join(dir, file), { intraOpNumThreads: 4, graphOptimizationLevel: 'all' })) as unknown as OrtSession;

type Row = { gold: number; pred: number; tpStrictP: number; tpStrictR: number; tpRelP: number; tpRelR: number };
const rows = new Map<Kind, Row>();
const row = (k: Kind) => rows.get(k) ?? (rows.set(k, { gold: 0, pred: 0, tpStrictP: 0, tpStrictR: 0, tpRelP: 0, tpRelR: 0 }), rows.get(k)!);
let goldChars = 0, coveredChars = 0, predChars = 0, predCharsOk = 0, ms = 0;
const errors: { doc: string; type: 'missed' | 'extra'; kind: Kind; text: string }[] = [];
const ov = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

for (const d of docs) {
  const t0 = performance.now();
  const ents = await detect(ort as unknown as OrtLike, session, tokenize, d.text, { threshold });
  const dets: Detection[] = buildDetections(d.text, findRules(d.text), ents);
  ms += performance.now() - t0;
  const gold = goldSpans(d);
  for (const g of gold) {
    const r = row(g.kind);
    r.gold++;
    if (dets.some((p) => p.kind === g.kind && p.start === g.start && p.end === g.end)) r.tpStrictR++;
    if (dets.some((p) => p.kind === g.kind && ov(p, g))) r.tpRelR++;
    else errors.push({ doc: d.id, type: 'missed', kind: g.kind, text: d.text.slice(g.start, g.end) });
  }
  for (const p of dets) {
    const r = row(p.kind);
    r.pred++;
    if (gold.some((g) => p.kind === g.kind && p.start === g.start && p.end === g.end)) r.tpStrictP++;
    if (gold.some((g) => p.kind === g.kind && ov(p, g))) r.tpRelP++;
    else errors.push({ doc: d.id, type: 'extra', kind: p.kind, text: d.text.slice(p.start, p.end) });
  }
  const g = new Uint8Array(d.text.length), p = new Uint8Array(d.text.length);
  for (const x of gold) g.fill(1, x.start, x.end);
  for (const x of dets) p.fill(1, x.start, x.end);
  for (let i = 0; i < d.text.length; i++) {
    if (/\s/.test(d.text[i]!)) continue; // spaces inside a span say nothing about its content
    goldChars += g[i]!;
    predChars += p[i]!;
    if (g[i] && p[i]) { coveredChars++; predCharsOk++; }
  }
}

const pct = (a: number, b: number) => (b ? ((100 * a) / b).toFixed(1) : '—');
const order: Kind[] = ['person', 'org', 'address', 'dni', 'nie', 'cif', 'nss', 'iban', 'card', 'phone', 'email', 'ip'];
const total = [...rows.values()].reduce((a, r) => ({ gold: a.gold + r.gold, pred: a.pred + r.pred, tpStrictP: a.tpStrictP + r.tpStrictP, tpStrictR: a.tpStrictR + r.tpStrictR, tpRelP: a.tpRelP + r.tpRelP, tpRelR: a.tpRelR + r.tpRelR }));
const lines = [
  '| Tipo | Reales | Detectadas | Precisión exacta | Cobertura exacta | Precisión con solape | Cobertura con solape |',
  '|---|---:|---:|---:|---:|---:|---:|',
  ...order.filter((k) => rows.has(k)).map((k) => {
    const r = rows.get(k)!;
    return `| ${k} | ${r.gold} | ${r.pred} | ${pct(r.tpStrictP, r.pred)} % | ${pct(r.tpStrictR, r.gold)} % | ${pct(r.tpRelP, r.pred)} % | ${pct(r.tpRelR, r.gold)} % |`;
  }),
  `| **Total** | ${total.gold} | ${total.pred} | ${pct(total.tpStrictP, total.pred)} % | ${pct(total.tpStrictR, total.gold)} % | ${pct(total.tpRelP, total.pred)} % | ${pct(total.tpRelR, total.gold)} % |`,
];
console.log(lines.join('\n'));
console.log(`\nCaracteres sensibles tapados: ${pct(coveredChars, goldChars)} % · caracteres tapados que eran sensibles: ${pct(predCharsOk, predChars)} %`);
console.log(`Documentos: ${docs.length} · modelo ${file} · umbral ${threshold} · ${(ms / 1000).toFixed(1)} s en total (CPU, onnxruntime-node)`);
for (const e of errors) console.log(`  ${e.type === 'missed' ? 'NO DETECTADO' : 'DE MÁS     '} ${e.kind.padEnd(8)} ${e.doc}: ${JSON.stringify(e.text)}`);
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({ model: file, threshold, docs: docs.length, rows: Object.fromEntries(order.filter((k) => rows.has(k)).map((k) => [k, rows.get(k)])), total, chars: { gold: goldChars, covered: coveredChars, pred: predChars, predOk: predCharsOk }, errors }, null, 1));
}
