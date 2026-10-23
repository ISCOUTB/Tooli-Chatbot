import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';

test('un correo institucional solo conserva un número vinculado y puede revocarse', {
  skip: process.env.TOOLI_TEST_REDIS !== '1',
}, async () => {
  const { default: Redis } = await import('ioredis');
  const { config } = await import('../config');
  const { checkCode, getIdentity, revokeIdentity, closeIdentityService } = await import('./identityService');
  const redis = new Redis(config.redis.url);
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
  const first = `test${suffix}1`;
  const second = `test${suffix}2`;
  const bruteForce = `test${suffix}3`;
  const legacy = `test${suffix}4`;
  const email = `test.${suffix}@utb.edu.co`;
  const code = '654321';
  const emailHash = createHash('sha256').update(email).digest('hex');
  const reverseKey = `identity-email:${emailHash}`;
  const seed = async (phone: string) => {
    const codeHash = createHmac('sha256', config.auth.jwtSecret).update(`${phone}:${code}`).digest('hex');
    await redis.setex(`otp:${phone}`, 600, JSON.stringify({ email, codeHash, tries: 0 }));
  };
  try {
    await seed(first);
    assert.deepEqual(await checkCode(first, '000000'), { ok: false, reason: 'wrong' });
    assert.deepEqual(await checkCode(first, code), { ok: true, email });
    assert.equal((await getIdentity(first))?.email, email);
    assert.equal(await redis.get(reverseKey), first);

    await seed(first);
    await seed(second);
    assert.deepEqual(await checkCode(second, code), { ok: true, email });
    assert.equal(await getIdentity(first), null, 'la transferencia debe revocar el número anterior');
    assert.equal(await redis.get(`otp:${first}`), null, 'la transferencia cancela códigos pendientes del número anterior');
    assert.equal((await getIdentity(second))?.email, email);
    assert.equal(await redis.get(reverseKey), second);

    await seed(second);
    await revokeIdentity(second);
    assert.equal(await getIdentity(second), null);
    assert.equal(await redis.get(reverseKey), null);
    assert.equal(await redis.get(`otp:${second}`), null, 'la revocación cancela códigos pendientes');

    await seed(bruteForce);
    const attempts = await Promise.all(Array.from({ length: 20 }, () => checkCode(bruteForce, '000000')));
    assert.equal(attempts.filter((attempt) => !attempt.ok && attempt.reason === 'wrong').length, 5);
    assert.deepEqual(await checkCode(bruteForce, code), { ok: false, reason: 'expired' });
    assert.equal(await getIdentity(bruteForce), null);

    await redis.setex(`identity:${legacy}`, 600, JSON.stringify({ email, verifiedAt: Date.now() }));
    assert.equal(await getIdentity(legacy), null, 'un vínculo sin índice inverso exige nueva verificación');
    await revokeIdentity(legacy);
    assert.equal(await redis.get(`identity:${legacy}`), null);
  } finally {
    await redis.del(`otp:${first}`, `otp:${second}`, `otp:${bruteForce}`, `identity:${first}`, `identity:${second}`, `identity:${bruteForce}`, `identity:${legacy}`, reverseKey);
    redis.disconnect();
    closeIdentityService();
  }
});
