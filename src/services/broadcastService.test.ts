import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import axios, { AxiosError } from 'axios';
import { config } from '../config';
import { clearTemplateCache, extractError, listApprovedTemplates } from './broadcastService';

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
    const { sendTemplateToRecipient } = await import('./broadcastService');
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
