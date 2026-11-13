import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findRules, luhn, validCif, validDni, validIban, validNie, validNss } from '../src/engine/rules.ts';

const kinds = (s: string) => findRules(s).map((m) => [m.kind, s.slice(m.start, m.end)]);

test('check digits', () => {
  assert.ok(validDni('53464097E'));
  assert.ok(validDni('53.464.097-e'));
  assert.ok(!validDni('12345678A'));
  assert.ok(validNie('X9513358Y'));
  assert.ok(!validNie('X0000000A'));
  assert.ok(validCif('B14650667'));
  assert.ok(!validCif('B14650668'));
  assert.ok(validIban('ES21 3943 1486 0866 6169 7230'));
  assert.ok(!validIban('ES00 1234 5678 9012 3456 7890'));
  assert.ok(validIban('DE89370400440532013000'));
  assert.ok(validNss('298513137727'));
  assert.ok(!validNss('298513137728'));
  assert.ok(luhn('4543 2319 4875 7494'));
  assert.ok(!luhn('4012 8888 8888 1882'));
});

test('finds structured identifiers in running text', () => {
  const s = 'DNI 53464097E, NIE Y2171979B, CIF A38748687, cuenta ES65 3622 0763 1248 6694 8781 dentro de plazo, ' +
    'tarjeta 5155 9797 1147 1042, tel. 612 345 678 y +34 699 120 334, correo ana.lopez@ejemplo.es, IP 81.44.203.17 y 2a02:9130:84c1:1f00::2c, NSS 507249849488.';
  assert.deepEqual(kinds(s), [
    ['dni', '53464097E'], ['nie', 'Y2171979B'], ['cif', 'A38748687'], ['iban', 'ES65 3622 0763 1248 6694 8781'],
    ['card', '5155 9797 1147 1042'], ['phone', '612 345 678'], ['phone', '+34 699 120 334'], ['email', 'ana.lopez@ejemplo.es'],
    ['ip', '81.44.203.17'], ['ip', '2a02:9130:84c1:1f00::2c'], ['nss', '507249849488'],
  ]);
});

test('phone groupings and foreign numbers', () => {
  assert.deepEqual(kinds('622 81 90 47, 91 123 45 67, 612345678, +33 6 12 34 56 78'), [
    ['phone', '622 81 90 47'], ['phone', '91 123 45 67'], ['phone', '612345678'], ['phone', '+33 6 12 34 56 78'],
  ]);
});

test('numbers that only look like data are left alone', () => {
  const s = 'Pedido de 3 unidades, producto 4012888888881882, importe 699 120 euros, el contrato de 12 meses, ' +
    'línea 000 000 000, versión 4.12.3, hora 10:42:00, CPU a 2400 MHz, 1080p, en 2025 BBC, reserva para 4 personas, ' +
    'pedido del 03/11/2026, el usuario puede cambiar la clave, Ref. 2026.';
  assert.deepEqual(kinds(s), []);
});

test('other identifiers, by the word that announces them', () => {
  const s = 'Pedido 12345678 a domicilio, expediente 2024/45/7781, póliza 7731-220-48.\n' +
    'NHC: 0048213   Nº colegiada 48-1287702   NASS: 14 9096265001 02\n' +
    'Tarxeta sanitaria: GACS 21011400 9\npasaporte colombiano: AV419027\nRef. incidencia: INC-77821034\n' +
    'login failed user=jl.moreno ip=10.2.0.4\njordi.p: a mi no\n@lolaB_1979 yo lo tomo';
  assert.deepEqual(kinds(s), [
    ['ref', '12345678'], ['ref', '2024/45/7781'], ['ref', '7731-220-48'], ['ref', '0048213'], ['ref', '48-1287702'],
    ['ref', '14 9096265001 02'], ['ref', 'GACS 21011400 9'], ['ref', 'AV419027'], ['ref', 'INC-77821034'],
    ['ref', 'jl.moreno'], ['ip', '10.2.0.4'], ['ref', 'jordi.p'], ['ref', '@lolaB_1979'],
  ]);
});

test('mobiles in unusual groups; landlines only after a word that says so', () => {
  assert.deepEqual(kinds('al 6 1 7 0 8 9 2 4 3 eh. Tel.: 6 4 4 - 0 1 9 - 2 3 7. tel 9 5 4 1 2 3 7 8 9. Total 9 5 4 1 2 3 7 8 9.'), [
    ['phone', '6 1 7 0 8 9 2 4 3'], ['phone', '6 4 4 - 0 1 9 - 2 3 7'], ['phone', '9 5 4 1 2 3 7 8 9'],
  ]);
});

