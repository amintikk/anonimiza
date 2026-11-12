// Write the "Cifras" section of the landing (es and en) from the evaluation results in docs/evaluacion/.
// Those files come from tools/compare: predict_prod.ts (the web's own code, int8w model) + score.ts --mode rules --th 0.3.
// Usage: node tools/make_figures.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Row = { gold: number; pred: number; tpR: number; tpRx: number; tpP: number; tpPx: number };
type Result = { docs: number; rows: Record<string, Row>; total: Row; chars: { gold: number; anyCovered: number; pred: number; predOk: number } };
const root = join(import.meta.dirname, '..');
const empty = (): Row => ({ gold: 0, pred: 0, tpR: 0, tpRx: 0, tpP: 0, tpPx: 0 });
// score.ts keeps what was annotated as "other identifier" (otherid: recall) apart from what the rule marked (ref:
// precision); here they are one row.
const load = (n: string): Result => {
  const r = JSON.parse(readFileSync(join(root, `docs/evaluacion/${n}.json`), 'utf8')) as Result;
  const o = r.rows.otherid ?? empty(), f = r.rows.ref ?? empty();
  if (r.rows.otherid || r.rows.ref) r.rows.otherid = { gold: o.gold, tpR: o.tpR, tpRx: o.tpRx, pred: f.pred, tpP: f.tpP, tpPx: f.tpPx };
  delete r.rows.ref;
  return r;
};
const tercero = load('tercero'), meddocan = load('meddocan'), nuevo = load('nuevo'), antiguo = load('antiguo');

const LABELS: Record<string, [string, string]> = {
  person: ['Personas', 'People'], org: ['Organizaciones', 'Organisations'], address: ['Direcciones', 'Addresses'],
  id: ['DNI, NIE, CIF, NSS', 'DNI, NIE, CIF, SSN'], iban: ['IBAN', 'IBAN'], card: ['Tarjetas', 'Cards'], phone: ['Teléfonos', 'Phones'],
  email: ['Correos', 'Emails'], ip: ['Direcciones IP', 'IP addresses'], birthdate: ['Fechas de nacimiento', 'Dates of birth'],
  plate: ['Matrículas', 'Number plates'], otherid: ['Otros identificadores', 'Other identifiers'],
};
const ORDER = ['person', 'org', 'address', 'id', 'iban', 'card', 'phone', 'email', 'ip', 'birthdate', 'plate', 'otherid'];

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
  const of = l('de', 'of');
  const cells = (x: Row) => `<td class="num">${x.gold}</td><td class="num">${x.pred}</td><td class="num">${pct(x.tpR, x.gold)}</td><td class="num">${pct(x.tpRx, x.gold)}</td><td class="num">${pct(x.tpP, x.pred)}</td><td class="num">${pct(x.tpPx, x.pred)}</td>`;
  const thead = `<thead><tr><th>${l('Tipo', 'Type')}</th><th class="num">${l('Anotados', 'Annotated')}</th><th class="num">${l('Marcados', 'Marked')}</th><th class="num">${l('Cobertura', 'Recall')}</th><th class="num">${l('Cobertura exacta', 'Exact recall')}</th><th class="num">${l('Precisión', 'Precision')}</th><th class="num">${l('Precisión exacta', 'Exact precision')}</th></tr></thead>`;
  const table = (r: Result) => {
    const rows = ORDER.filter((k) => r.rows[k]).map((k) => `<tr><td>${LABELS[k]![en ? 1 : 0]}</td>${cells(r.rows[k]!)}</tr>`);
    return `<div class="table-wrap">
  <table class="plain">
    ${thead}
    <tbody>
      ${rows.join('\n      ')}
      <tr class="total"><td>${l('Total', 'Total')}</td>${cells(r.total)}</tr>
    </tbody>
  </table>
</div>`;
  };
  const t = tercero.total, n = nuevo.total, a = antiguo.total;
  return `<div class="figs">
  <div class="fig-num"><b>${pct(t.tpR, t.gold)}</b><span>${l('de los datos personales quedaron sustituidos, al menos en parte', 'of the personal data items were replaced, at least in part')} (${t.tpR} ${of} ${t.gold})</span></div>
  <div class="fig-num"><b>${pct(tercero.chars.anyCovered, tercero.chars.gold)}</b><span>${l('de los caracteres sensibles quedaron tapados', 'of the sensitive characters were covered')}</span></div>
  <div class="fig-num"><b>${pct(t.tpP, t.pred)}</b><span>${l('de lo que marcó era de verdad un dato personal; el resto son sobre todo juzgados, organismos, bancos y aseguradoras, que no son datos personales, y alias de usuario tapados como si fueran nombres', 'of what it marked really was personal data; the rest are mostly courts, public bodies, banks and insurers, which are not personal data, and user aliases covered as if they were names')} (${t.tpP} ${of} ${t.pred})</span></div>
</div>
<h3 class="sub-h">${l('Conjunto de prueba congelado', 'Frozen test set')}</h3>
<p class="note">${l(
    `${num(tercero.docs)} documentos ficticios y desordenados: chats, correos, voz transcrita, PDF pegados con columnas y cortes de línea, informes médicos, documentos legales y administrativos, nóminas, logs y foros, con nombres de muchos orígenes y 7 textos sin datos personales. Los escribió y anotó un agente que no vio el código del detector, y se congelaron antes de ejecutar nada sobre ellos; nada se ha ajustado mirando sus fallos.`,
    `${num(tercero.docs)} fictitious, messy documents: chats, emails, transcribed voice, PDFs pasted with columns and broken lines, medical reports, legal and administrative documents, payslips, logs and forums, with names of many origins and 7 texts with no personal data. They were written and annotated by an agent that had not seen the detector's code, and frozen before anything was run on them; nothing has been tuned by looking at their errors.`,
  )}</p>
