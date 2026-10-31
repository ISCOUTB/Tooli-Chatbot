import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AtencionConfigError,
  AsesorElegible,
  CONFIG_ATENCION_DEFAULT,
  ConversacionEnEspera,
  conversacionesEnEspera,
  dentroDeHorario,
  elegirAsesor,
  planificarReparto,
  textoHorario,
  validarConfigAtencion,
} from './atencionEquipoService';
import type { ConversacionAtencion } from './chatwootAtencion';

const horario = { activo: true, dias: [1, 2, 3, 4, 5], desde: '08:00', hasta: '18:00' };

describe('configuración del equipo de atención', () => {
  it('acepta y normaliza una configuración completa', () => {
    const config = validarConfigAtencion({
      asignacionAutomatica: true,
      encuestaSatisfaccion: true,
      maxAbiertasPorAsesor: 12,
      horario: { activo: true, dias: [5, 1, 3], desde: '09:15', hasta: '17:45' },
    });
    assert.deepEqual(config, {
      asignacionAutomatica: true,
      encuestaSatisfaccion: true,
      maxAbiertasPorAsesor: 12,
      horario: { activo: true, dias: [1, 3, 5], desde: '09:15', hasta: '17:45' },
    });
  });

  it('rechaza máximos, días y horas inválidos', () => {
    const base = structuredClone(CONFIG_ATENCION_DEFAULT);
    assert.throws(() => validarConfigAtencion({ ...base, maxAbiertasPorAsesor: 0 }), AtencionConfigError);
    assert.throws(() => validarConfigAtencion({ ...base, maxAbiertasPorAsesor: 51 }), AtencionConfigError);
    assert.throws(() => validarConfigAtencion({ ...base, horario: { ...base.horario, dias: [1, 7] } }), AtencionConfigError);
    assert.throws(() => validarConfigAtencion({ ...base, horario: { ...base.horario, desde: '8:00' } }), AtencionConfigError);
    assert.throws(() => validarConfigAtencion({ ...base, horario: { ...base.horario, desde: '18:00', hasta: '18:00' } }), AtencionConfigError);
  });
});

describe('horario de atención en Bogotá', () => {
  it('incluye el inicio y excluye el cierre', () => {
    // 13:00 UTC y 23:00 UTC son 08:00 y 18:00 en Bogotá.
    assert.equal(dentroDeHorario(horario, new Date('2026-10-26T13:00:00Z')), true);
    assert.equal(dentroDeHorario(horario, new Date('2026-10-26T22:59:59Z')), true);
    assert.equal(dentroDeHorario(horario, new Date('2026-10-26T23:00:00Z')), false);
  });

  it('usa el día de Bogotá aunque en UTC ya sea el día siguiente', () => {
    assert.equal(dentroDeHorario({ ...horario, dias: [1], desde: '18:00', hasta: '23:00' }, new Date('2026-10-27T03:00:00Z')), true);
    assert.equal(dentroDeHorario(horario, new Date('2026-10-25T15:00:00Z')), false);
  });

  it('si está inactivo siempre permite atención', () => {
    assert.equal(dentroDeHorario({ ...horario, activo: false }, new Date('2026-10-25T03:00:00Z')), true);
  });

  it('produce un horario legible', () => {
    assert.equal(textoHorario(horario), 'lunes a viernes de 8:00 a 18:00');
    assert.equal(textoHorario({ ...horario, dias: [1, 3] }), 'lunes y miércoles de 8:00 a 18:00');
  });
});

describe('elección de asesor', () => {
  const asesor = (cambios: Partial<AsesorElegible> = {}): AsesorElegible => ({
    username: 'ana', chatwootUserId: 1, area: 'admisiones', conectado: true,
    estado: 'disponible', abiertas: 0, ultimaAsignacion: 0, ...cambios,
  });

  it('filtra por área, presencia y máximo de abiertas', () => {
    const elegido = elegirAsesor([
      asesor({ username: 'ti', chatwootUserId: 2, area: 'ti' }),
      asesor({ username: 'ocupada', chatwootUserId: 3, estado: 'ocupado' }),
      asesor({ username: 'llena', chatwootUserId: 4, abiertas: 5 }),
      asesor({ username: 'general', chatwootUserId: 5, area: 'all', abiertas: 2 }),
    ], 'admisiones', 5);
    assert.equal(elegido?.username, 'general');
  });

  it('elige menor carga antes que la última asignación', () => {
    const elegido = elegirAsesor([
      asesor({ username: 'ana', abiertas: 2, ultimaAsignacion: 1 }),
      asesor({ username: 'beto', chatwootUserId: 2, abiertas: 1, ultimaAsignacion: 999 }),
    ], 'admisiones', 5);
    assert.equal(elegido?.username, 'beto');
  });

  it('desempata por quien lleva más tiempo sin recibir', () => {
    const elegido = elegirAsesor([
      asesor({ username: 'ana', ultimaAsignacion: 200 }),
      asesor({ username: 'beto', chatwootUserId: 2, ultimaAsignacion: 100 }),
    ], 'admisiones', 5);
    assert.equal(elegido?.username, 'beto');
  });

  it('devuelve null cuando nadie puede recibir', () => {
    assert.equal(elegirAsesor([asesor({ conectado: false })], 'admisiones', 5), null);
  });
});

