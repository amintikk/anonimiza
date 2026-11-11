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
  const s = 'Pedido 12345678A, producto 4012 8888 8888 1882, importe 699 120 euros, expediente 2024/45/7781, ' +
    'línea 000 000 000, cuenta ES00 1234 5678 9012 3456 7890, NIE X0000000A, póliza 7731-220-48, versión 4.12.3, hora 10:42:00.';
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
