/** Integration test for broadcast delivery against the dedicated local Redis.
 * Uses synthetic jobs and a fake sender; no Meta request is made. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

const TEST_URL = 'redis://127.0.0.1:6389/15';
assert.equal(process.env.REDIS_URL, TEST_URL, 'Se requiere el Redis temporal dedicado');
const redis = new Redis(TEST_URL);
const { processBroadcastJobs, getBroadcastJob } = await import('../src/services/broadcastJobService.ts');

function job(recipients) {
  return {
    id: randomUUID(), templateName: 'test_template', language: 'es_CO', createdBy: 'local-test',
    createdAt: Date.now(), estado: 'pendiente', destinatarios: recipients,
    solicitados: recipients.length, duplicadosOmitidos: 0, enviados: [], fallidos: [], nextIndex: 0,
  };
}

let failed = false;
try {
  await redis.flushdb();
  const first = job(['573001111111', '573002222222']);
  await redis.set(`broadcast:job:${first.id}`, JSON.stringify(first));
  await redis.zadd('broadcast:queue', Date.now() - 1, first.id);
  const sent = [];
  let releaseFirst;
  let enteredFirst;
  const firstEntered = new Promise(resolve => { enteredFirst = resolve; });
  const firstHold = new Promise(resolve => { releaseFirst = resolve; });
  const send = async (_name, _language, to) => {
    sent.push(to);
    if (to === first.destinatarios[0]) {
      enteredFirst();
      await firstHold;
    }
  };
  const workerA = processBroadcastJobs(send);
  await firstEntered;
  const workerB = processBroadcastJobs(send);
  releaseFirst();
  await Promise.all([workerA, workerB]);
  assert.deepEqual(sent, first.destinatarios, 'dos workers no duplican destinatarios');
  const completed = await getBroadcastJob(first.id);
  assert.equal(completed?.estado, 'completado');
  assert.deepEqual(completed?.enviados, first.destinatarios);

  const interrupted = job(['573003333333', '573004444444']);
  interrupted.estado = 'procesando';
  interrupted.currentIndex = 0;
  interrupted.claimToken = 'worker-caido';
  await redis.set(`broadcast:job:${interrupted.id}`, JSON.stringify(interrupted));
  await redis.zadd('broadcast:processing', Date.now() - 1, interrupted.id);
  const recoveredSends = [];
  await processBroadcastJobs(async (_name, _language, to) => { recoveredSends.push(to); });
  const recovered = await getBroadcastJob(interrupted.id);
  assert.deepEqual(recoveredSends, [interrupted.destinatarios[1]], 'resultado incierto no se reenvía');
  assert.equal(recovered?.fallidos.length, 1);
  assert.match(recovered?.fallidos[0].error ?? '', /no confirmado/);
  assert.equal(recovered?.estado, 'completado');

  console.log('Redis broadcast: dos workers y recuperación sin reenvío incierto: OK');
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await redis.flushdb();
  await redis.quit();
}
process.exit(failed ? 1 : 0);
