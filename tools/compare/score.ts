// Score model predictions (predict.py / predict_prod.ts) against a gold file (gold.py), alone or merged
// with the web app's rules through the same buildDetections() the app runs.
// Usage: node tools/compare/score.ts <gold.json> <pred.json> [--th 0.3] [--mode model|rules] [--extra] [--sweep] [--json out] [--errors]
//   --mode model  the model's spans only (all its labels), greedy by score
//   --mode rules  rules + model names/organisations/addresses + repetitions (what the app does)
//   --extra       with --mode rules, also keep the model's other labels where no rule matched
import { readFileSync, writeFileSync } from 'node:fs';
import { buildDetections } from '../../src/engine/anonymize.ts';
import type { EntitySpan } from '../../src/engine/gliner.ts';
import { findRules } from '../../src/engine/rules.ts';

type K = string;
interface Gold { start: number; end: number; kind: K; type: string; required: boolean }
interface Span { start: number; end: number; kind: K; label?: string; score?: number }
const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i === -1 ? undefined : args[i + 1]; };
const [goldPath, predPath] = args;
const gold = JSON.parse(readFileSync(goldPath!, 'utf8')) as { docs: { id: string; text: string; gold: Gold[] }[] };
const pred = JSON.parse(readFileSync(predPath!, 'utf8')) as { model: string; labelset: string; docs: { id: string; spans: Span[] }[]; seconds?: number; words?: number };
const predBy = new Map(pred.docs.map((d) => [d.id, d.spans]));
const mode = opt('--mode') ?? 'rules';
const extra = args.includes('--extra');

const RULE_KIND: Record<string, K> = { dni: 'id', nie: 'id', cif: 'id', nss: 'id' };
// Identifiers are one family: a DNI found by the "other identifier" rule, or an identifier annotated as DNI, still counts.
const ID_FAMILY = new Set(['id', 'otherid', 'ref']);
const compatible = (a: K, b: K) => a === b || (ID_FAMILY.has(a) && ID_FAMILY.has(b));
const ov = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;
const LABEL: Record<K, 'person' | 'organization' | 'address'> = { person: 'person', org: 'organization', address: 'address' };

function greedy(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of [...spans].sort((a, b) => (b.score ?? 1) - (a.score ?? 1))) if (!out.some((o) => ov(o, s))) out.push(s);
  return out.sort((a, b) => a.start - b.start);
}

function detections(text: string, spans: Span[], th: number): Span[] {
  const kept = greedy(spans.filter((s) => (s.score ?? 1) >= th));
  if (mode === 'model') return kept;
  const ents: EntitySpan[] = kept.filter((s) => LABEL[s.kind]).map((s) => ({ start: s.start, end: s.end, label: LABEL[s.kind]!, score: s.score ?? 1 }));
  const dets: Span[] = buildDetections(text, findRules(text), ents).map((d) => ({ start: d.start, end: d.end, kind: RULE_KIND[d.kind] ?? d.kind }));
  if (extra) for (const s of kept) if (!LABEL[s.kind] && !dets.some((d) => ov(d, s))) dets.push(s);
  return dets;
}

interface Row { gold: number; pred: number; tpR: number; tpRx: number; tpP: number; tpPx: number }
function score(th: number, collect = false) {
  const rows = new Map<K, Row>();
  const row = (k: K) => rows.get(k) ?? (rows.set(k, { gold: 0, pred: 0, tpR: 0, tpRx: 0, tpP: 0, tpPx: 0 }), rows.get(k)!);
  let goldChars = 0, covered = 0, anyCovered = 0, predChars = 0, predOk = 0;
  const errors: { doc: string; type: 'missed' | 'extra'; kind: K; text: string; as?: K }[] = [];
  // Per document, without OTRO_ID: for confidence intervals by resampling documents (bootstrap.py).
  const perDoc: { id: string; gold: number; tpR: number; pred: number; tpP: number }[] = [];
  for (const d of gold.docs) {
    const pd = { id: d.id, gold: 0, tpR: 0, pred: 0, tpP: 0 };
    perDoc.push(pd);
    const dets = detections(d.text, predBy.get(d.id) ?? [], th);
    const req = d.gold.filter((g) => g.required);
    for (const g of req) {
      const r = row(g.kind);
      r.gold++;
      if (g.kind !== 'otherid') { pd.gold++; if (dets.some((p) => compatible(p.kind, g.kind) && ov(p, g))) pd.tpR++; }
      if (dets.some((p) => compatible(p.kind, g.kind) && p.start === g.start && p.end === g.end)) r.tpRx++;
      if (dets.some((p) => compatible(p.kind, g.kind) && ov(p, g))) r.tpR++;
      else if (collect) errors.push({ doc: d.id, type: 'missed', kind: g.kind, text: d.text.slice(g.start, g.end), as: dets.find((p) => ov(p, g))?.kind });
    }
    for (const p of dets) {
      const hit = req.some((g) => compatible(p.kind, g.kind) && ov(p, g));
      if (!hit && d.gold.some((g) => !g.required && ov(p, g))) continue; // optional span: neither right nor wrong
      const r = row(p.kind);
      r.pred++;
      if (p.kind !== 'otherid') { pd.pred++; if (hit) pd.tpP++; }
      if (hit) r.tpP++;
      else if (collect) errors.push({ doc: d.id, type: 'extra', kind: p.kind, text: d.text.slice(p.start, p.end) });
      if (req.some((g) => compatible(p.kind, g.kind) && p.start === g.start && p.end === g.end)) r.tpPx++;
    }
    // Characters: of the sensitive text, how much ends up hidden (by a marker of any type).
    const g = new Uint8Array(d.text.length), gk = new Uint8Array(d.text.length), p = new Uint8Array(d.text.length), opt = new Uint8Array(d.text.length);
    for (const x of req) g.fill(1, x.start, x.end);
    for (const x of d.gold.filter((x) => !x.required)) opt.fill(1, x.start, x.end);
    for (const x of dets) p.fill(1, x.start, x.end);
    for (const x of req) for (const y of dets) if (compatible(x.kind, y.kind)) gk.fill(1, Math.max(x.start, y.start), Math.min(x.end, y.end));
    for (let i = 0; i < d.text.length; i++) {
      if (/\s/.test(d.text[i]!)) continue;
      goldChars += g[i]!; covered += gk[i]!; anyCovered += g[i]! & p[i]!;
      if (p[i] && !opt[i]) { predChars++; predOk += g[i]!; }
    }
  }
  const t = [...rows.values()].reduce((a, r) => ({ gold: a.gold + r.gold, pred: a.pred + r.pred, tpR: a.tpR + r.tpR, tpRx: a.tpRx + r.tpRx, tpP: a.tpP + r.tpP, tpPx: a.tpPx + r.tpPx }), { gold: 0, pred: 0, tpR: 0, tpRx: 0, tpP: 0, tpPx: 0 });
  return { th, rows, total: t, chars: { gold: goldChars, covered, anyCovered, pred: predChars, predOk }, errors, perDoc };
}

