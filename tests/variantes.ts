// Many ways of writing the same data. Each value is rendered in several formats and placed in several
// contexts (with and without the word that announces it, in a sentence, a table, parentheses, at the end of
// a line). Used by tests/variantes.test.ts and by `node tests/variantes.ts` to list what is not detected.
import { findRules, type RuleKind } from '../src/engine/rules.ts';

export interface Case { family: string; kind: RuleKind; value: string; text: string }

const CONTEXTS = [
  (v: string) => `${v}`,
  (v: string) => `Datos: ${v}.`,
  (v: string) => `quedamos así (${v}) y luego`,
  (v: string) => `Nombre\t${v}\tOtro`,
  (v: string) => `el dato es ${v}, gracias`,
];

const LABELED = (labels: string[]) => (v: string) => labels.map((l) => `${l} ${v}`);

function product(family: string, kind: RuleKind, values: string[], labels: string[] = []): Case[] {
  const out: Case[] = [];
  for (const v of values) {
    for (const c of CONTEXTS) out.push({ family, kind, value: v, text: c(v) });
    for (const t of LABELED(labels)(v)) out.push({ family, kind, value: v, text: `Firmado, ${t}, en Madrid.` });
  }
  return out;
}

// Valid identifiers (check digits computed once and kept here).
const DNI = ['12345678Z', '00123456S', '50827391J'];
const dniForms = (d: string) => [d, `${d.slice(0, 8)}-${d[8]}`, `${d.slice(0, 8)} ${d[8]}`, `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}-${d[8]}`, `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}${d[8]}`, `${d.slice(0, 8)}${d[8]!.toLowerCase()}`, `${d.slice(0, 8)}-${d[8]!.toLowerCase()}`];
const NIE = ['X1234567L', 'Y2952918P', 'Z7905381X'];
const nieForms = (n: string) => [n, `${n[0]}-${n.slice(1, 8)}-${n[8]}`, `${n[0]} ${n.slice(1, 8)} ${n[8]}`, n.toLowerCase(), `${n.slice(0, 8)}-${n[8]}`];
const CIF = ['B12345674', 'A58818501', 'Q2826000H'];
const cifForms = (c: string) => [c, `${c[0]}-${c.slice(1)}`, `${c[0]} ${c.slice(1)}`, `${c[0]}-${c.slice(1, 3)}.${c.slice(3, 6)}.${c.slice(6)}`, `${c[0]}${c.slice(1, 8)}-${c[8]}`];
const IBAN = 'ES9121000418450200051332';
const ibanForms = [IBAN, IBAN.replace(/(.{4})(?!$)/g, '$1 '), IBAN.replace(/(.{4})(?!$)/g, '$1-'), IBAN.toLowerCase().replace(/(.{4})(?!$)/g, '$1 '), 'ES91 2100 0418 45 0200051332', 'DE89 3704 0044 0532 0130 00', 'FR14 2004 1010 0505 0001 3M02 606', 'PT50 0002 0123 1234 5678 9015 4'];
const CARD = '4111111111111111';
const cardForms = [CARD, '4111 1111 1111 1111', '4111-1111-1111-1111', '5500 0000 0000 0004', '3782 822463 10005'];
const NSS = ['281234567840'];
const nssForms = (n: string) => [n, `${n.slice(0, 2)} ${n.slice(2, 10)} ${n.slice(10)}`, `${n.slice(0, 2)}/${n.slice(2, 10)}/${n.slice(10)}`, `${n.slice(0, 2)}-${n.slice(2, 10)}-${n.slice(10)}`];
const phoneForms = ['612345678', '612 345 678', '612 34 56 78', '612-34-56-78', '612.34.56.78', '612-345-678', '+34 612 345 678', '+34612345678', '0034 612 345 678', '(+34) 612 34 56 78', '+34-612-345-678', '91 123 45 67', '911 234 567', '91-123-45-67', '(91) 123 45 67', '+44 20 7946 0958', '+33 6 12 34 56 78', '+212 661 340 288', '6 1 2 3 4 5 6 7 8', '61 23 45 67 8'];
const emailForms = ['ana.lopez@gmail.com', 'ANA.LOPEZ@GMAIL.COM', 'ana+facturas@empresa.es', 'j_perez-88@correo.mail.cat', 'info@bufete-garcia.com'];
const dateForms = ['03/04/1990', '3/4/1990', '03-04-1990', '03.04.1990', '3-4-90', '1990-04-03', '3 de abril de 1990', '3 abril 1990', '3 de abril del 1990', 'abril 3, 1990', '03/abr/1990'];
const birthCues = ['nacido el', 'nacida el', 'Fecha de nacimiento:', 'F. nac.:', 'F. nacimiento:', 'Fecha nac.', 'FNAC:', 'f/nac:', 'F.N.:', 'nació el', 'Nacimiento:', 'Data de naixement:', 'Data de nacemento:', 'Jaiotze data:', 'Date of birth:', 'DOB:', 'born on'];
const plateForms = ['1234 BCD', '1234-BCD', '1234BCD', '1234bcd', 'M-1234-AB', 'M 1234 AB', 'B-5678-XZ'];
const ipForms = ['192.168.1.20', '83.44.120.7', '2001:db8::8a2e:370:7334'];

