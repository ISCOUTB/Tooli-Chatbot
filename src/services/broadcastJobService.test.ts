import { it } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { config } from '../config';
import { clearTemplateCache } from './broadcastService';
import { enqueueBroadcast, getBroadcastJob } from './broadcastJobService';

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
