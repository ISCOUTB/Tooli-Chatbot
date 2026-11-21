import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  armarInicioPorRol,
  claveDiaAnterior,
  contarEstancados,
  contarSeguimiento,
  masAntiguas,
  metricasDelDia,
  esperaMasLargaMin,
  inicioDiaBogota,
  mensajesDeServicios,
  numeroMetrica,
  InicioRespuesta,
} from './inicioService';
import type { ConversacionAtencion } from './chatwootAtencion';
import type { FichaCrm } from './crmService';

const ficha = (estado: FichaCrm['estado'], asignadoA?: string): FichaCrm => ({
  phone: Math.random().toString(), estado, asignadoA, etiquetas: [], notas: [], actualizadoEn: 0,
});

const conversacion = (actividadTs: number, asignado: ConversacionAtencion['asignado'] = null): ConversacionAtencion => ({
  id: actividadTs, estado: 'open', contacto: { nombre: 'Prueba', telefono: '57' }, asignado,
  equipo: null, etiquetas: [], prioridad: null, noLeidos: 0, ultimoMensaje: null, actividadTs,
});

describe('contarSeguimiento', () => {
  it('separa las etapas propias y los seguimientos sin asesor', () => {
    assert.deepEqual(contarSeguimiento([
      ficha('nuevo', 'luis'), ficha('interesado', 'luis'), ficha('interesado'), ficha('contactado'), ficha('nuevo'),
    ], 'luis'), {
      mios: { nuevo: 1, contactado: 0, interesado: 1, inscrito: 0, descartado: 0 },
      sinAsignar: 2,
    });
  });
});

describe('esperaMasLargaMin', () => {
  it('usa la actividad más antigua solo entre conversaciones sin asignar', () => {
    const ahora = 2_000_000;
    assert.equal(esperaMasLargaMin([
      conversacion(ahora - 25 * 60_000),
      conversacion(ahora - 90 * 60_000, { id: 1, nombre: 'Ana' }),
      conversacion(ahora - 5 * 60_000),
    ], ahora), 25);
    assert.equal(esperaMasLargaMin([conversacion(ahora, { id: 1, nombre: 'Ana' })], ahora), null);
  });
});

describe('mensajesDeServicios', () => {
  it('traduce la consecuencia y reserva el detalle técnico para admin', () => {
    const checks = {
      iceberg: { status: 'down' as const, detail: 'timeout' },
      google_sheets: { status: 'degraded' as const, detail: 'quota' },
      redis: { status: 'ok' as const },
    };
    const asesor = mensajesDeServicios(checks, 'asesor');
    assert.equal(asesor[0].mensaje, 'No se pueden descargar recibos');
    assert.equal(asesor[0].detalle, undefined);
    assert.equal(mensajesDeServicios(checks, 'admin')[0].detalle, 'timeout');
  });
});

describe('armarInicioPorRol', () => {
  const bloques: Omit<InicioRespuesta, 'rol' | 'generadoEn'> = {
    atencion: { estado: 'ok', sinAsignar: 1, misSinLeer: 0, mias: 1, esperaMasLargaMin: 4, porAsesor: [{ id: 1, nombre: 'Ana', disponible: true, abiertas: 1 }] },
    seguimiento: { estado: 'ok', mios: { nuevo: 0, contactado: 0, interesado: 0, inscrito: 0, descartado: 0 }, sinAsignar: 0 },
    recordatorios: { estado: 'ok', fallidos: 0, programadosHoy: 0 },
    hoy: { estado: 'ok', interaccionesBot: 1, derivadosAsesor: 2, prospectosNuevos: 3, preguntasIa: 4 },
    servicios: { estado: 'ok', afectados: [] },
  };

  it('solo entrega carga por asesor al admin', () => {
    assert.equal(armarInicioPorRol('admin', bloques, 10).atencion.porAsesor?.length, 1);
    assert.equal(armarInicioPorRol('asesor', bloques, 10).atencion.porAsesor, undefined);
  });
});

