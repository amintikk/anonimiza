import '@fontsource-variable/inter';
import '../styles/tokens.css';
import './app.css';
import { ACCEPT, extractFile } from '../docs/extract.ts';
import { redactPdf, type OcrEvent, type PdfSource } from '../docs/pdf.ts';
import { writeDocx, type DocxSource } from '../docs/docx.ts';
import { CancelError, Engine } from '../engine/client.ts';
import { applyMarkers, assignMarkers, buildDetections, dotEndsSentence, KINDS, restore, type Assignment, type Detection, type Kind } from '../engine/anonymize.ts';
import type { EntitySpan } from '../engine/gliner.ts';
import { downloadSize, MODEL_FILES, modelFor } from '../engine/models.ts';
import type { Backend } from '../engine/protocol.ts';
import { findRules, type RuleMatch } from '../engine/rules.ts';
import { isCached, clearCache, pruneCache } from '../engine/store.ts';
import { lang, t } from '../i18n.ts';
import { $, download, fmtBytes, fmtDuration, fmtNum, h, toast } from '../ui/dom.ts';
import { hydrateIcons, icon, type IconName } from '../ui/icons.ts';
import { readSettings, saveSettings, wireTheme, type Settings } from '../ui/theme.ts';
import { SAMPLE } from './sample.ts';

(window as unknown as { anonimizaReady?: boolean }).anonimizaReady = true;

// ---------------------------------------------------------------------------------------------
// Kinds: labels, icons and colour families

type Family = 'person' | 'org' | 'address' | 'id' | 'money' | 'contact' | 'other';
const FAMILY: Record<Kind, Family> = {
  person: 'person', org: 'org', address: 'address', dni: 'id', nie: 'id', cif: 'id', nss: 'id',
  iban: 'money', card: 'money', phone: 'contact', email: 'contact', ip: 'contact', birthdate: 'id', plate: 'id', ref: 'id', other: 'other',
};
const KIND_ICON: Record<Kind, IconName> = {
  person: 'user', org: 'building', address: 'mapPin', dni: 'idCard', nie: 'idCard', cif: 'idCard', nss: 'idCard',
  iban: 'bank', card: 'card', phone: 'phone', email: 'mail', ip: 'network', birthdate: 'calendar', plate: 'car', ref: 'hash', other: 'tag',
};
const kindLabel = (k: Kind, plural = false): string =>
  ({
    person: plural ? t('Personas') : t('Persona'),
    org: plural ? t('Organizaciones') : t('Organización'),
    address: plural ? t('Direcciones') : t('Dirección'),
    dni: 'DNI',
    nie: 'NIE',
    cif: 'CIF',
    nss: plural ? t('Números de la Seguridad Social') : t('N.º Seguridad Social'),
    iban: 'IBAN',
    card: plural ? t('Tarjetas') : t('Tarjeta'),
    phone: plural ? t('Teléfonos') : t('Teléfono'),
    email: plural ? t('Correos') : t('Correo'),
    ip: plural ? t('Direcciones IP') : t('Dirección IP'),
    birthdate: plural ? t('Fechas de nacimiento') : t('Fecha de nacimiento'),
    plate: plural ? t('Matrículas') : t('Matrícula'),
    ref: plural ? t('Otros identificadores') : t('Otro identificador'),
    other: plural ? t('Otros datos') : t('Otro dato'),
  })[k];
/** Kinds offered when adding by hand. */
const MANUAL_KINDS: Kind[] = ['person', 'org', 'address', 'dni', 'phone', 'email', 'iban', 'birthdate', 'plate', 'ref', 'other'];

/** Why a detection is doubtful (right format, wrong check digit). */
const doubtNote = (k: Kind): string => (k === 'iban' || k === 'cif' ? t('Dígitos de control incorrectos: puede estar mal copiado. Compruébalo.') : k === 'card' ? t('No pasa la comprobación de tarjeta: puede estar mal copiada. Compruébalo.') : t('Letra de control incorrecta: puede estar mal copiado. Compruébalo.'));

const THRESHOLD: Record<NonNullable<Settings['sensitivity']>, number> = { high: 0.3, medium: 0.45, low: 0.6 };

// ---------------------------------------------------------------------------------------------
// State

type ModelState = 'unknown' | 'absent' | 'downloading' | 'compiling' | 'ready' | 'error';

const settings = readSettings();
const engine = new Engine();
const st = {
  text: '',
  fileName: '',
  // The PDF or DOCX the text came from, to write it back anonymised.
  source: null as null | { kind: 'pdf'; src: PdfSource } | { kind: 'docx'; src: DocxSource },
  rules: [] as RuleMatch[],
  entities: null as EntitySpan[] | null,
  manual: [] as { start: number; end: number; kind: Kind }[],
  off: new Set<string>(), // "start:end" of occurrences switched off
  dets: [] as Detection[],
  assign: { byId: new Map(), table: new Map() } as Assignment,
  mode: 'edit' as 'edit' | 'review',
  view: 'orig' as 'orig' | 'out',
  backend: 'wasm' as Backend,
  model: 'unknown' as ModelState,
  modelError: '',
  loaded: 0,
  total: 0,
  analysing: null as null | { done: number; total: number },
  modelMs: 0,
};
const posKey = (d: { start: number; end: number }) => `${d.start}:${d.end}`;

