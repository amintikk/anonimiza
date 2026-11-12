// Every way of writing each data type listed in tests/variantes.ts must be found, and the traps must not be.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { check } from './variantes.ts';

test('many ways of writing the same data are all found', () => {
  const { misses, total } = check();
  assert.equal(misses.length, 0, `${misses.length}/${total} sin detectar:\n${misses.slice(0, 20).map((m) => `${m.family}: ${JSON.stringify(m.text)}`).join('\n')}`);
});

test('numbers and words that only look like data are left alone', () => {
  assert.deepEqual(check().falsePositives, []);
});
