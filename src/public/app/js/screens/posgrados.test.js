import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= {};
globalThis.navigator ??= {};
globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
globalThis.document ??= {
  addEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
  head: { appendChild() {} },
  body: { appendChild() {} },
};

let P;
before(async () => { P = await import('./posgrados.js'); });

const SERIE = {
  '2026-09-10': { prospecto_iniciado: '10', prospecto_completado: '4', registro_iniciado: '8', registro_completado: '2', programas_especializaciones: '1', programas_maestrias: '2', programas_doctorados: '1' },
  '2026-09-11': { prospecto_iniciado: '20', prospecto_completado: '6', registro_iniciado: '12', registro_completado: '3', programas_especializaciones: '3', programas_maestrias: '1', programas_doctorados: '0' },
};

describe('resumirPosgrado', () => {
  it('suma los eventos reales de cada día', () => {
    const r = P.resumirPosgrado(SERIE);
    assert.equal(r.prospectos, 10);
    assert.equal(r.prospInicio, 30);
    assert.equal(r.registros, 5);
    assert.equal(r.regInicio, 20);
    assert.equal(r.especs, 4);
    assert.equal(r.maestrias, 3);
    assert.equal(r.doctorados, 1);
  });

  it('calcula las conversiones con redondeo', () => {
    const r = P.resumirPosgrado(SERIE);
    assert.equal(r.conv, 33);
    assert.equal(r.regConv, 25);
  });

  it('ordena las fechas para las gráficas', () => {
    const r = P.resumirPosgrado(SERIE);
    assert.deepEqual(r.dateKeys, ['2026-09-10', '2026-09-11']);
  });

  it('las claves que faltan cuentan como cero, no como NaN', () => {
    // El mock local no emite las claves de posgrado: el resumen debe dar 0.
    const r = P.resumirPosgrado({ '2026-09-10': { menu_shown: 90 } });
    assert.equal(r.prospectos, 0);
    assert.equal(r.conv, null);
    assert.equal(r.regConv, null);
  });

  it('sin iniciados la conversión no se presenta como cero', () => {
    const r = P.resumirPosgrado({ '2026-09-10': { prospecto_completado: '5' } });
    assert.equal(r.prospectos, 5);
    assert.equal(r.conv, null);
  });

  it('serie vacía o ausente da ceros', () => {
    assert.equal(P.resumirPosgrado({}).prospectos, 0);
    assert.equal(P.resumirPosgrado(undefined).registros, 0);
  });
});
