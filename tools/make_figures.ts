// Write the "Cifras" section of the landing (es and en) from the evaluation results.
// Usage: node tools/make_figures.ts   (after: node tools/evaluate.ts … --json docs/evaluacion-int8w.json, and the same for fp16)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Row = { gold: number; pred: number; tpStrictP: number; tpStrictR: number; tpRelP: number; tpRelR: number };
type Result = { model: string; threshold: number; docs: number; rows: Record<string, Row>; total: Row; chars: { gold: number; covered: number; pred: number; predOk: number } };
const root = join(import.meta.dirname, '..');
const wasm = JSON.parse(readFileSync(join(root, 'docs/evaluacion-int8w.json'), 'utf8')) as Result;
const gpu = JSON.parse(readFileSync(join(root, 'docs/evaluacion-fp16.json'), 'utf8')) as Result;

const LABELS: Record<string, [string, string]> = {
  person: ['Personas', 'People'], org: ['Organizaciones', 'Organisations'], address: ['Direcciones', 'Addresses'], dni: ['DNI', 'DNI'], nie: ['NIE', 'NIE'],
  cif: ['CIF', 'CIF'], nss: ['N.º Seguridad Social', 'Social security no.'], iban: ['IBAN', 'IBAN'], card: ['Tarjetas', 'Cards'], phone: ['Teléfonos', 'Phones'],
  email: ['Correos', 'Emails'], ip: ['Direcciones IP', 'IP addresses'],
};

// Measured once with tools/reference.py + tests/gliner.test.ts (127 entities from 28 documents, threshold 0.3).
const VARIANTS = [
  { file: 'model.onnx (fp32)', mb: 1157, agree: '127 / 127', diff: '< 0,0001', use: ['—', '—'] },
  { file: 'model_fp16.onnx', mb: 580, agree: '127 / 127', diff: '0,061', use: ['WebGPU', 'WebGPU'] },
  { file: 'model_q4f16.onnx', mb: 472, agree: '117 / 128', diff: '0,61', use: ['descartada', 'discarded'] },
  { file: 'model_int8.onnx', mb: 349, agree: '12 / 127', diff: '0,68', use: ['descartada', 'discarded'] },
  { file: 'model_uint8.onnx', mb: 349, agree: '23 / 127', diff: '0,70', use: ['descartada', 'discarded'] },
  { file: 'gliner-pii-int8w.onnx', mb: 357, agree: '126 / 127', diff: '0,047', use: ['WebAssembly', 'WebAssembly'] },
];

