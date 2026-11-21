import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { textoSeguro } from './noReconocidoService';

describe('lo que el bot no entendió', () => {
  it('guarda el texto sin correos ni números largos', () => {
    assert.equal(textoSeguro('mi correo es ana.perez@gmail.com'), 'mi correo es [correo]');
    assert.equal(textoSeguro('cc 1.234.567.890 por favor'), 'cc [número] por favor');
    assert.equal(textoSeguro('llámame al 300 123 4567'), 'llámame al [número]');
    assert.equal(textoSeguro('ciencias   náuticas'), 'ciencias náuticas');
    assert.equal(textoSeguro('maestría 2027'), 'maestría 2027');
    assert.equal(textoSeguro('x'.repeat(200)).length, 80);
  });
});
