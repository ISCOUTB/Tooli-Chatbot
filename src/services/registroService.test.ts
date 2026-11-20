import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filaDeRango } from './registroService';

describe('filaDeRango', () => {
  it('lee la fila que Sheets dice haber escrito', () => {
    assert.equal(filaDeRango('Registros!A12:F12'), 12);
    assert.equal(filaDeRango("'Registros'!A2:F2"), 2);
    assert.equal(filaDeRango('Registros!B7'), 7);
  });

  it('sin rango válido no inventa una fila', () => {
    assert.equal(filaDeRango(undefined), null);
    assert.equal(filaDeRango(''), null);
    assert.equal(filaDeRango('Registros'), null);
  });
});
