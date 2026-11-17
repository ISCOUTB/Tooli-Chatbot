import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import axios, { AxiosError } from 'axios';
import { config } from '../config';
import {
  BroadcastValidationError, clearEncabezadoCache, clearTemplateCache, extractError, listApprovedTemplates,
  prepararEncabezado, sendTemplateToRecipient,
} from './broadcastService';

describe('listApprovedTemplates', () => {
  it('recorre todas las páginas antes de guardar la lista en caché', async () => {
    const originalGet = axios.get;
    const originalToken = config.metaCloud.token;
    const originalWabaId = config.metaCloud.wabaId;
    const calls: Array<{ url: string; after: unknown }> = [];
    config.metaCloud.token = 'test-token';
    config.metaCloud.wabaId = '12345';
    clearTemplateCache();
    axios.get = (async (url: string, options?: { params?: { after?: string } }) => {
      calls.push({ url, after: options?.params?.after });
      return options?.params?.after
        ? { data: { data: [{ name: 'segunda', language: 'es_CO', category: 'UTILITY', components: [] }] } }
        : { data: { data: [{ name: 'primera', language: 'es_CO', category: 'UTILITY', components: [] }], paging: { next: 'https://example.invalid/next', cursors: { after: 'cursor-2' } } } };
    }) as typeof axios.get;

    try {
      const templates = await listApprovedTemplates();
      assert.deepEqual(templates.map(t => t.name), ['primera', 'segunda']);
      assert.deepEqual(calls, [
        { url: 'https://graph.facebook.com/v20.0/12345/message_templates', after: undefined },
        { url: 'https://graph.facebook.com/v20.0/12345/message_templates', after: 'cursor-2' },
      ]);
      await listApprovedTemplates();
      assert.equal(calls.length, 2);
    } finally {
      axios.get = originalGet;
      config.metaCloud.token = originalToken;
      config.metaCloud.wabaId = originalWabaId;
      clearTemplateCache();
    }
  });

  it('falla ante un cursor repetido y no guarda una lista incompleta', async () => {
    const originalGet = axios.get;
    const originalToken = config.metaCloud.token;
    const originalWabaId = config.metaCloud.wabaId;
    let calls = 0;
    config.metaCloud.token = 'test-token';
    config.metaCloud.wabaId = '12345';
    clearTemplateCache();
    axios.get = (async () => {
      calls++;
      return { data: { data: [], paging: { next: 'next', cursors: { after: 'same' } } } };
    }) as typeof axios.get;
    try {
      await assert.rejects(listApprovedTemplates(), /Paginación/);
      await assert.rejects(listApprovedTemplates(), /Paginación/);
      assert.equal(calls, 4);
    } finally {
      axios.get = originalGet;
      config.metaCloud.token = originalToken;
      config.metaCloud.wabaId = originalWabaId;
      clearTemplateCache();
    }
  });
});

describe('extractError', () => {
  it('expone solo estado/código de Meta, sin texto externo ni teléfono', () => {
    const err = new AxiosError('Error para 573001234567');
    err.response = {
      status: 400,
      data: { error: { code: 131047, message: 'Hola 573001234567, dato privado' } },
    } as typeof err.response;
    assert.equal(extractError(err), 'Meta rechazó el envío (HTTP 400, código 131047)');
  });

  it('señala como no confirmado un timeout que pudo llegar a Meta', () => {
    const err = new AxiosError('timeout para 573001234567');
    assert.equal(extractError(err), 'Resultado del envío no confirmado; revisar antes de reenviar.');
  });
});

