/** Prueba de la agenda contra un Redis REAL (los scripts Lua de verdad, no el doble de la suite).
 *
 * Levantar un Redis temporal y ejecutar:
 *   docker run -d --rm --name agenda-redis-test -p 6391:6379 redis:7-alpine
 *   REDIS_URL=redis://127.0.0.1:6391/15 node --env-file=.env.test --import tsx tools/test-agenda-redis.mjs
 *   docker stop agenda-redis-test
 *
 * Nunca apunta a Redis de desarrollo ni producción. No envía WhatsApp ni toca otros servicios. */
import assert from 'node:assert/strict';
import Redis from 'ioredis';

const TEST_URL = 'redis://127.0.0.1:6391/15';
assert.equal(process.env.REDIS_URL, TEST_URL, 'Se requiere el Redis temporal dedicado (puerto 6391, base 15)');

const redis = new Redis(TEST_URL);
await redis.flushdb();
const { crearAgenda } = await import('../src/services/agendaService.ts');

const AHORA = Date.parse('2026-11-23T08:00:00-05:00');
const usuarios = [
  { username: 'laura', fullName: 'Laura Pérez', role: 'asesor' },
  { username: 'mario', fullName: 'Mario Gómez', role: 'asesor' },
];
const recordatorios = [];
const ag = crearAgenda({
  redis,
  ahora: () => AHORA,
  usuarios: {
    listar: async () => usuarios,
    obtener: async (u) => usuarios.find((x) => x.username === u.toLowerCase()) ?? null,
  },
  horarioEquipo: async () => null,
  recordatorios: {
    programar: async (telefono, mensaje, cuandoMs) => { recordatorios.push({ telefono, cuandoMs, cancelado: false }); return `r${recordatorios.length}`; },
    cancelar: async (id) => { recordatorios[Number(id.slice(1)) - 1].cancelado = true; },
  },
  adaptador: () => 'evolution',
  ultimoEntrante: async () => null,
});

const semana = [1, 2, 3, 4, 5].map((dia) => ({ dia, desde: '09:00', hasta: '12:00' }));
const disp = { activo: true, areas: ['posgrados'], duracionMin: 30, pausaMin: 0, semana, excepciones: [] };
await ag.guardarDisponibilidad('laura', disp);
await ag.guardarDisponibilidad('mario', { ...disp, activo: false });

const iso = (ms) => new Date(ms - 5 * 3600_000).toISOString().slice(0, 19) + '-05:00';
const franja = (hora, min = 30) => {
  const ini = Date.parse(`2026-11-24T${hora}:00-05:00`);
  return { asesor: 'laura', asesorNombre: 'Laura', inicio: iso(ini), fin: iso(ini + min * 60_000) };
};
const reservar = (tel, f) => ag.reservar({ telefono: tel, area: 'posgrados', franja: f, canal: 'whatsapp' });

