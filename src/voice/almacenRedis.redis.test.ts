// Scripts Lua del almacén de voz contra un Redis real. Igual que identityService.redis.test.ts: solo corre con
// TOOLI_TEST_REDIS=1 (la suite normal no tiene Redis y no debe quedar colgada esperándolo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

test('almacén de voz en Redis: idempotencia, cupo atómico, compare-and-set y retención', { skip: process.env.TOOLI_TEST_REDIS !== '1' }, async () => {
  const { default: Redis } = await import('ioredis');
  const { config } = await import('../config');
  const { almacenRedis } = await import('./almacenRedis');
  const { AJUSTES_DEFECTO } = await import('./ajustes');
  const redis = new Redis(config.redis.url);
  const a = almacenRedis(redis);
  const p = `prueba-${randomUUID().slice(0, 8)}`;
  // Día lejano para no chocar con el uso real.
  const ahora = new Date('2031-01-15T15:00:00Z');
  try {
    assert.equal(await a.reclamarEvento(p, 'e1'), true);
    assert.equal(await a.reclamarEvento(p, 'e1'), false);
    await a.liberarEvento(p, 'e1');
    assert.equal(await a.reclamarEvento(p, 'e1'), true);

    const topes = { ...AJUSTES_DEFECTO, topeMinutosDia: 15, maxMinutosLlamada: 10, topeMinutosMes: 1000 };
    const [r1, r2, r3] = await Promise.all(['A', 'B', 'C'].map((c) => a.reservarLlamada({ proveedor: p, proveedorCallId: c, telefono: '573001', simulada: false, topes, ahora })));
    const ok = [r1, r2, r3].filter((r) => r.ok);
    assert.equal(ok.reduce((s, r) => s + (r.ok ? r.llamada.minutosPermitidos : 0), 0), 15);
    assert.ok([r1, r2, r3].some((r) => !r.ok && r.motivo === 'sin_cupo'));
    const l = ok[0].ok ? ok[0].llamada : null;
    assert.ok(l);
    const g1 = await a.guardar({ ...l, resumen: 'uno' });
    assert.ok(g1);
    assert.equal(await a.guardar({ ...l, resumen: 'viejo' }), null, 'versión vieja se rechaza');
    assert.equal((await a.leer(l.id))?.resumen, 'uno');
    const ttl = await redis.pttl(`voz:llamada:${l.id}`);
    assert.ok(ttl > 0, 'la llamada vence sola (retención)');
    await a.ajustarUso(l.usoDia, l.usoMes, -100);
    assert.equal((await a.uso(ahora)).dia, 0, 'el uso no queda negativo');
  } finally {
    const keys = await redis.keys(`voz:*${p}*`);
    if (keys.length) await redis.del(...keys);
    await redis.del('voz:uso:dia:2031-01-15', 'voz:uso:mes:2031-01');
    redis.disconnect();
  }
});

test('silencio en Redis: índice por fecha límite y borrado solo si la fecha sigue igual', { skip: process.env.TOOLI_TEST_REDIS !== '1' }, async () => {
  const { default: Redis } = await import('ioredis');
  const { config } = await import('../config');
  const { almacenRedis } = await import('./almacenRedis');
  const redis = new Redis(config.redis.url);
  const a = almacenRedis(redis);
  const id = `prueba-sil-${randomUUID().slice(0, 8)}`;
  // Fechas en 1970: no chocan con las de llamadas reales del mismo Redis.
  try {
    await a.indexarSilencio(id, 1000);
    assert.deepEqual((await a.silenciosVencidos(5000, 500)).filter((x) => x.id === id), [{ id, vence: 1000 }]);
    assert.deepEqual((await a.silenciosVencidos(999, 500)).filter((x) => x.id === id), [], 'antes de la fecha no aparece');
    // Otra instancia programó la etapa siguiente: borrar con la fecha vieja no la toca.
    await a.indexarSilencio(id, 2000);
    await a.quitarSilencio(id, 1000);
    assert.equal(Number(await redis.zscore('voz:silencios', id)), 2000);
    await a.quitarSilencio(id, 2000);
    assert.equal(await redis.zscore('voz:silencios', id), null);
  } finally {
    await redis.zrem('voz:silencios', id);
    redis.disconnect();
  }
});