function html(en: boolean): string {
  const l = (es: string, e: string) => (en ? e : es);
  const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toLocaleString(en ? 'en-US' : 'es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %` : '—');
  const num = (n: number) => n.toLocaleString(en ? 'en-US' : 'es-ES');
  const r = wasm;
  const rows = Object.entries(r.rows).map(([k, x]) =>
    `<tr><td>${LABELS[k]![en ? 1 : 0]}</td><td class="num">${x.gold}</td><td class="num">${x.pred}</td><td class="num">${pct(x.tpRelR, x.gold)}</td><td class="num">${pct(x.tpStrictR, x.gold)}</td><td class="num">${pct(x.tpRelP, x.pred)}</td><td class="num">${pct(x.tpStrictP, x.pred)}</td></tr>`);
  const tot = (x: Row, name: string) =>
    `<tr class="total"><td>${name}</td><td class="num">${x.gold}</td><td class="num">${x.pred}</td><td class="num">${pct(x.tpRelR, x.gold)}</td><td class="num">${pct(x.tpStrictR, x.gold)}</td><td class="num">${pct(x.tpRelP, x.pred)}</td><td class="num">${pct(x.tpStrictP, x.pred)}</td></tr>`;
  return `<div class="figs">
  <div class="fig-num"><b>${pct(r.total.tpRelR, r.total.gold)}</b><span>${l('de los datos personales anotados quedaron sustituidos, al menos en parte', 'of the annotated personal data were replaced, at least in part')} (${r.total.tpRelR} ${l('de', 'of')} ${r.total.gold})</span></div>
  <div class="fig-num"><b>${pct(r.chars.covered, r.chars.gold)}</b><span>${l('de los caracteres sensibles quedaron tapados', 'of the sensitive characters were covered')}</span></div>
  <div class="fig-num"><b>${pct(r.total.tpRelP, r.total.pred)}</b><span>${l('de lo que marcó la herramienta era de verdad un dato personal', 'of what the tool marked really was personal data')} (${r.total.tpRelP} ${l('de', 'of')} ${r.total.pred})</span></div>
</div>
<div class="table-wrap">
  <table class="plain">
    <thead><tr><th>${l('Tipo', 'Type')}</th><th class="num">${l('Anotados', 'Annotated')}</th><th class="num">${l('Marcados', 'Marked')}</th><th class="num">${l('Cobertura', 'Recall')}</th><th class="num">${l('Cobertura exacta', 'Exact recall')}</th><th class="num">${l('Precisión', 'Precision')}</th><th class="num">${l('Precisión exacta', 'Exact precision')}</th></tr></thead>
    <tbody>
      ${rows.join('\n      ')}
      ${tot(r.total, l('Total (WebAssembly, int8w)', 'Total (WebAssembly, int8w)'))}
      ${tot(gpu.total, l('Total (WebGPU, fp16)', 'Total (WebGPU, fp16)'))}
    </tbody>
  </table>
</div>
<p class="note">${l(
    `«Cobertura» y «precisión» cuentan como acierto que el marcado se solape con el dato del mismo tipo; las columnas «exacta» exigen los mismos límites. Umbral del modelo 0,3 (sensibilidad «Alta»). ${num(r.docs)} documentos, ${num(r.total.gold)} datos. <strong>Las cifras son optimistas:</strong> los documentos los escribió el autor, son limpios y las decisiones (etiquetas del modelo, umbral, formatos de teléfono, búsqueda de formas cortas de los nombres) se tomaron viendo los fallos en este mismo conjunto. Con el modelo solo, sin esas búsquedas de repeticiones, la cobertura de nombres era del 94 %. En documentos reales, espera más fallos.`,
    `"Recall" and "precision" count a hit when the marked text overlaps an annotated item of the same type; the "exact" columns require the same boundaries. Model threshold 0.3 ("High" sensitivity). ${num(r.docs)} documents, ${num(r.total.gold)} items. <strong>These figures are optimistic:</strong> the documents were written by the author, they are clean, and the choices (model labels, threshold, phone formats, searching for short forms of names) were made looking at the errors on this same set. The model alone, without those repetition searches, found 94 % of the names. Expect more misses on real documents.`,
  )}</p>
<h3 class="sub-h">${l('Variantes del modelo', 'Model variants')}</h3>
<p class="note">${l(
    'Coincidencia de cada exportación ONNX con GLiNER original en Python (PyTorch) sobre las mismas 28 entradas de prueba: entidades con los mismos límites y tipo, y mayor diferencia de puntuación. El int8 publicado en Hugging Face cuantiza las activaciones de todas las multiplicaciones y la proyección de salida de las capas feed-forward no lo soporta; por eso la variante para WebAssembly se cuantiza aquí solo en los pesos (8 bits por bloques), con activaciones en fp32.',
    'Agreement of each ONNX export with the original GLiNER in Python (PyTorch) on the same 28 test inputs: entities with the same boundaries and type, and largest score difference. The int8 file published on Hugging Face quantizes the activations of every matrix multiplication, which the output projection of the feed-forward layers does not survive; so the WebAssembly variant is quantized here on the weights only (8-bit blocks), with fp32 activations.',
  )}</p>
<div class="table-wrap">
  <table class="plain">
    <thead><tr><th>${l('Archivo', 'File')}</th><th class="num">${l('Tamaño', 'Size')}</th><th class="num">${l('Entidades iguales', 'Same entities')}</th><th class="num">${l('Dif. máx. puntuación', 'Max score diff.')}</th><th>${l('Uso', 'Used for')}</th></tr></thead>
    <tbody>
      ${VARIANTS.map((v) => `<tr><td><code>${v.file}</code></td><td class="num">${num(v.mb)} MB</td><td class="num">${v.agree}</td><td class="num">${en ? v.diff.replace(',', '.') : v.diff}</td><td>${v.use[en ? 1 : 0]}</td></tr>`).join('\n      ')}
    </tbody>
  </table>
</div>
<p class="note">${l(
    'Velocidad, solo orientativa: un documento de 187 palabras tarda unos 5–6 s con WebAssembly y 4 hilos en el servidor ARM (4 núcleos compartidos) donde se midió; una tarjeta gráfica debería ser bastante más rápida, pero la velocidad con WebGPU no se ha medido porque ese servidor no tiene GPU.',
    'Speed, as a rough guide: a 187-word document takes about 5–6 s with WebAssembly and 4 threads on the ARM server (4 shared cores) where it was measured; a graphics card should be much faster, but WebGPU speed has not been measured because that server has no GPU.',
  )}</p>`;
}

writeFileSync(join(root, 'src/site/partials/cifras.html'), html(false) + '\n');
writeFileSync(join(root, 'src/site/partials/cifras-en.html'), html(true) + '\n');
console.log('ok');