describe('numeroMetrica', () => {
  it('una métrica ausente del día es cero, no "sin datos"', () => {
    assert.equal(numeroMetrica({}, 'agent_handoff'), 0);
    assert.equal(numeroMetrica({ agent_handoff: '3' }, 'agent_handoff'), 3);
    assert.equal(numeroMetrica({ agent_handoff: 'x' }, 'agent_handoff'), null);
  });
});

describe('inicioDiaBogota', () => {
  it('el día empieza a medianoche de Bogotá (05:00 UTC)', () => {
    // 30 oct 2026, 02:00 en Bogotá = 07:00 UTC → el día empezó a las 05:00 UTC.
    assert.equal(inicioDiaBogota(Date.UTC(2026, 9, 30, 7)), Date.UTC(2026, 9, 30, 5));
    // 29 oct 2026, 23:00 en Bogotá = 30 oct 04:00 UTC → sigue siendo el 29.
    assert.equal(inicioDiaBogota(Date.UTC(2026, 9, 30, 4)), Date.UTC(2026, 9, 29, 5));
  });
});

describe('masAntiguas', () => {
  it('ordena la cola de la que más lleva a la que menos y resume cada conversación', () => {
    const ahora = 10_000_000;
    const con = (id: number, minutos: number, asignado: ConversacionAtencion['asignado'] = null): ConversacionAtencion => ({
      ...conversacion(ahora - minutos * 60_000, asignado), id,
      contacto: { nombre: id === 3 ? '' : `Persona ${id}`, telefono: '573001112233' },
      equipo: { id: 10, nombre: 'Admisiones' },
      ultimoMensaje: { texto: 'Hola, *quiero* saber   el _valor_', ts: ahora, tipo: 'in' },
    });
    const cola = masAntiguas([con(1, 5), con(2, 47), con(3, 22), con(4, 90, { id: 1, nombre: 'Ana' })], (c) => !c.asignado, 2, ahora);
    assert.deepEqual(cola.map((c) => [c.id, c.esperaMin]), [[2, 47], [3, 22]]);
    assert.equal(cola[1].nombre, '573001112233');
    assert.equal(cola[0].equipo, 'Admisiones');
    assert.equal(cola[0].vista, 'Hola, quiero saber el valor');
  });

  it('deja al final las conversaciones sin actividad conocida', () => {
    const ahora = 10_000_000;
    const sinFecha = { ...conversacion(0), id: 9 };
    const reciente = { ...conversacion(ahora - 60_000), id: 8 };
    assert.deepEqual(masAntiguas([sinFecha, reciente], () => true, 5, ahora).map((c) => c.id), [8, 9]);
  });
});

describe('contarEstancados', () => {
  it('cuenta solo los propios contactados o interesados sin cambios en cinco días', () => {
    const ahora = 100 * 24 * 60 * 60 * 1000;
    const hace = (dias: number) => ahora - dias * 24 * 60 * 60 * 1000;
    const con = (estado: FichaCrm['estado'], dias: number, asignadoA = 'luis'): FichaCrm => ({ ...ficha(estado, asignadoA), actualizadoEn: hace(dias) });
    assert.equal(contarEstancados([
      con('contactado', 7), con('interesado', 9), con('contactado', 2), con('nuevo', 30), con('contactado', 8, 'ana'),
      { ...ficha('contactado', 'luis'), actualizadoEn: 0 },
    ], 'luis', ahora), 2);
  });
});

describe('metricasDelDia y claveDiaAnterior', () => {
  it('arma las mismas cifras para hoy y para ayer', () => {
    assert.deepEqual(metricasDelDia({ menu_shown: '10', ai_request: '3', agent_handoff: '2' }), {
      interaccionesBot: 13, derivadosAsesor: 2, prospectosNuevos: 0, preguntasIa: 3,
    });
    assert.equal(claveDiaAnterior(Date.UTC(2026, 10, 14, 3, 0)), '2026-11-13');
  });

  it('cuenta el flujo conversacional: conversaciones nuevas, preguntas y quien autorizó sus datos', () => {
    assert.deepEqual(metricasDelDia({ conv_inicio: '7', ai_request: '5', datos_acepta: '4', agent_handoff: '1' }), {
      interaccionesBot: 12, derivadosAsesor: 1, prospectosNuevos: 4, preguntasIa: 5,
    });
  });
});