const refCases: [string, string][] = [
  ['Nº de expediente: 2024/0457', '2024/0457'], ['Exp. 4521/2025', '4521/2025'], ['Expte. nº 77812', '77812'], ['expediente núm. AB-2231', 'AB-2231'],
  ['N.H.C.: 448213', '448213'], ['NHC 2091174', '2091174'], ['Historia clínica nº 556677', '556677'], ['Nº historia: 99812', '99812'],
  ['Nº afiliación: 28/12345678/40X', '28/12345678/40X'], ['Póliza: 0071-AU-5583120', '0071-AU-5583120'], ['Póliza nº 88123456', '88123456'],
  ['Nº de socio 11823', '11823'], ['Nº de cliente: 0019823344', '0019823344'], ['Cliente nº 778812', '778812'], ['Código de cliente: CL-55821', 'CL-55821'],
  ['Referencia catastral 7841203VK1974S0012WX', '7841203VK1974S0012WX'], ['Nº colegiado 28/45612', '28/45612'], ['Colegiado nº 45612', '45612'],
  ['Pasaporte nº AV419027', 'AV419027'], ['passport no. 123456789', '123456789'], ['Tarjeta sanitaria: BBBB 1234 5678 9012', 'BBBB 1234 5678 9012'],
  ['Usuario: jlmoreno88', 'jlmoreno88'], ['user=jl.moreno', 'jl.moreno'], ['login: m.garcia', 'm.garcia'], ['@ana_lopez88', '@ana_lopez88'],
  ['Nº de empleado: 004512', '004512'], ['Id. de cliente: 88213', '88213'], ['Nº de pedido: 405-8812734-1190', '405-8812734-1190'],
];

// Harder forms: non-breaking spaces (Word, PDF), a line break inside the value (PDF), and values with a wrong
// check digit announced by their label (a mistyped identifier must still be hidden, as doubtful).
const nbsp = (v: string) => v.replace(/ /g, '\u00a0');
const broken = (v: string) => { const i = v.lastIndexOf(' ', Math.floor(v.length / 2) + 2); return i > 0 ? `${v.slice(0, i)}\n${v.slice(i + 1)}` : v; };
const hard = (family: string, kind: RuleKind, values: string[], label: string): Case[] =>
  values.flatMap((v) => [nbsp(v), broken(v)].filter((x) => x !== v).map((x) => ({ family: `${family}-duro`, kind, value: x, text: `${label} ${x}, gracias.` })));
const typo = (family: string, kind: RuleKind, values: string[], labels: string[]): Case[] =>
  values.flatMap((v) => labels.map((l) => ({ family: `${family}-mal`, kind, value: v, text: `Firmado, ${l} ${v}, en Madrid.` })));

