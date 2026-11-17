import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import axios from 'axios';
import { config } from '../config';
import { clearTemplateCache } from './broadcastService';
import { PlantillaInvalidaError, componentesParaMeta, nombreTecnico, validarPlantillaNueva } from './plantillaNueva';
import { crearPlantillaEnMeta, olvidarAppId } from './plantillasMeta';

const BASE = {
  nombre: 'Invitación Feria de Posgrados 2026',
  categoria: 'MARKETING',
  idioma: 'es',
  encabezado: { tipo: 'texto', texto: 'Feria de Posgrados UTB' },
  cuerpo: '¡Hola! 👋 Te invitamos a la *Feria de Posgrados* este viernes en el Campus Tecnológico.',
  pie: 'Posgrados UTB',
  botones: [
    { tipo: 'enlace', texto: 'Ver programas', url: 'https://www.utb.edu.co/posgrados/' },
    { tipo: 'respuesta', texto: 'Quiero ir' },
    { tipo: 'respuesta', texto: 'No me interesa' },
  ],
};

describe('validarPlantillaNueva', () => {
  it('arma lo que Meta pide, con las respuestas rápidas antes del enlace', () => {
    const p = validarPlantillaNueva(BASE);
    assert.equal(p.name, 'invitacion_feria_de_posgrados_2026');
    assert.deepEqual(componentesParaMeta(p), [
      { type: 'HEADER', format: 'TEXT', text: 'Feria de Posgrados UTB' },
      { type: 'BODY', text: BASE.cuerpo },
      { type: 'FOOTER', text: 'Posgrados UTB' },
      { type: 'BUTTONS', buttons: [
        { type: 'QUICK_REPLY', text: 'Quiero ir' },
        { type: 'QUICK_REPLY', text: 'No me interesa' },
        { type: 'URL', text: 'Ver programas', url: 'https://www.utb.edu.co/posgrados/' },
      ] },
    ]);
  });

  it('una plantilla mínima solo lleva el mensaje', () => {
    const p = validarPlantillaNueva({ nombre: 'aviso', categoria: 'UTILITY', cuerpo: '  Recuerda tu cita.  ' });
    assert.deepEqual(componentesParaMeta(p), [{ type: 'BODY', text: 'Recuerda tu cita.' }]);
    assert.equal(p.language, 'es');
  });

  it('con imagen exige el archivo de muestra', () => {
    const p = validarPlantillaNueva({ ...BASE, encabezado: { tipo: 'imagen' } });
    assert.throws(() => componentesParaMeta(p), /Falta la imagen/);
    assert.deepEqual(componentesParaMeta(p, '4::abc')[0], { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4::abc'] } });
  });

  it('explica cada error en palabras del asesor', () => {
    const casos: Array<[Record<string, unknown>, RegExp]> = [
      [{ nombre: '!!' }, /nombre/],
      [{ categoria: 'AUTHENTICATION' }, /marketing o de utilidad/],
      [{ idioma: 'fr' }, /idioma/],
      [{ cuerpo: '' }, /Escribe el mensaje/],
      [{ cuerpo: 'x'.repeat(1025) }, /1\.024/],
      [{ cuerpo: 'Hola {{nombre}}, te esperamos' }, /numerados como \{\{1\}\}/],
      [{ cuerpo: 'Hola {{1}}, te esperamos', ejemplosCuerpo: [''] }, /ejemplo para \{\{1\}\}/],
      [{ cuerpo: 'Hola {{2}}, te esperamos', ejemplosCuerpo: ['Ana'] }, /en orden/],
      [{ cuerpo: '{{1}}, te esperamos', ejemplosCuerpo: ['Ana'] }, /empezar ni terminar/],
      [{ cuerpo: 'Te esperamos, {{1}}', ejemplosCuerpo: ['Ana'] }, /empezar ni terminar/],
      [{ cuerpo: 'Hola {{1}, te esperamos' }, /sin cerrar/],
      [{ encabezado: { tipo: 'texto', texto: '{{1}} y {{2}}' } }, /un solo dato/],
      [{ encabezado: { tipo: 'texto', texto: 'Hola {{1}}' } }, /ejemplo para el dato del título/],
      [{ pie: 'UTB {{1}}' }, /no puede llevar datos variables/],
      [{ botones: [{ tipo: 'enlace', texto: 'Ver', url: 'https://utb.edu.co/eventos/', dinamico: true, ejemplo: 'feria 2026' }] }, /espacios/],
      [{ encabezado: { tipo: 'texto', texto: 'Dos\nlíneas' } }, /una sola línea/],
      [{ encabezado: { tipo: 'texto', texto: 'x'.repeat(61) } }, /60 caracteres/],
      [{ pie: 'x'.repeat(61) }, /60 caracteres/],
      [{ botones: [{ tipo: 'respuesta', texto: 'x'.repeat(26) }] }, /25 caracteres/],
      [{ botones: [{ tipo: 'enlace', texto: 'Ver', url: 'http://inseguro.com' }] }, /https:\/\//],
      [{ botones: [{ tipo: 'enlace', texto: 'Ver', url: 'javascript:alert(1)' }] }, /https:\/\//],
      [{ botones: [1, 2, 3, 4].map(n => ({ tipo: 'respuesta', texto: `Opción ${n}` })) }, /hasta 3/],
      [{ botones: [{ tipo: 'enlace', texto: 'A', url: 'https://a.co' }, { tipo: 'enlace', texto: 'B', url: 'https://b.co' }] }, /un solo botón con enlace/],
      [{ botones: [{ tipo: 'respuesta', texto: 'Sí' }, { tipo: 'respuesta', texto: 'sí' }] }, /lo mismo/],
    ];
    for (const [cambio, esperado] of casos) {
      assert.throws(() => validarPlantillaNueva({ ...BASE, ...cambio }), (err: unknown) => err instanceof PlantillaInvalidaError && esperado.test(err.message), JSON.stringify(cambio));
    }
  });

  it('el nombre técnico siempre empieza por letra y no supera 60 caracteres', () => {
    assert.equal(nombreTecnico('2026 Feria'), 'plantilla_2026_feria');
    assert.equal(nombreTecnico('  Ñandú & Café!!  '), 'nandu_cafe');
    assert.ok(nombreTecnico('palabra '.repeat(20)).length <= 60);
    assert.doesNotMatch(nombreTecnico('palabra '.repeat(20)), /_$/);
  });
});

describe('crearPlantillaEnMeta', () => {
  it('sube la imagen de muestra por la API de subidas y crea la plantilla', async () => {
    const originalGet = axios.get;
    const originalPost = axios.post;
    const originalMeta = { ...config.metaCloud };
    const llamadas: Array<{ url: string; params?: unknown; headers?: Record<string, string>; body?: unknown }> = [];
    Object.assign(config.metaCloud, { token: 'test-token', wabaId: '456', phoneNumberId: '123' });
    olvidarAppId();
    clearTemplateCache();
    axios.get = (async (url: string) => {
      llamadas.push({ url });
      return { data: { id: '123456789012345' } };
    }) as typeof axios.get;
    axios.post = (async (url: string, body: unknown, opciones: { params?: unknown; headers?: Record<string, string> }) => {
      llamadas.push({ url, params: opciones?.params, headers: opciones?.headers, body: url.includes('message_templates') ? body : undefined });
      if (url.endsWith('/uploads')) return { data: { id: 'upload:MTphdHRhY2htZW50?sig=ARZabc' } };
      if (url.includes('upload:')) return { data: { h: '4::aW1hZ2Vu' } };
      return { data: { id: '998877', status: 'PENDING', category: 'MARKETING' } };
    }) as typeof axios.post;
    try {
      const p = validarPlantillaNueva({ ...BASE, encabezado: { tipo: 'imagen' } });
      const creada = await crearPlantillaEnMeta(p, { base64: Buffer.from('jpg-de-prueba').toString('base64'), mime: 'image/jpeg' });
      assert.deepEqual(creada, { id: '998877', name: 'invitacion_feria_de_posgrados_2026', language: 'es', status: 'PENDING', category: 'MARKETING' });
      assert.equal(llamadas[0].url, 'https://graph.facebook.com/v20.0/app');
      assert.equal(llamadas[1].url, 'https://graph.facebook.com/v20.0/123456789012345/uploads');
      assert.deepEqual(llamadas[1].params, { file_name: 'encabezado.jpg', file_length: 13, file_type: 'image/jpeg' });
      assert.equal(llamadas[2].url, 'https://graph.facebook.com/v20.0/upload:MTphdHRhY2htZW50?sig=ARZabc');
      assert.equal(llamadas[2].headers?.Authorization, 'OAuth test-token');
      assert.equal(llamadas[3].url, 'https://graph.facebook.com/v20.0/456/message_templates');
      const cuerpo = llamadas[3].body as { components: Array<Record<string, unknown>> };
      assert.deepEqual(cuerpo.components[0], { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4::aW1hZ2Vu'] } });
    } finally {
      axios.get = originalGet;
      axios.post = originalPost;
      Object.assign(config.metaCloud, originalMeta);
      olvidarAppId();
    }
  });

  it('muestra el motivo de Meta cuando rechaza la creación', async () => {
    const originalPost = axios.post;
    const originalMeta = { ...config.metaCloud };
    const originalError = console.error;
    Object.assign(config.metaCloud, { token: 'test-token', wabaId: '456' });
    console.error = () => {};
    const error = Object.assign(new Error('Request failed with status code 400'), {
      isAxiosError: true,
      response: { status: 400, data: { error: {
        message: '(#100) Invalid parameter', error_user_title: 'Ya existe una plantilla con este nombre',
        error_user_msg: 'Usa otro nombre o elimina la existente.',
      } } },
    });
    axios.post = (async () => { throw error; }) as typeof axios.post;
    try {
      await assert.rejects(
        crearPlantillaEnMeta(validarPlantillaNueva({ ...BASE, encabezado: { tipo: 'ninguno' } }), null),
        (err: unknown) => err instanceof PlantillaInvalidaError && /Ya existe una plantilla con este nombre: Usa otro nombre/.test(err.message),
      );
      await assert.rejects(
        crearPlantillaEnMeta(validarPlantillaNueva({ ...BASE, encabezado: { tipo: 'imagen' } }), { base64: 'AAAA', mime: 'image/gif' }),
        /JPG o PNG/,
      );
    } finally {
      axios.post = originalPost;
      console.error = originalError;
      Object.assign(config.metaCloud, originalMeta);
    }
  });
});

describe('plantillas con datos variables', () => {
  it('arma los ejemplos que Meta exige y recuerda qué dato es cada variable', () => {
    const p = validarPlantillaNueva({
      ...BASE,
      encabezado: { tipo: 'texto', texto: 'Hola, {{1}}', ejemplo: 'Ana' },
      cuerpo: 'Te esperamos en {{1}} el {{2}} para hablar de {{3}}.',
      ejemplosCuerpo: ['Campus Tecnológico', ' viernes  20 de noviembre ', 'Maestría en Ingeniería', 'sobrante'],
      botones: [
        { tipo: 'enlace', texto: 'Ver evento', url: 'https://www.utb.edu.co/eventos/', dinamico: true, ejemplo: 'feria-2026' },
        { tipo: 'respuesta', texto: 'Ahí estaré' },
      ],
      significados: { 'encabezado:1': 'primer_nombre', 'cuerpo:1': 'lugar', 'cuerpo:2': 'fecha', 'cuerpo:3': 'programa', 'cuerpo:9': 'otro', 'raro': 'fecha', 'cuerpo:4': 'inventado' },
    });
    assert.deepEqual(p.significados, { 'encabezado:1': 'primer_nombre', 'cuerpo:1': 'lugar', 'cuerpo:2': 'fecha', 'cuerpo:3': 'programa' });
    assert.deepEqual(componentesParaMeta(p), [
      { type: 'HEADER', format: 'TEXT', text: 'Hola, {{1}}', example: { header_text: ['Ana'] } },
      { type: 'BODY', text: 'Te esperamos en {{1}} el {{2}} para hablar de {{3}}.', example: { body_text: [['Campus Tecnológico', 'viernes 20 de noviembre', 'Maestría en Ingeniería']] } },
      { type: 'FOOTER', text: 'Posgrados UTB' },
      { type: 'BUTTONS', buttons: [
        { type: 'QUICK_REPLY', text: 'Ahí estaré' },
        { type: 'URL', text: 'Ver evento', url: 'https://www.utb.edu.co/eventos/{{1}}', example: ['https://www.utb.edu.co/eventos/feria-2026'] },
      ] },
    ]);
  });

  it('una variable repetida cuenta una sola vez', () => {
    const p = validarPlantillaNueva({ ...BASE, cuerpo: 'Hola {{1}}, sí, {{1}}: te esperamos.', ejemplosCuerpo: ['Ana'] });
    assert.deepEqual(p.ejemplosCuerpo, ['Ana']);
  });
});

