/** Integration test for the inbound inbox against a dedicated local Redis.
 * Run with REDIS_URL=redis://127.0.0.1:6389/15 and .env.test.
 * No messaging provider is contacted. The test database is cleared. */
import assert from 'node:assert/strict';
import Redis from 'ioredis';

const TEST_URL = 'redis://127.0.0.1:6389/15';
assert.equal(process.env.REDIS_URL, TEST_URL, 'Se requiere el Redis temporal dedicado');
const redis = new Redis(TEST_URL);
const {
  enqueueInbound, processInboundInbox, listInboundReviews, resolveInboundReview,
} = await import('../src/services/inboundInbox.ts');

const message = (from, messageId) => ({ from, messageId, text: 'Mensaje sintético', timestamp: 1 });
const processed = [];
let failed = false;

try {
  await redis.flushdb();
  assert.equal(await enqueueInbound('meta', message('573001111111', 'first')), true);
  assert.equal(await enqueueInbound('meta', message('573001111111', 'first')), false);
  assert.equal(await enqueueInbound('meta', message('573001111111', 'second')), true);
  assert.equal(await enqueueInbound('meta', message('573002222222', 'other')), true);
  const process = async (_source, inbound) => {
    processed.push(inbound.messageId);
    await new Promise(resolve => setTimeout(resolve, 5));
    return 'handled';
  };
  await Promise.all([processInboundInbox(process), processInboundInbox(process)]);
  assert.equal(processed.filter(id => id === 'first').length, 1);
  assert.ok(processed.indexOf('first') < processed.indexOf('second'), 'FIFO por remitente');
  assert.deepEqual(new Set(processed), new Set(['first', 'second', 'other']));

  await enqueueInbound('meta', message('573003333333', 'uncertain'));
  await enqueueInbound('meta', message('573003333333', 'behind'));
  await processInboundInbox(async (_source, inbound) => {
    if (inbound.messageId === 'uncertain') throw new Error('fallo sintético');
    processed.push(inbound.messageId);
    return 'handled';
  });
  let reviews = await listInboundReviews();
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].messageId, 'uncertain');
  assert.ok(!processed.includes('behind'), 'el siguiente mensaje queda bloqueado');
  assert.equal(await resolveInboundReview(reviews[0].id, 'acknowledge'), true);
  await processInboundInbox(process);
  assert.ok(processed.includes('behind'));

  await enqueueInbound('meta', message('573004444444', 'retry'));
  await processInboundInbox(async () => { throw new Error('fallo antes de enviar'); });
  reviews = await listInboundReviews();
  assert.equal(reviews.length, 1);
  assert.equal(await resolveInboundReview(reviews[0].id, 'retry'), true);
  await processInboundInbox(process);
  assert.equal(processed.filter(id => id === 'retry').length, 1);

  console.log('Redis inbox: deduplicación, FIFO, concurrencia, bloqueo y revisión: OK');
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await redis.flushdb();
  await redis.quit();
}
process.exit(failed ? 1 : 0);
