// Structured identifiers found with regular expressions and, where the format has one, a check digit.
// A number that fails its check digit is usually not reported, which keeps codes, amounts and references
// out. The exceptions are formats specific enough to be a mistyped identifier rather than something else
// (a DNI or NIE with the wrong letter, an IBAN of the right length): those are reported as doubtful.

export type RuleKind = 'address' | 'email' | 'iban' | 'card' | 'dni' | 'nie' | 'cif' | 'nss' | 'phone' | 'ip' | 'birthdate' | 'plate' | 'ref';

export interface RuleMatch {
  start: number;
  end: number;
  kind: RuleKind;
  /** Right format, wrong check digit: probably a mistyped identifier. */
  doubtful?: boolean;
}

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const digitsOnly = (s: string) => s.replace(/[^0-9A-Za-z]/g, '').toUpperCase();

export function validDni(raw: string): boolean {
  const s = digitsOnly(raw);
  const m = /^(\d{8})([A-Z])$/.exec(s);
  return !!m && DNI_LETTERS[Number(m[1]) % 23] === m[2];
}

export function validNie(raw: string): boolean {
  const s = digitsOnly(raw);
  const m = /^([XYZ])(\d{7})([A-Z])$/.exec(s);
  if (!m) return false;
  const n = Number(String('XYZ'.indexOf(m[1]!)) + m[2]);
  return DNI_LETTERS[n % 23] === m[3];
}

/** CIF / NIF of a legal entity: letter + 7 digits + control digit or letter. */
export function validCif(raw: string): boolean {
  const s = digitsOnly(raw);
  const m = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(s);
  if (!m) return false;
  const d = m[2]!;
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    let x = Number(d[i]);
    if (i % 2 === 0) {
      x *= 2;
      x = Math.floor(x / 10) + (x % 10);
    }
    sum += x;
  }
  const c = (10 - (sum % 10)) % 10;
  const ctl = m[3]!;
  const letter = 'JABCDEFGHI'[c]!;
  // Some entity types must use a letter, others a digit; accept both forms where the law allows either.
  if ('PQRSW'.includes(m[1]!) || d.startsWith('00')) return ctl === letter;
  if ('ABEH'.includes(m[1]!)) return ctl === String(c);
  return ctl === String(c) || ctl === letter;
}

/** Spanish social security number (12 digits: province, number, mod-97 control). */
export function validNss(raw: string): boolean {
  const s = raw.replace(/\D/g, '');
  if (s.length !== 12) return false;
  const a = Number(s.slice(0, 2));
  const b = Number(s.slice(2, 10));
  const c = Number(s.slice(10));
  if (a < 1 || a > 53) return false;
  const base = b < 10_000_000 ? b + a * 10_000_000 : Number(`${a}${s.slice(2, 10)}`);
  return base % 97 === c;
}

export function luhn(raw: string): boolean {
  const s = raw.replace(/\D/g, '');
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    let x = Number(s[s.length - 1 - i]);
    if (i % 2 === 1) {
      x *= 2;
      if (x > 9) x -= 9;
    }
    sum += x;
  }
  return sum % 10 === 0;
}

// IBAN length by country (SWIFT registry), for the countries most likely to appear in Spanish texts and the rest of SEPA.
const IBAN_LEN: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GI: 23, GR: 27,
  HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24,
  SE: 24, SI: 19, SK: 24, SM: 27, VA: 22, AR: 0, MA: 28, BR: 29, TR: 26, MX: 0, AE: 23, SA: 24, QA: 29,
};

export function validIban(raw: string): boolean {
  const s = raw.replace(/[\s-]/g, '').toUpperCase(); // PDFs may wrap a number onto the next line
  const len = IBAN_LEN[s.slice(0, 2)];
  if (!len || s.length !== len || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of moved) {
    const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rem = (rem * 10 + Number(d)) % 97;
  }
  return rem === 1;
}

function validIpv4(s: string): boolean {
  const parts = s.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255 && !(p.length > 1 && p.startsWith('0')));
}

