import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document ??= {
  addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
  createElement: () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {} }, appendChild() {}, addEventListener() {}, setAttribute() {} }),
  body: { appendChild() {} }, activeElement: null,
};

let H;
before(async () => { H = await import('./home.js'); });

describe('textoEspera', () => {
  it('expresa minutos y horas sin falsa precisión', () => {
    assert.equal(H.textoEspera(25), 'hace 25 min');
    assert.equal(H.textoEspera(125), 'hace 2 h');
  });
});

describe('formatoMetrica', () => {
  it('distingue un dato ausente de cero', () => {
    assert.equal(H.formatoMetrica(null), '—');
    assert.equal(H.formatoMetrica(0), '0');
  });
});

describe('bloquesVisibles', () => {
  it('muestra los bloques propios de cada rol y solo avisa servicios al asesor cuando hace falta', () => {
    assert.deepEqual(H.bloquesVisibles('admin', {}), ['pendiente', 'carga', 'servicios', 'hoy']);
    assert.deepEqual(H.bloquesVisibles('asesor', { servicios: { estado: 'ok', afectados: [] } }), ['atencion', 'seguimiento', 'hoy']);
    assert.deepEqual(H.bloquesVisibles('asesor', { servicios: { estado: 'ok', afectados: [{}] } }), ['atencion', 'seguimiento', 'servicios', 'hoy']);
    assert.deepEqual(H.bloquesVisibles('asesor', { servicios: { estado: 'error', afectados: [] } }), ['atencion', 'seguimiento', 'servicios', 'hoy']);
  });
});
