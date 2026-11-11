// Detections → stable markers → anonymised text, and markers → original values (restore).
// Everything here works on plain strings and lives only in memory.
import type { EntitySpan, ModelLabel } from './gliner.ts';
import type { RuleKind, RuleMatch } from './rules.ts';

export type Kind = 'person' | 'org' | 'address' | RuleKind | 'other';
export type Source = 'rule' | 'model' | 'repeat' | 'manual';

/** Display and marker order. */
export const KINDS: Kind[] = ['person', 'org', 'address', 'dni', 'nie', 'cif', 'nss', 'iban', 'card', 'phone', 'email', 'ip', 'birthdate', 'plate', 'other'];

export const MARKER_NAMES: Record<'es' | 'en', Record<Kind, string>> = {
  es: { person: 'PERSONA', org: 'ORGANIZACION', address: 'DIRECCION', dni: 'DNI', nie: 'NIE', cif: 'CIF', nss: 'NSS', iban: 'IBAN', card: 'TARJETA', phone: 'TELEFONO', email: 'EMAIL', ip: 'IP', birthdate: 'FECHA_NACIMIENTO', plate: 'MATRICULA', other: 'DATO' },
  en: { person: 'PERSON', org: 'ORGANIZATION', address: 'ADDRESS', dni: 'DNI', nie: 'NIE', cif: 'CIF', nss: 'SSN', iban: 'IBAN', card: 'CARD', phone: 'PHONE', email: 'EMAIL', ip: 'IP', birthdate: 'BIRTH_DATE', plate: 'PLATE', other: 'OTHER' },
};

const FROM_MODEL: Record<ModelLabel, Kind> = { person: 'person', organization: 'org', address: 'address' };
const STRUCTURED = new Set<Kind>(['dni', 'nie', 'cif', 'nss', 'iban', 'card', 'phone', 'ip', 'birthdate', 'plate']);

