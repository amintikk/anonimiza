// Names and addresses written in many ways, run through the web pipeline (int8w model + rules, threshold 0.3).
// Lists, per form and context, what stays visible. Usage: node tools/variantes_modelo.ts <models-folder>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Tokenizer } from '@huggingface/tokenizers';
import * as ort from 'onnxruntime-node';
import { applyMarkers, assignMarkers, buildDetections } from '../src/engine/anonymize.ts';
import { detect, type OrtLike, type OrtSession } from '../src/engine/gliner.ts';
import { findRules } from '../src/engine/rules.ts';

const dir = process.argv[2]!;
const tk = new Tokenizer(JSON.parse(readFileSync(join(dir, 'tokenizer.json'), 'utf8')), JSON.parse(readFileSync(join(dir, 'tokenizer_config.json'), 'utf8')));
const session = (await ort.InferenceSession.create(join(dir, 'gliner-pii-int8w.onnx'))) as unknown as OrtSession;
const tokenize = (w: string) => tk.encode(w, { add_special_tokens: false }).ids;

async function anonymise(text: string): Promise<string> {
  const ents = await detect(ort as unknown as OrtLike, session, tokenize, text, { threshold: 0.3 });
  const dets = buildDetections(text, findRules(text), ents);
  return applyMarkers(text, dets, assignMarkers(text, dets, 'es').byId);
}

// [first, surname1, surname2]
const PEOPLE: [string, string, string][] = [
  ['María', 'López', 'García'], ['Jordi', 'Puig', 'Ferrer'], ['Nahia', 'Etxeberria', 'Uriarte'], ['Xosé', 'Outeiriño', 'Castro'],
  ['Mohamed', 'El Idrissi', 'Benali'], ['Ioana', 'Popescu', 'Dumitru'], ['Wang', 'Xiulan', ''], ['Rosa', 'Prieto', 'León'],
  ['José María', 'Pérez-Llorca', 'Ruiz'], ['Luz Dary', 'Ospina', 'Ríos'],
];
const forms = ([n, a, b]: [string, string, string]) => {
  const full = [n, a, b].filter(Boolean).join(' ');
  return [
    ['completo', full], ['mayúsculas', full.toLocaleUpperCase('es')], ['minúsculas', full.toLocaleLowerCase('es')],
    ['apellidos, nombre', `${[a, b].filter(Boolean).join(' ')}, ${n}`], ['APELLIDOS, Nombre', `${[a, b].filter(Boolean).join(' ').toLocaleUpperCase('es')}, ${n}`],
    ['inicial', `${n[0]}. ${a}`], ['tratamiento', `Sra. ${a}`], ['nombre y apellido', `${n} ${a}`], ['sin tildes', full.normalize('NFD').replace(/\p{M}/gu, '')],
  ] as [string, string][];
};
const CONTEXTS: [string, (v: string) => string][] = [
  ['firma', (v) => `Un saludo,\n${v}\nDepartamento de compras`],
  ['frase', (v) => `Ayer hablé con ${v} sobre la factura pendiente.`],
  ['campo', (v) => `Nombre: ${v}\nFecha: 03/11/2026`],
  ['chat', (v) => `[10:14] ${v}: vale, mañana lo miro`],
  ['tabla', (v) => `${v}\t45\tAdministración\t2.100,00 €`],
  ['correo', (v) => `De: ${v} <usuario@correo.es>\nAsunto: cita`],
];
const ADDRESSES = [
  'C/ Mayor 5, 2ºB', 'calle mayor nº 5, 3º izda', 'Avda. Diagonal 640, 08017 Barcelona', 'Pza. de España 3, bajo', 'Ctra. de Valencia km 12',
  'Rúa do Hórreo 54, 2º esq.', 'Carrer de Provença 318, 2n 1a', 'Paseo de la Castellana, 200 - 5º', 'Urb. Los Pinos, parcela 23', 'Avenida de América 37, portal 2',
  'Calle Sierpes 12, 41004 Sevilla', 'c/ san vicente 14 pta 3, valencia', 'Plaza Mayor nº 1, 37002 Salamanca', 'Bº La Victoria, bloque 4, 1ºA',
];
const ADDR_CTX: [string, (v: string) => string][] = [
  ['frase', (v) => `Vivo en ${v} desde hace años.`], ['campo', (v) => `Domicilio: ${v}\nTeléfono: no`], ['envío', (v) => `Enviar a ${v}, gracias.`],
];

const misses: string[] = [];
let total = 0;
const tally = new Map<string, [number, number]>();
const count = (k: string, ok: boolean) => { const t = tally.get(k) ?? [0, 0]; t[0] += ok ? 1 : 0; t[1]++; tally.set(k, t); };
for (const p of PEOPLE) for (const [form, v] of forms(p)) for (const [ctx, f] of CONTEXTS) {
  const out = await anonymise(f(v));
  // Leaked when any surname (or the given name, for one-word forms) is still visible.
  const parts = [p[1], p[2], p[0]].filter((x) => x && x.length > 2).flatMap((x) => [x, x.normalize('NFD').replace(/\p{M}/gu, '')]);
  const leaked = parts.filter((x) => new RegExp(`(?<![\\p{L}])${x}(?![\\p{L}])`, 'iu').test(out));
  total++;
  count(`nombre · ${form}`, !leaked.length);
  count(`nombre · ${ctx}`, !leaked.length);
  if (leaked.length) misses.push(`NOMBRE ${form}/${ctx}: ${JSON.stringify(out.replace(/\n/g, ' ⏎ '))}`);
}
for (const a of ADDRESSES) for (const [ctx, f] of ADDR_CTX) {
  const out = await anonymise(f(a));
  const words = a.split(/[\s,]+/).filter((w) => /\p{L}{4,}/u.test(w) && !/^(calle|avda|avenida|plaza|paseo|carrer|bajo|portal|parcela|bloque)$/i.test(w));
  const leaked = words.filter((w) => out.toLowerCase().includes(w.toLowerCase()));
  total++;
  count(`dirección · ${ctx}`, !leaked.length);
  if (leaked.length) misses.push(`DIRECCIÓN ${ctx}: ${JSON.stringify(out)}`);
}
console.log(`${total - misses.length}/${total} sin fugas`);
for (const [k, [ok, n]] of [...tally].sort()) console.log(`${k.padEnd(32)} ${ok}/${n}`);
for (const m of misses) console.log('  ' + m);
