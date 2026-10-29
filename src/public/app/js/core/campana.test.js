import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DESTINATARIOS_CAMPANA, normalizarTelefonoCampana, parseListaCampana } from './campana.js';

describe('normalizarTelefonoCampana', () => {
  it('agrega el 57 a los celulares colombianos sin indicativo', () => {
    assert.equal(normalizarTelefonoCampana('300 111 2233'), '573001112233');
    assert.equal(normalizarTelefonoCampana('+57 300 111 2233'), '573001112233');
    assert.equal(normalizarTelefonoCampana('+1 305 555 0101'), '13055550101');
  });
});

describe('parseListaCampana', () => {
  it('lee lo que se pega desde Excel (tabulaciones) y salta el encabezado', () => {
    const r = parseListaCampana('Teléfono\tNombre\tPregrado\n3001112233\tLAURA GÓMEZ\tINGENIERIA INDUSTRIAL\n573004445566\tAndrés Pérez\tDerecho\n');
    assert.deepEqual(r.destinatarios, [
      { telefono: '573001112233', nombre: 'LAURA GÓMEZ', pregrado: 'INGENIERIA INDUSTRIAL' },
      { telefono: '573004445566', nombre: 'Andrés Pérez', pregrado: 'Derecho' },
    ]);
    assert.deepEqual(r.errores, []);
  });

  it('acepta CSV con punto y coma o con comas, y comillas', () => {
    assert.equal(parseListaCampana('3001112233;Laura;Psicología').destinatarios[0].pregrado, 'Psicología');
    assert.equal(parseListaCampana('"3001112233","Laura","Finanzas, Negocios"').destinatarios[0].pregrado, 'Finanzas, Negocios');
  });

  it('reporta por línea lo que no sirve, cuenta duplicados y sin pregrado', () => {
    const r = parseListaCampana('123\tNadie\tDerecho\n3001112233\t\tDerecho\n3004445566\tAna\t\n300 444 5566\tAna otra vez\tDerecho');
    assert.deepEqual(r.errores, [{ linea: 1, motivo: 'teléfono inválido' }, { linea: 2, motivo: 'falta el nombre' }]);
    assert.equal(r.destinatarios.length, 1);
    assert.equal(r.duplicados, 1);
    assert.equal(r.sinPregrado, 1);
  });

  it('avisa si la lista pasa del máximo por envío', () => {
    const lista = Array.from({ length: MAX_DESTINATARIOS_CAMPANA + 1 }, (_, i) => `57300${String(1000000 + i)}\tPersona ${i}\tDerecho`).join('\n');
    assert.equal(parseListaCampana(lista).excedeMaximo, true);
    assert.equal(parseListaCampana('').destinatarios.length, 0);
  });
});
