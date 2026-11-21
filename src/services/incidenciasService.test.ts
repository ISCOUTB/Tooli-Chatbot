import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detalleSeguro } from './incidenciasService';

describe('detalleSeguro', () => {
  it('tapa correos y números largos para que el panel no muestre datos personales', () => {
    const texto = detalleSeguro('No se guardó ana.perez@gmail.com con el 300 123 4567 ni la cédula 1.047.123.456');
    assert.ok(!texto.includes('@gmail'), texto);
    assert.ok(!/\d{4}/.test(texto), texto);
    assert.match(texto, /\[correo\]/);
    assert.match(texto, /\[número\]/);
  });

  it('agrega la causa del error y no pasa de 140 caracteres', () => {
    const texto = detalleSeguro('La IA no respondió', new Error('timeout de 30 s'));
    assert.match(texto, /^La IA no respondió \(/);
    assert.ok(detalleSeguro('x'.repeat(300)).length <= 140);
    assert.equal(detalleSeguro('Sin causa'), 'Sin causa');
  });
});