// ---------------------------------------------------------------------------------------------
// Elements

const input = $<HTMLTextAreaElement>('input');
const review = $('review');
const editor = $('editor');
const groupsEl = $('groups');
const modelCard = $('model-card');

// ---------------------------------------------------------------------------------------------
// Engine and model

/** Why the CPU is used, for the engine panel. */
let cpuReason: 'user' | 'nogpu' | 'nof16' | 'software' | 'fallback' = 'nogpu';
let gpuLabel = '';

async function pickBackend(): Promise<Backend> {
  if (settings.backend === 'wasm') return (cpuReason = 'user'), 'wasm';
  if (!('gpu' in navigator)) return (cpuReason = 'nogpu'), 'wasm';
  try {
    // The first request can come back empty while the GPU process is still starting.
    const adapter = (await navigator.gpu.requestAdapter()) ?? (await new Promise<GPUAdapter | null>((r) => setTimeout(() => r(navigator.gpu.requestAdapter()), 400)));
    if (!adapter) return (cpuReason = 'nogpu'), 'wasm';
    const info = adapter.info;
    gpuLabel = [info?.vendor, info?.architecture].filter(Boolean).join(' ');
    // A software rasteriser is slower than multi-threaded WebAssembly.
    if ((info as { isFallbackAdapter?: boolean } | undefined)?.isFallbackAdapter || /swiftshader|llvmpipe|lavapipe|software/i.test(`${gpuLabel} ${info?.description ?? ''}`))
      return (cpuReason = 'software'), 'wasm';
    // The GPU variant is fp16: without shader-f16 it would not run, so use the CPU one.
    if (!adapter.features.has('shader-f16')) return (cpuReason = 'nof16'), 'wasm';
    return 'webgpu';
  } catch {
    return (cpuReason = 'nogpu'), 'wasm';
  }
}

const threads = () => Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));

let loading: Promise<boolean> | null = null;

