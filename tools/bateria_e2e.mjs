// Ejecuta la batería contra la app real y comprueba la salida descargada (texto, DOCX y PDF, con una segunda pasada de OCR
// sobre el PDF de salida). Requiere la app servida con los modelos en local: `ANONIMIZA_MODELS=<carpeta> npx vite preview`
// y `VITE_MODELS_URL=/models/ npm run build` antes. Variables: APP (URL), OUT (carpeta de salida), SOLO y EXCLUIR (filtros
// por nombre separados por comas), PLAYWRIGHT_CORE (paquete playwright-core), CHROME_EXE (ejecutable de Chromium).
// Uso: node tools/bateria_e2e.mjs tests/bateria/A tests/bateria/C ...
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { unzipSync } from 'fflate';

// playwright-core no es dependencia del proyecto: indica dónde está con PLAYWRIGHT_CORE (ruta al paquete o nombre instalado).
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? 'playwright-core');

const APP = process.env.APP ?? 'http://127.0.0.1:4173/app/';
const OUT = process.env.OUT ?? 'bateria-e2e-salida';
const SOLO = process.env.SOLO ?? '';
const EXCLUIR = (process.env.EXCLUIR ?? '').split(',').filter(Boolean);
// Chromium para Playwright: CHROME_EXE (ruta al ejecutable). Sin ella, Playwright usa el suyo.
const EXE = process.env.CHROME_EXE;
mkdirSync(OUT, { recursive: true });

const lotes = process.argv.slice(2);
const docs = [];
for (const lote of lotes) {
  for (const f of readdirSync(lote).filter((x) => x.endsWith('.esperado.json')).sort()) {
    const exp = JSON.parse(readFileSync(join(lote, f), 'utf8'));
    if (SOLO && !exp.documento.includes(SOLO)) continue;
    if (EXCLUIR.some((x) => exp.documento.includes(x))) continue;
    docs.push({ lote: basename(lote), exp, file: join(lote, exp.documento) });
  }
}

const occ = (text, v) => {
  const out = [];
  if (!v) return out;
  for (let i = text.indexOf(v); i >= 0; i = text.indexOf(v, i + v.length)) out.push(i);
  return out;
};
const ctx = (text, i, n) => text.slice(Math.max(0, i - 50), i + n + 50).replace(/\n/g, '⏎');

/** Texto de todas las partes de un DOCX de salida: XML crudo y texto de los <w:t> unidos. */
function docxParts(bytes) {
  const files = unzipSync(bytes);
  const texts = {};
  for (const [name, data] of Object.entries(files)) {
    if (/\.(xml|rels)$/.test(name)) {
      const raw = new TextDecoder().decode(data);
      const wt = [...raw.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
      texts[name] = raw + '\n' + wt;
    }
  }
  return { names: Object.keys(files), texts };
}


/** Espera a que el motor termine: cierra la ventana del OCR cuando acaba, acepta la descarga del modelo y
 *  da por bueno cuando no está ocupado, la tarjeta está oculta y la lista de detecciones no cambia durante 5 s. */
async function esperarMotor(page, timeoutMs = 900_000) {
  const t0 = Date.now();
  let previo = '', estable = 0, modeloPulsado = false;
  while (Date.now() - t0 < timeoutMs) {
    const st = await page.evaluate(() => {
      const ocr = document.getElementById('ocr-dialog');
      const card = document.getElementById('model-card');
      const eng = document.getElementById('engine-btn');
      const btn = card ? Array.from(card.querySelectorAll('button')).find((b) => /Descargar modelo|Reintentar/.test(b.innerText)) : null;
      return {
        ocrAbierto: !!ocr?.open,
        ocrListo: !!ocr?.open && /Listo|no encontró|Entendido/.test(ocr.innerText),
        modeloBtn: !!btn,
        ok: !!eng && eng.dataset.state !== 'busy' && eng.dataset.state !== 'off' && !!card && card.hidden && !(ocr?.open),
        grupos: document.getElementById('groups')?.innerText ?? '',
      };
    });
    if (st.ocrListo) await page.evaluate(() => document.getElementById('ocr-ok')?.click());
    else if (st.modeloBtn && !modeloPulsado) {
      modeloPulsado = true;
      await page.evaluate(() => {
        const card = document.getElementById('model-card');
        Array.from(card.querySelectorAll('button')).find((b) => /Descargar modelo|Reintentar/.test(b.innerText))?.click();
      });
    }
    if (st.ok && st.grupos === previo) estable++;
    else estable = 0;
    previo = st.grupos;
    if (estable >= 5) return;
    await page.waitForTimeout(1000);
  }
  throw new Error('el motor no terminó');
}

/** Sube un archivo a la app, espera al motor y devuelve el texto que muestra la revisión y los valores detectados. */
async function leerEnApp(browser, file, timeoutMs = 900_000) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(APP, { waitUntil: 'load' });
    await page.setInputFiles('#file', file);
    await esperarMotor(page, timeoutMs);
    await page.waitForTimeout(300);
    const detectados = await page.locator('#groups').innerText().catch(() => '');
    const revision = await page.locator('#review').innerText().catch(() => '');
    return { detectados, revision };
  } finally {
    await context.close();
  }
}

