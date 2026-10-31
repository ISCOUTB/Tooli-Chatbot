import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AtencionConfigError,
  AsesorElegible,
  CONFIG_ATENCION_DEFAULT,
  dentroDeHorario,
  elegirAsesor,
  textoHorario,
  validarConfigAtencion,
} from './atencionEquipoService';

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
