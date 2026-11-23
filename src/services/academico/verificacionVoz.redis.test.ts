// Los pasos atómicos de la voz (Lua de identityService.pendientesVoz) contra un Redis REAL (auditoría 22-nov, H1-H3).
// Solo corre con TOOLI_TEST_REDIS=1 y REDIS_URL apuntando a un Redis de pruebas: usa números aleatorios y borra sus
// claves al terminar.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { clavesVoz, crearAcademico, LIMITES_VOZ, type DepsNucleo, type LimitesVoz, type PendienteVoz } from './nucleo';

const CON_REDIS = process.env.TOOLI_TEST_REDIS === '1';
const sufijo = () => String(parseInt(randomUUID().replace(/-/g, '').slice(0, 10), 16)).slice(0, 9).padStart(9, '0');

describe('verificación por voz con Redis real (Lua atómico)', { skip: !CON_REDIS && 'necesita TOOLI_TEST_REDIS=1' }, () => {
  const usados: string[] = [];
  let svc: typeof import('../identityService');

  async function mundo() {
    svc ??= await import('../identityService');
    const estudiante = `57300${sufijo()}`;
    usados.push(estudiante);
    const correos: string[] = [];
    const deps: DepsNucleo = {
      identidad: {
        obtener: async (t) => (t === estudiante ? { email: 'ana.perez@utb.edu.co', codigo: 'T00012345', codigoVerificado: true } : null),
        porCodigo: async (c) => (c === 'T00012345' ? { telefono: estudiante, email: 'ana.perez@utb.edu.co' } : null),
        porCedula: async () => null,
      },
      existeCodigoEnFuente: async () => false,
      cedulaDe: async () => null,
      interruptores: { notas: () => false, recibo: () => false, turno: () => false, horario: () => false, cursos: () => false },
      proveedores: {},
      permitirBusqueda: async () => true,
      regla: () => ({ notaMinima: 3, notaMaxima: 5, pesosCortes: [30, 30, 40], sinConfirmar: true }),
      ahora: () => new Date(),
      verificacion: {
        enviarCorreo: async (_e, c) => { correos.push(c); },
        pendientes: svc.pendientesVoz,
        secreto: 'secreto-de-prueba-redis',
        generarCodigo: () => '777777',
      },
    };
    const llamante = () => { const t = `57605${sufijo()}`; usados.push(t); return t; };
    return { api: crearAcademico(deps), correos, estudiante, llamante };
  }

  after(async () => {
    if (!svc) return;
    const { default: Redis } = await import('ioredis');
    const { config } = await import('../../config');
    const r = new Redis(config.redis.url);
    for (const t of usados) {
      const claves = Object.values(clavesVoz).map((f) => f(t));
      await r.del(...claves);
    }
    r.disconnect();
    svc.closeIdentityService();
  });

  it('tope diario en el Lua: con el contador del día lleno responde «tope_dia» (el de la hora, «espera»)', async () => {
    const m = await mundo();
    const { default: Redis } = await import('ioredis');
    const { config } = await import('../../config');
    const r = new Redis(config.redis.url);
    try {
      await r.set(clavesVoz.diaDestino(m.estudiante), String(LIMITES_VOZ.maxDiaDestino), 'PX', 60_000);
      assert.equal((await m.api.iniciarVerificacionPorDato!(m.llamante(), { codigo: 'T00012345' })).estado, 'tope_dia');
      await r.del(clavesVoz.diaDestino(m.estudiante));
      await r.set(clavesVoz.horaDestino(m.estudiante), String(LIMITES_VOZ.maxHoraDestino), 'PX', 60_000);
      assert.equal((await m.api.iniciarVerificacionPorDato!(m.llamante(), { codigo: 'T00012345' })).estado, 'espera');
      assert.equal(m.correos.length, 0);
    } finally {
      r.disconnect();
    }
  });

  it('H3: tres inicios simultáneos mandan un solo correo', async () => {
    const m = await mundo();
    const ll = m.llamante();
    const rs = await Promise.all([1, 2, 3].map(() => m.api.iniciarVerificacionPorDato!(ll, { codigo: 'T00012345' })));
    assert.deepEqual(rs.map((r) => r.estado).sort(), ['enviado', 'espera', 'espera']);
    assert.equal(m.correos.length, 1);
  });

  it('H1: tras agotar los 3 intentos la espera sigue (la marca sobrevive al pendiente)', async () => {
    const m = await mundo();
    const ll = m.llamante();
    assert.equal((await m.api.iniciarVerificacionPorDato!(ll, { codigo: 'T00012345' })).estado, 'enviado');
    const motivos = [];
    for (let k = 0; k < 3; k++) { const r = await m.api.confirmarVerificacion!(ll, String(100000 + k)); motivos.push(r.ok ? 'ok' : r.motivo); }
    assert.deepEqual(motivos, ['no_coincide', 'no_coincide', 'demasiados']);
    assert.equal((await m.api.iniciarVerificacionPorDato!(ll, { codigo: 'T00012345' })).estado, 'espera');
  });

  it('H2: 20 confirmaciones simultáneas: 2 fallos, 1 «demasiados» y ningún acierto', async () => {
    const m = await mundo();
    const ll = m.llamante();
    await m.api.iniciarVerificacionPorDato!(ll, { codigo: 'T00012345' });
    const conjeturas = Array.from({ length: 20 }, (_, i) => String(100000 + i));
    conjeturas[19] = '777777';
    const rs = await Promise.all(conjeturas.map((c) => m.api.confirmarVerificacion!(ll, c)));
    const motivos = rs.map((r) => (r.ok ? 'ok' : r.motivo));
    assert.equal(motivos.filter((x) => x === 'no_coincide').length, 2, motivos.join(','));
    assert.equal(motivos.filter((x) => x === 'demasiados').length, 1, motivos.join(','));
    assert.equal(motivos.filter((x) => x === 'ok').length, 0);
  });

  it('acierto: el código vale una vez y devuelve el teléfono del vínculo', async () => {
    const m = await mundo();
    const ll = m.llamante();
    await m.api.iniciarVerificacionPorDato!(ll, { codigo: 'T00012345' });
    assert.deepEqual(await m.api.confirmarVerificacion!(ll, '777777'), { ok: true, telefonoEstudiante: m.estudiante });
    assert.deepEqual(await m.api.confirmarVerificacion!(ll, '777777'), { ok: false, motivo: 'vencido' });
  });

  it('H1: tope por destino con números rotados (5 por hora)', async () => {
    const m = await mundo();
    const estados = [];
    for (let i = 0; i < 6; i++) estados.push((await m.api.iniciarVerificacionPorDato!(m.llamante(), { codigo: 'T00012345' })).estado);
    assert.deepEqual(estados, ['enviado', 'enviado', 'enviado', 'enviado', 'enviado', 'espera']);
  });

  it('H1: agotar dos veces bloquea al llamante (espera corta para no dormir 60 s)', async () => {
    const m = await mundo();
    const ll = m.llamante();
    const l: LimitesVoz = { ...LIMITES_VOZ, esperaMs: 30 };
    const pend = (): PendienteVoz => ({
      huella: 'aa'.repeat(32), telefonoEstudiante: m.estudiante, email: 'ana.perez@utb.edu.co',
      intentos: 0, expira: Date.now() + 600_000, creado: Date.now(),
    });
    for (let ronda = 0; ronda < 2; ronda++) {
      assert.equal(await svc.pendientesVoz.crearSiCabe(ll, pend(), 600_000, Date.now(), l), 'ok');
      for (let k = 0; k < 3; k++) await svc.pendientesVoz.intentar(ll, m.estudiante, 'bb'.repeat(32), Date.now(), l);
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(await svc.pendientesVoz.crearSiCabe(ll, pend(), 600_000, Date.now(), l), 'bloqueado');
  });
});