// CHROME_ARGS: flags extra separados por espacios (p. ej. --disable-webgpu para que la app use el modelo WASM en local).
const EXTRA = (process.env.CHROME_ARGS ?? '').split(/\s+/).filter(Boolean);
const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), args: ['--no-sandbox', ...EXTRA] });
const resultados = [];
for (const d of docs) {
  const ext = extname(d.file).toLowerCase();
  const kind = ext === '.pdf' ? 'pdf' : ext === '.docx' ? 'docx' : 'txt';
  const salida = join(OUT, `${d.lote}--${basename(d.file)}.${kind === 'txt' ? 'txt' : kind}`);
  const r = { lote: d.lote, documento: d.exp.documento, kind, ms: 0, error: '', salida, datos: [], falsos: [], nota: '' };
  const t0 = Date.now();
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(APP, { waitUntil: 'load' });
    await page.setInputFiles('#file', d.file);
    // La revisión aparece cuando el motor ha terminado; si no hay detecciones, la lista queda vacía y seguimos.
    // Primera vez en un navegador limpio: la app pide descargar el modelo GLiNER (consentimiento explícito). Lo aceptamos.
    // La app muestra primero la revisión solo con reglas y luego añade GLiNER: esperamos a que el motor deje de estar ocupado.
    await esperarMotor(page);
    const toast = await page.locator('#toast').innerText().catch(() => '');
    if (toast) r.nota = `toast: ${toast.slice(0, 200)}`;
    const sel = kind === 'txt' ? '#btn-download' : '#btn-doc';
    await page.waitForFunction((s) => { const b = document.querySelector(s); return b && !b.disabled; }, sel, { timeout: 600_000 });
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 600_000 }), page.click(sel)]);
    await dl.saveAs(salida);
    r.ms = Date.now() - t0;
  } catch (e) {
    r.error = String(e.message ?? e).split('\n')[0];
    r.ms = Date.now() - t0;
    await page.screenshot({ path: join(OUT, `${d.lote}--${basename(d.file)}.error.png`) }).catch(() => {});
  } finally {
    await context.close();
  }
  if (!r.error) {
    if (kind === 'txt') {
      const out = readFileSync(salida, 'utf8');
      for (const x of d.exp.datos ?? []) {
        const n = occ(out, x.texto).length; // aparece tal cual en la salida = escapa (la sustitución debe quitarlo)
        r.datos.push({ texto: x.texto, tipo: x.tipo, escapa: n > 0, veces: n, contexto: n ? ctx(out, occ(out, x.texto)[0], x.texto.length) : '' });
      }
      for (const fp of d.exp.falsos_positivos ?? []) {
        const en = occ(out, fp.texto).length > 0;
        r.falsos.push({ texto: fp.texto, presente_en_salida: en });
      }
    } else if (kind === 'docx') {
      const { names, texts } = docxParts(readFileSync(salida));
      const thumb = names.some((n) => /docProps\/thumbnail/i.test(n));
      for (const x of d.exp.datos ?? []) {
        const hits = Object.entries(texts).filter(([, t]) => t.includes(x.texto)).map(([n]) => n);
        const escapa = hits.length > 0 || (x.ubicacion === 'miniatura' && thumb);
        r.datos.push({ texto: x.texto, tipo: x.tipo, ubicacion: x.ubicacion, escapa, veces: hits.length, en: hits.join(','), contexto: '' });
      }
      r.nota += ` miniatura_en_salida=${thumb}`;
    } else {
      // La salida es una imagen por página: la leemos otra vez con el OCR de la app y miramos qué datos se recuperan.
      const { detectados, revision } = await leerEnApp(browser, salida).catch((e) => ({ detectados: '', revision: '', err: String(e.message ?? e) }));
      const norm = (x) => x.replace(/\s+/g, '').toLowerCase();
      const leidoNorm = norm(revision);
      for (const x of d.exp.datos ?? []) {
        const nuc = x.texto.replace(/^((D\.ª|Dª\.|D\.|Dña\.|Sr\.|Sra\.|Srta\.|Dr\.|Dra\.|\p{Lu}\.)\s+)+/u, '') || x.texto;
        const aparece = norm(detectados).includes(norm(nuc)) || leidoNorm.includes(norm(nuc));
        r.datos.push({ texto: x.texto, tipo: x.tipo, ubicacion: x.ubicacion, escapa: aparece, veces: aparece ? 1 : 0, en: 'ocr-salida', contexto: '' });
      }
      r.nota += ' salida PDF: segunda pasada OCR en la app';
    }
  }
  resultados.push(r);
  const esc = r.datos.filter((x) => x.escapa).length;
  console.log(`${r.lote}/${r.documento}: ${r.error ? 'ERROR ' + r.error : `${r.datos.length} datos, ${esc} escapan`} (${(r.ms / 1000).toFixed(1)} s)`);
}
await browser.close();
writeFileSync(join(OUT, 'resultados.json'), JSON.stringify(resultados, null, 2));
console.log(`Resultados: ${join(OUT, 'resultados.json')}`);