export interface Detection {
  id: number;
  start: number;
  end: number;
  kind: Kind;
  source: Source;
  score?: number;
  /** Right format but wrong check digit (a mistyped DNI, for instance): shown as doubtful in the review. */
  doubtful?: boolean;
  on: boolean;
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

/** The value a detection stands for: case, spacing and separators do not create a new marker. */
export function valueKey(kind: Kind, value: string): string {
  if (STRUCTURED.has(kind)) return value.replace(/[^0-9A-Za-z:]/g, '').toUpperCase().replace(/^(?:\+|00)?34(?=[6789]\d{8}$)/, '');
  return value.normalize('NFC').toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every other place where a value appears as whole words (the model can miss a repetition). */
function occurrences(text: string, value: string, flags = 'i'): { start: number; end: number }[] {
  const body = escapeRe(value.trim()).replace(/\s+/g, '\\s+');
  if (!body) return [];
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, `g${flags}u`);
  return [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'i', 'e', 'da', 'do', 'dos', 'das', 'van', 'von', 'di', 'le', 'el', 'al', 'ben', 'bin', 'abu']);

/**
 * Names and surnames that are also ordinary words. A part of a name in this list is searched only with
 * the capital it had ("Rosa", "Pilar"), so "rosa" the colour or "dolores de cabeza" stay as they are;
 * any other part is searched regardless of case ("etxeberria", "youssef").
 */
const COMMON_WORDS = new Set(`
  rosa ángel angel pilar dolores luz rocío rocio amparo consuelo mercedes esperanza blanca soledad paz león leon
  leal moreno rey prieto cordero sierra campo campos iglesias iglesia sol mar cruz flores flor castillo santos
  pastor guerra vega rico bueno nieto serrano romero gallego cano marín marin domingo lozano garrido caballero
  mora montes peña pena cabello duro bravo toro ramos fuentes fuente medina calvo delgado blanco rubio
  herrero molina vidal soler sanz salvador manzano olivo olivares parra lobo cuesta navarro aguilar gil moral
  pardo rojo rojas castaño palomo palomares conde duque obispo abad marqués marques príncipe principe infante
  piña nuevo viejo alegre benito bello bonito hermoso grande pequeño pequeno largo corto valiente franco
  justo clemente inocencio prudencio victoria gloria aurora alba estrella paloma azucena violeta margarita
  azul celeste milagros asunción asuncion concepción concepcion encarnación encarnacion purificación remedios
  socorro angustias trinidad rosario reyes nieves montserrat fe caridad jesús jesus
  salud ventura fortuna feliz dulce inmaculada candela lucero cielo río rio rivera ribera rivas riba arroyo
  lago laguna ríos mata matas monte montaña pinto pinos pino roble robles nogales olmo olmos fresno espino
  zarza rama ramas hoja viña vinas huerta huertas prado prados llano vallejo valle valles torre torres
  muro muros puerta puertas casas casa palacio palacios villa villar ciudad puente puentes calle plaza
  mayor menor rueda ruedas cuerda cuerdas barco barca nave naves molinos molino cabrera vaquero pastora
  herrera hierro plata oro cobre piedra piedras arenas arena tierra tierras campillo campos llamas fuego
  hoyos hoyo cueva cuevas lomas loma cerro cerros cabeza pinilla caña cañas vara varas sevilla toledo
  granada valencia león burgos soria murcia alicante cuenca segovia zamora ávila avila lugo navarra
  aragón aragon castilla galicia asturias cantabria andalucía andalucia mallorca menorca ibiza canarias
  madrid barcelona bilbao vitoria oviedo girona lleida tarragona tortosa
  amor gracia gracias cortés cortes leyva lirio jardín jardin martes lunes viernes sábado sabado enero
  mayo junio julio agosto abril marzo
  verde negro moreno pardo gordo calvo rubio delgado rizo tejero zapatero carpintero pintor cantero
  sastre ferrero ferrer herrador molinero panadero vaquero cabrero ovejero porquero guardia soldado
  cid cano rey reina conde príncipe papa
`.trim().split(/\s+/));

/**
 * Shorter forms of a full name that still point to the person: first name + first surname, and each
 * word on its own (common words only with their capital, so "Rosa" the name is not "rosa" the colour).
 */
export function nameParts(name: string): string[] {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return [];
  const out = new Set<string>();
  if (words.length >= 3 && !PARTICLES.has(words[1]!.toLowerCase())) out.add(`${words[0]} ${words[1]}`);
  for (const w of words) {
    const clean = w.replace(/[.,;:]+$/, '');
    if (clean.length < 3 || !/^\p{L}[\p{L}'’-]*$/u.test(clean) || PARTICLES.has(clean.toLowerCase())) continue;
    // A common word written in lower case inside the name gives nothing safe to search for.
    if (isCommonWord(clean) && !/^\p{Lu}/u.test(clean)) continue;
    out.add(clean);
  }
  return [...out];
}

export const isCommonWord = (w: string) => COMMON_WORDS.has(w.toLocaleLowerCase('es'));

/** Merge rule matches and model entities, then extend every value to all its occurrences. */
export function buildDetections(text: string, rules: RuleMatch[], entities: EntitySpan[], manual: { start: number; end: number; kind: Kind }[] = []): Detection[] {
  let id = 0;
  const dets: Detection[] = [];
  const add = (start: number, end: number, kind: Kind, source: Source, score?: number, doubtful?: boolean) => {
    if (end <= start || dets.some((d) => overlaps(d, { start, end }))) return false;
    dets.push({ id: ++id, start, end, kind, source, score, on: true, ...(doubtful ? { doubtful } : {}) });
    return true;
  };
  // Manual choices first: the user's word beats any automatic guess.
  for (const m of manual) add(m.start, m.end, m.kind, 'manual');
  for (const r of rules) add(r.start, r.end, r.kind, 'rule', undefined, r.doubtful);
  for (const e of entities) {
    // Trim punctuation the model sometimes keeps at the edges.
    let { start, end } = e;
    while (start < end && /[\s.,;:()«»"'“”]/.test(text[start]!)) start++;
    while (end > start && /[\s,;:()«»"'“”]/.test(text[end - 1]!)) end--;
    add(start, end, FROM_MODEL[e.label], 'model', e.score);
  }
  for (const d of [...dets]) {
    if (d.source === 'rule') continue;
    const value = text.slice(d.start, d.end);
    if (value.trim().length < 2) continue;
    for (const o of occurrences(text, value)) add(o.start, o.end, d.kind, 'repeat');
  }
  // People are often mentioned again by part of their name, even in lower case: "Javier Molina Ortega" →
  // "Javier Molina", "Sr. Molina", "javier". Parts that are ordinary words keep their capital.
  for (const d of [...dets]) {
    if (d.kind !== 'person' || d.source === 'repeat') continue;
    for (const v of nameParts(text.slice(d.start, d.end))) {
      const exact = !v.includes(' ') && isCommonWord(v);
      for (const o of occurrences(text, v, exact ? '' : 'i')) add(o.start, o.end, 'person', 'repeat');
    }
  }
  return dets.sort((a, b) => a.start - b.start);
}

export interface Assignment {
  /** Marker of each detection, by detection id. */
  byId: Map<number, string>;
  /** Marker → original text (the longest form seen), for restoring. */
  table: Map<string, string>;
}

/**
 * Numbers markers per kind in order of first appearance; the same value always gets the same marker.
 * A shorter person name contained in exactly one longer one ("Lucía Herrero" in "Lucía Herrero Campos")
 * shares its marker, so the text keeps saying it is the same person.
 */
export function assignMarkers(text: string, dets: Detection[], lang: 'es' | 'en'): Assignment {
  // Every detection gets a marker, active or not: switching one off must not renumber the others.
  const active = [...dets].sort((a, b) => a.start - b.start);
  const keyOf = new Map<number, string>();
  for (const d of active) keyOf.set(d.id, `${d.kind}\u0000${valueKey(d.kind, text.slice(d.start, d.end))}`);

  // Link partial person names to the single longer name that contains them.
  const people = [...new Set(active.filter((d) => d.kind === 'person').map((d) => keyOf.get(d.id)!))];
  const words = (k: string) => k.split('\u0000')[1]!.split(' ');
  const canonical = new Map<string, string>();
  for (const k of people) {
    const w = words(k);
    const longer = people.filter((o) => o !== k && words(o).length > w.length && containsRun(words(o), w));
    const roots = new Set(longer.filter((o) => !people.some((p) => p !== o && words(p).length > words(o).length && containsRun(words(p), words(o)))));
    canonical.set(k, roots.size === 1 ? [...roots][0]! : k);
  }

  const counters = new Map<Kind, number>();
  const markerOfKey = new Map<string, string>();
  const byId = new Map<number, string>();
  const table = new Map<string, string>();
  const names = MARKER_NAMES[lang];
  for (const d of active) {
    let k = keyOf.get(d.id)!;
    if (d.kind === 'person') k = canonical.get(k) ?? k;
    let marker = markerOfKey.get(k);
    if (!marker) {
      const n = (counters.get(d.kind) ?? 0) + 1;
      counters.set(d.kind, n);
      marker = `[${names[d.kind]}_${n}]`;
      markerOfKey.set(k, marker);
    }
    byId.set(d.id, marker);
    const value = text.slice(d.start, d.end);
    const prev = table.get(marker);
    if (!prev || value.length > prev.length) table.set(marker, value);
  }
  return { byId, table };
}

function containsRun(hay: string[], needle: string[]): boolean {
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((w, j) => hay[i + j] === w)) return true;
  return false;
}

/**
 * True when a value ending in a dot ("S.L.", "Sra.") also closes the sentence: end of text, end of line,
 * or a capital after the space. The marker then keeps that full stop after it.
 */
export function dotEndsSentence(text: string, d: { end: number }): boolean {
  if (text[d.end - 1] !== '.' || text[d.end - 2] === '.') return false;
  const after = text.slice(d.end, d.end + 3);
  return after === '' || /^\s*(?:\n|$)|^ +["«(]?\p{Lu}/u.test(after);
}

/** Replace every active detection by its marker. */
export function applyMarkers(text: string, dets: Detection[], byId: Map<number, string>): string {
  let out = '';
  let pos = 0;
  for (const d of [...dets].filter((x) => x.on).sort((a, b) => a.start - b.start)) {
    out += text.slice(pos, d.start) + byId.get(d.id)! + (dotEndsSentence(text, d) ? '.' : '');
    pos = d.end;
  }
  return out + text.slice(pos);
}

export interface Restored {
  text: string;
  replaced: number;
  /** Markers in the text that are not in the table (for instance, invented by the AI). */
  unknown: string[];
  /** Markers of the table that never appeared. */
  unused: string[];
}

/**
 * Put the original values back. Tolerates what chat assistants tend to do with markers: change the case,
 * drop the brackets, or write a space instead of the underscore.
 */
export function restore(text: string, table: Map<string, string>): Restored {
  const byName = new Map<string, string>();
  for (const [m, v] of table) byName.set(m.slice(1, -1).toUpperCase(), v);
  const used = new Set<string>();
  const unknown = new Set<string>();
  let replaced = 0;
  // Marker names may contain underscores themselves (FECHA_NACIMIENTO_1).
  const re = /\[\s*(\p{L}+(?:[ _]\p{L}+)*)[ _-]?(\d+)\s*\]|(?<![\p{L}\p{N}_])(\p{L}+(?:_\p{L}+)*)_(\d+)(?![\p{L}\p{N}_])/gu;
  let out = '';
  let pos = 0;
  for (const m of text.matchAll(re)) {
    const [all, a, an, b, bn] = m;
    const name = `${(a ?? b)!.toUpperCase().replace(/ /g, '_')}_${an ?? bn}`;
    const v = byName.get(name);
    out += text.slice(pos, m.index);
    pos = m.index + all.length;
    if (v === undefined) {
      if (a) unknown.add(all);
      out += all;
      continue;
    }
    used.add(name);
    replaced++;
    out += v;
    // "S.L." restored before the full stop the marker kept: one dot is enough.
    if (v.endsWith('.') && text[pos] === '.' && text[pos + 1] !== '.') pos++;
  }
  out += text.slice(pos);
  const unused = [...table.keys()].filter((m) => !used.has(m.slice(1, -1).toUpperCase()));
  return { text: out, replaced, unknown: [...unknown], unused };
}
