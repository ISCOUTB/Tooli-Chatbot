import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

/* informes.js importa utilidades de pantalla que consultan document al cargar;
   las funciones de formato no usan el DOM. */
globalThis.document ??= {
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {}, addEventListener() {}, setAttribute() {},
  }),
  body: { appendChild() {} },
  activeElement: null,
};

let I;
before(async () => { I = await import('./informes.js'); });

describe('formatoDuracion', () => {
  it('presenta minutos, horas y días de forma compacta', () => {
    assert.equal(I.formatoDuracion(12), '12 min');
    assert.equal(I.formatoDuracion(200), '3 h 20 min');
    assert.equal(I.formatoDuracion(3120), '2 d 4 h');
    assert.equal(I.formatoDuracion(null), '—');
  });
});

describe('formatoSatisfaccion', () => {
  it('usa un decimal con coma y distingue la falta de datos', () => {
    assert.equal(I.formatoSatisfaccion(4.56), '4,6/5');
    assert.equal(I.formatoSatisfaccion(null), '—');
  });
});

describe('formatoPorcentaje', () => {
  it('calcula el porcentaje de la distribución sin dividir por cero', () => {
    assert.equal(I.formatoPorcentaje(3, 12), '25%');
    assert.equal(I.formatoPorcentaje(0, 0), '0%');
  });
});