/** Start the worker and load the model (download it if needed). Resolves to whether it is ready. */
function loadModel(): Promise<boolean> {
  if (st.model === 'ready') return Promise.resolve(true);
  loading ??= (async () => {
    try {
      // Ask the browser not to evict the stored model under storage pressure (best effort).
      void navigator.storage?.persist?.().catch(() => false);
      await engine.start(st.backend, threads());
      st.model = (await isCached(modelFor(st.backend))) ? 'compiling' : 'downloading';
      renderModel();
      await engine.load({
        download: (_file, loaded, total, cached) => {
          if (total < 1e8) return; // the tokenizer: too small to show
          st.loaded = loaded;
          st.total = total;
          if (st.model !== 'downloading' && !cached) st.model = 'downloading';
          renderModelThrottled();
        },
        progress: (stage) => {
          if (stage === 'compile') {
            st.model = 'compiling';
            renderModel();
          }
        },
      });
      st.model = 'ready';
      renderModel();
      void pruneCache();
      if (!(await isCached(modelFor(st.backend)))) {
        toast(t('El navegador no ha dejado guardar el modelo (falta espacio o es una ventana privada): se volverá a descargar la próxima vez.'), 'error');
      }
      return true;
    } catch (e) {
      if (e instanceof CancelError) {
        st.model = 'absent';
      } else if (st.backend === 'webgpu') {
        // A GPU that announces WebGPU may still fail to build the session: fall back to the CPU.
        st.backend = 'wasm';
        cpuReason = 'fallback';
        loading = null;
        renderModel();
        return loadModel();
      } else {
        st.model = 'error';
        st.modelError = e instanceof Error ? e.message : String(e);
      }
      renderModel();
      return false;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

let rafPending = false;
function renderModelThrottled(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    renderModel();
  });
}

function engineName(): string {
  return st.backend === 'webgpu' ? t('WebGPU (tarjeta gráfica)') : t('WebAssembly (procesador, {n} hilos)', { n: engine.threads });
}

function renderModel(): void {
  // Header button: an icon for the engine and a dot for its state.
  const gpu = st.backend === 'webgpu';
  popBtn.dataset.state =
    st.model === 'error' ? 'error' : st.model === 'downloading' || st.model === 'compiling' || st.analysing ? 'busy' : st.model === 'ready' ? (gpu ? 'gpu' : 'cpu') : 'off';
  $('engine-ico').replaceChildren(icon(gpu ? 'zap' : 'cpu', 18));
  popBtn.setAttribute('aria-label', `${t('Motor de análisis')}: ${engineTitle()}`);
  renderEnginePop();

  // Side card: only while something needs the user's attention.
  const needs = st.mode === 'review' && st.entities === null;
  const show = st.model === 'downloading' || st.model === 'compiling' || st.model === 'error' || (st.model === 'absent' && needs) || st.analysing !== null;
  modelCard.hidden = !show;
  if (!show) return;
  const size = fmtBytes(downloadSize(st.backend));
  let body: Node[] = [];
  if (st.analysing) {
    const { done, total } = st.analysing;
    body = [
      h('div', { class: 'mc-row' }, h('strong', {}, t('Buscando nombres, direcciones y organizaciones')), h('span', { class: 'mc-num' }, total > 1 ? `${done}/${total}` : '')),
      bar(total ? done / total : 0, true),
    ];
  } else if (st.model === 'absent') {
    body = [
      h('strong', {}, t('Falta el modelo para nombres, direcciones y organizaciones')),
      h('p', {}, t('Ya se han buscado los datos con formato fijo (DNI, IBAN, teléfonos…). Para el resto hace falta descargar una vez el modelo GLiNER ({size}); se guarda en este navegador.', { size })),
      h('div', { class: 'mc-actions' }, h('button', { class: 'btn accent small', type: 'button', onclick: () => void startModel() }, icon('download', 16), t('Descargar modelo'))),
    ];
  } else if (st.model === 'downloading') {
    body = [
      h('div', { class: 'mc-row' }, h('strong', {}, t('Descargando el modelo')), h('span', { class: 'mc-num' }, `${fmtBytes(st.loaded)} / ${fmtBytes(st.total || modelFor(st.backend).bytes)}`)),
      bar(st.total ? st.loaded / st.total : 0, false),
      h('p', {}, t('Solo esta vez: después se carga desde el navegador.')),
    ];
  } else if (st.model === 'compiling') {
    body = [h('div', { class: 'mc-row' }, h('strong', {}, t('Preparando el modelo')), h('span', { class: 'mc-num' }, engineName())), bar(0, true)];
  } else if (st.model === 'error') {
    body = [
      h('strong', {}, t('No se pudo cargar el modelo')),
      h('p', { class: 'mc-error' }, st.modelError),
      h('div', { class: 'mc-actions' }, h('button', { class: 'btn small', type: 'button', onclick: () => void startModel() }, icon('undo', 16), t('Reintentar'))),
    ];
  }
  modelCard.replaceChildren(...body);
}

function bar(frac: number, indeterminate: boolean): HTMLElement {
  const fill = h('div', { class: 'bar-fill' });
  fill.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
  return h('div', { class: `bar${indeterminate && frac === 0 ? ' busy' : ''}` }, fill);
}

async function startModel(): Promise<void> {
  if (await loadModel()) {
    if (st.mode === 'review' && st.entities === null) await runModel();
  }
}

// ---------------------------------------------------------------------------------------------
// Engine popover (header)

const pop = $('engine-pop');
const popBtn = $('engine-btn');

function engineTitle(): string {
  if (st.model === 'error') return t('Modelo no disponible');
  if (st.model === 'downloading') return t('Descargando el modelo… {p} %', { p: String(Math.floor((100 * st.loaded) / Math.max(st.total, 1))) });
  if (st.model === 'compiling') return t('Preparando el modelo…');
  if (st.model !== 'ready') return t('Solo reglas: falta el modelo');
  return st.backend === 'webgpu' ? t('Usando la tarjeta gráfica') : t('Usando la CPU');
}

function engineNote(): string {
  if (st.model === 'error') return st.modelError;
  if (st.model !== 'ready' && st.model !== 'downloading' && st.model !== 'compiling') return t('Sin el modelo solo se buscan los datos con formato fijo (DNI, IBAN, teléfonos…).');
  if (st.backend === 'webgpu') return t('La forma más rápida en este equipo.');
  return {
    user: t('Elegido en los ajustes.'),
    nogpu: t('Este navegador no ofrece WebGPU. Funciona igual, algo más despacio.'),
    nof16: t('La tarjeta gráfica no admite el formato del modelo (fp16). Funciona igual, algo más despacio.'),
    software: t('Este equipo solo ofrece WebGPU por software, que sería más lento que la CPU.'),
    fallback: t('WebGPU dio un error en este equipo y se cambió a la CPU.'),
  }[cpuReason];
}

function renderEnginePop(): void {
  const sens = settings.sensitivity ?? 'high';
  const gpu = st.backend === 'webgpu';
  const seg = h('div', { class: 'switch3', role: 'radiogroup', 'aria-label': t('Sensibilidad') });
  for (const [k, label] of [
    ['high', t('Alta')],
    ['medium', t('Media')],
    ['low', t('Baja')],
  ] as const) {
    seg.append(
      h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(sens === k),
        onclick: () => {
          settings.sensitivity = k;
          saveSettings({ sensitivity: k });
          renderEnginePop();
          if (st.mode === 'review' && st.model === 'ready') void runModel();
        },
      }, label),
    );
  }
  pop.replaceChildren(
    h('div', { class: 'pop-sec' },
      h('div', { class: 'pop-title' }, h('span', { class: 'engine-dot', 'data-state': popBtn.dataset.state ?? 'off' }), engineTitle()),
      h('div', { class: 'kv' }, h('span', {}, t('Motor')), h('b', {}, gpu ? 'WebGPU' : 'WebAssembly')),
      gpu && gpuLabel ? h('div', { class: 'kv' }, h('span', {}, t('Tarjeta')), h('b', {}, gpuLabel)) : null,
      !gpu ? h('div', { class: 'kv' }, h('span', {}, t('Hilos')), h('b', {}, String(st.model === 'ready' ? engine.threads : threads()))) : null,
      h('div', { class: 'kv' }, h('span', {}, t('Modelo')), h('b', {}, `${fmtBytes(downloadSize(st.backend))} · ${st.model === 'ready' || st.model === 'compiling' ? t('descargado') : t('sin descargar')}`)),
      st.modelMs ? h('div', { class: 'kv' }, h('span', {}, t('Último análisis')), h('b', {}, fmtDuration(st.modelMs))) : null,
      h('p', { class: 'pop-note' }, engineNote()),
    ),
    h('div', { class: 'pop-sec' },
      h('div', { class: 'pop-label' }, t('Sensibilidad del modelo')),
      seg,
      h('p', { class: 'pop-note' }, t('Alta encuentra más nombres y direcciones a cambio de algún falso positivo. Las cifras publicadas se midieron con «Alta».')),
    ),
    h('div', { class: 'pop-actions' },
      st.model !== 'ready' && st.model !== 'downloading' && st.model !== 'compiling'
        ? h('button', { class: 'btn small accent', type: 'button', onclick: () => void startModel() }, icon('download', 16), t('Cargar modelo ({size})', { size: fmtBytes(downloadSize(st.backend)) }))
        : null,
      st.model !== 'ready' ? null : h('button', {
        class: 'btn small ghost', type: 'button',
        onclick: async () => {
          engine.stop();
          loading = null;
          await clearCache();
          st.model = 'absent';
          renderModel();
          toast(t('Modelo borrado de este navegador.'));
        },
      }, icon('trash', 16), t('Borrar modelo descargado')),
    ),
  );
}

