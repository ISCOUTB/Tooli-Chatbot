/** Atomic QR issue/redeem test on dedicated local Redis; synthetic users only. */
import assert from 'node:assert/strict';
import Redis from 'ioredis';

const TEST_URL = 'redis://127.0.0.1:6389/15';
assert.equal(process.env.REDIS_URL, TEST_URL, 'Se requiere el Redis temporal dedicado');
const redis = new Redis(TEST_URL);
const { crearCodigoNutria, canjearCodigoNutria, getCodigoNutria, getCanjesRecientes } =
  await import('../src/services/nutriaCodigoService.ts');

let failed = false;
try {
  await redis.flushdb();
  const same = await Promise.all(Array.from({ length: 20 }, () => crearCodigoNutria('573001111111')));
  assert.equal(new Set(same).size, 1, 'un participante obtiene un solo código incluso con peticiones simultáneas');
  assert.match(same[0], /^NUTR-[A-HJ-NP-Z2-9]{10}$/);
  const codes = await Promise.all(Array.from({ length: 40 }, (_, i) => crearCodigoNutria(`573002${String(i).padStart(6, '0')}`)));
  assert.equal(new Set(codes).size, codes.length, 'los códigos de participantes distintos son únicos');

  const redeemed = await Promise.all(Array.from({ length: 20 }, () => canjearCodigoNutria(same[0])));
  assert.equal(redeemed.filter(result => result.ok).length, 1, 'solo un escáner canjea el código');
  assert.equal(redeemed.filter(result => result.error === 'already_redeemed').length, 19);
  assert.equal((await getCodigoNutria(same[0]))?.canjeado, true);
  assert.equal((await getCanjesRecientes()).filter(entry => entry.code === same[0]).length, 1);
  assert.equal((await canjearCodigoNutria('NOEXISTE')).error, 'not_found');

  await redis.set('nutria:codigo:ABCD', JSON.stringify({ phone: '573009999999', canjeado: false, creadoEn: 'legacy' }));
  assert.equal((await canjearCodigoNutria('abcd')).ok, true, 'los códigos antiguos siguen funcionando');
  console.log('Redis NutriA: emisión idempotente, códigos únicos y canje concurrente: OK');
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await redis.flushdb();
  await redis.quit();
}
process.exit(failed ? 1 : 0);