${table(tercero)}
<h3 class="sub-h">${l('MEDDOCAN (público)', 'MEDDOCAN (public)')}</h3>
<p class="note">${l(
    `Corpus público de historias clínicas en español anotadas para anonimización (Marimon et al., 2019), escrito por otros. Se usan ${num(meddocan.docs)} historias de su partición de prueba que no se miraron al escribir las reglas; las demás, sí, y comparten plantilla con estas («NHC:», «NºCol:»), así que la fila de otros identificadores es optimista. Sus tipos se agrupan en los de esta herramienta; las edades, el sexo, las profesiones y las fechas que no son de nacimiento no se cuentan.`,
    `Public corpus of Spanish clinical case reports annotated for anonymisation (Marimon et al., 2019), written by others. ${num(meddocan.docs)} reports from its test split that were not looked at while writing the rules are used; the others were, and they share a template with these (“NHC:”, “NºCol:”), so the other-identifiers row is optimistic. Its types are grouped into this tool's; ages, sex, professions and dates other than birth dates are not counted.`,
  )}</p>
${table(meddocan)}
<p class="note">${l(
    `«Cobertura» y «precisión» cuentan como acierto que lo marcado se solape con el dato del mismo tipo; las columnas «exacta» exigen los mismos límites. Mismo código que la web, modelo int8w, umbral 0,3 (sensibilidad «Alta»). Otros dos conjuntos se usaron para ajustar la herramienta y por eso dan cifras optimistas: ${num(nuevo.docs)} documentos sucios (cobertura ${pct(n.tpR, n.gold)}, precisión ${pct(n.tpP, n.pred)}) y ${num(antiguo.docs)} documentos limpios escritos por el autor (${pct(a.tpR, a.gold)} y ${pct(a.tpP, a.pred)}).`,
    `"Recall" and "precision" count a hit when the marked text overlaps an annotated item of the same type; the "exact" columns require the same boundaries. Same code as the web app, int8w model, threshold 0.3 ("High" sensitivity). Two other sets were used to tune the tool and so give optimistic figures: ${num(nuevo.docs)} messy documents (recall ${pct(n.tpR, n.gold)}, precision ${pct(n.tpP, n.pred)}) and ${num(antiguo.docs)} clean documents written by the author (${pct(a.tpR, a.gold)} and ${pct(a.tpP, a.pred)}).`,
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
    'Velocidad, solo orientativa: 250 palabras tardan unos 10 s con WebAssembly y 4 hilos en el servidor ARM (4 núcleos compartidos y ocupados) donde se midió; una tarjeta gráfica debería ser bastante más rápida, pero la velocidad con WebGPU no se ha medido porque ese servidor no tiene GPU.',
    'Speed, as a rough guide: 250 words take about 10 s with WebAssembly and 4 threads on the ARM server (4 shared, busy cores) where it was measured; a graphics card should be much faster, but WebGPU speed has not been measured because that server has no GPU.',
  )}</p>`;
}

writeFileSync(join(root, 'src/site/partials/cifras.html'), html(false) + '\n');
writeFileSync(join(root, 'src/site/partials/cifras-en.html'), html(true) + '\n');
console.log('ok');