function setPop(open: boolean): void {
  pop.classList.toggle('open', open);
  popBtn.setAttribute('aria-expanded', String(open));
}
// With a mouse the panel opens on hover, and stays while the pointer is over it.
let hoverTimer = 0;
$('engine').addEventListener('pointerenter', (e) => {
  if (e.pointerType !== 'mouse') return;
  clearTimeout(hoverTimer);
  setPop(true);
});
$('engine').addEventListener('pointerleave', (e) => {
  if (e.pointerType !== 'mouse') return;
  hoverTimer = window.setTimeout(() => setPop(false), 180);
});
popBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  // With a mouse the hover has already opened it: a click must not close it again.
  setPop((e as PointerEvent).pointerType === 'mouse' || !pop.classList.contains('open'));
});
document.addEventListener('click', (e) => {
  if (!pop.contains(e.target as Node)) setPop(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    setPop(false);
    hideAddMenu();
  }
});

// ---------------------------------------------------------------------------------------------
// Input

function updateCount(): void {
  const n = input.value.trim() ? input.value.trim().split(/\s+/).length : 0;
  $('count').textContent = n ? t('{n} palabras', { n: fmtNum(n) }) : '';
  ($('btn-detect') as HTMLButtonElement).disabled = !input.value.trim();
}
input.addEventListener('input', updateCount);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && input.value.trim()) void detectAll();
});

$('btn-sample').addEventListener('click', () => {
  ocrNote.hidden = true;
  input.value = SAMPLE[lang];
  st.fileName = '';
  st.source = null;
  setFileName();
  updateCount();
  void detectAll();
});

function setFileName(): void {
  const el = $('file-name');
  el.hidden = !st.fileName;
  el.textContent = st.fileName;
}

const ocrNote = $('ocr-note');
const ocrStatus = $('ocr-status');
const OCR_BYTES = MODEL_FILES.ocrDet.bytes + MODEL_FILES.ocrRec.bytes + MODEL_FILES.ocrDict.bytes;
$('ocr-ok').addEventListener('click', () => (ocrNote.hidden = true));

/** The OCR note only shows for a PDF that has no text to copy; it says what is happening while the pages are read. */
function ocrProgress(e: OcrEvent): void {
  ocrNote.hidden = false;
  ocrStatus.textContent =
    e.stage === 'page'
      ? t('Leyendo la página {n} de {total}…', { n: String(e.page), total: String(e.pages) })
      : e.cached
        ? t('Preparando el OCR…')
        : t('Descargando el OCR ({size}, solo la primera vez)…', { size: fmtBytes(OCR_BYTES) });
}

async function openFile(file: File): Promise<void> {
  ocrNote.hidden = true;
  try {
    const got = await extractFile(file, ocrProgress);
    if (got.ocr) {
      ocrNote.hidden = false;
      ocrStatus.textContent = t('Listo: {n} líneas leídas.', { n: String(got.text.split('\n').filter((l) => l.trim()).length) });
    }
    input.value = got.text;
    st.source = got.pdf ? { kind: 'pdf', src: got.pdf } : got.docx ? { kind: 'docx', src: got.docx } : null;
    st.fileName = file.name;
    setFileName();
    updateCount();
    if (st.mode === 'review') setMode('edit');
    if (!input.value.trim()) throw new Error(t('El archivo no contiene texto.'));
    void detectAll();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}

const fileInput = $<HTMLInputElement>('file');
fileInput.accept = ACCEPT;
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) void openFile(f);
  fileInput.value = '';
});

// Drag and drop anywhere on the anonymise view.
let dragDepth = 0;
const view = $('view-anon');
view.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  dragDepth++;
  editor.classList.add('dragging');
});
view.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
view.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    editor.classList.remove('dragging');
  }
});
view.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  editor.classList.remove('dragging');
  const f = e.dataTransfer?.files[0];
  if (f) {
    if (st.mode === 'review') setMode('edit');
    void openFile(f);
  }
});

// ---------------------------------------------------------------------------------------------
// Detection

$('btn-detect').addEventListener('click', () => void detectAll());

