// Structured identifiers found with regular expressions and, where the format has one, a check digit.
// A number that fails its check digit is not reported: that keeps codes, amounts and references out.

export type RuleKind = 'email' | 'iban' | 'card' | 'dni' | 'nie' | 'cif' | 'nss' | 'phone' | 'ip';

export interface RuleMatch {
  start: number;
  end: number;
  kind: RuleKind;
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
}

// No digit, letter or separator-plus-digit right before or after: a match must not be a slice of a longer code.
const B = String.raw`(?<![\p{L}\p{N}])`;
const E = String.raw`(?![\p{L}\p{N}])`;
const NB = String.raw`(?<![\p{L}\p{N}]|\d[ .\-/])`;
const NE = String.raw`(?![\p{L}\p{N}]|[ .\-/]\d)`;
const re = (s: string) => new RegExp(s, 'giu');

// Order matters: earlier rules win when two matches overlap (an IBAN contains digits that look like a phone).
const RULES: Rule[] = [
  { kind: 'email', re: re(String.raw`${B}[\p{L}\p{N}._%+\-]+@[\p{L}\p{N}\-]+(?:\.[\p{L}\p{N}\-]+)*\.\p{L}{2,}${E}`) },
  { kind: 'iban', re: re(String.raw`${B}[A-Z]{2}\d{2}(?:[ \-\n]?[A-Z0-9]){10,30}`), valid: validIban },
  { kind: 'card', re: re(String.raw`${NB}(?:\d[ \-\n]?){12,18}\d${NE}`), valid: (s) => /^(?:4|5[1-5]|2[2-7]|3[47]|6)/.test(s.replace(/\D/g, '')) && luhn(s) },
  { kind: 'nie', re: re(String.raw`${B}[XYZ][ \-]?\d{7}[ \-]?[A-Z]${E}`), valid: validNie },
  { kind: 'dni', re: re(String.raw`${B}\d{2}\.?\d{3}\.?\d{3}[ \-]?[A-Z]${E}`), valid: validDni },
  { kind: 'cif', re: re(String.raw`${B}[ABCDEFGHJNPQRSUVW][ \-]?\d{7}[ \-]?[0-9A-J]${E}`), valid: validCif },
  { kind: 'nss', re: re(String.raw`${NB}\d{2}[ /\-]?\d{8}[ /\-]?\d{2}${NE}`), valid: validNss },
  { kind: 'ip', re: re(String.raw`${B}(?:\d{1,3}\.){3}\d{1,3}${E}`), valid: validIpv4 },
  { kind: 'ip', re: re(String.raw`(?<![\p{L}\p{N}:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\p{L}\p{N}:])`), valid: validIpv6 },
  // Spanish numbers: optional +34 / 0034, then 9 digits starting with 6, 7, 8 or 9, written whole or in the usual
  // groups (3-3-3, 3-2-2-2, 2-3-2-2). Other groupings are usually policy, order or case numbers.
  { kind: 'phone', re: re(String.raw`${NB}(?:(?:\+|00)34[ .\-]?)?(?:[6789]\d{8}|\(?[6789]\d{2}\)?[ .\-\n]\d{3}[ .\-\n]\d{3}|\(?[6789]\d{2}\)?[ .\-\n]\d{2}[ .\-\n]\d{2}[ .\-\n]\d{2}|[6789]\d[ .\-\n]\d{3}[ .\-\n]\d{2}[ .\-\n]\d{2})${NE}`) },
  // Other countries, only with an explicit international prefix.
  { kind: 'phone', re: re(String.raw`(?<![\p{L}\p{N}+])(?:\+|00)(?!34)[1-9]\d{0,2}(?:[ .\-]?\(?\d\)?){6,13}${NE}`) },
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

export function findRules(text: string): RuleMatch[] {
  const taken = new Uint8Array(text.length);
  const out: RuleMatch[] = [];
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
      if (rule.valid && !rule.valid(s)) continue;
      if (taken.subarray(start, end).some((x) => x)) continue;
      taken.fill(1, start, end);
      out.push({ start, end, kind: rule.kind });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
