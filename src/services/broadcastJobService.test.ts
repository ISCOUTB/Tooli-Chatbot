import { it } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { config } from '../config';
import { clearTemplateCache } from './broadcastService';
import { BroadcastJob, enqueueBroadcast, enviarADestinatario, getBroadcastJob, guardarContextoEnviado } from './broadcastJobService';

it('crea un trabajo persistente y reintentos idénticos reutilizan el mismo ID', async () => {
  const originalGet = axios.get;
  const originalMeta = { ...config.metaCloud };
  const values = new Map<string, string>();
  let writes = 0;
  let templateReads = 0;
  const store = {
    async get(key: string) { return values.get(key) ?? null; },
    async eval(_script: string, numKeys: number, ...args: string[]) {
      writes++;
      const [dedupeKey, jobKey] = args.slice(0, numKeys);
      const [id, payload] = args.slice(numKeys);
      if (values.has(dedupeKey)) return values.get(dedupeKey)!;
      values.set(jobKey, payload);
      values.set(dedupeKey, id);
      return id;
    },
  };
  config.metaCloud.token = 'test-token';
  config.metaCloud.phoneNumberId = '123';
  config.metaCloud.wabaId = '456';
  clearTemplateCache();
  axios.get = (async () => {
    templateReads++;
    return { data: { data: [{ name: 'aviso', language: 'es_CO', category: 'UTILITY', components: [] }] } };
  }) as typeof axios.get;
  try {
    const first = await enqueueBroadcast('aviso', 'es_CO', ['+57 300 123 4567', '573009876543'], 'admin', store);
    const retry = await enqueueBroadcast('aviso', 'es-CO', ['573009876543', '573001234567'], 'admin', store);
    assert.equal(first.id, retry.id);
    assert.equal(first.estado, 'pendiente');
    assert.deepEqual((await getBroadcastJob(first.id, store))?.destinatarios, ['573001234567', '573009876543']);
    assert.equal(writes, 1);
    assert.equal(templateReads, 1);
  } finally {
    axios.get = originalGet;
    Object.assign(config.metaCloud, originalMeta);
    clearTemplateCache();
  }
});

it('campaña: cada destinatario lleva sus variables y su contexto; al que le faltan datos no se le envía', async () => {
  const originalGet = axios.get;
  const originalMeta = { ...config.metaCloud };
  const values = new Map<string, string>();
  const store = {
    async get(key: string) { return values.get(key) ?? null; },
    async eval(_script: string, numKeys: number, ...args: string[]) {
      const [dedupeKey, jobKey] = args.slice(0, numKeys);
      const [id, payload] = args.slice(numKeys);
      values.set(jobKey, payload);
      values.set(dedupeKey, id);
      return id;
    },
  };
  config.metaCloud.token = 'test-token';
  config.metaCloud.phoneNumberId = '123';
  config.metaCloud.wabaId = '456';
  clearTemplateCache();
  axios.get = (async () => ({
    data: { data: [{ name: 'campana_posgrados', language: 'es_CO', category: 'MARKETING', components: [{ type: 'BODY', text: 'Hola {{1}}, como egresado de {{2}}…' }] }] },
  })) as typeof axios.get;
  try {
    const job = await enqueueBroadcast('campana_posgrados', 'es_CO', [
      { telefono: '573001112233', parametros: ['Laura', 'Ingeniería Industrial'], contexto: { relacion: 'egresado_utb', pregradoId: 'ingenieria-industrial' } },
      { telefono: '573004445566', parametros: ['Pedro', ''] },
    ], 'admin', store);
    assert.deepEqual(job.destinatarios, ['573001112233']);
    assert.deepEqual(job.parametros, [['Laura', 'Ingeniería Industrial']]);
    assert.deepEqual(job.contextos, [{ relacion: 'egresado_utb', pregradoId: 'ingenieria-industrial' }]);
    assert.deepEqual(job.fallidos.map(f => f.numero), ['573004445566']);

    // Sin datos por destinatario (selección de prospectos) una plantilla con variables no se puede enviar
    await assert.rejects(() => enqueueBroadcast('campana_posgrados', 'es_CO', ['573007778899'], 'admin', store), /variables/);
  } finally {
    axios.get = originalGet;
    Object.assign(config.metaCloud, originalMeta);
    clearTemplateCache();
  }
});

it('al procesar: no se le envía a quien se dio de baja y el contexto se guarda solo tras un envío confirmado', async () => {
  const job = {
    templateName: 'campana_posgrados', language: 'es_CO',
    destinatarios: ['573001112233', '573004445566'],
    parametros: [['Laura', 'Ingeniería Industrial'], ['Pedro', 'Derecho']],
    contextos: [{ relacion: 'egresado_utb', pregradoId: 'ingenieria-industrial' }, null],
  } as unknown as BroadcastJob;
  const enviados: unknown[][] = [];
  const guardados: [string, Record<string, string>][] = [];
  const deps = {
    estaDadoDeBaja: async (tel: string) => tel === '573004445566',
    guardarContextoCampana: async (tel: string, ctx: Record<string, string>) => { guardados.push([tel, ctx]); },
  };
  const send = (async (...args: unknown[]) => { enviados.push(args); }) as never;

  assert.equal(await enviarADestinatario(job, 0, send, deps), undefined);
  assert.deepEqual(enviados[0], ['campana_posgrados', 'es_CO', '573001112233', ['Laura', 'Ingeniería Industrial']]);
  await guardarContextoEnviado(job, 0, deps);
  assert.deepEqual(guardados, [['573001112233', { relacion: 'egresado_utb', pregradoId: 'ingenieria-industrial' }]]);

  assert.match((await enviarADestinatario(job, 1, send, deps))!, /baja/);
  assert.equal(enviados.length, 1, 'a la baja no se le envía nada');
  await guardarContextoEnviado(job, 1, deps);
  assert.equal(guardados.length, 1, 'sin contexto no se guarda nada');

  // Si Meta falla, se reporta el error y no hay contexto que guardar
  const falla = (async () => { throw new Error('caída'); }) as never;
  assert.ok(await enviarADestinatario(job, 0, falla, deps));
});
