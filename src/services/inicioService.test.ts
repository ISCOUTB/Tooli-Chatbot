import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  armarInicioPorRol,
  contarSeguimiento,
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
    assert.equal(asesor[0].mensaje, 'No se pueden consultar turnos ni descargar recibos');
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
