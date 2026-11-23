import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  burbujaDeOpcion, contenidoMensaje, contenidoNota, estabaAbajo, etiquetaPaso, opcionesDe, tamanoLegible, telefonoSimuladoBonito,
} from './simulador-whatsapp.js';

describe('simulador de WhatsApp: utilidades del panel', () => {
  it('número de prueba legible y nada más', () => {
    assert.equal(telefonoSimuladoBonito('570000123456'), '+57 0000 12 34 56');
    assert.equal(telefonoSimuladoBonito('573001234567'), '573001234567', 'un número real no se disfraza de prueba');
  });

  it('al tocar un botón se envía su id y en la burbuja se ve su título, como en el teléfono', () => {
    assert.deepEqual(burbujaDeOpcion({ id: 'conv:asesor', texto: '👤 Hablar con un asesor' }), { enviar: 'conv:asesor', mostrar: '👤 Hablar con un asesor' });
    assert.deepEqual(burbujaDeOpcion({ id: '3', titulo: 'Maestría' }), { enviar: '3', mostrar: 'Maestría' });
  });

  it('solo baja solo si quien prueba estaba al final', () => {
    assert.equal(estabaAbajo({ scrollTop: 900, clientHeight: 500, scrollHeight: 1450 }), true);
    assert.equal(estabaAbajo({ scrollTop: 200, clientHeight: 500, scrollHeight: 1450 }), false);
  });

  it('el texto del bot va escapado y con el formato de WhatsApp', () => {
    const html = contenidoMensaje({ tipo: 'texto', texto: 'Hola *Laura* <script>alert(1)</script>' });
    assert.match(html, /<strong>Laura<\/strong>/);
    assert.doesNotMatch(html, /<script>/);
  });

  it('botones, lista, imagen, documento y nota', () => {
    const botones = { tipo: 'botones', titulo: 'Tooli', texto: '¿Qué buscas?', pie: 'UTB', botones: [{ id: '1', texto: 'Maestría' }] };
    assert.match(contenidoMensaje(botones), /wsim-pie/);
    assert.deepEqual(opcionesDe(botones), [{ id: '1', texto: 'Maestría' }]);
    const lista = { tipo: 'lista', titulo: 'T', texto: 'D', boton: 'Ver', secciones: [{ titulo: 'S', filas: [{ id: 'a', titulo: 'A' }, { id: 'b', titulo: 'B' }] }] };
    assert.deepEqual(opcionesDe(lista).map(o => o.id), ['a', 'b']);
    assert.match(contenidoMensaje({ tipo: 'imagen', src: 'data:image/jpeg;base64,AAA', pie: 'Flyer' }), /<img class="wsim-imagen" src="data:image\/jpeg;base64,AAA" alt="Flyer"/);
    assert.match(contenidoMensaje({ tipo: 'documento', nombre: 'recibo.pdf', mimetype: 'application/pdf', bytes: 52_000 }), /PDF[\s\S]*recibo\.pdf[\s\S]*51 KB/);
    assert.equal(tamanoLegible(3 * 1024 * 1024), '3,0 MB');
    assert.match(contenidoNota({ servicio: 'Google Sheets', texto: 'No se agregó.' }), /Google Sheets/);
    assert.match(contenidoNota({ servicio: 'Chatwoot', texto: 'Un asesor habría recibido:\nresumen largo' }), /<details/);
  });

  it('pasos del flujo con nombre legible', () => {
    assert.equal(etiquetaPaso('reco_nombre'), 'Asesor · nombre');
    assert.equal(etiquetaPaso('paso_nuevo'), 'paso_nuevo');
    assert.equal(etiquetaPaso(null), 'Sin conversación');
  });
});