let fallo = false;
try {
  // 1. 40 personas, misma franja, a la vez, contra Redis real.
  const tels = Array.from({ length: 40 }, (_, i) => `5730011${String(10000 + i)}`);
  const r = await Promise.all(tels.map((t) => reservar(t, franja('09:00'))));
  assert.equal(r.filter((x) => x.ok).length, 1, 'solo una reserva gana la misma franja');
  assert.equal(r.filter((x) => !x.ok && x.motivo === 'ocupada').length, 39);
  assert.equal(await redis.zcard('agenda:asesor:laura'), 1);
  console.log('ok 1: 40 reservas simultáneas de la misma franja -> 1 gana');

  // 2. Franjas solapadas simultáneas (panel).
  const solapadas = await Promise.all(['10:00', '10:10', '10:20', '10:29'].map((h, i) =>
    ag.reservarPanel({ telefono: `5730022${1000 + i}`, area: 'posgrados', franja: franja(h) }, 'admin', true)));
  assert.equal(solapadas.filter((x) => x.ok).length, 1);
  console.log('ok 2: 4 reservas solapadas simultáneas -> 1 gana');

  // 3. Límite por teléfono bajo concurrencia.
  await ag.guardarConfig({ antelacionMin: 120, maxCitasFuturas: 1, diasVentana: 14, festivos: [] });
  const lim = await Promise.all(['10:30', '11:00', '11:30'].map((h) => reservar('573003330000', franja(h))));
  assert.equal(lim.filter((x) => x.ok).length, 1);
  assert.equal(lim.filter((x) => !x.ok && x.motivo === 'limite').length, 2);
  console.log('ok 3: límite por teléfono respetado bajo concurrencia');

  // 4. Cancelar: ajeno no puede; tres a la vez solo cuentan una.
  const ganadora = r.find((x) => x.ok).cita;
  assert.equal(await ag.cancelar(ganadora.id, '573009999999'), false);
  const c = await Promise.all([1, 2, 3].map(() => ag.cancelar(ganadora.id, ganadora.telefono)));
  assert.equal(c.filter(Boolean).length, 1);
  assert.equal((await ag.obtenerCita(ganadora.id)).estado, 'cancelada');
  assert.equal((await reservar('573004440000', franja('09:00'))).ok, true, 'la franja cancelada se puede volver a reservar');
  console.log('ok 4: cancelar solo para el dueño y una sola vez; la franja se libera');

  // 5. Reprogramar sin chocar con la propia cita y recordatorios.
  const nueva = await reservar('573005550000', franja('09:30'));
  assert.equal(nueva.ok, true);
  await ag.guardarConfig({ antelacionMin: 120, maxCitasFuturas: 1, diasVentana: 14, festivos: [] });
  assert.equal((await ag.reprogramar(nueva.cita.id, '573005550000', franja('15:00'))).ok, false, 'disponibilidad 09-12: 15:00 no es una franja válida');
  assert.deepEqual(await ag.reprogramar(nueva.cita.id, '573005550000', { asesor: 'laura', asesorNombre: 'Laura', inicio: lim.find((x) => x.ok).cita.inicio, fin: lim.find((x) => x.ok).cita.fin }), { ok: false, motivo: 'ocupada' }, 'una franja ya tomada no se concede');
  assert.equal((await ag.obtenerCita(nueva.cita.id)).estado, 'confirmada', 'la cita original no se toca');
  assert.equal((await ag.reprogramar(nueva.cita.id, '573005550000', franja('09:30'))).ok, true, 'al mismo horario, sin chocar con la propia cita (límite 1)');
  assert.equal((await ag.citasDe('573005550000')).length, 1);
  console.log('ok 5: reprogramar respeta franja real y no choca con el límite');

  // 6. Los ZSET no se pierden: citasDe usa el índice del teléfono.
  assert.equal((await ag.listarCitas({ desdeMs: Date.parse('2026-11-24T00:00:00-05:00'), hastaMs: Date.parse('2026-11-25T00:00:00-05:00') })).length >= 4, true);
  console.log('ok 6: listarCitas del panel');

  // 7. Renombrar al asesor (LUA_RENOMBRAR_ASESOR): disponibilidad, ZSET y citas pasan juntos; sin doble reserva.
  const tomadas = await ag.listarCitas({ desdeMs: 0, hastaMs: Date.parse('2100-01-01'), asesor: 'laura', estado: 'confirmada' });
  const ttlAntes = await redis.ttl(`agenda:cita:${tomadas[0].id}`);
  usuarios[0].username = 'laura.perez';
  const movidas = await ag.renombrarAsesor('laura', 'laura.perez');
  assert.ok(movidas >= tomadas.length, `citas migradas: ${movidas}`);
  assert.equal(await redis.exists('agenda:disp:laura', 'agenda:asesor:laura'), 0);
  assert.equal((await ag.disponibilidadDe('laura.perez')).activo, true);
  assert.equal(await redis.zcard('agenda:asesor:laura.perez'), tomadas.length);
  const migrada = await ag.obtenerCita(tomadas[0].id);
  assert.equal(migrada.asesor, 'laura.perez');
  assert.ok(Math.abs((await redis.ttl(`agenda:cita:${tomadas[0].id}`)) - ttlAntes) <= 2, 'KEEPTTL conserva el vencimiento');
  const otra = { ...franja(tomadas[0].inicio.slice(11, 16)), asesor: 'laura.perez' };
  assert.deepEqual(await reservar('573006660000', otra), { ok: false, motivo: 'ocupada' }, 'la hora tomada sigue tomada');
  assert.equal(await ag.renombrarAsesor('laura', 'laura.perez'), 0, 'idempotente');
  console.log('ok 7: renombrar migra todo de una vez y no deja doble reserva');

  // 8. Borrar al asesor (LUA_ASESOR_BORRADO): sus citas quedan sin asesor y su agenda se limpia.
  const huerfanas = await ag.asesorBorrado('laura.perez');
  assert.equal(huerfanas, tomadas.length);
  assert.equal(await redis.exists('agenda:disp:laura.perez', 'agenda:asesor:laura.perez'), 0);
  assert.equal((await ag.citasSinAsesor()).length, tomadas.length);
  assert.equal((await ag.obtenerCita(tomadas[0].id)).sinAsesor, true);
  assert.equal((await ag.obtenerCita(tomadas[0].id)).estado, 'confirmada');
  console.log('ok 8: borrar deja las citas futuras «sin asesor» a la vista del administrador');
  // 9. Recordatorios reintentados con Meta (LUA_ANOTAR_RECORDATORIOS): se anotan con compare-and-set y suman ids.
  let reloj = AHORA;
  const recMeta = [];
  const agMeta = crearAgenda({
    redis,
    ahora: () => reloj,
    usuarios: { listar: async () => usuarios, obtener: async (u) => usuarios.find((x) => x.username === u.toLowerCase()) ?? null },
    horarioEquipo: async () => null,
    recordatorios: {
      programar: async (telefono, mensaje, cuandoMs) => { recMeta.push({ cuandoMs, cancelado: false }); return `m${recMeta.length}`; },
      cancelar: async (id) => { recMeta[Number(id.slice(1)) - 1].cancelado = true; },
    },
    adaptador: () => 'meta',
    ultimoEntrante: async () => null,
  });
  await agMeta.guardarDisponibilidad('mario', { ...disp, activo: true });
  const telMeta = '573007770000';
  const jueves = { asesor: 'mario', asesorNombre: 'Mario', inicio: '2026-11-26T10:00:00-05:00', fin: '2026-11-26T10:30:00-05:00' };
  const rm = await agMeta.reservar({ telefono: telMeta, area: 'posgrados', franja: jueves, canal: 'whatsapp' });
  assert.equal(rm.ok, true, JSON.stringify(rm));
  assert.deepEqual((await agMeta.obtenerCita(rm.cita.id)).recordatoriosPendientes, ['24h', '1h']);
  assert.ok(await redis.get(`agenda:rec-pend:${telMeta}`), 'queda la marca de pendientes');
  reloj = Date.parse('2026-11-25T08:00:00-05:00');
  assert.equal(await agMeta.reintentarRecordatorios(telMeta, reloj), 1);
  reloj = Date.parse('2026-11-26T08:00:00-05:00');
  assert.equal(await agMeta.reintentarRecordatorios(telMeta, reloj), 1);
  const completa = await agMeta.obtenerCita(rm.cita.id);
  assert.deepEqual(completa.recordatorios, ['24h', '1h']);
  assert.equal(completa.recordatoriosPendientes, undefined);
  assert.deepEqual(JSON.parse(await redis.get(`agenda:rec:${rm.cita.id}`)), ['m1', 'm2'], 'los ids se suman en orden');
  assert.equal(await redis.get(`agenda:rec-pend:${telMeta}`), null, 'sin pendientes, la marca se borra');
  assert.ok((await redis.ttl(`agenda:cita:${rm.cita.id}`)) > 0, 'la cita conserva su vencimiento');
  assert.equal(await agMeta.cancelar(rm.cita.id, telMeta), true);
  assert.ok(recMeta.every((r) => r.cancelado), 'cancelar la cita cancela también los reintentados');
  console.log('ok 9: los recordatorios pendientes se reintentan al escribir y se cancelan con la cita');
  console.log('TODAS LAS PRUEBAS CONTRA REDIS REAL PASARON');
} catch (e) {
  fallo = true;
  console.error('FALLÓ:', e);
} finally {
  await redis.flushdb();
  redis.disconnect();
}
process.exit(fallo ? 1 : 0);
