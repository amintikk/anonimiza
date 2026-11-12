import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { applyMarkers, assignMarkers, buildDetections, isGeneric, nameParts, restore } from '../src/engine/anonymize.ts';
import { findRules } from '../src/engine/rules.ts';
import type { EntitySpan } from '../src/engine/gliner.ts';

const ent = (text: string, value: string, label: EntitySpan['label']): EntitySpan => {
  const start = text.indexOf(value);
  return { start, end: start + value.length, label, score: 0.9 };
};

test('stable markers, repeated values and partial names', () => {
  const text = 'Javier Molina Ortega (DNI 53464097E) alquila a Lucía Herrero. Javier Molina firma; el Sr. Molina paga. Escribid a Lucía Herrero o al 612 345 678 / 612345678.';
  const ents = [ent(text, 'Javier Molina Ortega', 'person'), ent(text, 'Lucía Herrero', 'person')];
  const dets = buildDetections(text, findRules(text), ents);
  const a = assignMarkers(text, dets, 'es');
  const out = applyMarkers(text, dets, a.byId);
  assert.equal(out, '[PERSONA_1] (DNI [DNI_1]) alquila a [PERSONA_2]. [PERSONA_1] firma; el Sr. [PERSONA_1] paga. Escribid a [PERSONA_2] o al [TELEFONO_1] / [TELEFONO_1].');
  assert.equal(a.table.get('[PERSONA_1]'), 'Javier Molina Ortega');
});

test('switching one off keeps the other markers', () => {
  const text = 'Ana Ruiz y Pedro Gil, de Talleres Norte.';
  const ents = [ent(text, 'Ana Ruiz', 'person'), ent(text, 'Pedro Gil', 'person'), ent(text, 'Talleres Norte', 'organization')];
  const dets = buildDetections(text, [], ents);
  dets[0]!.on = false;
  const a = assignMarkers(text, dets, 'en');
  assert.equal(applyMarkers(text, dets, a.byId), 'Ana Ruiz y [PERSON_2], de [ORGANIZATION_1].');
});

test('manual entries win and spread to every occurrence', () => {
  const text = 'El proyecto Atlas lo dirige Atlas Consulting; Atlas cierra en mayo.';
  const dets = buildDetections(text, [], [], [{ start: 12, end: 17, kind: 'other' }]);
  const a = assignMarkers(text, dets, 'es');
  assert.equal(applyMarkers(text, dets, a.byId), 'El proyecto [DATO_1] lo dirige [DATO_1] Consulting; [DATO_1] cierra en mayo.');
});

test('restore tolerates what chat assistants do to markers', () => {
  const table = new Map([['[PERSONA_1]', 'Lucía Herrero'], ['[IBAN_1]', 'ES21 3943 1486 0866 6169 7230'], ['[PERSONA_10]', 'Ana']]);
  const r = restore('Hola [PERSONA_1], [persona 1] y PERSONA_1. Cuenta [IBAN_1]. [PERSONA_10] no es [PERSONA_1]0. [PERSONA_7]?', table);
  assert.equal(r.text, 'Hola Lucía Herrero, Lucía Herrero y Lucía Herrero. Cuenta ES21 3943 1486 0866 6169 7230. Ana no es Lucía Herrero0. [PERSONA_7]?');
  assert.deepEqual(r.unknown, ['[PERSONA_7]']);
  assert.equal(r.replaced, 6);
});

test('round trip: anonymise then restore gives the original back', () => {
  const text = 'Carmen Ibáñez Soler (carmen.ibanez@buzon-ejemplo.net, 634 772 018) vive en Plaza de España 7, 50001 Zaragoza.';
  const ents = [ent(text, 'Carmen Ibáñez Soler', 'person'), ent(text, 'Plaza de España 7, 50001 Zaragoza', 'address')];
  const dets = buildDetections(text, findRules(text), ents);
  const a = assignMarkers(text, dets, 'es');
  const out = applyMarkers(text, dets, a.byId);
  assert.ok(!/Carmen|634|Zaragoza|buzon/.test(out));
  assert.equal(restore(out, a.table).text, text);
});

