import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  claveDePlantilla, estadoEnvio, motivoNoEnviable, partesPlantilla, variablesDePlantilla,
} from './plantillas.js';

const SIMPLE = { name: 'aviso', language: 'es_CO', components: [{ type: 'BODY', text: 'Aviso de prueba' }] };
const COMPLETA = {
  name: 'gracias', language: 'es_CO',
  components: [
    { type: 'HEADER', format: 'TEXT', text: 'Gracias' },
    { type: 'body', text: 'Fue un gusto *verte*' },
    { type: 'FOOTER', text: 'UTB' },
    { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Más información' }, { type: 'URL', text: 'Ver programas', url: 'https://www.utb.edu.co' }, { type: 'URL' }] },
  ],
};
const CON_VARIABLES = {
  name: 'campana', language: 'es_CO',
  components: [{ type: 'BODY', text: 'Hola {{1}}, por tu pregrado en {{2}}… {{1}}', example: { body_text: [['Ana {{9}}', 'Sistemas']] } }],
};
const EJEMPLO = 'https://scontent.whatsapp.net/v/afiche.png?oh=firma';
const CON_IMAGEN = { name: 'afiche', language: 'es', components: [{ type: 'HEADER', format: 'IMAGE', example: { header_handle: [EJEMPLO] } }, { type: 'BODY', text: 'Mira el afiche' }] };
const IMAGEN_SIN_EJEMPLO = { name: 'afiche', language: 'es', components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Mira el afiche' }] };
const CON_UBICACION = { name: 'sede', language: 'es', components: [{ type: 'HEADER', format: 'LOCATION' }, { type: 'BODY', text: 'Aquí estamos' }] };

test('separa las partes visibles de la plantilla', () => {
  assert.deepEqual(partesPlantilla(COMPLETA), {
    encabezado: 'Gracias', encabezadoMedia: '', encabezadoEjemplo: '', cuerpo: 'Fue un gusto *verte*', pie: 'UTB',
    botones: [{ texto: 'Más información', tipo: 'QUICK_REPLY' }, { texto: 'Ver programas', tipo: 'URL' }],
  });
  assert.deepEqual(partesPlantilla(SIMPLE), { encabezado: '', encabezadoMedia: '', encabezadoEjemplo: '', cuerpo: 'Aviso de prueba', pie: '', botones: [] });
  assert.equal(partesPlantilla(CON_IMAGEN).encabezadoMedia, 'IMAGE');
  assert.equal(partesPlantilla(CON_IMAGEN).encabezadoEjemplo, EJEMPLO);
  assert.equal(partesPlantilla(IMAGEN_SIN_EJEMPLO).encabezadoEjemplo, '');
  assert.deepEqual(partesPlantilla(null), { encabezado: '', encabezadoMedia: '', encabezadoEjemplo: '', cuerpo: '', pie: '', botones: [] });
});

test('cuenta las variables una vez cada una y sin mirar los ejemplos de Meta', () => {
  assert.equal(variablesDePlantilla(SIMPLE), 0);
  assert.equal(variablesDePlantilla(CON_VARIABLES), 2);
  assert.equal(variablesDePlantilla({ components: [{ type: 'BODY', text: 'Hola {{nombre}}' }] }), 1);
});

test('explica por qué una plantilla no se envía desde esta pantalla', () => {
  assert.equal(motivoNoEnviable(SIMPLE), '');
  assert.equal(motivoNoEnviable(COMPLETA), '');
  assert.match(motivoNoEnviable(CON_VARIABLES), /2 variables.*Campaña por pregrado/);
  // Con imagen sí se envía: sale con el archivo que Meta aprobó.
  assert.equal(motivoNoEnviable(CON_IMAGEN), '');
  assert.match(motivoNoEnviable(IMAGEN_SIN_EJEMPLO), /no entregó el archivo/);
  assert.match(motivoNoEnviable(CON_UBICACION), /ubicación/);
});

test('una plantilla se identifica por nombre e idioma', () => {
  assert.equal(claveDePlantilla(SIMPLE), 'aviso|es_CO');
  assert.notEqual(claveDePlantilla(SIMPLE), claveDePlantilla({ ...SIMPLE, language: 'en' }));
});

test('resume el estado de un envío', () => {
  assert.deepEqual(estadoEnvio({ estado: 'procesando', enviados: 1, fallidos: 0 }), { texto: 'En proceso', tono: 'info' });
  assert.deepEqual(estadoEnvio({ estado: 'completado', enviados: 3, fallidos: 0 }), { texto: 'Enviado', tono: 'ok' });
  assert.deepEqual(estadoEnvio({ estado: 'completado', enviados: 2, fallidos: 1 }), { texto: 'Con fallos', tono: 'aviso' });
  assert.deepEqual(estadoEnvio({ estado: 'completado', enviados: 0, fallidos: 3 }), { texto: 'No se envió', tono: 'error' });
});