const pct = (a: number, b: number) => (b ? (100 * a) / b : NaN);
const f = (x: number) => (Number.isNaN(x) ? '—' : x.toFixed(1));
const f1 = (p: number, r: number) => (p + r ? (2 * p * r) / (p + r) : 0);
/** F2: recall counts twice as much as precision (a missed datum is a leak; an extra one only hides a word). */
const f2 = (p: number, r: number) => (p + r ? (5 * p * r) / (4 * p + r) : 0);
const name = `${pred.model}/${pred.labelset} · ${mode}${extra ? '+extra' : ''}`;

if (args.includes('--sweep')) {
  console.log(`${name} · ${goldPath}`);
  console.log('umbral | cobertura | precisión | F1 | F2 | cob. exacta | prec. exacta | caracteres tapados');
  for (const th of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
    const s = score(th);
    const R = pct(s.total.tpR, s.total.gold), P = pct(s.total.tpP, s.total.pred);
    console.log(`${th.toFixed(1)} | ${f(R)} | ${f(P)} | ${f(f1(P, R))} | ${f(f2(P, R))} | ${f(pct(s.total.tpRx, s.total.gold))} | ${f(pct(s.total.tpPx, s.total.pred))} | ${f(pct(s.chars.anyCovered, s.chars.gold))}`);
  }
} else {
  const th = Number(opt('--th') ?? 0.3);
  const s = score(th, true);
  const order = ['person', 'org', 'address', 'id', 'iban', 'card', 'phone', 'email', 'ip', 'birthdate', 'plate', 'otherid', 'ref'];
  console.log(`${name} · umbral ${th} · ${goldPath}`);
  console.log('| Tipo | Reales | Marcados | Cobertura | Cob. exacta | Precisión | Prec. exacta |');
  console.log('|---|---:|---:|---:|---:|---:|---:|');
  for (const k of order.filter((k) => s.rows.has(k))) {
    const r = s.rows.get(k)!;
    console.log(`| ${k} | ${r.gold} | ${r.pred} | ${f(pct(r.tpR, r.gold))} | ${f(pct(r.tpRx, r.gold))} | ${f(pct(r.tpP, r.pred))} | ${f(pct(r.tpPx, r.pred))} |`);
  }
  const t = s.total;
  console.log(`| **Total** | ${t.gold} | ${t.pred} | ${f(pct(t.tpR, t.gold))} | ${f(pct(t.tpRx, t.gold))} | ${f(pct(t.tpP, t.pred))} | ${f(pct(t.tpPx, t.pred))} |`);
  console.log(`caracteres sensibles tapados (cualquier tipo): ${f(pct(s.chars.anyCovered, s.chars.gold))} % · con su tipo: ${f(pct(s.chars.covered, s.chars.gold))} % · tapados que eran sensibles: ${f(pct(s.chars.predOk, s.chars.pred))} %`);
  if (args.includes('--errors')) for (const e of s.errors) console.log(`  ${e.type === 'missed' ? 'SE ESCAPA' : 'DE MÁS   '} ${e.kind.padEnd(9)}${e.as ? `(marcado como ${e.as}) ` : ''}${e.doc}: ${JSON.stringify(e.text)}`);
  const out = opt('--json');
  if (out) writeFileSync(out, JSON.stringify({ name, gold: goldPath, th, rows: Object.fromEntries(s.rows), total: s.total, chars: s.chars, errors: s.errors, perDoc: s.perDoc, seconds: pred.seconds, words: pred.words, docs: gold.docs.length }, null, 1));
}
