import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyMarkers, assignMarkers, buildDetections, nameParts, restore } from '../src/engine/anonymize.ts';
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
  assert.deepEqual(nameParts('Ana'), []);
});
