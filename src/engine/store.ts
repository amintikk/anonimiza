// Model files: downloaded once from the models domain, then kept in the browser's Cache Storage.
import { t } from '../i18n.ts';
import { MODEL_FILES, type FileMeta } from './models.ts';

/** Where the files are downloaded from (see .env.production). The CSP allows only this origin besides the site. */
const BASE = ((import.meta.env.VITE_MODELS_URL as string | undefined) ?? '/models/').replace(/\/?$/, '/');
const CACHE = 'anonimiza-models-v1';

const query = (f: FileMeta): string => `${f.file}?v=${f.sha256.slice(0, 12)}`;
/** Cache key: independent of which server the file came from. */
const cacheKey = (f: FileMeta): string => `/models/${query(f)}`;

async function openCache(): Promise<Cache | null> {
  try {
    return await caches.open(CACHE);
  } catch {
    return null; // private windows or blocked storage: keep working without persistence
  }
}

export async function isCached(f: FileMeta): Promise<boolean> {
  const cache = await openCache();
  return !!cache && !!(await cache.match(cacheKey(f)));
}

/** Delete every stored model file (Settings → "Borrar modelos descargados"). */
export async function clearCache(): Promise<void> {
  try {
    await caches.delete(CACHE);
  } catch {
    /* storage blocked: nothing to delete */
  }
}

/** Drop cached files that no longer belong to the catalogue (older exports). */
export async function pruneCache(): Promise<void> {
  const cache = await openCache();
  if (!cache) return;
  const keep = new Set(Object.values(MODEL_FILES).map((f) => new URL(cacheKey(f), location.origin).href));
  for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
}

async function download(f: FileMeta, onBytes: (loaded: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(BASE + query(f), { mode: 'cors', credentials: 'omit' });
  if (!res.ok || !res.body) throw new Error(t('No se pudo descargar {f} ({s})', { f: f.file, s: res.status }));
  const buf = new Uint8Array(f.bytes);
  const reader = res.body.getReader();
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.byteLength > f.bytes) throw new Error(`${f.file}: ${t('tamaño inesperado')}`);
    buf.set(value, loaded);
    loaded += value.byteLength;
    onBytes(loaded);
  }
  if (loaded !== f.bytes) throw new Error(`${f.file}: ${t('descarga incompleta ({a}/{b} bytes)', { a: loaded, b: f.bytes })}`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  const hex = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== f.sha256) throw new Error(`${f.file}: ${t('la huella SHA-256 no coincide')}`);
  return buf;
}

/** Download a model file (or read it from the browser cache), reporting bytes as they arrive. */
export async function fetchFile(f: FileMeta, onBytes: (loaded: number, cached: boolean) => void): Promise<Uint8Array> {
  const key = cacheKey(f);
  const cache = await openCache();
  const hit = await cache?.match(key);
  if (hit) {
    const buf = new Uint8Array(await hit.arrayBuffer());
    if (buf.byteLength === f.bytes) {
      onBytes(f.bytes, true);
      return buf;
    }
    await cache!.delete(key);
  }
  const buf = await download(f, (n) => onBytes(n, false));
  try {
    await cache?.put(key, new Response(buf, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(f.bytes) } }));
  } catch {
    // Quota exceeded: the model still runs this session, it just will not persist.
  }
  return buf;
}