describe('sendTemplateToRecipient', () => {
  it('llena las variables del cuerpo en orden y no manda componentes si no hay', async () => {
    const originalPost = axios.post;
    const originalMeta = { ...config.metaCloud };
    const bodies: unknown[] = [];
    config.metaCloud.token = 'test-token';
    config.metaCloud.phoneNumberId = '123';
    axios.post = (async (_url: string, body: unknown) => { bodies.push(body); return { data: {} }; }) as typeof axios.post;
    try {
      await sendTemplateToRecipient('campana', 'es_CO', '573001112233', ['Laura', 'Ingeniería Industrial']);
      await sendTemplateToRecipient('aviso', 'es_CO', '573001112233');
      assert.deepEqual((bodies[0] as { template: unknown }).template, {
        name: 'campana',
        language: { code: 'es_CO' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Laura' }, { type: 'text', text: 'Ingeniería Industrial' }] }],
      });
      assert.deepEqual((bodies[1] as { template: unknown }).template, { name: 'aviso', language: { code: 'es_CO' } });
    } finally {
      axios.post = originalPost;
      Object.assign(config.metaCloud, originalMeta);
    }
  });
});

describe('plantillas con archivo en el encabezado', () => {
  const EJEMPLO = 'https://scontent.whatsapp.net/v/t61/invitacion.png?oh=firma&oe=6F000000';
  const PLANTILLAS = [
    { name: 'invitacion', language: 'es', category: 'MARKETING', components: [{ type: 'HEADER', format: 'IMAGE', example: { header_handle: [EJEMPLO] } }, { type: 'BODY', text: 'Te invitamos' }] },
    { name: 'aviso', language: 'es', category: 'UTILITY', components: [{ type: 'BODY', text: 'Aviso' }] },
  ];

  it('sube a Meta la imagen aprobada una sola vez y la adjunta al enviar', async () => {
    const originalGet = axios.get;
    const originalPost = axios.post;
    const originalMeta = { ...config.metaCloud };
    const descargas: string[] = [];
    const subidas: Array<{ url: string; tipo: unknown; archivo: unknown }> = [];
    const mensajes: unknown[] = [];
    Object.assign(config.metaCloud, { token: 'test-token', phoneNumberId: '123', wabaId: '456' });
    clearTemplateCache();
    clearEncabezadoCache();
    axios.get = (async (url: string) => {
      if (url.includes('/message_templates')) return { data: { data: PLANTILLAS } };
      descargas.push(url);
      return { data: Buffer.from('png-de-prueba'), headers: { 'content-type': 'image/png; charset=binary' } };
    }) as typeof axios.get;
    axios.post = (async (url: string, body: unknown) => {
      if (url.endsWith('/media')) {
        const form = body as FormData;
        subidas.push({ url, tipo: form.get('type'), archivo: (form.get('file') as File).name });
        return { data: { id: '987654321' } };
      }
      mensajes.push(body);
      return { data: {} };
    }) as typeof axios.post;
    try {
      const encabezado = await prepararEncabezado('invitacion', 'es');
      assert.deepEqual(encabezado, { tipo: 'image', mediaId: '987654321' });
      assert.deepEqual(descargas, [EJEMPLO]);
      assert.deepEqual(subidas, [{ url: 'https://graph.facebook.com/v20.0/123/media', tipo: 'image/png', archivo: 'encabezado.png' }]);

      // Un segundo envío de la misma plantilla reutiliza el archivo ya subido.
      assert.deepEqual(await prepararEncabezado('invitacion', 'es'), encabezado);
      assert.equal(subidas.length, 1);
      // Una plantilla sin archivo no descarga ni sube nada.
      assert.equal(await prepararEncabezado('aviso', 'es'), null);
      assert.equal(descargas.length, 1);

      await sendTemplateToRecipient('invitacion', 'es', '573001112233', [], encabezado);
      assert.deepEqual((mensajes[0] as { template: unknown }).template, {
        name: 'invitacion',
        language: { code: 'es' },
        components: [{ type: 'header', parameters: [{ type: 'image', image: { id: '987654321' } }] }],
      });
    } finally {
      axios.get = originalGet;
      axios.post = originalPost;
      Object.assign(config.metaCloud, originalMeta);
      clearTemplateCache();
      clearEncabezadoCache();
    }
  });

  it('si el archivo no se puede preparar, el envío no se crea y el asesor lo sabe', async () => {
    const originalGet = axios.get;
    const originalPost = axios.post;
    const originalMeta = { ...config.metaCloud };
    const originalError = console.error;
    let subidas = 0;
    Object.assign(config.metaCloud, { token: 'test-token', phoneNumberId: '123', wabaId: '456' });
    clearTemplateCache();
    clearEncabezadoCache();
    console.error = () => {};
    axios.post = (async () => { subidas++; return { data: { id: '987654321' } }; }) as typeof axios.post;
    try {
      // La descarga falla (dirección vencida).
      axios.get = (async (url: string) => {
        if (url.includes('/message_templates')) return { data: { data: PLANTILLAS } };
        throw new Error('403 URL signature expired');
      }) as typeof axios.get;
      await assert.rejects(prepararEncabezado('invitacion', 'es'), (err: unknown) =>
        err instanceof BroadcastValidationError && /No se pudo preparar el archivo/.test(err.message));

      // Llega algo que no es una imagen.
      axios.get = (async (url: string) => {
        if (url.includes('/message_templates')) return { data: { data: PLANTILLAS } };
        return { data: Buffer.from('<html>'), headers: { 'content-type': 'text/html' } };
      }) as typeof axios.get;
      await assert.rejects(prepararEncabezado('invitacion', 'es'), /no es del tipo que declara/);
      assert.equal(subidas, 0, 'nunca se sube a Meta un archivo que no se pudo validar');

      await assert.rejects(prepararEncabezado('no_existe', 'es'), /no está aprobado o no existe/);
    } finally {
      axios.get = originalGet;
      axios.post = originalPost;
      console.error = originalError;
      Object.assign(config.metaCloud, originalMeta);
      clearTemplateCache();
      clearEncabezadoCache();
    }
  });
});

describe('archivos más pesados que el tope de WhatsApp', () => {
  const EJEMPLO = 'https://scontent.whatsapp.net/v/t61/afiche.png?oh=firma&oe=6F000000';
  const PLANTILLAS = [
    { name: 'afiche', language: 'es', category: 'MARKETING', components: [{ type: 'HEADER', format: 'IMAGE', example: { header_handle: [EJEMPLO] } }, { type: 'BODY', text: 'Mira' }] },
  ];
  const SEIS_MB = Buffer.alloc(6 * 1024 * 1024 + 300_000, 1);

  it('una imagen de 6 MB se reduce antes de subirla a Meta', async () => {
    const originalGet = axios.get;
    const originalPost = axios.post;
    const originalMeta = { ...config.metaCloud };
    const subidas: Array<{ tipo: unknown; bytes: number }> = [];
    const reducidas: Array<[number, string]> = [];
    Object.assign(config.metaCloud, { token: 'test-token', phoneNumberId: '123', wabaId: '456' });
    clearTemplateCache();
    clearEncabezadoCache();
    axios.get = (async (url: string) => url.includes('/message_templates')
      ? { data: { data: PLANTILLAS } }
      : { data: SEIS_MB, headers: { 'content-type': 'image/png' } }) as typeof axios.get;
    axios.post = (async (_url: string, body: FormData) => {
      subidas.push({ tipo: body.get('type'), bytes: (body.get('file') as File).size });
      return { data: { id: '123456789' } };
    }) as typeof axios.post;
    const reducir = async (buffer: Buffer, mime: string) => {
      reducidas.push([buffer.length, mime]);
      return { buffer: Buffer.alloc(800_000, 2), mime: 'image/jpeg' as const };
    };
    try {
      assert.deepEqual(await prepararEncabezado('afiche', 'es', reducir), { tipo: 'image', mediaId: '123456789' });
      assert.deepEqual(reducidas, [[SEIS_MB.length, 'image/png']]);
      assert.deepEqual(subidas, [{ tipo: 'image/jpeg', bytes: 800_000 }]);
    } finally {
      axios.get = originalGet;
      axios.post = originalPost;
      Object.assign(config.metaCloud, originalMeta);
      clearTemplateCache();
      clearEncabezadoCache();
    }
  });

  it('una imagen liviana se sube tal cual y un video pesado se rechaza con su tamaño', async () => {
    const { ajustarAlTope } = await import('./broadcastService');
    const liviana = Buffer.alloc(1000, 1);
    const sinReducir = async () => { throw new Error('no debía reducirse'); };
    assert.deepEqual(await ajustarAlTope('image', liviana, 'image/png', sinReducir), { buffer: liviana, mime: 'image/png', reducida: false });
    await assert.rejects(
      ajustarAlTope('video', Buffer.alloc(17 * 1024 * 1024), 'video/mp4', sinReducir),
      (err: unknown) => err instanceof BroadcastValidationError && /video pesa 17,0 MB.*hasta 16,0 MB/.test(err.message),
    );
    const originalError = console.error;
    console.error = () => {};
    try {
      // Si no se logra reducir, el asesor sabe qué hacer.
      await assert.rejects(ajustarAlTope('image', SEIS_MB, 'image/png', sinReducir), /no se pudo reducir. Usa una imagen más liviana/);
    } finally {
      console.error = originalError;
    }
  });
});

describe('componentesDelEnvio', () => {
  it('pone cada valor en su lugar: imagen, cuerpo y final del enlace', async () => {
    const { componentesDelEnvio } = await import('./broadcastService');
    const ranuras = [
      { lugar: 'cuerpo', numero: 1 }, { lugar: 'cuerpo', numero: 2 }, { lugar: 'boton', indice: 0, numero: 1 },
    ] as const;
    assert.deepEqual(componentesDelEnvio(['Ana', 'Feria de posgrados', 'feria posgrados'], { tipo: 'image', mediaId: '987' }, [...ranuras]), [
      { type: 'header', parameters: [{ type: 'image', image: { id: '987' } }] },
      { type: 'body', parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: 'Feria de posgrados' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'feria%20posgrados' }] },
    ]);
  });

  it('un encabezado de texto con variable lleva su valor', async () => {
    const { componentesDelEnvio } = await import('./broadcastService');
    assert.deepEqual(componentesDelEnvio(['35.000', '42'], null, [{ lugar: 'cuerpo', numero: 1 }, { lugar: 'encabezado', numero: 1 }]), [
      { type: 'header', parameters: [{ type: 'text', text: '42' }] },
      { type: 'body', parameters: [{ type: 'text', text: '35.000' }] },
    ]);
  });

  it('un trabajo viejo, sin ranuras, manda todo al cuerpo como antes', async () => {
    const { componentesDelEnvio } = await import('./broadcastService');
    assert.deepEqual(componentesDelEnvio(['Laura', 'Industrial'], null), [
      { type: 'body', parameters: [{ type: 'text', text: 'Laura' }, { type: 'text', text: 'Industrial' }] },
    ]);
    assert.deepEqual(componentesDelEnvio([], null), []);
  });
});