test('name parts', () => {
  assert.deepEqual(nameParts('Javier Molina Ortega'), ['Javier Molina', 'Javier', 'Molina', 'Ortega']);
  assert.deepEqual(nameParts('María de la Fuente'), ['María', 'Fuente']);
  assert.deepEqual(nameParts('youssef el idrissi'), ['youssef', 'idrissi']);
  assert.deepEqual(nameParts('rosa ortega'), ['ortega']);
  assert.deepEqual(nameParts('Ana'), []);
});

test('review case: lower-case repetitions, doubtful DNI, birth date, plate, full stop after S.L.', () => {
  const text = readFileSync(new URL('./data/caso-revision.txt', import.meta.url), 'utf8');
  // What the model found in production (names, organisations, address); the rest must come from the rules and repetitions.
  const ents = [
    ent(text, 'Montse', 'person'), ent(text, 'Nahia Etxeberria Uriarte', 'person'), ent(text, 'Youssef El Idrissi', 'person'),
    ent(text, 'Puig i Ferrer', 'person'), ent(text, 'Jordi', 'person'), ent(text, 'Hospital Verge de la Cinta', 'organization'),
    ent(text, 'Construcciones Ebre Sud, S.L.', 'organization'), ent(text, 'calle Major, 12, 2n 1a, 43500 Tortosa', 'address'),
  ];
  const dets = buildDetections(text, findRules(text), ents);
  const a = assignMarkers(text, dets, 'es');
  const out = applyMarkers(text, dets, a.byId);
  for (const leak of ['etxeberria', 'youssef', '71530264K', '14/03/1987', '4821 KLM', 'Tortosa', 'nahia', 'X1234567L', '977 44 12 03']) {
    assert.ok(!out.toLowerCase().includes(leak.toLowerCase()), `${leak} leaked`);
  }
  assert.match(out, /la sra\. \[PERSONA_2\] no le gusta/);
  assert.match(out, /hablad con \[PERSONA_3\]\./);
  assert.match(out, /de \[ORGANIZACION_2\]\.\n\nContacto/);
  assert.match(out, /nacida el \[FECHA_NACIMIENTO_1\]/);
  assert.match(out, /el \[MATRICULA_1\] y el expediente es el 2024\/00871/); // the case number is not covered
  assert.ok(dets.find((d) => text.slice(d.start, d.end) === '71530264K')?.doubtful);
  // Short forms share the marker of the full name, so they come back as the full name.
  const back = restore(out, a.table);
  assert.deepEqual(back.unknown, []);
  assert.match(back.text, /de Construcciones Ebre Sud, S\.L\.\n\nContacto/);
  assert.match(back.text, /hablad con Youssef El Idrissi\./);
});

test('name parts that are ordinary words keep their capital', () => {
  const text = 'Rosa Pilar Ortega tiene dolores; rosa y pilar no son ella, pero Rosa sí, y ortega también.';
  const dets = buildDetections(text, [], [ent(text, 'Rosa Pilar Ortega', 'person')]);
  const marked = dets.map((d) => text.slice(d.start, d.end));
  assert.deepEqual(marked, ['Rosa Pilar Ortega', 'Rosa', 'ortega']);
});

test('roles and hospital departments proposed by the model are dropped; named ones stay', () => {
  for (const v of ['paciente', 'la paciente', 'ARRENDATARIA', 'Mi madre', 'hijo menor de edad', 'Ambas partes', 'las partes', 'EL PROVEEDOR']) assert.ok(isGeneric('person', v), v);
  assert.ok(isGeneric('org', 'EL PROVEEDOR'));
  for (const v of ['Urología', 'Servicio de Oncología', 'Unidad de Cuidados Intensivos', 'Medicina Interna', 'nuestro centro']) assert.ok(isGeneric('org', v), v);
  for (const v of ['Rosa', 'Paciente Ana López', 'Madre Teresa', 'Doctor Pérez']) assert.ok(!isGeneric('person', v), v);
  for (const v of ['Servicio de Urología del Hospital Clínic', 'Hospital La Paz', 'Farmacia Pujol', 'Comunidad de Madrid']) assert.ok(!isGeneric('org', v), v);
});

test('identifiers found by their cue word are also found where they come back alone', () => {
  const text = 'Mensaje de RosaMotor: user=rosamotor_77 entra.\ngracias rosamotor_77!!';
  const dets = buildDetections(text, findRules(text), []);
  assert.deepEqual(dets.map((d) => [d.kind, text.slice(d.start, d.end)]), [['ref', 'rosamotor_77'], ['ref', 'rosamotor_77']]);
});
