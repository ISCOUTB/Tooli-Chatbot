import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document ??= {
  querySelector: () => null,
  querySelectorAll: () => [],
};

let estado;
before(async () => { estado = await import('./estado.js'); });

describe('estado de carga compartido', () => {
  it('escapa el mensaje y permite ocultar el reintento', () => {
    const html = estado.htmlError('<b>Error</b>', { reintentar: false });
    assert.match(html, /role="alert"/);
    assert.match(html, /&lt;b&gt;Error&lt;\/b&gt;/);
    assert.doesNotMatch(html, /data-reintentar/);
  });

  it('crea un aviso parcial con reintento', () => {
    const html = estado.htmlAvisoParcial('Falta seguimiento');
    assert.match(html, /role="status"/);
    assert.match(html, /data-reintentar/);
  });

  it('conecta todos los botones de reintento', () => {
    const eventos = [];
    const botones = [{ addEventListener: (tipo, fn) => eventos.push([tipo, fn]) }, { addEventListener: (tipo, fn) => eventos.push([tipo, fn]) }];
    const fn = () => {};
    estado.conectarReintento({ querySelectorAll: () => botones }, fn);
    assert.deepEqual(eventos, [['click', fn], ['click', fn]]);
  });

  it('marca y desmarca aria-busy', () => {
    const atributos = new Map();
    const elemento = {
      setAttribute: (nombre, valor) => atributos.set(nombre, valor),
      removeAttribute: nombre => atributos.delete(nombre),
    };
    estado.marcarCargando(elemento, true);
    assert.equal(atributos.get('aria-busy'), 'true');
    estado.marcarCargando(elemento, false);
    assert.equal(atributos.has('aria-busy'), false);
  });
});
