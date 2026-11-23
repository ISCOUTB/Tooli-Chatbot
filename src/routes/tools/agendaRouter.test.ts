import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
import { crearAgenda, AgendaServicio } from '../../services/agendaService';
import { MundoFake, crearMundo, dispSemana } from '../../services/agenda.fakes.test';
import { crearAgendaRouter } from './agendaRouter';

const TEL = '573001234567';
const TEL2 = '573009876543';

let server: Server;
let base: string;
let mundo: MundoFake;
let servicio: AgendaServicio;
let auditoria: Array<{ username: string; action: string; detail?: string }>;
let avisos: Array<{ telefono: string; texto: string }>;
let ventanaCerrada: boolean;
let agendaActiva: boolean;

before(async () => {
  const app = express();
  app.use(express.json());
  // Sustituye a requireAuth: la identidad llega en una cabecera.
  app.use((req, _res, next) => {
    const [username, role] = String(req.headers['x-user'] ?? '').split(':');
    (req as unknown as { user: unknown }).user = { username, role, fullName: username };
    next();
  });
  app.use('/api/tools', (req, res, next) => router(req, res, next));
  await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/tools`;
});
after(() => { server.close(); });

let router: express.Router;
beforeEach(async () => {
  mundo = crearMundo();
  servicio = crearAgenda(mundo.deps);
  auditoria = [];
  avisos = [];
  ventanaCerrada = false;
  agendaActiva = true;
  await servicio.guardarDisponibilidad('laura', dispSemana(['posgrados']));
  await servicio.guardarDisponibilidad('mario', dispSemana(['posgrados', 'ti']));
  router = crearAgendaRouter({
    servicio,
    audit: async (username, action, detail) => { auditoria.push({ username, action, detail }); },
    avisar: async (telefono, texto) => {
      if (ventanaCerrada) return { enviado: false, motivo: 'ventana cerrada' };
      avisos.push({ telefono, texto });
      return { enviado: true };
    },
    ahora: () => mundo.reloj.ahora,
    activa: () => agendaActiva,
  });
});

async function llamar(quien: string, metodo: string, ruta: string, cuerpo?: unknown) {
  const r = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', 'x-user': quien },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return { status: r.status, json: (await r.json()) as Record<string, any> };
}

const LAURA = 'laura:asesor';
const MARIO = 'mario:asesor';
const ADMIN = 'admin:admin';
const cita = (extra: Record<string, unknown> = {}) => ({
  telefono: TEL, nombre: 'Ana', area: 'posgrados', asesor: 'laura', inicio: '2026-11-24T09:00:00-05:00', ...extra,
});

describe('AGENDA_ACTIVA=false: la API de la agenda está apagada', () => {
  it('el panel pregunta el estado y, apagada, ninguna ruta de la agenda responde ni escribe', async () => {
    assert.deepEqual((await llamar(LAURA, 'GET', '/agenda/estado')).json, { activa: true });
    agendaActiva = false;
    assert.deepEqual((await llamar(LAURA, 'GET', '/agenda/estado')).json, { activa: false });
    const rutas: Array<[string, string, unknown?]> = [
      ['GET', '/agenda/asesores'], ['GET', '/agenda/config'], ['GET', '/agenda/disponibilidad/laura'],
      ['GET', '/agenda/franjas?asesor=laura'], ['GET', '/agenda/citas?desde=2026-11-24'],
      ['POST', '/agenda/citas', cita()], ['PUT', '/agenda/disponibilidad/laura', dispSemana()],
      ['PUT', '/agenda/config', { antelacionMin: 60, maxCitasFuturas: 3, diasVentana: 10 }],
    ];
    for (const [metodo, ruta, cuerpo] of rutas) {
      const r = await llamar(ADMIN, metodo, ruta, cuerpo);
      assert.equal(r.status, 404, `${metodo} ${ruta}`);
      assert.equal(r.json.error, 'agenda_apagada');
    }
    assert.equal(avisos.length, 0, 'nadie recibe «escribe cancelar cita» de un flujo apagado');
    assert.equal(auditoria.length, 0);
    assert.deepEqual(await servicio.listarCitas({ desdeMs: 0, hastaMs: Date.parse('2100-01-01') }), []);
  });
});

describe('disponibilidad y configuración', () => {
  it('cada asesor ve y edita la suya; el administrador, la de todos; nadie la de otro', async () => {
    assert.equal((await llamar(MARIO, 'GET', '/agenda/disponibilidad/laura')).status, 403);
    assert.equal((await llamar(LAURA, 'GET', '/agenda/disponibilidad/laura')).status, 200);
    assert.equal((await llamar(ADMIN, 'GET', '/agenda/disponibilidad/laura')).status, 200);
    const cuerpo = dispSemana(['ti']);
    assert.equal((await llamar(MARIO, 'PUT', '/agenda/disponibilidad/laura', cuerpo)).status, 403);
    assert.equal(auditoria.length, 0, 'un intento prohibido no deja cambios ni auditoría de cambio');
    const r = await llamar(ADMIN, 'PUT', '/agenda/disponibilidad/laura', cuerpo);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.disponibilidad.areas, ['ti']);
    assert.deepEqual(auditoria, [{ username: 'admin', action: 'agenda_disponibilidad_actualizada', detail: 'asesor laura · activa · 10 tramos · 0 excepciones' }]);
  });

  it('valida el cuerpo con zod y con las reglas del servicio', async () => {
    const mal = [
      { ...dispSemana(), duracionMin: 'treinta' },
      { ...dispSemana(), semana: [{ dia: 9, desde: '09:00', hasta: '10:00' }] },
      { ...dispSemana(), semana: [{ dia: 1, desde: '9:00', hasta: '10:00' }] },
      { ...dispSemana(), extra: 'no permitido' },
      { ...dispSemana(), duracionMin: 5 },
      { ...dispSemana(), areas: [] },
    ];
    for (const m of mal) assert.equal((await llamar(LAURA, 'PUT', '/agenda/disponibilidad/laura', m)).status, 400, JSON.stringify(m).slice(0, 80));
    assert.equal(auditoria.length, 0);
  });

  it('la configuración general solo la cambia el administrador', async () => {
    const cfg = { antelacionMin: 60, maxCitasFuturas: 3, diasVentana: 10, festivos: ['2026-12-25'] };
    assert.equal((await llamar(LAURA, 'PUT', '/agenda/config', cfg)).status, 403);
    assert.equal((await llamar(ADMIN, 'PUT', '/agenda/config', { ...cfg, maxCitasFuturas: 0 })).status, 400);
    const ok = await llamar(ADMIN, 'PUT', '/agenda/config', cfg);
    assert.equal(ok.status, 200);
    assert.equal((await llamar(LAURA, 'GET', '/agenda/config')).json.config.maxCitasFuturas, 3);
    assert.equal(auditoria[0].action, 'agenda_config_actualizada');
  });

  it('lista a los asesores con quién es el usuario y qué puede editar', async () => {
    const r = await llamar(LAURA, 'GET', '/agenda/asesores');
    const laura = r.json.asesores.find((a: any) => a.username === 'laura');
    const mario = r.json.asesores.find((a: any) => a.username === 'mario');
    assert.deepEqual([laura.esYo, laura.puedeEditar, mario.esYo, mario.puedeEditar], [true, true, false, false]);
    assert.equal('semana' in laura, false, 'no se filtra la disponibilidad completa en el listado');
  });
});

describe('citas desde el panel', () => {
  it('crear: reserva, avisa a la persona y audita quién, qué y sobre quién sin el teléfono completo', async () => {
    const r = await llamar(LAURA, 'POST', '/agenda/citas', cita({ motivo: 'Seguimiento' }));
    assert.equal(r.status, 201);
    assert.equal(r.json.cita.canal, 'panel');
    assert.equal(r.json.cita.creadaPor, 'laura');
    assert.equal(r.json.cita.fin, '2026-11-24T09:30:00-05:00', 'sin `fin` usa la duración del asesor');
    assert.equal(r.json.aviso.enviado, true);
    assert.equal(avisos[0].telefono, TEL);
    assert.match(avisos[0].texto, /martes 24 de noviembre a las 9:00 a\. m\./);
    assert.equal(auditoria.length, 1);
    assert.equal(auditoria[0].username, 'laura');
    assert.equal(auditoria[0].action, 'agenda_cita_creada');
    assert.match(auditoria[0].detail!, /asesor laura · persona \*\*\*\*4567 · 2026-11-24T09:00:00-05:00/);
    assert.equal(auditoria[0].detail!.includes(TEL), false, 'el teléfono completo no va a la auditoría');
    assert.equal(auditoria[0].detail!.includes('4567') && !auditoria[0].detail!.includes('3001234567'), true);
  });

  it('crear: un asesor no agenda en la agenda de otro; el administrador sí', async () => {
    assert.equal((await llamar(MARIO, 'POST', '/agenda/citas', cita())).status, 403);
    assert.equal((await llamar(ADMIN, 'POST', '/agenda/citas', cita())).status, 201);
  });

  it('crear: ocupada 409, franja inválida 400, forzar la deja salirse de la rejilla, cuerpo malo 400', async () => {
    assert.equal((await llamar(LAURA, 'POST', '/agenda/citas', cita())).status, 201);
    const ocupada = await llamar(LAURA, 'POST', '/agenda/citas', cita({ telefono: TEL2 }));
    assert.equal(ocupada.status, 409);
    assert.equal(ocupada.json.error, 'ocupada');
    assert.equal((await llamar(LAURA, 'POST', '/agenda/citas', cita({ telefono: TEL2, inicio: '2026-11-24T09:10:00-05:00' }))).status, 400);
    assert.equal((await llamar(LAURA, 'POST', '/agenda/citas', cita({ telefono: TEL2, inicio: '2026-11-24T19:00:00-05:00', forzar: true }))).status, 201);
    assert.equal((await llamar(LAURA, 'POST', '/agenda/citas', cita({ telefono: 'abc' }))).status, 400);
    assert.equal((await llamar(LAURA, 'POST', '/agenda/citas', { telefono: TEL })).status, 400);
    assert.equal((await llamar(LAURA, 'POST', '/agenda/citas', cita({ inicio: 'mañana' }))).status, 400);
    assert.equal((await llamar(LAURA, 'POST', '/agenda/citas', cita({ area: 'ventas' }))).status, 400);
  });

  it('con la ventana de WhatsApp cerrada no envía y se lo dice al asesor', async () => {
    ventanaCerrada = true;
    const r = await llamar(LAURA, 'POST', '/agenda/citas', cita());
    assert.equal(r.status, 201, 'la cita se crea igual');
    assert.deepEqual(r.json.aviso, { enviado: false, motivo: 'ventana cerrada' });
    assert.equal(avisos.length, 0);
  });

  it('listar: el teléfono completo solo para el dueño de la agenda y el administrador', async () => {
    await llamar(LAURA, 'POST', '/agenda/citas', cita());
    const q = '/agenda/citas?desde=2026-11-24&dias=1';
    const propia = (await llamar(LAURA, 'GET', q)).json.citas[0];
    const admin = (await llamar(ADMIN, 'GET', q)).json.citas[0];
    const ajena = (await llamar(MARIO, 'GET', q)).json.citas[0];
    assert.equal(propia.telefono, TEL);
    assert.equal(admin.telefono, TEL);
    assert.equal(ajena.telefono, undefined);
    assert.equal(ajena.telefonoMasc, '****4567');
    assert.equal(ajena.puedeEditar, false);
    assert.equal(JSON.stringify(ajena).includes('3001234567'), false);
    assert.equal((await llamar(LAURA, 'GET', '/agenda/citas?desde=2026-02-30')).status, 400);
    assert.equal((await llamar(LAURA, 'GET', '/agenda/citas?desde=2026-11-24&dias=99')).status, 400);
  });

  it('mover: libera la hora vieja, avisa y audita; no se mueve la cita de otro ni a la agenda de otro', async () => {
    const creada = (await llamar(LAURA, 'POST', '/agenda/citas', cita())).json.cita;
    avisos.length = 0;
    assert.equal((await llamar(MARIO, 'POST', `/agenda/citas/${creada.id}/mover`, { inicio: '2026-11-24T10:00:00-05:00' })).status, 403);
    assert.equal((await llamar(LAURA, 'POST', `/agenda/citas/${creada.id}/mover`, { inicio: '2026-11-24T10:00:00-05:00', asesor: 'mario' })).status, 403);
    const r = await llamar(LAURA, 'POST', `/agenda/citas/${creada.id}/mover`, { inicio: '2026-11-24T10:00:00-05:00' });
    assert.equal(r.status, 200);
    assert.equal(r.json.cita.inicio, '2026-11-24T10:00:00-05:00');
    assert.match(avisos[0].texto, /Cambiamos tu cita/);
    assert.match(auditoria[auditoria.length - 1].detail!, /-> 2026-11-24T10:00:00-05:00/);
    assert.equal((await servicio.obtenerCita(creada.id))?.estado, 'cancelada');
    // La hora vieja quedó libre para otra persona.
    assert.equal((await llamar(LAURA, 'POST', '/agenda/citas', cita({ telefono: TEL2 }))).status, 201);
  });

  it('mover a una hora ocupada devuelve 409 y deja la cita donde estaba', async () => {
    const a = (await llamar(LAURA, 'POST', '/agenda/citas', cita())).json.cita;
    await llamar(LAURA, 'POST', '/agenda/citas', cita({ telefono: TEL2, inicio: '2026-11-24T10:00:00-05:00' }));
    const r = await llamar(LAURA, 'POST', `/agenda/citas/${a.id}/mover`, { inicio: '2026-11-24T10:00:00-05:00' });
    assert.equal(r.status, 409);
    assert.equal((await servicio.obtenerCita(a.id))?.estado, 'confirmada');
  });

  it('cancelar: solo quien puede editarla; no dos veces; id inválido o inexistente', async () => {
    const c = (await llamar(LAURA, 'POST', '/agenda/citas', cita())).json.cita;
    assert.equal((await llamar(MARIO, 'POST', `/agenda/citas/${c.id}/cancelar`)).status, 403);
    assert.equal((await servicio.obtenerCita(c.id))?.estado, 'confirmada');
    avisos.length = 0;
    assert.equal((await llamar(ADMIN, 'POST', `/agenda/citas/${c.id}/cancelar`)).status, 200);
    assert.match(avisos[0].texto, /fue cancelada por el equipo/);
    assert.equal(auditoria[auditoria.length - 1].username, 'admin');
    assert.equal(auditoria[auditoria.length - 1].action, 'agenda_cita_cancelada');
    assert.equal((await llamar(ADMIN, 'POST', `/agenda/citas/${c.id}/cancelar`)).status, 409);
    assert.equal((await llamar(ADMIN, 'POST', '/agenda/citas/cita_noexiste/cancelar')).status, 404);
    assert.equal((await llamar(ADMIN, 'POST', '/agenda/citas/..%2F..%2Fx/cancelar')).status, 400);
  });

  it('marcar atendida / no asistió: solo cuando ya empezó, y queda auditado', async () => {
    const c = (await llamar(LAURA, 'POST', '/agenda/citas', cita())).json.cita;
    assert.equal((await llamar(LAURA, 'POST', `/agenda/citas/${c.id}/estado`, { estado: 'atendida' })).status, 409);
    mundo.reloj.ahora = Date.parse('2026-11-24T10:00:00-05:00');
    assert.equal((await llamar(MARIO, 'POST', `/agenda/citas/${c.id}/estado`, { estado: 'atendida' })).status, 403);
    assert.equal((await llamar(LAURA, 'POST', `/agenda/citas/${c.id}/estado`, { estado: 'cualquiera' })).status, 400);
    const r = await llamar(LAURA, 'POST', `/agenda/citas/${c.id}/estado`, { estado: 'no_asistio' });
    assert.equal(r.status, 200);
    assert.equal(r.json.cita.estado, 'no_asistio');
    assert.equal(auditoria[auditoria.length - 1].action, 'agenda_cita_no_asistio');
  });

  it('franjas del panel: las de un solo asesor', async () => {
    const r = await llamar(LAURA, 'GET', '/agenda/franjas?asesor=laura&desde=2026-11-24&dias=1');
    assert.equal(r.status, 200);
    assert.equal(r.json.franjas.length, 12);
    assert.ok(r.json.franjas.every((f: any) => f.asesor === 'laura'));
    assert.equal((await llamar(LAURA, 'GET', '/agenda/franjas')).status, 400);
  });
});