async function detectAll(): Promise<void> {
  const text = input.value.replace(/\r\n?/g, '\n').replace(/\u0085/g, '\n').normalize('NFC');
  if (!text.trim()) return;
  st.text = text;
  st.rules = findRules(text);
  st.entities = null;
  st.manual = [];
  st.off.clear();
  st.view = 'orig';
  setMode('review');
  rebuild();
  if (st.model === 'ready' || st.model === 'compiling' || st.model === 'downloading' || (await loadingFromCache())) {
    if (await loadModel()) await runModel();
  } else {
    renderModel();
  }
}

/** If the model is already in the browser cache, load it without asking. */
async function loadingFromCache(): Promise<boolean> {
  try {
    return await isCached(modelFor(st.backend));
  } catch {
    return false;
  }
}

let runToken = 0;
async function runModel(): Promise<void> {
  const token = ++runToken;
  const text = st.text;
  st.analysing = { done: 0, total: 0 };
  renderModel();
  try {
    const t0 = performance.now();
    const entities = await engine.detect(text, THRESHOLD[settings.sensitivity ?? 'high'], {
      progress: (stage, done, total) => {
        if (stage !== 'detect' || token !== runToken) return;
        st.analysing = { done, total };
        renderModelThrottled();
      },
    });
    if (token !== runToken || text !== st.text) return;
    st.modelMs = performance.now() - t0;
    st.entities = entities;
    rebuild();
  } catch (e) {
    if (e instanceof CancelError) return;
    if (st.backend === 'webgpu' && token === runToken) {
      // The GPU path cannot be tested on every device: if it fails while running, retry on the CPU.
      st.backend = 'wasm';
      cpuReason = 'fallback';
      st.model = 'absent';
      engine.stop();
      loading = null;
      st.analysing = null;
      toast(t('La tarjeta gráfica ha fallado; se usa el procesador.'), 'error');
      if (await loadModel()) return runModel();
      return;
    }
    toast(e instanceof Error ? e.message : String(e), 'error');
  } finally {
    if (token === runToken) {
      st.analysing = null;
      renderModel();
    }
  }
}

function rebuild(): void {
  st.dets = buildDetections(st.text, st.rules, st.entities ?? [], st.manual);
  for (const d of st.dets) d.on = !st.off.has(posKey(d));
  // Markers are numbered over every detection, active or not, so switching one off never renumbers the rest.
  st.assign = assignMarkers(st.text, st.dets, lang);
  renderReview();
  renderGroups();
}

// ---------------------------------------------------------------------------------------------
// Review

function setMode(mode: 'edit' | 'review'): void {
  st.mode = mode;
  const reviewing = mode === 'review';
  editor.hidden = reviewing;
  review.hidden = !reviewing;
  $('foot-edit').hidden = reviewing;
  $('foot-review').hidden = !reviewing;
  $('mode-switch').hidden = !reviewing;
  $('main-title').textContent = !reviewing ? t('Texto original') : st.view === 'out' ? t('Resultado') : t('Revisión');
  $('side-empty').hidden = reviewing;
  $('found').hidden = !reviewing;
  if (!reviewing) {
    runToken++;
    st.analysing = null;
    engine.cancel();
    hideAddMenu();
    renderModel();
    input.focus();
  }
  setView(st.view);
}

function setView(v: 'orig' | 'out'): void {
  st.view = v;
  $('mode-orig').setAttribute('aria-selected', String(v === 'orig'));
  $('mode-out').setAttribute('aria-selected', String(v === 'out'));
  $('select-hint').hidden = v !== 'orig';
  review.classList.toggle('out', v === 'out');
  if (st.mode === 'review') {
    $('main-title').textContent = v === 'out' ? t('Resultado') : t('Revisión');
    renderReview();
  }
}
$('mode-orig').addEventListener('click', () => setView('orig'));
$('mode-out').addEventListener('click', () => setView('out'));

$('btn-edit').addEventListener('click', () => setMode('edit'));

function anonymised(): string {
  return applyMarkers(st.text, st.dets, st.assign.byId);
}

function renderReview(): void {
  const frag = document.createDocumentFragment();
  let pos = 0;
  const text = st.text;
  for (const d of st.dets) {
    if (d.start > pos) frag.append(text.slice(pos, d.start));
    const marker = st.assign.byId.get(d.id) ?? '';
    const fam = FAMILY[d.kind];
    if (st.view === 'out') {
      frag.append(d.on ? h('span', { class: `mk k-${fam}`, 'data-id': d.id }, marker) : text.slice(d.start, d.end));
      if (d.on && dotEndsSentence(text, d)) frag.append('.');
    } else {
      frag.append(
        h('mark', {
          class: `m k-${fam}${d.on ? '' : ' off'}${d.doubtful ? ' doubtful' : ''}`,
          'data-id': d.id,
          title: `${kindLabel(d.kind)} · ${marker} · ${d.on ? t('clic para no sustituir') : t('clic para sustituir')}${d.doubtful ? `\n${doubtNote(d.kind)}` : ''}`,
        }, text.slice(d.start, d.end)),
      );
    }
    pos = d.end;
  }
  if (pos < text.length) frag.append(text.slice(pos));
  review.replaceChildren(frag);
  const active = st.dets.some((d) => d.on);
  ($('btn-copy') as HTMLButtonElement).disabled = !st.text;
  // The same PDF or DOCX back, only while the text is still exactly the one read from it.
  // A PDF or DOCX comes back as the same kind of file: that is the main button, and the text ones step back.
  const doc = $('btn-doc');
  const file = !!st.source && st.source.src.text === st.text;
  doc.hidden = !file;
  if (st.source) doc.querySelector('span')!.textContent = st.source.kind === 'pdf' ? t('Descargar PDF') : t('Descargar DOCX');
  const txt = $('btn-download'), cp = $('btn-copy');
  txt.querySelector('span')!.textContent = file ? '.txt' : t('Descargar .txt');
  txt.title = t('Descargar el texto anonimizado (.txt)');
  txt.classList.toggle('ghost', file);
  cp.querySelector('span')!.textContent = file ? t('Copiar texto') : t('Copiar resultado');
  cp.classList.toggle('ghost', file);
  cp.classList.toggle('primary', !file && active);
}

