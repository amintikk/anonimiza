// Write the "Cifras" section of the landing (es and en) from the evaluation results in docs/evaluacion/.
// Those files come from tools/compare: predict_prod.ts (the web's own code, int8w model) + score.ts --mode rules --th 0.3.
// Usage: node tools/make_figures.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Row = { gold: number; pred: number; tpR: number; tpRx: number; tpP: number; tpPx: number };
type Result = { docs: number; rows: Record<string, Row>; total: Row; chars: { gold: number; anyCovered: number; pred: number; predOk: number } };
const root = join(import.meta.dirname, '..');
const load = (n: string) => JSON.parse(readFileSync(join(root, `docs/evaluacion/${n}.json`), 'utf8')) as Result;
const nuevo = load('nuevo'), meddocan = load('meddocan'), antiguo = load('antiguo');

const LABELS: Record<string, [string, string]> = {
  person: ['Personas', 'People'], org: ['Organizaciones', 'Organisations'], address: ['Direcciones', 'Addresses'],
  id: ['DNI, NIE, CIF, NSS', 'DNI, NIE, CIF, SSN'], iban: ['IBAN', 'IBAN'], card: ['Tarjetas', 'Cards'], phone: ['Teléfonos', 'Phones'],
  email: ['Correos', 'Emails'], ip: ['Direcciones IP', 'IP addresses'], birthdate: ['Fechas de nacimiento', 'Dates of birth'],
  plate: ['Matrículas', 'Number plates'], otherid: ['Otros identificadores (no se buscan)', 'Other identifiers (not searched for)'],
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
  const inScope = (r: Result): Row => {
    const o = r.rows.otherid ?? { gold: 0, pred: 0, tpR: 0, tpRx: 0, tpP: 0, tpPx: 0 };
    return { gold: r.total.gold - o.gold, pred: r.total.pred - o.pred, tpR: r.total.tpR - o.tpR, tpRx: r.total.tpRx - o.tpRx, tpP: r.total.tpP - o.tpP, tpPx: r.total.tpPx - o.tpPx };
  };
  const cells = (x: Row) => `<td class="num">${x.gold}</td><td class="num">${x.pred}</td><td class="num">${pct(x.tpR, x.gold)}</td><td class="num">${pct(x.tpRx, x.gold)}</td><td class="num">${pct(x.tpP, x.pred)}</td><td class="num">${pct(x.tpPx, x.pred)}</td>`;
  const thead = `<thead><tr><th>${l('Tipo', 'Type')}</th><th class="num">${l('Anotados', 'Annotated')}</th><th class="num">${l('Marcados', 'Marked')}</th><th class="num">${l('Cobertura', 'Recall')}</th><th class="num">${l('Cobertura exacta', 'Exact recall')}</th><th class="num">${l('Precisión', 'Precision')}</th><th class="num">${l('Precisión exacta', 'Exact precision')}</th></tr></thead>`;
  const table = (r: Result) => {
    const s = inScope(r);
    const rows = ORDER.filter((k) => r.rows[k]).map((k) => `<tr><td>${LABELS[k]![en ? 1 : 0]}</td>${cells(r.rows[k]!)}</tr>`);
    return `<div class="table-wrap">
  <table class="plain">
    ${thead}
    <tbody>
      ${rows.join('\n      ')}
      <tr class="total"><td>${l('Total de lo que se busca', 'Total of what is searched for')}</td>${cells(s)}</tr>
      <tr class="total"><td>${l('Total con otros identificadores', 'Total with other identifiers')}</td>${cells(r.total)}</tr>
    </tbody>
  </table>
</div>`;
  };
  const n = inScope(nuevo), m = inScope(meddocan), a = inScope(antiguo);
  return `<div class="figs">
  <div class="fig-num"><b>${pct(n.tpR, n.gold)}</b><span>${l('de los datos que la herramienta busca quedaron sustituidos, al menos en parte', 'of the data the tool looks for were replaced, at least in part')} (${n.tpR} ${of} ${n.gold})</span></div>
  <div class="fig-num"><b>${pct(nuevo.chars.anyCovered, nuevo.chars.gold)}</b><span>${l('de los caracteres sensibles quedaron tapados, contando también números de expediente, usuarios y otros identificadores que no busca', 'of the sensitive characters were covered, also counting case numbers, usernames and other identifiers it does not look for')}</span></div>
  <div class="fig-num"><b>${pct(nuevo.total.tpP, nuevo.total.pred)}</b><span>${l('de lo que marcó era de verdad un dato personal; el resto son sobre todo palabras como «ARRENDADOR», nombres de organismos y alias de usuario', 'of what it marked really was personal data; the rest are mostly words like “LANDLORD”, names of public bodies and user aliases')} (${nuevo.total.tpP} ${of} ${nuevo.total.pred})</span></div>
</div>
<h3 class="sub-h">${l('Conjunto de prueba congelado', 'Frozen test set')}</h3>
<p class="note">${l(
    `${num(nuevo.docs)} documentos ficticios y deliberadamente sucios: chats y correos informales en minúscula y con erratas, texto pegado de PDF con líneas partidas, voz transcrita, nombres vascos, catalanes, gallegos, árabes y latinoamericanos, nombres que son palabras comunes (Rosa, Pilar, Dolores) y 7 textos sin datos personales. Los escribió y anotó un agente que no vio el código del detector, y se congelaron antes de ejecutar nada sobre ellos; nada se ha ajustado mirando sus fallos.`,
    `${num(nuevo.docs)} fictitious and deliberately messy documents: informal chats and emails in lower case and with typos, text pasted from PDFs with broken lines, transcribed voice messages, Basque, Catalan, Galician, Arabic and Latin American names, names that are common words (Rosa, Pilar, Dolores) and 7 texts with no personal data. They were written and annotated by an agent that had not seen the detector's code, and frozen before anything was run on them; nothing has been tuned by looking at their errors.`,
  )}</p>