function validIpv6(s: string): boolean {
  if ((s.match(/::/g) ?? []).length > 1) return false;
  const groups = s.split(':');
  if (s.includes('::')) return groups.length <= 8 && groups.filter(Boolean).every((g) => /^[0-9a-f]{1,4}$/i.test(g)) && groups.filter(Boolean).length >= 2;
  return groups.length === 8 && groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g));
}

interface Rule {
  kind: RuleKind;
  re: RegExp;
  valid?(text: string): boolean;
  /** When valid() fails: report the match anyway, flagged as doubtful, if this returns true. */
  doubtful?(match: string, text: string, start: number): boolean;
  /** Reject a match whose surroundings say it is something else. */
  reject?(text: string, start: number, end: number): boolean;
}

// No digit, letter or separator-plus-digit right before or after: a match must not be a slice of a longer code.
const B = String.raw`(?<![\p{L}\p{N}])`;
const E = String.raw`(?![\p{L}\p{N}])`;
const NB = String.raw`(?<![\p{L}\p{N}]|\d[ .\-/])`;
const NE = String.raw`(?![\p{L}\p{N}]|[ .\-/]\d)`;
const re = (s: string, flags = 'giu') => new RegExp(s, flags);
// A separator inside a number, or a line break where a PDF or a table cell wrapped it ("670-071-⏎788", "B-⏎52.783.370").
const S = String.raw`(?:[ .\-]\n?|\n)`;
const SID = String.raw`(?:[ \-]\n?|\n)`;

/** A wrong DNI/NIE letter is a typo only if the letter is attached ("48213907K", "48213907-K") or a capital. */
const idTypo = (s: string) => !/\s[a-z]$/.test(s);
/** "… 83639138 y domicilio": a lower-case letter after a space, followed by more words, is the conjunction, not a DNI letter. */
const conjunction = (t: string, _s: number, e: number) => /\s[a-zñ]$/.test(t.slice(e - 2, e)) && /^[^\S\n]+\p{L}/u.test(t.slice(e, e + 3));

// Spanish number plates. Current format: 4 digits + 3 consonants (no vowels, Ñ or Q). Lower case is
// accepted only without a space ("4821klm"), and units or currencies that fit the pattern are not plates.
const NOT_PLATE = new Set(['MHZ', 'GHZ', 'KHZ', 'RPM', 'PDF', 'PNG', 'JPG', 'SVG', 'BMP', 'MKV', 'MPG', 'GBP', 'CHF', 'CZK', 'DKK', 'PLN', 'HKD', 'NZD', 'SGD', 'CNY', 'KRW', 'MXN', 'BRL', 'KWH', 'MWH', 'GWH', 'KBPS', 'MBPS', 'BPM', 'FPS', 'DPI', 'PPM', 'CCC', 'XXX', 'BMW', 'BBC', 'CNN', 'NBC', 'PSG', 'DGT', 'RTV', 'PVP', 'KMH']);
const PROVINCES = 'A|AB|AL|AV|B|BA|BI|BU|C|CA|CC|CE|CO|CR|CS|CU|GC|GE|GI|GR|GU|H|HU|IB|J|L|LE|LO|LU|M|MA|ML|MU|NA|O|OR|OU|P|PM|PO|S|SA|SE|SG|SO|SS|T|TE|TF|TO|V|VA|VI|Z|ZA';

// Dates of birth: a date shortly after a word that says so ("nacida el", "fecha de nacimiento:", "F. nac.").
// Other dates are not personal on their own and stay.
const MONTHS = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december|ene|feb|mar|abr|jun|jul|ago|sep|sept|oct|nov|dic|jan|apr|aug|dec';
const DATE = String.raw`(?:\d{1,2}[\/.\-](?:${MONTHS})\.?[\/.\-](?:\d{4}|\d{2})|\d{1,2}[\/.\-]\d{1,2}[\/.\-](?:\d{4}|\d{2})|\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}|\d{1,2}(?:\s+de)?\s+(?:${MONTHS})\.?(?:\s+(?:de|del)\s+|\s+|,\s*)\d{4}|(?:${MONTHS})\.?\s+\d{1,2},?\s+\d{4})`;
const BIRTH_CUE = String.raw`(?:nacid[oa]s?|naci[óo]|nacimiento|nacemento|f(?:echa|ec)?\.?\s*(?:de\s+)?nac(?:\.|imiento)?|nac\.|f\s?\/\s?nac(?:\.|imiento)?|f\.\s*n\.|born|date\s+of\s+birth|d\.?o\.?b\.?|data\s+de\s+naixement|nascut|nascuda|jaiotze\s+data)`;
const BIRTH_RE = new RegExp(String.raw`${B}${BIRTH_CUE}(?![\p{L}])[^\n\d]{0,40}?(?:\n[^\n\d]{0,12})?(${DATE}|(?<=\b(?:en|in)\s+(?:el\s+año\s+)?)\d{4})${E}`, 'giud');