review.addEventListener('click', (e) => {
  const sel = getSelection();
  if (sel && !sel.isCollapsed) return; // the user is selecting text, not toggling
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
  if (!el) return;
  const d = st.dets.find((x) => x.id === Number(el.dataset.id));
  if (!d) return;
  toggleOccurrence(d);
});

function toggleOccurrence(d: Detection): void {
  const k = posKey(d);
  if (d.on) st.off.add(k);
  else st.off.delete(k);
  if (d.source === 'manual' && d.on) {
    // Switching off something added by hand removes it: the list changes shape.
    st.manual = st.manual.filter((m) => posKey(m) !== k);
    st.off.delete(k);
    rebuild();
    return;
  }
  setOn();
}

/**
 * Switching a value on or off changes only its state: the text, the counters and the switches are updated in place.
 * Rebuilding the list would recreate every row, and the page would flash.
 */
function setOn(): void {
  for (const d of st.dets) d.on = !st.off.has(posKey(d));
  renderReview();
  renderFoundHead();
  syncSwitches();
}

function renderFoundHead(): void {
  const values = new Set(st.dets.map((d) => st.assign.byId.get(d.id))).size;
  const on = st.dets.filter((d) => d.on).length;
  $('found-title').textContent = values ? t('Datos detectados') : t('No se ha detectado nada');
  $('found-sub').textContent = values ? t('{v} valores · {o} de {n} apariciones se sustituirán', { v: values, o: on, n: st.dets.length }) : st.entities === null ? t('Aún falta el análisis con el modelo.') : t('Selecciona en el texto lo que quieras sustituir.');
}

function syncSwitches(): void {
  const on = new Map<string, boolean>();
  for (const d of st.dets) {
    const m = st.assign.byId.get(d.id)!;
    on.set(m, (on.get(m) ?? false) || d.on);
  }
  for (const row of groupsEl.querySelectorAll<HTMLElement>('.row[data-marker]')) {
    const v = on.get(row.dataset.marker!) ?? false;
    row.classList.toggle('is-off', !v);
    row.querySelector('.sw')!.setAttribute('aria-checked', String(v));
  }
}

// ---------------------------------------------------------------------------------------------
// Side list: detections grouped by kind, then by marker (one row per distinct value)

function renderGroups(): void {
  const byKind = new Map<Kind, Map<string, Detection[]>>();
  for (const d of st.dets) {
    const m = st.assign.byId.get(d.id)!;
    const g = byKind.get(d.kind) ?? byKind.set(d.kind, new Map()).get(d.kind)!;
    (g.get(m) ?? g.set(m, []).get(m)!).push(d);
  }
  renderFoundHead();
  const out: HTMLElement[] = [];
  for (const kind of KINDS) {
    const g = byKind.get(kind);
    if (!g) continue;
    const rows = [...g.entries()].map(([marker, ds]) => {
      const anyOn = ds.some((d) => d.on);
      const value = st.assign.table.get(marker) ?? st.text.slice(ds[0]!.start, ds[0]!.end);
      const sw = h('button', {
        class: 'sw', type: 'button', role: 'switch', 'aria-checked': String(anyOn),
        'aria-label': t('Sustituir «{v}»', { v: value }),
        onclick: (e: Event) => {
          e.stopPropagation();
          // Read the state now: the row may have been switched since it was drawn.
          const on = ds.some((d) => d.on);
          const hadManual = on && ds.some((d) => d.source === 'manual');
          for (const d of ds) {
            if (on) st.off.add(posKey(d));
            else st.off.delete(posKey(d));
          }
          if (hadManual) {
            // Switching off something added by hand removes it: the list changes shape.
            st.manual = st.manual.filter((m) => !ds.some((d) => d.source === 'manual' && posKey(d) === posKey(m)));
            rebuild();
          } else setOn();
        },
      }, h('span', { class: 'sw-knob' }));
      const row = h('div', { class: `row${anyOn ? '' : ' is-off'}`, role: 'button', tabindex: 0, title: t('Ver en el texto'), 'data-marker': marker },
        sw,
        ds.some((d) => d.doubtful)
          ? h('span', { class: 'row-val', title: doubtNote(kind) }, h('span', { class: 'doubt-ico', 'aria-label': t('Dudoso') }, icon('alert', 14)), value)
          : h('span', { class: 'row-val' }, value),
        h('code', { class: `chip k-${FAMILY[kind]}` }, marker),
        ds.length > 1 ? h('span', { class: 'row-n' }, `×${ds.length}`) : null,
      );
      const go = () => focusDetection(ds[0]!);
      row.addEventListener('click', go);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') go();
      });
      return row;
    });
    out.push(
      h('section', { class: `group k-${FAMILY[kind]}` },
        h('header', {}, h('span', { class: 'g-ico' }, icon(KIND_ICON[kind], 15)), h('h3', {}, kindLabel(kind, g.size > 1)), h('span', { class: 'g-n' }, String(g.size))),
        ...rows,
      ),
    );
  }
  groupsEl.replaceChildren(...out);
}