describe('cola de espera', () => {
  const asesor = (cambios: Partial<AsesorElegible> = {}): AsesorElegible => ({
    username: 'ana', chatwootUserId: 1, area: 'admisiones', conectado: true,
    estado: 'disponible', abiertas: 0, ultimaAsignacion: 0, ...cambios,
  });
  const espera = (...ids: number[]): ConversacionEnEspera[] => ids.map((id) => ({ id, area: 'admisiones' }));
  const quienes = (plan: ReturnType<typeof planificarReparto>) => plan.map((paso) => `${paso.conversacionId}:${paso.username}`);

  it('toma las abiertas sin asesor de TI o Admisiones, de la más antigua a la más nueva', () => {
    const conversacion = (id: number, cambios: Partial<ConversacionAtencion>): ConversacionAtencion => ({
      id, estado: 'open', contacto: { nombre: 'Persona', telefono: '573000000000' }, asignado: null,
      equipo: { id: 10, nombre: 'Admisiones' }, etiquetas: [], prioridad: null, noLeidos: 0,
      ultimoMensaje: null, actividadTs: 0, ...cambios,
    });
    const enEspera = conversacionesEnEspera([
      conversacion(40, {}),
      conversacion(12, { equipo: { id: 11, nombre: 'Soporte TI' } }),
      conversacion(30, { asignado: { id: 1, nombre: 'Ana' } }),
      conversacion(20, { equipo: null }),
      conversacion(25, { equipo: { id: 99, nombre: 'Otro' } }),
    ], { ti: 11, admisiones: 10 });
    assert.deepEqual(enEspera, [{ id: 12, area: 'ti' }, { id: 40, area: 'admisiones' }]);
  });

  it('el chat nuevo va al asesor activo que no tiene ninguno', () => {
    const plan = planificarReparto(espera(7), [
      asesor({ username: 'ana', abiertas: 1 }),
      asesor({ username: 'beto', chatwootUserId: 2, abiertas: 0, ultimaAsignacion: 999 }),
    ], 5);
    assert.deepEqual(plan, [{ conversacionId: 7, area: 'admisiones', username: 'beto', chatwootUserId: 2 }]);
  });

  it('cada chat va al que menos tenga contando lo asignado en la misma vuelta', () => {
    const plan = planificarReparto(espera(1, 2, 3), [
      asesor({ username: 'ana', abiertas: 1 }),
      asesor({ username: 'beto', chatwootUserId: 2, abiertas: 0 }),
    ], 5);
    assert.deepEqual(quienes(plan), ['1:beto', '2:ana', '3:beto']);
  });

  it('entre cargas iguales alterna, empezando por quien lleva más tiempo sin recibir', () => {
    const plan = planificarReparto(espera(1, 2, 3, 4), [
      asesor({ username: 'ana', ultimaAsignacion: 500 }),
      asesor({ username: 'beto', chatwootUserId: 2, ultimaAsignacion: 100 }),
    ], 5);
    assert.deepEqual(quienes(plan), ['1:beto', '2:ana', '3:beto', '4:ana']);
  });

  it('atiende primero la más antigua y deja esperando lo que supera el máximo', () => {
    const plan = planificarReparto(espera(30, 10, 20), [asesor({ abiertas: 0 })], 2);
    assert.deepEqual(quienes(plan), ['10:ana', '20:ana']);
  });

  it('si todos están en el máximo, nadie recibe hasta que se libere un cupo', () => {
    assert.deepEqual(planificarReparto(espera(1), [asesor({ abiertas: 3 }), asesor({ username: 'beto', abiertas: 3 })], 3), []);
  });

  it('sin asesores conectados y disponibles todo queda en espera', () => {
    assert.deepEqual(planificarReparto(espera(1, 2), [
      asesor({ conectado: false }),
      asesor({ username: 'beto', chatwootUserId: 2, estado: 'ausente' }),
    ], 5), []);
  });

  it('un chat sin candidato de su área no frena a los de la otra', () => {
    const plan = planificarReparto([{ id: 1, area: 'ti' }, { id: 2, area: 'admisiones' }], [asesor()], 5);
    assert.deepEqual(quienes(plan), ['2:ana']);
  });

  it('no modifica la carga de los asesores recibidos', () => {
    const asesores = [asesor({ abiertas: 1, ultimaAsignacion: 50 })];
    planificarReparto(espera(1, 2), asesores, 5);
    assert.deepEqual(asesores, [asesor({ abiertas: 1, ultimaAsignacion: 50 })]);
  });
});