/** Case-insensitive letters for a pattern used without the i flag (the code itself must keep its case). */
const ci = (p: string) =>
  p.replace(/\\p\{[^}]+\}|\\.|\[[^\]]*\]|[a-zñáéíóúò]/g, (c) =>
    c.startsWith('[') ? c.slice(0, -1) + c.slice(1, -1).replace(/\\.|[^a-zñáéíóúò]/g, '').toUpperCase() + ']' : c.length > 1 ? c : `[${c}${c.toUpperCase()}]`,
  );
// Other identifiers (case, medical record, policy, membership, passport, user name…) have no format of
// their own: they are recognised by the word that announces them ("NHC:", "Nº expediente", "póliza nº",
// "user=") followed by a code with at least one digit. A word that only means "number" is not enough.
const REF_CUE = String.raw`(?:n\.?\s?h\.?\s?c|historia(?:l)?(?:\s+cl[ií]nica)?|h\.\s?cl[ií]nica|cipa?|nass|nuhsa|tis|tarjeta|tarxeta|targeta|afiliaci[oó]n|afiliad[oa]|episodio|epis\.|colegiad[oa]|col\.|col|expediente|expedient|exp(?:te)?\.|atestado|diligencias|procedimiento|autos|p[oó]liza|p[oò]lissa|contrato|siniestro|referencia|ref\.|incidencia|pedido|localizador|reserva|cliente|abonado|socio|soci|pasaporte|passaport|passport|carn[eé]t?|placa|t\.?i\.?p\.?|sip|licencia|microchip|chip|empleado|trabajador|matr[ií]cula\s+escolar|id|mrn|patient\s+id)`;
const REF_BEFORE = new RegExp(String.raw`${B}${ci(REF_CUE)}(?![\p{L}])[^\n]{0,14}$`, 'u');
const REF_NUM = String.raw`(?:n\.?\s?[º°o]\.?|n[uú]m(?:ero)?\.?|number|no\.|#)`;
const REF_TOKEN = String.raw`[\p{L}\p{N}]+(?:[.\-\/_][\p{L}\p{N}]+)*`;
const REF_RE = new RegExp(
  String.raw`${B}(?:${ci(REF_NUM)}\s*(?:de\s+)?)?${ci(REF_CUE)}(?![\p{L}])((?:(?:[^\S\n]+|[^\S\n]*\n[^\S\n]*)(?:de|del|la|las|los|el|su|\p{Ll}{3,20}|\p{Lu}{2,5})){0,4}?)` +
    String.raw`(\.?[^\S\n]*(?:[:=#]|(?:con\s+)?${ci(REF_NUM)})?[^\S\n]*(?:[:=#][^\S\n]*)?(?:\n[^\S\n]*)?)` +
    String.raw`((?:(?=[\p{L}\p{N}.\-\/_]*\d)${REF_TOKEN}|[A-Z]{2,5}(?= [A-Z\d]))(?: (?:\d[\p{L}\p{N}]*(?:[.\-\/_][\p{L}\p{N}]+)*|[A-Z]{2,5}(?= [A-Z\d])))*)${E}`,
  'gud',
);
// User names after "user=", "usuario:", "@": no digit needed, but they must look like a handle.
const USER_RE = /(?<![\p{L}\p{N}])(?:user(?:name)?|usuari[oa]?|login|alias|nick)(\s*[:=]\s*|\s+)([\p{L}\p{N}][\p{L}\p{N}._\-]*[\p{L}\p{N}])(?![\p{L}\p{N}@])/giud;
// The same after a longer label that ends in a colon: "Usuario de VPN asignado a la jefa de proyecto: lbenitez.ext".
const USER_LONG_RE = /(?<![\p{L}\p{N}])(?:user(?:name)?|usuari[oa]?|login|alias|nick)([^\S\n][^\n:=]{1,50}[:=][^\S\n]*)([\p{L}\p{N}][\p{L}\p{N}._\-]*[\p{L}\p{N}])(?![\p{L}\p{N}@])/giud;
const MENTION_RE = /(?<![\p{L}\p{N}._%+\-@])@([\p{L}\p{N}_][\p{L}\p{N}_.]*[\p{L}\p{N}_])(?![\p{L}\p{N}@])/gud;
// A handle at the start of a line, in chats and forums: "jordi.p: …", "lolaB_1979 escribió:".
const SPEAKER_RE = /^[^\S\n]*([\p{L}\p{N}]+(?:[._][\p{L}\p{N}]+)+|[\p{L}]+\d+|\p{Ll}+\p{Lu}[\p{L}\p{N}]*)(?=:\s|\s+escribi[óo]:?|\s+wrote:?)/gmud;