function focusDetection(d: Detection): void {
  if (st.view !== 'orig') setView('orig');
  const el = review.querySelector<HTMLElement>(`[data-id="${d.id}"]`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
}

// ---------------------------------------------------------------------------------------------
// Adding by hand: select text in the review, choose a kind

const addMenu = $('add-menu');
let pendingRange: { start: number; end: number } | null = null;

function selectionRange(): { start: number; end: number; rect: DOMRect } | null {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount || st.view !== 'orig') return null;
  const r = sel.getRangeAt(0);
  if (!review.contains(r.commonAncestorContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(review);
  pre.setEnd(r.startContainer, r.startOffset);
  let start = pre.toString().length;
  let end = start + r.toString().length;
  // Trim spaces and punctuation the selection usually drags along.
  while (start < end && /[\s.,;:()«»"'“”]/.test(st.text[start]!)) start++;
  while (end > start && /[\s.,;:()«»"'“”]/.test(st.text[end - 1]!)) end--;
  if (end - start < 2 || end - start > 300) return null;
  return { start, end, rect: r.getBoundingClientRect() };
}

function showAddMenu(): void {
  const s = selectionRange();
  if (!s) return hideAddMenu();
  pendingRange = { start: s.start, end: s.end };
  if (!addMenu.childElementCount) {
    addMenu.append(
      h('div', { class: 'add-title' }, t('Sustituir como')),
      ...MANUAL_KINDS.map((k) =>
        h('button', { type: 'button', role: 'menuitem', class: `k-${FAMILY[k]}`, 'data-kind': k }, h('span', { class: 'g-ico' }, icon(KIND_ICON[k], 14)), kindLabel(k)),
      ),
    );
  }
  addMenu.classList.add('open');
  const w = addMenu.offsetWidth;
  const hgt = addMenu.offsetHeight;
  let x = s.rect.left + s.rect.width / 2 - w / 2;
  x = Math.max(8, Math.min(innerWidth - w - 8, x));
  let y = s.rect.bottom + 10;
  if (y + hgt > innerHeight - 8) y = Math.max(8, s.rect.top - hgt - 10);
  addMenu.style.left = `${x}px`;
  addMenu.style.top = `${y}px`;
}

function hideAddMenu(): void {
  addMenu.classList.remove('open');
  pendingRange = null;
}

addMenu.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection while clicking
addMenu.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]');
  if (!b || !pendingRange) return;
  const kind = b.dataset.kind as Kind;
  const { start, end } = pendingRange;
  // A hand-picked range replaces whatever automatic detections it overlaps.
  st.manual = st.manual.filter((m) => m.end <= start || m.start >= end);
  st.manual.push({ start, end, kind });
  for (const d of st.dets) if (d.start < end && start < d.end) st.off.delete(posKey(d));
  getSelection()?.removeAllRanges();
  hideAddMenu();
  rebuildWithManual(start, end);
  toast(t('Añadido como {k}. Se sustituye en todas sus apariciones.', { k: kindLabel(kind).toLowerCase() }));
});

/** Manual entries win over automatic ones: drop automatic detections that overlap them before merging. */
function rebuildWithManual(start: number, end: number): void {
  st.rules = st.rules.filter((r) => r.end <= start || r.start >= end);
  if (st.entities) st.entities = st.entities.filter((e) => e.end <= start || e.start >= end);
  rebuild();
}

let selTimer = 0;
document.addEventListener('selectionchange', () => {
  clearTimeout(selTimer);
  selTimer = window.setTimeout(() => (selectionRange() ? showAddMenu() : hideAddMenu()), 180);
});
addEventListener('scroll', hideAddMenu, { passive: true });
review.addEventListener('scroll', hideAddMenu, { passive: true });

// ---------------------------------------------------------------------------------------------
// Output

function outName(suffix: string): string {
  const base = st.fileName ? st.fileName.replace(/\.[^.]+$/, '') : t('texto');
  return `${base}-${suffix}.txt`;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers or a denied permission: fall back to a hidden textarea.
    const ta = h('textarea', { class: 'sr-only' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

$('btn-copy').addEventListener('click', async () => {
  if (await copy(anonymised())) toast(t('Copiado. Revísalo antes de compartirlo.'));
  else toast(t('No se pudo copiar. Usa «Descargar».'), 'error');
});
$('btn-download').addEventListener('click', () => download(outName(t('anonimizado')), anonymised()));

let docBusy = false;
$('btn-doc').addEventListener('click', async () => {
  const source = st.source;
  if (!source || source.src.text !== st.text || docBusy) return;
  docBusy = true;
  const btn = $('btn-doc') as HTMLButtonElement;
  btn.disabled = true;
  try {
    const covers = st.dets.filter((d) => d.on).map((d) => ({ start: d.start, end: d.end, label: st.assign.byId.get(d.id) ?? '' }));
    const base = `${st.fileName.replace(/\.[^.]+$/, '') || t('documento')}-${t('anonimizado')}`;
    if (source.kind === 'pdf') {
      const bytes = await redactPdf(source.src, covers, (n, total) => toast(t('Generando el PDF: página {n} de {total}…', { n: String(n), total: String(total) })));
      download(`${base}.pdf`, bytes, 'application/pdf');
      toast(t('PDF descargado. Revísalo antes de compartirlo: las imágenes que contenga (firmas, fotos, sellos) no se tapan.'));
    } else {
      const bytes = await writeDocx(source.src, covers);
      download(`${base}.docx`, bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      toast(t('DOCX descargado. Revísalo antes de compartirlo: las imágenes que contenga (firmas, fotos, sellos) no se tapan.'));
    }
  } catch (e) {
    toast(`${t('No se pudo generar el archivo.')} ${e instanceof Error ? e.message : ''}`, 'error');
  } finally {
    docBusy = false;
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------------------------
// Restore

const aiInput = $<HTMLTextAreaElement>('ai-input');
const restoredEl = $('restored');
let restoredText = '';

function renderRestore(): void {
  const table = st.assign.table;
  const src = aiInput.value;
  const empty = !table.size;
  if (!src.trim()) {
    restoredText = '';
    restoredEl.replaceChildren(
      h('div', { class: 'placeholder' },
        icon(empty ? 'info' : 'restore', 22),
        h('p', {}, empty
          ? t('Primero anonimiza un texto en esta misma pestaña. La tabla de sustituciones solo existe en la memoria de esta página: si la recargas o la cierras, desaparece.')
          : t('Pega a la izquierda la respuesta de la IA. Los marcadores que conozca esta pestaña ({n}) se cambiarán por los datos originales.', { n: table.size })),
      ),
    );
    $('restore-stats').textContent = '';
    ($('btn-r-copy') as HTMLButtonElement).disabled = true;
    ($('btn-r-download') as HTMLButtonElement).disabled = true;
    return;
  }
  const r = restore(src, table);
  restoredText = r.text;
  // Show the restored values highlighted.
  const values = [...new Set(table.values())].sort((a, b) => b.length - a.length);
  const frag = document.createDocumentFragment();
  if (r.replaced && values.length) {
    const re = new RegExp(values.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    let pos = 0;
    for (const m of r.text.matchAll(re)) {
      if (m.index > pos) frag.append(r.text.slice(pos, m.index));
      frag.append(h('mark', { class: 'm restored-val' }, m[0]));
      pos = m.index + m[0].length;
    }
    frag.append(r.text.slice(pos));
  } else frag.append(r.text);
  restoredEl.replaceChildren(frag);
  const parts = [t('{n} marcadores restaurados', { n: r.replaced })];
  if (r.unknown.length) parts.push(t('desconocidos: {m}', { m: r.unknown.slice(0, 4).join(', ') + (r.unknown.length > 4 ? '…' : '') }));
  if (empty) parts.push(t('no hay ninguna tabla de sustituciones en esta pestaña'));
  $('restore-stats').textContent = parts.join(' · ');
  $('restore-stats').classList.toggle('warn', r.unknown.length > 0 || empty);
  ($('btn-r-copy') as HTMLButtonElement).disabled = false;
  ($('btn-r-download') as HTMLButtonElement).disabled = false;
}
aiInput.addEventListener('input', renderRestore);
$('btn-r-copy').addEventListener('click', async () => {
  if (await copy(restoredText)) toast(t('Copiado.'));
});
$('btn-r-download').addEventListener('click', () => download(outName(t('restaurado')), restoredText));
$('btn-paste').addEventListener('click', async () => {
  try {
    aiInput.value = await navigator.clipboard.readText();
    renderRestore();
  } catch {
    aiInput.focus();
    toast(t('El navegador no deja leer el portapapeles: pega con Ctrl+V.'), 'error');
  }
});

// ---------------------------------------------------------------------------------------------
// Tabs

function setTab(which: 'anon' | 'restore'): void {
  const anon = which === 'anon';
  $('tab-anon').setAttribute('aria-selected', String(anon));
  $('tab-restore').setAttribute('aria-selected', String(!anon));
  document.querySelector('.seg')?.classList.toggle('second', !anon);
  $('view-anon').hidden = !anon;
  $('view-restore').hidden = anon;
  hideAddMenu();
  if (!anon) renderRestore();
  history.replaceState(null, '', anon ? location.pathname : '#restaurar');
}
$('tab-anon').addEventListener('click', () => setTab('anon'));
$('tab-restore').addEventListener('click', () => setTab('restore'));

// ---------------------------------------------------------------------------------------------
// Start

async function boot(): Promise<void> {
  hydrateIcons();
  wireTheme();
  updateCount();
  setMode('edit');
  if (location.hash === '#restaurar') setTab('restore');
  st.backend = await pickBackend();
  st.model = (await loadingFromCache()) ? 'compiling' : 'absent';
  renderModel();
  // A model already in the browser loads in the background so the first detection is immediate.
  if (st.model === 'compiling') void loadModel();
}

void boot();
