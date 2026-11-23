// Portado de FastFood: schedule-phrases.test.ts (ruteo IA/persona) y callbacks-report.test.ts (cola y reporte).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { asesoresDisponibles, bogotaClock, decideRoute, leerHorarioAsesores, matchRule, readScheduleRules } from './horario';
import { buildWeeklyReport, pendingCallbacks } from './devoluciones';
import type { LlamadaVoz } from './tipos';

const RULES = readScheduleRules({
  on: true,
  otherwise: 'ai',
  rules: [
    { id: 'r1', days: [1], from: '12:00', to: '14:00', who: 'person' },
    { id: 'r2', days: [6, 0], from: '22:00', to: '02:00', who: 'person' },
  ],
});

describe('reglas de ruteo IA / persona', () => {
  it('una regla de día y hora manda a una persona; fuera de ella, la asistente', () => {
    assert.equal(decideRoute(RULES, true, { weekday: 1, minute: 12 * 60 }).effective, 'person');
    assert.equal(decideRoute(RULES, true, { weekday: 1, minute: 14 * 60 - 1 }).effective, 'person');
    assert.equal(decideRoute(RULES, true, { weekday: 1, minute: 14 * 60 }).effective, 'ai');
    assert.equal(decideRoute(RULES, true, { weekday: 2, minute: 13 * 60 }).effective, 'ai');
  });
  it('una regla que cruza la medianoche cuenta el día en que empezó', () => {
    assert.equal(matchRule(RULES, 6, 23 * 60)?.id, 'r2');
    assert.equal(matchRule(RULES, 0, 60)?.id, 'r2');
    assert.equal(matchRule(RULES, 1, 60)?.id, 'r2');
    assert.equal(matchRule(RULES, 2, 60), null);
  });
  it('sin número de desvío contesta la asistente y el motivo lo dice', () => {
    const r = decideRoute(RULES, false, { weekday: 1, minute: 12 * 60 + 30 });
    assert.equal(r.who, 'person');
    assert.equal(r.effective, 'ai');
    assert.match(r.reason, /no hay número de desvío/);
  });
  it('reglas basura se descartan', () => {
    const r = readScheduleRules({ on: true, rules: [{ id: 'x', days: [1], from: '25:00', to: '10:00', who: 'person' }] });
    assert.equal(r.on, false);
  });
});

describe('horario de asesores (hora de Colombia)', () => {
  it('reloj de Colombia: UTC-5', () => {
    const c = bogotaClock(new Date('2026-11-24T02:30:00Z')); // lunes 23 21:30 en Bogotá
    assert.equal(c.weekday, 1);
    assert.equal(c.minute, 21 * 60 + 30);
    assert.equal(c.day, '2026-11-23');
  });
  it('lunes 10 am sí; lunes 7 pm no; sábado 11 am sí; domingo no', () => {
    const h = leerHorarioAsesores(undefined);
    assert.equal(asesoresDisponibles(h, new Date('2026-11-23T15:00:00Z')), true);
    assert.equal(asesoresDisponibles(h, new Date('2026-11-24T00:00:00Z')), false);
    assert.equal(asesoresDisponibles(h, new Date('2026-11-28T16:00:00Z')), true);
    assert.equal(asesoresDisponibles(h, new Date('2026-11-29T15:00:00Z')), false);
  });
  it('franjas inválidas se descartan', () => {
    assert.deepEqual(leerHorarioAsesores([{ dias: [1], desde: '18:00', hasta: '08:00' }, { dias: [], desde: '08:00', hasta: '09:00' }]), []);
  });
});

const NOW = new Date('2026-11-20T18:00:00Z');
type Fila = Pick<LlamadaVoz, 'id' | 'simulada' | 'telefono' | 'resultado' | 'iniciada' | 'duracionSeg' | 'resumen' | 'devolucionHecha' | 'costoUsd'>;
const row = (o: Partial<Fila> & { id: string }): Fila => ({
  simulada: false, telefono: '573001112233', resultado: 'colgo', iniciada: '2026-11-20T16:00:00Z', duracionSeg: 20, resumen: null, devolucionHecha: null, costoUsd: 0.07, ...o,
});

describe('cola de devoluciones', () => {
  it('lista una por número, la más reciente, con cuántas veces llamó', () => {
    const r = pendingCallbacks([row({ id: 'a', iniciada: '2026-11-20T15:00:00Z' }), row({ id: 'b', resultado: 'devolver_llamada' })], NOW);
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'b');
    assert.equal(r[0].attempts, 2);
  });
  it('no cuenta simuladas, colgadas de menos de 8 s, ni resueltas', () => {
    assert.equal(pendingCallbacks([row({ id: 'a', simulada: true }), row({ id: 'b', duracionSeg: 3 }), row({ id: 'c', resultado: 'consulta' }), row({ id: 'd', telefono: '' })], NOW).length, 0);
  });
  it('se resuelve si lo atendieron después (consulta, cita, transferida) o ya se devolvió', () => {
    for (const ok of ['consulta', 'cita', 'transferida', 'datos_estudiante'] as const) {
      assert.equal(pendingCallbacks([row({ id: 'a', iniciada: '2026-11-20T15:00:00Z' }), row({ id: 'b', resultado: ok })], NOW).length, 0, ok);
    }
    assert.equal(pendingCallbacks([row({ id: 'a', devolucionHecha: '2026-11-20T17:00:00Z' })], NOW).length, 0);
    const again = pendingCallbacks([row({ id: 'a', devolucionHecha: '2026-11-20T15:30:00Z', iniciada: '2026-11-20T15:00:00Z' }), row({ id: 'b', iniciada: '2026-11-20T17:00:00Z' })], NOW);
    assert.deepEqual(again.map((x) => x.id), ['b']);
  });
  it('olvida lo de hace más de 3 días; el silencio y el sin cupo también entran', () => {
    assert.equal(pendingCallbacks([row({ id: 'a', iniciada: '2026-11-16T10:00:00Z' })], NOW).length, 0);
    assert.equal(pendingCallbacks([row({ id: 'a', resultado: 'silencio' }), row({ id: 'b', telefono: '573009998877', resultado: 'sin_cupo', duracionSeg: 0 })], NOW).length, 2);
  });
});

describe('reporte semanal', () => {
  it('suma días, resueltas, citas, minutos y ahorro', () => {
    const rows = [
      row({ id: '1', resultado: 'cita', duracionSeg: 180, costoUsd: 0.21 }),
      row({ id: '2', resultado: 'consulta', duracionSeg: 120, costoUsd: 0.14 }),
      row({ id: '3', resultado: 'colgo', duracionSeg: 10, costoUsd: 0.07 }),
      row({ id: '4', simulada: true, resultado: 'cita' }),
      row({ id: '5', resultado: 'cita', iniciada: '2026-10-01T10:00:00Z' }),
    ];
    const r = buildWeeklyReport(rows, { hourlyCop: 12000, now: NOW });
    assert.equal(r.days.length, 7);
    assert.equal(r.calls, 3);
    assert.equal(r.handled, 2);
    assert.equal(r.appointments, 1);
    assert.equal(r.minutes, 5);
    assert.equal(r.costCop, 1680);
    assert.equal(r.humanCop, 1000);
    assert.equal(r.savedCop, 1000 - 1680);
  });
});
