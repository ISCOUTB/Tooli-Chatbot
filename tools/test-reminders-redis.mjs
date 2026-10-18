/** Prueba de integración contra un Redis temporal dedicado en 127.0.0.1:6389/15.
 * Ejecutar con REDIS_URL=redis://127.0.0.1:6389/15 y .env.test.
 * Nunca apunta a Redis de desarrollo ni producción. No envía WhatsApp. */
import assert from 'node:assert/strict';
import Redis from 'ioredis';

const TEST_URL = 'redis://127.0.0.1:6389/15';
assert.equal(process.env.REDIS_URL, TEST_URL, 'Se requiere el Redis temporal dedicado');

const redis = new Redis(TEST_URL);
const { scheduleReminder, cancelReminder, getReminder, processDueReminders } =
  await import('../src/services/reminderService.ts');

let sent = 0;
const send = async ({ telefono }) => {
  sent++;
  return { ok: true, to: telefono };
};
const ids = [];
const schedule = async () => {
  const reminder = await scheduleReminder({
    telefono: '573001234567', mensaje: 'Recordatorio de prueba local',
    scheduledAt: Date.now() + 60_000, createdBy: 'test-local',
  });
  ids.push(reminder.id);
  return reminder;
};

let failed = false;
try {
  const cancelled = await schedule();
  assert.equal((await cancelReminder(cancelled.id))?.cancelled, true);
  await processDueReminders(cancelled.scheduledAt + 1, send);
  assert.equal(sent, 0, 'una cancelación previa no envía');

  const racing = await schedule();
  let releaseSend;
  let enteredSend;
  const entered = new Promise(resolve => { enteredSend = resolve; });
  const hold = new Promise(resolve => { releaseSend = resolve; });
  const heldSend = async ({ telefono }) => {
    sent++;
    enteredSend();
    await hold;
    return { ok: true, to: telefono };
  };
  const first = processDueReminders(racing.scheduledAt + 1, heldSend);
  await entered;
  const during = await cancelReminder(racing.id);
  assert.equal(during?.cancelled, false, 'un envío reclamado no puede cancelarse');
  assert.equal(during?.reminder.estado, 'procesando');
  const second = processDueReminders(racing.scheduledAt + 1, heldSend);
  releaseSend();
  await Promise.all([first, second]);
  assert.equal(sent, 1, 'dos workers solo envían una vez');
  assert.equal((await getReminder(racing.id))?.estado, 'enviado');
  assert.equal((await cancelReminder(racing.id))?.cancelled, false);

  const beforeSend = await schedule();
  const recoveryNow = beforeSend.scheduledAt + 6 * 60_000;
  await redis.set(`reminder:${beforeSend.id}`, JSON.stringify({
    ...beforeSend, estado: 'procesando', claimToken: 'interrupted', claimedAt: recoveryNow - 6 * 60_000,
  }));
  await redis.zrem('reminders:queue', beforeSend.id);
  await redis.zadd('reminders:processing', recoveryNow - 1, beforeSend.id);
  await processDueReminders(recoveryNow, send);
  assert.equal((await getReminder(beforeSend.id))?.estado, 'enviado', 'se recupera un reclamo anterior al envío');
  assert.equal(sent, 2);

  const uncertain = await schedule();
  await redis.set(`reminder:${uncertain.id}`, JSON.stringify({
    ...uncertain, estado: 'procesando', claimToken: 'interrupted',
    claimedAt: recoveryNow - 6 * 60_000, sendStartedAt: recoveryNow - 5 * 60_000,
  }));
  await redis.zrem('reminders:queue', uncertain.id);
  await redis.zadd('reminders:processing', recoveryNow - 1, uncertain.id);
  await processDueReminders(recoveryNow, send);
  assert.equal((await getReminder(uncertain.id))?.estado, 'fallido', 'un resultado incierto queda para revisión');
  assert.equal(sent, 2, 'no se reenvía un intento externo incierto');

  console.log('Redis: cancelación, dos workers, recuperación y no reenvío incierto: OK');
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  for (const id of ids) {
    await redis.del(`reminder:${id}`);
    await redis.zrem('reminders:queue', id);
    await redis.zrem('reminders:processing', id);
    await redis.zrem('reminders:index', id);
  }
  await redis.quit();
}
process.exit(failed ? 1 : 0);
