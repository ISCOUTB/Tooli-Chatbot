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
  it('expresa cuánto lleva la espera, en minutos u horas, sin falsa precisión', () => {
    assert.equal(H.textoEspera(25), '25 min');
    assert.equal(H.textoEspera(125), '2 h');
    assert.equal(H.textoEspera(null), '—');
  });
});

describe('nivelEspera', () => {
  it('marca la espera en amarillo desde 15 minutos y en rojo desde 30', () => {
    assert.equal(H.nivelEspera(14), 'normal');
    assert.equal(H.nivelEspera(15), 'media');
    assert.equal(H.nivelEspera(29), 'media');
    assert.equal(H.nivelEspera(30), 'alta');
    assert.equal(H.nivelEspera(null), 'normal');
  });
});

describe('formatoMetrica', () => {
  it('distingue un dato ausente de cero', () => {
    assert.equal(H.formatoMetrica(null), '—');
    assert.equal(H.formatoMetrica(0), '0');
  });
});

describe('estadoAsesor', () => {
  it('da texto y color semántico a cada presencia', () => {
    assert.deepEqual(H.estadoAsesor('ocupado'), { texto: 'Ocupado', clase: 'is-ocupado' });
    assert.deepEqual(H.estadoAsesor('ausente'), { texto: 'Ausente', clase: 'is-ausente' });
    assert.equal(H.estadoAsesor('desconocido').texto, 'Desconectado');
  });
});

describe('bloquesVisibles', () => {
  it('muestra los bloques propios de cada rol y solo avisa servicios al asesor cuando hace falta', () => {
    assert.deepEqual(H.bloquesVisibles('admin', {}), ['pendiente', 'carga', 'servicios', 'hoy']);
    assert.deepEqual(H.bloquesVisibles('asesor', { servicios: { estado: 'ok', afectados: [] } }), ['atencion', 'seguimiento', 'hoy']);
    assert.deepEqual(H.bloquesVisibles('asesor', { servicios: { estado: 'ok', afectados: [{}] } }), ['atencion', 'servicios', 'seguimiento', 'hoy']);
    assert.deepEqual(H.bloquesVisibles('asesor', { servicios: { estado: 'error', afectados: [] } }), ['atencion', 'servicios', 'seguimiento', 'hoy']);
  });
});
