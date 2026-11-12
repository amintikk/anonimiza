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
const tercero = load('tercero'), meddocan = load('meddocan');

// The landing shows only the headline figures; the tables by type are in docs/evaluacion/ and the README.
function html(en: boolean): string {
  const l = (es: string, e: string) => (en ? e : es);
  // Rounded to whole numbers; site.ts counts up to data-count when the figure scrolls into view.
  const pct = (a: number, b: number) => {
    const v = Math.round((100 * a) / b);
    return `<b data-count="${v}">${v} %</b>`;
  };
  const t = tercero.total, m = meddocan.total;
  return `<div class="figs">
  <div class="fig-num">${pct(t.tpR, t.gold)}<span>${l(`de los datos personales sustituidos en ${tercero.docs} documentos desordenados que no se usaron para ajustar la herramienta`, `of the personal data replaced in ${tercero.docs} messy documents that were not used to tune the tool`)}</span></div>
  <div class="fig-num">${pct(m.tpR, m.gold)}<span>${l(`en ${meddocan.docs} historias clínicas públicas (MEDDOCAN)`, `in ${meddocan.docs} public clinical reports (MEDDOCAN)`)}</span></div>
  <div class="fig-num">${pct(t.tpP, t.pred)}<span>${l('de lo que marca es de verdad un dato personal; el resto suelen ser juzgados, bancos u organismos', 'of what it marks really is personal data; the rest are mostly courts, banks or public bodies')}</span></div>
</div>
<p class="note">${l('Método, tablas por tipo y cada error, en el', 'Method, tables by type and every error, in the')} <a href="https://github.com/amintikk/anonimiza#cifras-medidas" target="_blank" rel="noopener">${l('repositorio', 'repository')}</a>.</p>`;
}

writeFileSync(join(root, 'src/site/partials/cifras.html'), html(false) + '\n');
writeFileSync(join(root, 'src/site/partials/cifras-en.html'), html(true) + '\n');
console.log('ok');
