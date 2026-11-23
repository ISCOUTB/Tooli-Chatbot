import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  avanceCortes, cortesDesdeNotas, leerNotasEscritas, necesarioParaPasar, promedio, reglaNotas,
} from './calculos';
import { armarCalculo } from './notasVista';

const REGLA = { notaMinima: 3.0, notaMaxima: 5.0, pesosCortes: [30, 30, 40], sinConfirmar: true };

describe('regla de notas', () => {
  it('trae 3.0 y 30/30/40 por defecto y se marca como sin confirmar', () => {
    const r = reglaNotas({});
    assert.equal(r.notaMinima, 3.0);
    assert.deepEqual(r.pesosCortes, [30, 30, 40]);
    assert.equal(r.sinConfirmar, true);
  });

  it('se parametriza por variables y exige que los pesos sumen 100', () => {
    const r = reglaNotas({ TOOLI_NOTA_MINIMA: '3.5', TOOLI_CORTES_PESOS: '20,20,20,40', TOOLI_REGLA_NOTAS_CONFIRMADA: '1' });
    assert.equal(r.notaMinima, 3.5);
    assert.deepEqual(r.pesosCortes, [20, 20, 20, 40]);
    assert.equal(r.sinConfirmar, false);
    assert.deepEqual(reglaNotas({ TOOLI_CORTES_PESOS: '50,40' }).pesosCortes, [30, 30, 40]);
    assert.equal(reglaNotas({ TOOLI_NOTA_MINIMA: '9' }).notaMinima, 3.0);
  });
});

describe('promedio y avance', () => {
  it('promedia solo notas válidas', () => {
    assert.equal(promedio([4, 3, '5', 'x', null, undefined, 7]), 4);
    assert.equal(promedio([]), null);
    assert.equal(promedio(['abc']), null);
  });

  it('calcula lo ganado por corte', () => {
    const a = avanceCortes(cortesDesdeNotas([4, 3], REGLA));
    assert.equal(a.acumulado, 2.1); // 4*0.3 + 3*0.3
    assert.equal(a.pesoCursado, 60);
    assert.equal(a.pesoPendiente, 40);
    assert.equal(a.promedioCursado, 3.5);
  });
});

describe('cuánto necesito en el final para pasar', () => {
  it('caso posible', () => {
    const n = necesarioParaPasar(cortesDesdeNotas([3.5, 3.5], REGLA), REGLA);
    // ganado 2.1, falta 0.9 sobre el 40 % -> 2.25
    assert.deepEqual(n, { caso: 'posible', necesaria: 2.25 });
  });

  it('ya aprobada aunque saque cero', () => {
    assert.deepEqual(necesarioParaPasar(cortesDesdeNotas([5, 5], REGLA), REGLA), { caso: 'ya_aprobada', necesaria: 0 });
  });

  it('imposible cuando pasa de 5', () => {
    const n = necesarioParaPasar(cortesDesdeNotas([1, 1], REGLA), REGLA);
    assert.equal(n.caso, 'imposible');
    assert.ok(n.caso === 'imposible' && n.necesaria > 5);
  });

  it('sin pendientes devuelve la definitiva', () => {
    assert.deepEqual(necesarioParaPasar(cortesDesdeNotas([4, 4, 4], REGLA), REGLA), { caso: 'sin_pendientes', definitiva: 4 });
  });

  it('sin datos', () => {
    assert.deepEqual(necesarioParaPasar([], REGLA), { caso: 'sin_datos' });
  });

  it('respeta una nota mínima distinta', () => {
    const n = necesarioParaPasar(cortesDesdeNotas([3.5, 3.5], REGLA), { ...REGLA, notaMinima: 3.5 });
    assert.deepEqual(n, { caso: 'posible', necesaria: 3.5 });
  });
});

describe('notas escritas por la persona', () => {
  it('lee decimales con punto o coma y descarta lo imposible', () => {
    assert.deepEqual(leerNotasEscritas('3.5, 4,0 y 7 y 2'), [3.5, 4, 2]);
    assert.deepEqual(leerNotasEscritas('nada'), []);
  });

  it('arma la respuesta de WhatsApp y la de voz', () => {
    const r = armarCalculo([3.5, 3.5], REGLA);
    assert.match(r.paraTexto, /2\.3|2\.2/);
    assert.match(r.paraTexto, /por confirmar/);
    assert.match(r.paraVoz, /dos punto dos cinco/);
    assert.match(armarCalculo([5, 5], REGLA).paraVoz, /ya aseguraste/);
    assert.match(armarCalculo([1, 1], REGLA).paraVoz, /ya no se alcanza/);
  });
});
