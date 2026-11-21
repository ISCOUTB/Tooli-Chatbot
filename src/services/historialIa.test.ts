import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recortarHistorial } from './historialIa';

describe('recortarHistorial', () => {
  it('una conversación corta va completa', () => {
    assert.deepEqual(recortarHistorial([1, 2, 3, 4], 10), [1, 2, 3, 4]);
  });

  it('en una larga van la primera pregunta con su respuesta y las últimas', () => {
    const historial = Array.from({ length: 16 }, (_, i) => i + 1);
    assert.deepEqual(recortarHistorial(historial, 10), [1, 2, 9, 10, 11, 12, 13, 14, 15, 16]);
    assert.equal(recortarHistorial(historial, 10).length, 10);
  });
});
