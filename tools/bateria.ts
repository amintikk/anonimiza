// Batería de pruebas: pasa los textos de una carpeta por el motor (reglas + GLiNER, como la app con sensibilidad alta)
// y los compara con sus .esperado.json. Dice qué datos se escapan, qué falsos positivos aparecen y qué se marca de más.
// Uso: ANONIMIZA_MODELS=<carpeta con modelos> [ANONIMIZA_MODEL=gliner-pii-int8w.onnx] node tools/bateria.ts <carpeta-lote>...
// Sin ANONIMIZA_MODELS solo corren las reglas. Resultados en BATERIA_OUT (por defecto ./bateria-resultados).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { findRules } from '../src/engine/rules.ts';
import { buildDetections, type Detection } from '../src/engine/anonymize.ts';
import { detect, type EntitySpan, type OrtLike, type OrtSession } from '../src/engine/gliner.ts';

interface Esperado {
  documento: string;
  datos?: { texto: string; tipo: string; debe_detectarse?: boolean; nota?: string }[];
  falsos_positivos?: { texto: string; motivo?: string }[];
}

type Estado = 'ok' | 'parcial' | 'miss' | 'sin_ocurrencia';

const TIPO: Record<string, string> = {
  person: 'PERSONA', org: 'ORGANIZACION', address: 'DIRECCION', dni: 'DNI', nie: 'NIE', cif: 'CIF', nss: 'NSS', iban: 'IBAN',
  card: 'TARJETA', phone: 'TELEFONO', email: 'EMAIL', ip: 'IP', birthdate: 'FECHA_NACIMIENTO', plate: 'MATRICULA', ref: 'REFERENCIA', other: 'OTRO',
};

const modelDir = process.env.ANONIMIZA_MODELS;
const modelFile = process.env.ANONIMIZA_MODEL ?? 'gliner-pii-int8w.onnx';
const outDir = process.env.BATERIA_OUT ?? 'bateria-resultados';
const lotes = process.argv.slice(2);
if (!lotes.length) {
  console.error('Uso: node tools/bateria.ts <carpeta-lote>...');
  process.exit(2);
}

async function loadModel() {
  if (!modelDir || !existsSync(join(modelDir, modelFile))) return null;
  const ort = await import('onnxruntime-node');
  const { Tokenizer } = await import('@huggingface/tokenizers');
  const tk = new Tokenizer(
    JSON.parse(readFileSync(join(modelDir, 'tokenizer.json'), 'utf8')),
    JSON.parse(readFileSync(join(modelDir, 'tokenizer_config.json'), 'utf8')),
  );
  const session = (await ort.InferenceSession.create(join(modelDir, modelFile))) as unknown as OrtSession;
  return {
    ort: ort as unknown as OrtLike,
    session,
    tokenize: (w: string) => tk.encode(w, { add_special_tokens: false }).ids,
  };
}

/** Texto tal como lo leería la app: UTF-16 con BOM o UTF-8, sin BOM. */
function readText(file: string): string {
  const buf = readFileSync(file);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  return buf.toString('utf8').replace(/^﻿/, '');
}

function occurrences(text: string, value: string): number[] {
  const out: number[] = [];
  if (!value) return out;
  for (let i = text.indexOf(value); i >= 0; i = text.indexOf(value, i + value.length)) out.push(i);
  return out;
}

/** The identifying part of a name: without the title or initial in front ("Sr. García" → "García"). */
const nucleo = (v: string) => v.replace(/^((D\.ª|Dª\.|D\.|Dña\.|Sr\.|Sra\.|Srta\.|Dr\.|Dra\.|\p{Lu}\.)\s+)+/u, '') || v;

const context = (text: string, s: number, e: number) =>
  text.slice(Math.max(0, s - 60), e + 60).replace(/\n/g, '⏎');

function coverageMask(length: number, dets: Detection[]): Uint8Array {
  const mask = new Uint8Array(length);
  for (const d of dets) if (d.on !== false) mask.fill(1, Math.max(0, d.start), Math.min(length, d.end));
  return mask;
}