export function positives(): Case[] {
  return [
    ...hard('iban', 'iban', ['ES91 2100 0418 4502 0005 1332'], 'IBAN'),
    ...hard('phone', 'phone', ['612 345 678', '+34 612 34 56 78', '91 123 45 67'], 'Tel.'),
    ...hard('card', 'card', ['4111 1111 1111 1111'], 'tarjeta'),
    ...hard('nss', 'nss', ['28 12345678 40'], 'NSS'),
    ...hard('plate', 'plate', ['1234 BCD'], 'matrícula'),
    ...hard('dni', 'dni', ['12.345.678 Z', '12345678 Z'], 'DNI'),
    ...typo('dni', 'dni', ['12345678A', '12.345.678-A', '50827391 T'], ['DNI', 'NIF', 'D.N.I.']),
    ...typo('nie', 'nie', ['X1234567A', 'Y-2952918-B'], ['NIE']),
    ...typo('cif', 'cif', ['B12345678', 'B-87654321'], ['CIF', 'NIF', 'C.I.F.']),
    ...typo('iban', 'iban', ['ES91 2100 0418 4502 0005 1333', 'ES00 1234 5678 9012 3456 7890'], ['IBAN', 'cuenta', 'IBAN:']),
    ...typo('card', 'card', ['4111 1111 1111 1112', '5500000000000005'], ['tarjeta', 'tarjeta nº']),
    ...typo('nss', 'nss', ['28 12345678 41', '281234567841'], ['NSS', 'nº de la Seguridad Social', 'afiliación SS']),
    ...product('dni', 'dni', DNI.flatMap(dniForms), ['DNI', 'D.N.I.', 'NIF', 'dni:', 'con DNI nº']),
    ...product('nie', 'nie', NIE.flatMap(nieForms), ['NIE', 'N.I.E.', 'NIE nº']),
    ...product('cif', 'cif', CIF.flatMap(cifForms), ['CIF', 'C.I.F.', 'NIF']),
    ...product('iban', 'iban', ibanForms, ['IBAN', 'cuenta', 'c/c', 'nº de cuenta']),
    ...product('card', 'card', cardForms, ['tarjeta', 'nº de tarjeta']),
    ...product('nss', 'nss', NSS.flatMap(nssForms), ['NSS', 'Nº S.S.', 'nº afiliación SS']),
    ...product('phone', 'phone', phoneForms, ['Tel.', 'Teléfono:', 'móvil', 'tlf:', 'Tfno.']),
    ...product('email', 'email', emailForms, ['Email:', 'correo']),
    ...product('ip', 'ip', ipForms, ['IP']),
    ...product('plate', 'plate', plateForms, ['matrícula', 'Matrícula:']),
    ...birthCues.flatMap((c) => dateForms.map((d) => ({ family: 'birthdate', kind: 'birthdate' as RuleKind, value: d, text: `Paciente: ${c} ${d}, en Lleida.` }))),
    ...refCases.map(([t, v]) => ({ family: 'ref', kind: 'ref' as RuleKind, value: v, text: `Datos: ${t}. Fin.` })),
  ];
}

/** Text that must stay as it is: no rule should mark anything here. */
export const NEGATIVES = [
  'El importe es de 1.234.567,89 € y el IVA del 21 %.', 'La reunión es el 03/04/2026 a las 10:30.', 'Vence el 15 de mayo de 2027.',
  'Código postal 28009 y portal 12.', 'Referencia de producto: 8421376003185.', 'Versión 4.12.3 del programa.', 'En 1990 había 612 socios.',
  'Pedido de 3 unidades por 24,90 €.', 'La finca tiene 1234 m² y 56 árboles.', 'Ley Orgánica 3/2018 y Real Decreto 1720/2007.', 'Artículo 1902 del Código Civil.',
  'El ticket BCK-2291 está cerrado.', 'Tarjeta regalo de 50 € para el sorteo.', 'CIF: pendiente de recibir.', 'La Seguridad Social abrió 3 oficinas en 2024.',
  'Tel. de atención: consultar en la web.', 'El 15 de mayo de 2027 termina el contrato, nacido de la fusión de 2019.', 'Llegaron 2.000 personas al estadio de 45.000 plazas.', 'Página 12 de 245.', 'ISBN 978-84-376-0494-7.',
];

export function check(): { misses: Case[]; total: number; falsePositives: string[] } {
  const cases = positives();
  const misses = cases.filter((c) => {
    const ms = findRules(c.text);
    const start = c.text.indexOf(c.value);
    return !ms.some((m) => (m.kind === c.kind || (c.family === 'ref' && m.kind === 'ref')) && m.start <= start && m.end >= start + c.value.length);
  });
  const falsePositives = NEGATIVES.flatMap((t) => findRules(t).map((m) => `${m.kind}:${t.slice(m.start, m.end)} ← ${t}`));
  return { misses, total: cases.length, falsePositives };
}

if (import.meta.main) {
  const { misses, total, falsePositives } = check();
  const byFamily = new Map<string, { n: number; miss: Case[] }>();
  for (const c of positives()) (byFamily.get(c.family) ?? byFamily.set(c.family, { n: 0, miss: [] }).get(c.family)!).n++;
  for (const m of misses) byFamily.get(m.family)!.miss.push(m);
  console.log(`${total - misses.length}/${total} detectados`);
  for (const [f, { n, miss }] of byFamily) console.log(`${f.padEnd(10)} ${n - miss.length}/${n}`);
  const shown = new Set<string>();
  for (const m of misses) { const k = `${m.family}|${m.value}`; if (!shown.has(k) || process.argv.includes('--all')) { shown.add(k); console.log(`  FALLA ${m.family}: ${JSON.stringify(m.text)}`); } }
  for (const f of falsePositives) console.log(`  DE MÁS ${f}`);
}
