import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/* phone-preview.js no toca el DOM al importarse (solo define funciones),
   así que se puede importar directo sin stubs. */
import { groupMessages } from './phone-preview.js';

const msg = (ts, direction) => ({ ts, direction, text: 'hola' });

describe('groupMessages', () => {
  it('lista vacía devuelve vacío', () => {
    assert.deepEqual(groupMessages([]), []);
  });

  it('agrupa la misma dirección dentro de 3 minutos', () => {
    const grupos = groupMessages([msg(0, 'in'), msg(60_000, 'in'), msg(120_000, 'in')]);
    assert.equal(grupos.length, 1);
    assert.equal(grupos[0].length, 3);
  });

  it('corta el grupo al cambiar de dirección', () => {
    const grupos = groupMessages([msg(0, 'in'), msg(10_000, 'in'), msg(20_000, 'out')]);
    assert.equal(grupos.length, 2);
    assert.deepEqual(grupos.map(g => g.length), [2, 1]);
  });

  it('corta el grupo a los 3 minutos exactos aunque siga la dirección', () => {
    const TRES_MIN = 3 * 60 * 1000;
    const grupos = groupMessages([msg(0, 'in'), msg(TRES_MIN, 'in')]);
    assert.equal(grupos.length, 2);
  });

  it('un milisegundo antes de los 3 minutos sigue agrupando', () => {
    const TRES_MIN = 3 * 60 * 1000;
    const grupos = groupMessages([msg(0, 'out'), msg(TRES_MIN - 1, 'out')]);
    assert.equal(grupos.length, 1);
  });
});
