/** Chatwoot webhook ACK test with a dedicated local Redis, no WhatsApp send. */
import assert from 'node:assert/strict';
import express from 'express';
import Redis from 'ioredis';
import { once } from 'node:events';

const TEST_URL = 'redis://127.0.0.1:6389/15';
assert.equal(process.env.REDIS_URL, TEST_URL, 'Se requiere el Redis temporal dedicado');
const redis = new Redis(TEST_URL);
const { config } = await import('../src/config/index.ts');
config.chatwoot.accountId = '111';
config.chatwoot.inboxId = '222';
config.chatwoot.webhookToken = 'q'.repeat(40);
const { chatwootWebhookRouter } = await import('../src/routes/chatwootWebhook.ts');

const app = express();
app.use(express.json());
app.use('/chatwoot-webhook', chatwootWebhookRouter);
const server = app.listen(0, '127.0.0.1');
await once(server, 'listening');
const port = server.address().port;
const payload = {
  event: 'message_created', id: 987, message_type: 'outgoing', private: false,
  content: 'Respuesta sintética', account: { id: 111 }, inbox: { id: 222 },
  conversation: { id: 333, account_id: 111, inbox_id: 222, meta: { sender: { identifier: '573001234567' } } },
};
const post = (token, body) => fetch(`http://127.0.0.1:${port}/chatwoot-webhook?token=${token}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

let failed = false;
try {
  await redis.flushdb();
  assert.equal((await post('incorrecto', payload)).status, 401);
  assert.equal(await redis.zcard('inbound:ready'), 0);
  assert.equal((await post(config.chatwoot.webhookToken, payload)).status, 200);
  assert.equal((await post(config.chatwoot.webhookToken, payload)).status, 200);
  assert.equal(await redis.zcard('inbound:ready'), 1);
  const fifos = await redis.keys('inbound:fifo:*');
  assert.equal(fifos.length, 1);
  assert.equal(await redis.llen(fifos[0]), 1, 'entrega repetida no se procesa dos veces');
  const resolved = { ...payload, event: 'conversation_resolved', status: 'resolved', id: 333 };
  assert.equal((await post(config.chatwoot.webhookToken, resolved)).status, 200);
  assert.equal(await redis.llen(fifos[0]), 2);
  console.log('Chatwoot webhook: autenticación, ACK tras Redis y deduplicación: OK');
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await redis.flushdb();
  await redis.quit();
  await new Promise(resolve => server.close(resolve));
}
// En Windows, cerrar el listener y salir en el mismo tick puede interrumpir
// el handle TCP mientras Node lo libera.
await new Promise(resolve => setTimeout(resolve, 200));
process.exit(failed ? 1 : 0);
