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
  '2026-09-10': { conv_inicio: '10', datos_acepta: '8', datos_rechaza: '2', reco_inicio: '6', reco_resultados: '5', reco_ficha: '3', reco_asesor: '2', reco_lead_completado: '1', reco_util_si: '3', reco_util_no: '1' },
  '2026-09-11': { conv_inicio: '20', datos_acepta: '16', datos_rechaza: '4', reco_inicio: '10', reco_resultados: '9', reco_ficha: '4', reco_asesor: '3', reco_lead_completado: '2', reco_util_si: '5', reco_util_no: '1' },
};

describe('resumirPosgrado', () => {
  it('suma los pasos del flujo conversacional de cada día', () => {
    const r = P.resumirPosgrado(SERIE);
    assert.equal(r.conversaciones, 30);
    assert.equal(r.autorizaron, 24);
    assert.equal(r.pidieronAyuda, 16);
    assert.equal(r.vieronReco, 14);
    assert.equal(r.fichas, 7);
    assert.equal(r.pidieronAsesor, 5);
    assert.equal(r.leads, 3);
  });

  it('calcula quién autorizó y a quién le sirvió con redondeo', () => {
    const r = P.resumirPosgrado(SERIE);
    assert.equal(r.pctAutorizo, 80);
    assert.equal(r.pctUtil, 80);
  });

  it('el embudo va del primer mensaje al asesor, en orden', () => {
    const r = P.resumirPosgrado(SERIE);
    assert.deepEqual(r.pasos.map(([, n]) => n), [30, 24, 16, 14, 7, 5, 3]);
    assert.equal(r.pasos[0][0], 'Conversaciones');
  });

  it('no cuenta los eventos del menú viejo (turnos, notas, recibos)', () => {
    const r = P.resumirPosgrado({ '2026-09-10': { menu_shown: '90', turnos_consultados: '5', notas_consultadas: '4', prospecto_iniciado: '7' } });
    assert.equal(r.conversaciones, 0);
    assert.deepEqual(r.pasos.map(([, n]) => n), [0, 0, 0, 0, 0, 0, 0]);
  });

  it('ordena las fechas para las gráficas', () => {
    assert.deepEqual(P.resumirPosgrado(SERIE).dateKeys, ['2026-09-10', '2026-09-11']);
  });

  it('sin respuestas los porcentajes no se presentan como cero', () => {
    const r = P.resumirPosgrado({ '2026-09-10': { conv_inicio: '5' } });
    assert.equal(r.conversaciones, 5);
    assert.equal(r.pctAutorizo, null);
    assert.equal(r.pctUtil, null);
  });

  it('serie vacía o ausente da ceros', () => {
    assert.equal(P.resumirPosgrado({}).conversaciones, 0);
    assert.equal(P.resumirPosgrado(undefined).leads, 0);
  });
});
