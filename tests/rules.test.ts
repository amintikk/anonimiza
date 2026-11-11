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
  const s = 'Pedido 12345678 a domicilio, producto 4012888888881882, importe 699 120 euros, expediente 2024/45/7781, ' +
    'línea 000 000 000, póliza 7731-220-48, versión 4.12.3, hora 10:42:00, CPU a 2400 MHz, 1080p, en 2025 BBC.';
  assert.deepEqual(kinds(s), []);
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
