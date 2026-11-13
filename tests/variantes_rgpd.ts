// Variantes a gran escala para los datos de expedientes: direcciones sin código postal, datos sensibles por
// etiqueta (salud, lugar de nacimiento, estado civil…), años de nacimiento en lista, NSS con cualquier separador,
// fechas con espacios y DNI pegado a un nombre. Se combinan etiquetas × valores × formatos × contextos
// para cubrir miles de casos sin escribirlos a mano. Lo usa tests/variantes.ts.
import type { RuleKind } from '../src/engine/rules.ts';

export interface CaseV { family: string; kind: RuleKind; value: string; text: string }

// Calles: tipo de vía, nombre, y número con o sin etiqueta.
const VIAS = ['Calle', 'C/', 'Avda.', 'Avenida', 'Plaza', 'Pza.', 'Paseo', 'Carrer', 'Ronda', 'Camino', 'Passeig', 'Rambla'];
const NOMBRES = ['de Sant Joan', 'Mayor', 'del Olmo Azul', 'de las Nubes', 'Alcalá', 'de la Constitución', 'Gran Vía', 'de Pere Calders', 'de la Font', 'Sant Pau'];
const NUMEROS = ['34', '6', '120', '204', '17'];
const NUM_FORMAS = [(n: string) => `, ${n}`, (n: string) => ` ${n}`, (n: string) => `, número ${n}`, (n: string) => `, nº ${n}`, (n: string) => `, n.º ${n}`];
const TRAMOS = ['', ', Escalera B, Piso 4º, Puerta 2ª', ', 3.º A', ', 2.º izq.', ', bloque 3, portal 2', ', 1ª planta', ' bajo', ', 4.ª planta, puerta 12'];
const CONTEXTOS_DIR = [(d: string) => d, (d: string) => `Dirección postal: ${d}.`, (d: string) => `Domicilio: ${d}. Teléfono de contacto`, (d: string) => `vive en ${d}, desde 2019`];

const DIRECCIONES: string[] = [];
for (const v of VIAS) for (const n of NOMBRES) for (const num of NUMEROS) for (const f of NUM_FORMAS.slice(0, 3)) for (const t of TRAMOS.slice(0, 5))
  DIRECCIONES.push(`${v} ${n}${f(num)}${t}`);

// Datos sensibles por etiqueta: cada etiqueta con cada valor y con varios formatos (dos puntos, tabla, línea propia).
const SENSIBLES: [string, string[]][] = [
  ['Grupo sanguíneo', ['A Positivo (A+)', '0 Rh negativo', 'AB+', 'Grupo 0, Rh positivo']],
  ['Tipo de sangre', ['B-', 'A+', 'O negativo']],
  ['Alergias', ['Penicilina y derivados', 'frutos secos (nueces)', 'látex', 'ninguna conocida', 'polen de gramíneas']],
  ['Alergias medicamentosas', ['Penicilina', 'Ibuprofeno y AAS']],
  ['Alergias alimentarias', ['Lactosa', 'marisco']],
  ['Intolerancias', ['gluten', 'lactosa']],
  ['Diagnóstico', ['diabetes tipo 2', 'hipertensión arterial', 'asma bronquial leve']],
  ['Patología', ['artrosis lumbar', 'migraña crónica']],
  ['Enfermedades', ['celiaquía', 'epilepsia controlada']],
  ['Discapacidad', ['33 % (reconocido)', 'No aplica', 'física, 40 %']],
  ['Grado de discapacidad', ['0 % (No aplica)', '65 %']],
  ['Medicación habitual', ['enalapril 10 mg', 'metformina 850 mg']],
  ['Tratamiento médico', ['quimioterapia en curso', 'fisioterapia semanal']],
  ['Baja médica', ['desde el 3 de marzo', 'por enfermedad común']],
  ['Reconocimiento médico', ['Apto sin restricciones', 'Apto con restricciones (pantalla)', 'No apto temporal']],
  ['Historial médico', ['sin antecedentes relevantes', 'cirugía de rodilla en 2019']],
  ['Antecedentes médicos', ['hipotiroidismo', 'ninguno']],
  ['Lugar de nacimiento', ['Tarragona (España)', 'Lleida', 'Badalona, Barcelona', 'Oviedo (Asturias)']],
  ['Estado civil', ['Casado/a', 'Soltera', 'Divorciado', 'Viudo/a']],
  ['Religión', ['católica', 'musulmana', 'ninguna']],
  ['Orientación sexual', ['heterosexual', 'no declarada']],
  ['Afiliación sindical', ['UGT', 'no afiliado']],
  ['Ideología política', ['no declarada']],
  ['Origen étnico', ['no declarado', 'gitano']],
  ['Nacionalidad', ['Española', 'Marroquí', 'Francesa y española']],
];
const SENS_CONTEXTOS = [
  (l: string, v: string) => `${l}: ${v}`,
  (l: string, v: string) => `${l}   ${v}   Otro dato`,
  (l: string, v: string) => `${l}\n${v}\n`,
  (l: string, v: string) => `${l}\n\n${v}`,
  (l: string, v: string) => `Ficha. ${l}: ${v}. Revisado el lunes.`,
];