${table(nuevo)}
<h3 class="sub-h">${l('MEDDOCAN (público)', 'MEDDOCAN (public)')}</h3>
<p class="note">${l(
    `Corpus público de historias clínicas en español anotadas para anonimización (Marimon et al., 2019), escrito por otros. Se usan las ${num(meddocan.docs)} primeras historias de su partición de prueba. Sus tipos se agrupan en los de esta herramienta; las edades, el sexo, las profesiones y las fechas que no son de nacimiento no se cuentan. Total de lo que se busca: cobertura ${pct(m.tpR, m.gold)}, precisión ${pct(m.tpP, m.pred)}. Los ${num(meddocan.rows.otherid?.gold ?? 0)} números de historia, de colegiado y de aseguramiento no se buscan y quedan a la vista: con ellos, la cobertura baja al ${pct(meddocan.total.tpR, meddocan.total.gold)}.`,
    `Public corpus of Spanish clinical case reports annotated for anonymisation (Marimon et al., 2019), written by others. The first ${num(meddocan.docs)} reports of its test split are used. Its types are grouped into this tool's; ages, sex, professions and dates other than birth dates are not counted. Total of what is searched for: recall ${pct(m.tpR, m.gold)}, precision ${pct(m.tpP, m.pred)}. The ${num(meddocan.rows.otherid?.gold ?? 0)} medical record, licence and insurance numbers are not searched for and stay visible: counting them, recall drops to ${pct(meddocan.total.tpR, meddocan.total.gold)}.`,
  )}</p>
${table(meddocan)}
<p class="note">${l(
    `«Cobertura» y «precisión» cuentan como acierto que lo marcado se solape con el dato del mismo tipo; las columnas «exacta» exigen los mismos límites. Mismo código que la web, modelo int8w, umbral 0,3 (sensibilidad «Alta»). En el conjunto con el que se desarrolló la herramienta (${num(antiguo.docs)} documentos limpios escritos por el autor, ${num(antiguo.total.gold)} datos) salía un ${pct(a.tpR, a.gold)} de cobertura y un ${pct(a.tpP, a.pred)} de precisión: esas cifras eran optimistas, porque las decisiones se tomaron viendo sus fallos.`,
    `"Recall" and "precision" count a hit when the marked text overlaps an annotated item of the same type; the "exact" columns require the same boundaries. Same code as the web app, int8w model, threshold 0.3 ("High" sensitivity). On the set the tool was developed with (${num(antiguo.docs)} clean documents written by the author, ${num(antiguo.total.gold)} items) it reached ${pct(a.tpR, a.gold)} recall and ${pct(a.tpP, a.pred)} precision: those figures were optimistic, because the choices were made looking at its errors.`,
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