test('numbers wrapped onto a new line, as text from PDFs often is', () => {
  assert.deepEqual(kinds('teléfonos 655\n908 112 y cuenta ES21 3943 1486\n0866 6169 7230.'), [['phone', '655\n908 112'], ['iban', 'ES21 3943 1486\n0866 6169 7230']]);
});

test('lowercase and unspaced forms', () => {
  assert.deepEqual(kinds('dni 53464097e iban es2139431486086661697230 tlf 612345678'), [
    ['dni', '53464097e'], ['iban', 'es2139431486086661697230'], ['phone', '612345678'],
  ]);
});

test('right format with a wrong check digit is reported as doubtful', () => {
  const s = 'DNI 71530264K, dni 12345678-a, NIE X0000000A, cuenta ES00 1234 5678 9012 3456 7890, tarjeta 4012 8888 8888 1882. Válido: 48213907L.';
  assert.deepEqual(findRules(s).map((m) => [m.kind, s.slice(m.start, m.end), !!m.doubtful]), [
    ['dni', '71530264K', true], ['dni', '12345678-a', true], ['nie', 'X0000000A', true],
    ['iban', 'ES00 1234 5678 9012 3456 7890', true], ['card', '4012 8888 8888 1882', true], ['dni', '48213907L', false],
  ]);
});

test('number plates', () => {
  assert.deepEqual(kinds('Su coche es el 4821 KLM, la moto 1234-BCD, el otro 9876klm y uno antiguo M-1234-AB o GR 4567 B.'), [
    ['plate', '4821 KLM'], ['plate', '1234-BCD'], ['plate', '9876klm'], ['plate', 'M-1234-AB'], ['plate', 'GR 4567 B'],
  ]);
  assert.deepEqual(kinds('Pantalla 2400 MHZ, 1000 GBP, año 2024 con 4 ruedas, ref 12345 KLM.'), []);
});

test('dates of birth only, not other dates', () => {
  const s = 'Paciente nacida el 14/03/1987. F. nac.: 3-5-92. Fecha de nacimiento\n12 de enero de 1979. Nació en 1990. ' +
    'DOB: March 4, 1985. Cita el 20/05/2025; contrato de 1 de marzo de 2024.';
  assert.deepEqual(kinds(s), [
    ['birthdate', '14/03/1987'], ['birthdate', '3-5-92'], ['birthdate', '12 de enero de 1979'], ['birthdate', '1990'], ['birthdate', 'March 4, 1985'],
  ]);
});

test('a person after "Usuaria:" is not a user name', () => {
  assert.deepEqual(kinds('Usuaria: Josefa Martín Cuesta, 78 años. usuario: jmartinez'), [['ref', 'jmartinez']]);
});

test('a CIF announced as such is reported even with a wrong control character, as doubtful', () => {
  assert.deepEqual(findRules('con CIF B-87654321, y el código B-87654321').map((m) => [m.kind, m.doubtful ?? false]), [['cif', true]]);
});

test('full postal addresses with a postal code', () => {
  assert.deepEqual(kinds('domicilio social en Calle de Alcalá, 120, 4.ª planta, 28009 Madrid, representada'), [['address', 'Calle de Alcalá, 120, 4.ª planta, 28009 Madrid']]);
  assert.deepEqual(kinds('Avda. de la Constitución 45, 1º izq., 46009 València\nMóvil'), [['address', 'Avda. de la Constitución 45, 1º izq., 46009 València']]);
  assert.deepEqual(kinds('vive en la calle Mayor, cerca de la plaza'), []);
});