const LIST_MORE = /^(?:[^\S\n]*,|[^\S\n]+(?:y|e|o|and))[^\S\n]+(\p{N}[\p{L}\p{N}.\-\/]*)(?![\p{L}\p{N}])/u;
const DATE_ONLY = new RegExp(String.raw`^${DATE}$`, 'iu');

/** EAN-13 / EAN-8 barcodes: product references, not a person's. */
function validEan(v: string): boolean {
  if (!/^(?:\d{8}|\d{13})$/.test(v)) return false;
  const d = [...v].map(Number);
  const sum = d.slice(0, -1).reverse().reduce((a, x, i) => a + x * (i % 2 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === d.at(-1);
}

function refValue(cue: string, between: string, cueSep: string, v: string): boolean {
  if (!/\d/.test(v) || DATE_ONLY.test(v) || validEan(v)) return false;
  const marked = /[:=#º°]|n[uú]m|number|no\./i.test(cueSep);
  // More than two words between the cue and the value ("póliza de responsabilidad civil profesional nº …",
  // "Referencia de la devolución: …") only with a colon or a "nº" right before the value.
  if (between.trim().split(/\s+/).filter(Boolean).length > 2 && !marked) return false;
  // A product, model or article reference names a thing, not a person.
  if (/producto|art[ií]culo|modelo|pieza|product|item/i.test(cue)) return false;
  // A bare 13-digit number after "Ref." is a barcode even when its check digit is off.
  if (/^ref/i.test(cue.trim()) && /^\d{13}$/.test(v)) return false;
  const alnum = v.replace(/[^\p{L}\p{N}]/gu, '');
  // A bare number right after the word ("pedido 2000 unidades") needs a separator or more digits.
  // Badge, membership and professional numbers are short but still a person's: «carné profesional 4417».
  const badge = /carn|col|placa|t\.?i\.?p|pasaport|passport/i.test(cue) && /^\d{4}$/.test(alnum) && !/^(?:19|20)\d\d$/.test(alnum);
  if (!marked && !badge && alnum.length < 5 && !/\p{L}/u.test(alnum)) return false;
  return alnum.length >= 2;
}

/** User names need something that makes them a handle, not a word: a digit, a dot, an underscore, camelCase, or "=" / ":" before a lower-case word. */
// "Usuaria: Josefa Martín" is a person, not a user name: a plain word must be all lower case.
const handleLike = (sep: string, v: string) => /[\d._]/.test(v) || /\p{Ll}\p{Lu}/u.test(v) || (/[:=]/.test(sep) && v.length >= 3 && /^\p{Ll}+$/u.test(v));

const PHONE_CUE = /(?:tel[eé]?f?|tlf|tfno|m[oó]vil|fijo|llam|n[uú]mero|whatsapp|phone|cel)[^\n\d]{0,14}$/i;

// Postal addresses written in full: a street type, a name, a number and, on the same line, a five-digit postal
// code with its town ("Calle de Alcalá, 120, 4.ª planta, 28009 Madrid"). Without the postal code they are left
// to the model.
const STREET = String.raw`(?:calle|c\/|avda\.|avenida|av\.|plaza|pza\.|pl\.|paseo|p[ºo°]\.?|ronda|r[uú]a|carrer|carretera|ctra\.|camino|traves[ií]a|glorieta|urbanizaci[oó]n|urb\.|pasaje|v[ií]a|pol[ií]gono|cuesta|bulevar|rambla|passeig|avinguda|pla[cç]a|kalea|etorbidea)`;
const TOWN = String.raw`\p{Lu}[\p{L}'’\-]+(?:[^\S\n]+(?:(?:de|del|la|las|los|el|d'|i|y|e)[^\S\n]+)?\p{Lu}[\p{L}'’\-]+)*(?:[^\S\n]*\([\p{L} ]+\))?`;
const ADDRESS_RE = new RegExp(String.raw`${B}${ci(STREET)}[^\S\n]+[^\n,;]{2,60}?,?[^\S\n]*(?:n[º°.]?[^\S\n]*)?\d{1,4}(?![\d])(?:[^\n]|\n(?!\n)){0,60}?(?<!\d)\d{5}(?:[^\S\n]+|[^\S\n]*\n[^\S\n]*)${TOWN}`, 'gu');

/** True when one of these words comes shortly before position `st` on the same line ("CIF de la empresa: …"). */
const announced = (cue: string) => {
  const r = new RegExp(String.raw`(?<![\p{L}])(?:${cue})(?![\p{L}])[^\n\d]{0,25}$`, 'iu');
  return (t: string, st: number) => r.test(t.slice(Math.max(0, st - 45), st));
};
// With the word that announces it, a value of the right shape is hidden even when its check digit fails: it is
// most likely mistyped, and leaving it visible is the worse mistake. It is shown as doubtful.
const CIF_CUE = announced(String.raw`c\.?\s?i\.?\s?f|n\.?\s?i\.?\s?f`);
const NSS_CUE = announced(String.raw`n\.?\s?s\.?\s?s|nuss|naf|seguridad\s+social|seg\.\s?social|afiliaci[oó]n|s\.\s?s\.?`);
const DNI_CUE = announced(String.raw`d\.?\s?n\.?\s?i|n\.?\s?i\.?\s?f|documento(?:\s+nacional)?(?:\s+de\s+identidad)?`);
const CARD_CUE = announced(String.raw`tarjeta|targeta|tarxeta|card|visa|mastercard|amex`);

// Order matters: earlier rules win when two matches overlap (an IBAN contains digits that look like a phone).
const RULES: Rule[] = [
  { kind: 'email', re: re(String.raw`${B}[\p{L}\p{N}._%+\-]+@[\p{L}\p{N}\-]+(?:\.[\p{L}\p{N}\-]+)*\.\p{L}{2,}${E}`) },
  // An IBAN of the right length for its country with a wrong check is a mistyped account, not a code.
  { kind: 'iban', re: re(String.raw`${B}[A-Z]{2}\d{2}(?:${SID}?[A-Z0-9]){10,30}`), valid: validIban, doubtful: (s) => /^[A-Z]{2}\d{2}/.test(s) },
  // A card number written in four groups of four with a wrong Luhn digit is still most likely a card.
  { kind: 'card', re: re(String.raw`${NB}(?:\d${SID}?){12,18}\d${NE}`), valid: (s) => cardPrefix(s) && luhn(s), doubtful: (s, t, st) => (cardPrefix(s) && /^\d{4}([ \-])\d{4}\1\d{4}\1\d{4}$/.test(s)) || (CARD_CUE(t, st) && /^\d{13,19}$/.test(s.replace(/\D/g, ''))) },
  // A CIF with a wrong control character is still reported, as doubtful, when the word "CIF" or "NIF" announces it.
  // Before DNI: in "B-83639138 y" the digits and the next word would also make a valid DNI.
  { kind: 'cif', re: re(String.raw`${B}[ABCDEFGHJNPQRSUVW]${SID}?\d{2}\.?\d{3}\.?\d{2}${SID}?[0-9A-J]${E}`), valid: validCif, doubtful: (_s, t, st) => CIF_CUE(t, st) },
  { kind: 'nie', re: re(String.raw`${B}[XYZ]${SID}?\d{7}${SID}?[A-Z]${E}`), valid: validNie, doubtful: idTypo, reject: conjunction },
  { kind: 'dni', re: re(String.raw`${B}\d{2}\.?\d{3}\.?\d{3}${SID}?[A-Z]${E}`), valid: validDni, doubtful: idTypo, reject: conjunction },
  // A DNI without its letter, when the word says so ("DNI 12.345.678").
  { kind: 'dni', re: re(String.raw`${NB}\d{2}\.?\d{3}\.?\d{3}${NE}`), valid: () => false, doubtful: (_s, t, st) => DNI_CUE(t, st) },
  { kind: 'nss', re: re(String.raw`${NB}\d{2}(?:[ /\-]\n?|\n)?\d{8}(?:[ /\-]\n?|\n)?\d{2}${NE}`), valid: validNss, doubtful: (_s, t, st) => NSS_CUE(t, st) },
  { kind: 'plate', re: re(String.raw`${NB}\d{4}(?:${SID}?[BCDFGHJKLMNPRSTVWXYZ]{3}|[BCDFGHJKLMNPRSTVWXYZbcdfghjklmnprstvwxyz]{3}|-[bcdfghjklmnprstvwxyz]{3})${E}`, 'gu'), valid: (s) => !NOT_PLATE.has(s.slice(-3).toUpperCase()) },
  { kind: 'plate', re: re(String.raw`${B}(?:${PROVINCES})[ \-]?\d{4}[ \-]?[A-Z]{1,2}${E}`, 'gu'), reject: (t, s) => /\d[ .\-\/]?$/.test(t.slice(Math.max(0, s - 2), s)) },
  { kind: 'ip', re: re(String.raw`${B}(?:\d{1,3}\.){3}\d{1,3}${E}`), valid: validIpv4 },
  { kind: 'ip', re: re(String.raw`(?<![\p{L}\p{N}:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\p{L}\p{N}:])`), valid: validIpv6 },
  // Spanish numbers: optional +34 / 0034, then 9 digits starting with 6, 7, 8 or 9, written whole or in the usual
  // groups (3-3-3, 3-2-2-2, 2-3-2-2). Other groupings are usually policy, order or case numbers.
  { kind: 'phone', re: re(String.raw`${NB}(?:\(?(?:\+|00)34\)?[ .\-]?)?(?:[6789]\d{8}|\(?[6789]\d{2}\)?${S}\d{3}${S}\d{3}|\(?[6789]\d{2}\)?${S}\d{2}${S}\d{2}${S}\d{2}|\(?[6789]\d\)?${S}\d{3}${S}\d{2}${S}\d{2})${NE}`) },
  // Mobiles split in unusual groups ("631 77 8 90 21", "6 1 7 0 8 9 2 4 3", "644 - 019 - 237"): nine digits
  // starting with 6 or 7 are a phone however they are written. Landlines (8, 9) only after a word that says so.
  { kind: 'phone', re: re(String.raw`${NB}(?:(?:\+|00)34[ .\-]?)?[67](?:(?:[ .]|[^\S\n]?-[^\S\n]?|-\n)?\d){8}${NE}`), reject: (t, s) => REF_BEFORE.test(t.slice(Math.max(0, s - 30), s)) },
  { kind: 'phone', re: re(String.raw`${NB}(?:(?:\+|00)34[ .\-]?)?[89](?:(?:[ .]|[^\S\n]?-[^\S\n]?)?\d){8}${NE}`), reject: (t, s) => !PHONE_CUE.test(t.slice(Math.max(0, s - 30), s)) },
  // Other countries, only with an explicit international prefix.
  { kind: 'phone', re: re(String.raw`(?<![\p{L}\p{N}+])(?:\+|00)(?!34)[1-9]\d{0,2}(?:[ .\-]?\(?\d\)?){6,13}${NE}`), reject: (t, s) => !t.startsWith('+', s) && REF_BEFORE.test(t.slice(Math.max(0, s - 30), s)) },
];

/**
 * IBANs are matched greedily (they may be written in groups of four), so the candidate is trimmed to
 * the length its country requires before checking it.
 */
function trimIban(text: string, start: number, end: number): number | null {
  const cc = text.slice(start, start + 2).toUpperCase();
  const len = IBAN_LEN[cc];
  if (!len) return null;
  let n = 0;
  for (let i = start; i < end; i++) {
    if (/[A-Za-z0-9]/.test(text[i]!)) n++;
    if (n === len) {
      // The IBAN must not continue straight into more letters or digits.
      if (/[\p{L}\p{N}]/u.test(text[i + 1] ?? '')) return null;
      return i + 1;
    }
  }
  return null;
}

const cardPrefix = (s: string) => /^(?:4|5[1-5]|2[2-7]|3[47]|6)/.test(s.replace(/\D/g, ''));

export function findRules(input: string): RuleMatch[] {
  // Non-breaking and thin spaces (Word, PDF) count as spaces; one code unit each, so positions do not move.
  const text = input.replace(/[\u00a0\u2007\u2009\u200a\u202f]/g, ' ');
  const taken = new Uint8Array(text.length);
  const out: RuleMatch[] = [];
  // Dates of birth first: "14/03/1987" must not be read as anything else.
  BIRTH_RE.lastIndex = 0;
  for (const m of text.matchAll(BIRTH_RE)) {
    const [start, end] = m.indices![1]!;
    if (taken.subarray(start, end).some((x) => x)) continue;
    taken.fill(1, start, end);
    out.push({ start, end, kind: 'birthdate' });
  }
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    for (const m of text.matchAll(rule.re)) {
      const start = m.index;
      let end = start + m[0].length;
      if (rule.kind === 'iban') {
        const e = trimIban(text, start, end);
        if (e === null) continue;
        end = e;
      }
      const s = text.slice(start, end);
      let doubtful = false;
      if (rule.valid && !rule.valid(s)) {
        if (!rule.doubtful?.(s, text, start)) continue;
        doubtful = true;
      }
      if (rule.reject?.(text, start, end)) continue;
      if (taken.subarray(start, end).some((x) => x)) continue;
      taken.fill(1, start, end);
      out.push(doubtful ? { start, end, kind: rule.kind, doubtful } : { start, end, kind: rule.kind });
    }
  }
  const take = (start: number, end: number, kind: RuleKind = 'ref') => {
    if (end <= start || taken.subarray(start, end).some((x) => x)) return;
    taken.fill(1, start, end);
    out.push({ start, end, kind });
  };
  for (const m of text.matchAll(ADDRESS_RE)) take(m.index, m.index + m[0].length, 'address');
  for (const m of text.matchAll(REF_RE)) {
    if (!refValue(m[0].slice(0, m.indices![1]![0] - m.index), m[1]!, m[2]!, m[3]!)) continue;
    let end = m.indices![3]![1];
    take(...m.indices![3]!);
    // A list of them: «carné profesional 4417 y 5208».
    const len = m[3]!.replace(/[^\p{L}\p{N}]/gu, '').length;
    for (let n; (n = LIST_MORE.exec(text.slice(end, end + 40))); ) {
      const v = n[1]!;
      if (Math.abs(v.replace(/[^\p{L}\p{N}]/gu, '').length - len) > 2) break;
      const s = end + n[0].length - v.length;
      take(s, s + v.length);
      end = s + v.length;
    }
  }
  for (const m of [...text.matchAll(USER_RE), ...text.matchAll(USER_LONG_RE)]) {
    const sep = m[1]!, v = m[2]!;
    // After a long label only something that is clearly a handle (digit, dot, underscore, camelCase).
    const ok = /[^\s:=]/.test(sep) && sep.length > 3 ? /[\d._]/.test(v) || /\p{Ll}\p{Lu}/u.test(v) : handleLike(sep, v);
    if (ok && !/^(?:de|del|la|el|que|con|para|y|o)$/i.test(v)) take(...m.indices![2]!);
  }
  for (const m of text.matchAll(MENTION_RE)) take(m.index, m.indices![1]![1]);
  for (const m of text.matchAll(SPEAKER_RE)) take(...m.indices![1]!);
  return out.sort((a, b) => a.start - b.start);
}