const meanCover = (mask: Uint8Array, s: number, e: number) => {
  let n = 0;
  for (let i = s; i < e; i++) n += mask[i]!;
  return n / Math.max(1, e - s);
};

const model = await loadModel();
console.log(model ? `Modelo: ${modelFile}` : 'SIN MODELO: solo reglas (define ANONIMIZA_MODELS para el motor completo)');
mkdirSync(outDir, { recursive: true });

const totals = { datos: 0, ok: 0, parcial: 0, miss: 0, sin_ocurrencia: 0, falsos: 0, falsos_docs: 0, extras: 0, docs: 0, ms: 0 };
const md: string[] = [`# Resultados de la batería (${new Date().toISOString().slice(0, 16)})`, '', model ? `Modelo: ${modelFile}` : 'Solo reglas', ''];

for (const lote of lotes) {
  const name = basename(lote.replace(/\/$/, ''));
  md.push(`## Lote ${name}`, '');
  // BATERIA_EXCLUIR: fragmentos de nombre separados por comas que se saltan (p. ej. documentos enormes).
  const excluir = (process.env.BATERIA_EXCLUIR ?? '').split(',').filter(Boolean);
  const esperados = readdirSync(lote).filter((f) => f.endsWith('.esperado.json') && !excluir.some((x) => f.includes(x))).sort();
  for (const f of esperados) {
    const exp = JSON.parse(readFileSync(join(lote, f), 'utf8')) as Esperado;
    const file = join(lote, exp.documento);
    if (!existsSync(file)) {
      md.push(`- ${exp.documento}: falta el fichero`, '');
      continue;
    }
    if (!file.endsWith('.txt')) {
      md.push(`- ${exp.documento}: no es texto plano, se prueba en otra pasada`, '');
      continue;
    }
    const text = readText(file);
    const t0 = Date.now();
    const rules = findRules(text);
    const ents: EntitySpan[] = model ? await detect(model.ort, model.session, model.tokenize, text, { threshold: 0.3 }) : [];
    const dets = buildDetections(text, rules, ents);
    const ms = Date.now() - t0;
    const mask = coverageMask(text.length, dets);

    const datos = (exp.datos ?? []).map((d) => {
      const valor = nucleo(d.texto);
      const occ = occurrences(text, valor);
      if (!occ.length) return { texto: d.texto, tipo: d.tipo, estado: 'sin_ocurrencia' as Estado, contexto: '', kind: '', nota: d.nota };
      let estado: Estado = 'ok';
      let peor = occ[0]!;
      let kind = '';
      for (const s of occ) {
        const e = s + valor.length;
        const c = meanCover(mask, s, e);
        if (c === 0) {
          estado = 'miss';
          peor = s;
          break;
        }
        if (c < 1 && estado === 'ok') {
          estado = 'parcial';
          peor = s;
        }
      }
      const ov = dets.find((x) => x.on !== false && x.start < peor + valor.length && x.end > peor);
      if (ov) kind = ov.kind;
      return {
        texto: d.texto,
        tipo: d.tipo,
        estado,
        contexto: estado === 'ok' ? '' : context(text, peor, peor + valor.length),
        kind,
        nota: d.nota,
        tipo_detectado: kind ? TIPO[kind] ?? kind : '',
      };
    });

    const datosZonas = (exp.datos ?? []).flatMap((d) => occurrences(text, nucleo(d.texto)).map((s) => [s, s + nucleo(d.texto).length] as const));
    const falsos = (exp.falsos_positivos ?? []).flatMap((fp) =>
      occurrences(text, fp.texto)
        // Un trozo de un dato esperado (p. ej. «91427536» dentro de «91427536Y») no es un falso positivo.
        .filter((s) => !datosZonas.some(([a, b]) => s < b && s + fp.texto.length > a))
        .filter((s) => meanCover(mask, s, s + fp.texto.length) === 1)
        .map((s) => ({ texto: fp.texto, motivo: fp.motivo ?? '', kind: dets.find((x) => x.start < s + fp.texto.length && x.end > s)?.kind ?? '', contexto: context(text, s, s + fp.texto.length) })),
    );

    // Detecciones que no corresponden a ningún dato esperado ni a un falso positivo conocido.
    const esperadoZonas = [
      ...(exp.datos ?? []).flatMap((d) => occurrences(text, d.texto).map((s) => [s, s + d.texto.length] as const)),
      ...(exp.falsos_positivos ?? []).flatMap((fp) => occurrences(text, fp.texto).map((s) => [s, s + fp.texto.length] as const)),
    ];
    const extras = dets
      .filter((x) => x.on !== false && !esperadoZonas.some(([s, e]) => x.start < e && x.end > s))
      .slice(0, 300)
      .map((x) => ({ texto: text.slice(x.start, x.end), kind: x.kind, origen: x.source, contexto: context(text, x.start, x.end) }));

    const report = { documento: exp.documento, lote: name, ms, datos, falsos, extras };
    writeFileSync(join(outDir, `${name}-${basename(exp.documento)}.json`), JSON.stringify(report, null, 2));

    totals.docs++;
    totals.ms += ms;
    totals.datos += datos.length;
    for (const d of datos) totals[d.estado === 'sin_ocurrencia' ? 'sin_ocurrencia' : d.estado]++;
    totals.falsos += falsos.length;
    if (falsos.length) totals.falsos_docs++;
    totals.extras += extras.length;

    const fallos = datos.filter((d) => d.estado === 'miss' || d.estado === 'parcial');
    const sinOc = datos.filter((d) => d.estado === 'sin_ocurrencia');
    const tipoDist = datos.filter((d) => (d.estado === 'ok' || d.estado === 'parcial') && d.tipo_detectado && d.tipo_detectado !== d.tipo);
    console.log(`${name}/${exp.documento}: ${datos.length} datos (${fallos.length} fallos, ${sinOc.length} sin ocurrencia), ${falsos.length} falsos positivos, ${extras.length} extras, ${ms} ms`);
    md.push(`### ${exp.documento} — ${datos.length} datos, ${fallos.length} fallos, ${falsos.length} falsos positivos, ${extras.length} extras (${ms} ms)`, '');
    for (const d of fallos) md.push(`- ${d.estado === 'miss' ? 'ESCAPA' : 'PARCIAL'} [${d.tipo}] \`${d.texto}\` — ${d.contexto}${d.nota ? ` · ${d.nota}` : ''}`);
    for (const d of falsos) md.push(`- FALSO POSITIVO [${d.kind}] \`${d.texto}\` — ${d.contexto}${d.motivo ? ` · ${d.motivo}` : ''}`);
    for (const d of tipoDist) md.push(`- tipo distinto [${d.tipo} esperado, ${d.tipo_detectado} detectado] \`${d.texto}\``);
    for (const d of sinOc) md.push(`- (generador) sin ocurrencia en el texto: \`${d.texto}\``);
    md.push('');
  }
}

const pct = (n: number) => (totals.datos ? ((100 * n) / totals.datos).toFixed(1) : '0') + '%';
const resumen = [
  `Datos esperados: ${totals.datos} (sin ocurrencia en el texto: ${totals.sin_ocurrencia})`,
  `Bien: ${totals.ok} (${pct(totals.ok)}) · parcial: ${totals.parcial} · escapan: ${totals.miss} (${pct(totals.miss)})`,
  `Falsos positivos: ${totals.falsos} en ${totals.falsos_docs} documentos · detecciones extra: ${totals.extras}`,
  `Documentos: ${totals.docs} · tiempo: ${(totals.ms / 1000).toFixed(1)} s`,
];
console.log('\n' + resumen.join('\n'));
writeFileSync(join(outDir, 'resumen.md'), [...md, '## Total', '', ...resumen.map((l) => `- ${l}`), ''].join('\n'));
console.log(`Detalle: ${join(outDir, 'resumen.md')}`);