// From a 9-page PDF test file (see tools/expediente_prueba.py): what PDF extraction and table cells do to the data.
test('data split by PDF line wraps and longer labels', () => {
  const v = (s: string) => findRules(s).map((m) => s.slice(m.start, m.end));
  // The CIF wins over the DNI hidden in it, and the conjunction after it is not a DNI letter.
  assert.deepEqual(kinds('con C.I.F. B-83639138 y domicilio social'), [['cif', 'B-83639138']]);
  assert.deepEqual(kinds('con CIF B-\n52.783.370, con domicilio'), [['cif', 'B-\n52.783.370']]);
  assert.deepEqual(v('Teléfono\n670-071-\n788\ncorreo'), ['670-071-\n788']);
  assert.deepEqual(kinds('22.731.761-\nX\n'), [['dni', '22.731.761-\nX']]);
  assert.deepEqual(kinds('con DNI 12.345.678 y domicilio'), [['dni', '12.345.678']]);
  assert.deepEqual(findRules('con DNI 12.345.678 y domicilio')[0]!.doubtful, true);
  assert.deepEqual(kinds('domicilio social en Avenida del Puerto, 214, 3.º B, 46023\nValencia, inscrita'), [['address', 'Avenida del Puerto, 214, 3.º B, 46023\nValencia']]);
  assert.deepEqual(v('póliza de responsabilidad\ncivil profesional nº RC-2024-0087731 con'), ['RC-2024-0087731']);
  assert.deepEqual(v('Referencia de la devolución: DEV-0193374.'), ['DEV-0193374']);
  assert.deepEqual(v('cita en su tarjeta SIP\n1840273659). Ante'), ['1840273659']);
  assert.deepEqual(v('Col. nº\n46/0812233'), ['46/0812233']);
  assert.deepEqual(v('los agentes con carné profesional 4417 y 5208, de servicio'), ['4417', '5208']);
  assert.deepEqual(v('Usuario de VPN asignado a la jefa de proyecto: lbenitez.ext.'), ['lbenitez.ext']);
  // Still left alone.
  assert.deepEqual(v('el carné de conducir desde 2015 y la póliza de hogar renovada'), []);
  assert.deepEqual(v('Usuario de la aplicación: ninguno'), []);
});

test('invisible characters inside an identifier and digits of other scripts are read, and positions point at the original text', () => {
  const text = 'DNI del solicitante: 1234​5678Z. Teléfono: +34 ٦١٢٣٤٥٦٧٨. Calle Alcá­la 120.';
  const dni = findRules(text).find((r) => r.kind === 'dni');
  assert.ok(dni, 'DNI with a zero-width space is found');
  assert.equal(text.slice(dni.start, dni.end), '1234​5678Z');
  const phone = findRules(text).find((r) => r.kind === 'phone');
  assert.ok(phone, 'phone written with Arabic-Indic digits is found');
  assert.equal(text.slice(phone.start, phone.end), '+34 ٦١٢٣٤٥٦٧٨');
});

test('NSS and dates written with spaces around the separators', () => {
  assert.deepEqual(kinds('Nº Afiliación Seg. Social 43 / 10894567 / 29'), [['nss', '43 / 10894567 / 29']]);
  assert.deepEqual(kinds('Fecha de Nacimiento: 22 / 03 / 1988 (38 años)'), [['birthdate', '22 / 03 / 1988']]);
  assert.deepEqual(kinds('Fecha de Caducidad DNI 18 / 09 / 2031'), []);
});

test('years of birth in a list after the birth cue', () => {
  assert.deepEqual(kinds('2 (Nacidos en 2018\ny 2021)'), [['birthdate', '2018'], ['birthdate', '2021']]);
});

test('a street address without its postal code, with stair, floor and door', () => {
  const s = 'Dirección Postal Principal: Calle de Sant Joan, número 34, Escalera B, Piso 4º, Puerta 2ª. Código Postal 43201';
  assert.deepEqual(kinds(s), [['address', 'Calle de Sant Joan, número 34, Escalera B, Piso 4º, Puerta 2ª']]);
  assert.deepEqual(kinds('Pza. de las Nubes 6, 15008 A Coruña. Tel'), [['address', 'Pza. de las Nubes 6, 15008 A Coruña']]);
});

test('sensitive values in labelled fields: health, birthplace, marital status', () => {
  assert.deepEqual(kinds('Grupo Sanguíneo y RH\n\nA Positivo (A+)'), [['other', 'A Positivo (A+)']]);
  assert.deepEqual(kinds('Alergias Medicamentosas   Penicilina y derivados'), [['other', 'Penicilina y derivados']]);
  assert.deepEqual(kinds('Lugar de Nacimiento\n\nTarragona (España)'), [['other', 'Tarragona (España)']]);
  assert.deepEqual(kinds('Estado Civil: Casado/a'), [['other', 'Casado/a']]);
});

test('a DNI glued to a capitalised name is still a DNI; a lower-case word or a digit is part of the code', () => {
  assert.deepEqual(kinds('Pegados: 12345678ZJuan.'), [['dni', '12345678Z']]);
  assert.deepEqual(kinds('nombre 12345678Zabc'), []);
});