// Años de nacimiento en lista, dentro de texto y de tabla.
const LISTAS = [
  (a: string, b: string) => `2 (Nacidos en ${a} y ${b})`,
  (a: string, b: string) => `hijos nacidos en ${a}, ${b}`,
  (a: string, b: string) => `Nacidos en ${a}\ny ${b})`,
  (a: string, b: string) => `nacidos en ${a} e ${b}`,
];
const ANIOS: [string, string][] = [['2018', '2021'], ['2005', '2011'], ['1999', '2003'], ['2014', '2020'], ['2010', '2016']];

// NSS con cualquier separador o sin él; fechas con espacios alrededor de los separadores.
const NSS_SEP = ['281234567840', '28 12345678 40', '28 / 12345678 / 40', '28/12345678/40', '28 - 12345678 - 40', '28-12345678-40', '28.12345678.40'];
const FECHAS_SEP = ['22 / 03 / 1988', '22/03/1988', '22 - 03 - 1988', '22.03.1988', '22 . 03 . 1988', '3 / 4 / 90'];
const ETQ_NSS = ['Nº Afiliación Seg. Social', 'NSS:', 'Nº S.S.', 'afiliación a la SS'];
const ETQ_NAC = ['Fecha de Nacimiento', 'F. nac.:', 'Nacido el', 'Fecha de nacimiento:', 'nacida el'];

// DNI pegado a un nombre o a una palabra con mayúscula.
const DNI_PEG = ['12345678Z', '50827391J', '00123456S'];
const NOMBRES_PEG = ['Juan', 'María', 'Ana López', 'Lúa', 'Pérez'];

export function positivesRgpd(): CaseV[] {
  const out: CaseV[] = [];
  for (const d of DIRECCIONES) for (const c of CONTEXTOS_DIR) out.push({ family: 'direccion-sin-cp', kind: 'address', value: d, text: c(d) });
  for (const [l, vals] of SENSIBLES) for (const v of vals) for (const c of SENS_CONTEXTOS) out.push({ family: 'sensible', kind: 'other', value: v, text: c(l, v) });
  for (const [a, b] of ANIOS) for (const f of LISTAS) {
    out.push({ family: 'anio-lista', kind: 'birthdate', value: a, text: f(a, b) });
    out.push({ family: 'anio-lista', kind: 'birthdate', value: b, text: f(a, b) });
  }
  for (const n of NSS_SEP) for (const e of ETQ_NSS) out.push({ family: 'nss-sep', kind: 'nss', value: n, text: `${e} ${n}, en vigor.` });
  for (const dte of FECHAS_SEP) for (const e of ETQ_NAC) out.push({ family: 'fecha-sep', kind: 'birthdate', value: dte, text: `${e} ${dte}, en Lleida.` });
  for (const d of DNI_PEG) for (const n of NOMBRES_PEG) out.push({ family: 'dni-pegado', kind: 'dni', value: d, text: `Pegados: ${d}${n}. Fin.` });
  return out;
}

/** Textos neutros que no deben marcar nada de lo anterior. */
export const NEGATIVOS_RGPD = [
  'El alumno tiene 3 años de experiencia en la empresa.', 'Asistieron 45 personas a la reunión de la calle.',
  'Entrega en la plaza el martes a las 10:30.', 'El grupo sanguíneo no aparece en el formulario de la oferta.',
  'Las alergias no se tratan en esta clínica.', 'Se revisa el estado de la obra cada mes.',
];
