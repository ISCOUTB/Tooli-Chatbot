import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filaDeRango, pedidoNombreProspecto } from './registroService';

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

describe('pedidoNombreProspecto', () => {
  it('cambiar el nombre escribe solo la columna B de esa fila: el correo y el programa no se tocan', () => {
    assert.deepEqual(pedidoNombreProspecto(12, 'Laura Gómez'), { range: 'Registros!B12', values: [['Laura Gómez']] });
  });

  it('una fila inválida no escribe nada', () => {
    for (const fila of [0, 1, 2.5, Number.NaN]) assert.throws(() => pedidoNombreProspecto(fila, 'Laura'), String(fila));
  });
});
