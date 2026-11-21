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

let M;
before(async () => { M = await import('./metricas.js'); });

const DIAS = {
  '2026-11-20': {
    conv_inicio: '10', ai_request: '7', turno_consultado: '30', notas_consultadas: '12', recibo_descargado: '5',
    no_reconocido: '3', 'no_reconocido:paso:carrera': '2', 'no_reconocido:paso:ia_sin_dato': '1',
    incidencia: '1', 'incidencia:tipo:crm': '1',
  },
  '2026-11-21': {
    conv_inicio: '5', no_reconocido: '2', 'no_reconocido:paso:carrera': '2', incidencia: '2', 'incidencia:tipo:flyer': '2',
  },
};

describe('métricas del flujo conversacional', () => {
  it('solo cuenta eventos del flujo nuevo: ni turnos, ni notas, ni recibos', () => {
    const t = M.totalesDelFlujo(DIAS);
    assert.equal(t.conv_inicio, 15);
    assert.equal(t.ai_request, 7);
    assert.equal(t.no_reconocido, 5);
    assert.equal(t.incidencia, 3);
    for (const viejo of ['turno_consultado', 'notas_consultadas', 'recibo_descargado']) assert.equal(t[viejo], undefined, viejo);
    assert.equal(Object.keys(t).some((k) => k.includes(':')), false);
  });

  it('desglosa lo que no entendió y los errores, de mayor a menor', () => {
    assert.deepEqual(M.contarPorDetalle(DIAS, 'no_reconocido', 'paso'), [['carrera', 4], ['ia_sin_dato', 1]]);
    assert.deepEqual(M.contarPorDetalle(DIAS, 'incidencia', 'tipo'), [['flyer', 2], ['crm', 1]]);
    assert.deepEqual(M.contarPorDetalle({}, 'incidencia', 'tipo'), []);
  });

  it('la lista blanca no incluye los eventos del menú anterior', () => {
    for (const viejo of ['turno_consultado', 'notas_consultadas', 'recibo_descargado', 'menu_shown']) assert.equal(M.EVENTOS_FLUJO.includes(viejo), false, viejo);
  });
});
