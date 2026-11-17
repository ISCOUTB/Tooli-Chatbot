import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatoCifra, leerCifra } from './animar.js';

test('lee las cifras como las muestra el panel en español', () => {
  assert.equal(leerCifra('203'), 203);
  assert.equal(leerCifra(' 1.234 '), 1234);
  assert.equal(leerCifra('12.345.678'), 12345678);
  assert.equal(leerCifra('3,5'), 3.5);
  assert.equal(leerCifra('—'), null);
  assert.equal(leerCifra('4 abiertas'), null);
  assert.equal(leerCifra(''), null);
});

test('al contar, cada paso se escribe con el mismo formato que la cifra final', () => {
  assert.equal(formatoCifra(1234.4), (1234).toLocaleString('es-CO'));
  assert.equal(formatoCifra(203), '203');
  assert.equal(leerCifra(formatoCifra(98765)), 98765);
});
