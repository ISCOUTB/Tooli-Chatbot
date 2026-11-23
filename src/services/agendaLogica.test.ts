import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AgendaValidacionError, Disponibilidad, calcularFranjasAsesor, chocan, diaEnPalabras, elegirVariadas, fechaEnPalabras,
  fechaValida, festivosColombia, horaEnPalabras, inicioDelDia, isoBogota, msDeIso, partesBogota, planearRecordatorios, sumarDias,
  validarConfigAgenda, validarDisponibilidad,
} from './agendaLogica';
import { tituloFilaFranja } from './agendaTextos';

const MIN = 60_000;
const bog = (iso: string) => Date.parse(`${iso}-05:00`);

function disp(extra: Partial<Disponibilidad> = {}): Disponibilidad {
  return {
    asesor: 'laura', activo: true, areas: ['posgrados'], duracionMin: 30, pausaMin: 0,
    semana: [{ dia: 1, desde: '09:00', hasta: '11:00' }], excepciones: [], actualizado: 1, ...extra,
  };
}

// Lunes 2026-11-23 a las 08:00 en Bogotá.
const AHORA = bog('2026-11-23T08:00:00');

function franjas(d: Disponibilidad, extra: Partial<Parameters<typeof calcularFranjasAsesor>[0]> = {}) {
  return calcularFranjasAsesor({
    disp: d, ocupados: [], ahoraMs: AHORA, desdeMs: AHORA, hastaMs: AHORA + 24 * 60 * MIN,
    antelacionMin: 0, festivos: [], ...extra,
  }).map((f) => isoBogota(f.inicioMs).slice(11, 16));
}

describe('zona horaria America/Bogota', () => {
  it('partesBogota cruza el día en UTC pero no en Bogotá', () => {
    // 02:00 UTC del martes 24 = 21:00 del lunes 23 en Bogotá.
    const p = partesBogota(Date.parse('2026-11-24T02:00:00Z'));
    assert.deepEqual(p, { fecha: '2026-11-23', dia: 1, minutos: 21 * 60 });
  });

  it('isoBogota y msDeIso son inversas y siempre llevan -05:00', () => {
    const ms = Date.parse('2026-11-24T02:00:00Z');
    assert.equal(isoBogota(ms), '2026-11-23T21:00:00-05:00');
    assert.equal(msDeIso(isoBogota(ms)), ms);
  });

  it('inicioDelDia es la medianoche de Bogotá, no la de UTC', () => {
    assert.equal(inicioDelDia('2026-11-23'), Date.parse('2026-11-23T05:00:00Z'));
  });

  it('una franja de las 21:00 locales sale con la fecha local aunque en UTC ya sea el día siguiente', () => {
    const d = disp({ semana: [{ dia: 1, desde: '20:00', hasta: '22:00' }] });
    const f = calcularFranjasAsesor({
      disp: d, ocupados: [], ahoraMs: AHORA, desdeMs: AHORA, hastaMs: AHORA + 24 * 60 * MIN, antelacionMin: 0, festivos: [],
    });
    assert.deepEqual(f.map((x) => isoBogota(x.inicioMs)), [
      '2026-11-23T20:00:00-05:00', '2026-11-23T20:30:00-05:00', '2026-11-23T21:00:00-05:00', '2026-11-23T21:30:00-05:00',
    ]);
    // 21:30 locales ya es martes en UTC: el día de la semana que cuenta es el de Bogotá.
    assert.equal(new Date(f[3].inicioMs).getUTCDay(), 2);
  });

  it('sumarDias respeta fin de mes y de año', () => {
    assert.equal(sumarDias('2026-11-30', 1), '2026-12-01');
    assert.equal(sumarDias('2026-12-31', 1), '2027-01-01');
    assert.equal(sumarDias('2026-03-01', -1), '2026-02-28');
  });

  it('fechaValida rechaza días que no existen', () => {
    assert.equal(fechaValida('2026-02-29'), false);
    assert.equal(fechaValida('2028-02-29'), true);
    assert.equal(fechaValida('2026-13-01'), false);
  });
});

describe('cálculo de franjas libres', () => {
  it('parte el tramo en citas de la duración y no deja una que se salga', () => {
    assert.deepEqual(franjas(disp()), ['09:00', '09:30', '10:00', '10:30']);
    // 50 min en un tramo de 120: caben 2 (100 min), la tercera se saldría.
    assert.deepEqual(franjas(disp({ duracionMin: 50 })), ['09:00', '09:50']);
  });

  it('la pausa separa las citas y se descuenta del tramo', () => {
    assert.deepEqual(franjas(disp({ duracionMin: 30, pausaMin: 15 })), ['09:00', '09:45', '10:30']);
  });

  it('no ofrece el pasado ni lo que empieza antes de la antelación mínima', () => {
    const ahora = bog('2026-11-23T09:20:00');
    const base = { ahoraMs: ahora, desdeMs: ahora };
    assert.deepEqual(franjas(disp(), { ...base, antelacionMin: 0 }), ['09:30', '10:00', '10:30']);
    assert.deepEqual(franjas(disp(), { ...base, antelacionMin: 30 }), ['10:00', '10:30']);
    // Justo en el límite: empieza exactamente a la antelación mínima, sí se ofrece.
    assert.deepEqual(franjas(disp(), { ...base, antelacionMin: 40 }), ['10:00', '10:30']);
    assert.deepEqual(franjas(disp(), { ...base, antelacionMin: 41 }), ['10:30']);
  });

  it('una cita que termina justo cuando empieza otra no choca (pausa 0)', () => {
    const ocupado = { inicioMs: bog('2026-11-23T09:30:00'), finMs: bog('2026-11-23T10:00:00') };
    // La de 09:00 termina a las 09:30, cuando empieza la ocupada: no choca.
    assert.deepEqual(franjas(disp(), { ocupados: [ocupado] }), ['09:00', '10:00', '10:30']);
    assert.equal(chocan(
      { inicioMs: 0, finMs: 30 * MIN }, { inicioMs: 30 * MIN, finMs: 60 * MIN }, 0,
    ), false);
  });

  it('con pausa, la cita pegada a otra sí choca y se pierde la de al lado', () => {
    const ocupado = { inicioMs: bog('2026-11-23T09:45:00'), finMs: bog('2026-11-23T10:15:00') };
    const d = disp({ pausaMin: 15 });
    // Rejilla 09:00, 09:45, 10:30. La de 09:45 es la ocupada; 09:00 termina 09:30 + pausa 15 = 09:45 (no choca);
    // 10:30 empieza justo a las 10:15 + 15 de pausa (no choca).
    assert.deepEqual(franjas(d, { ocupados: [ocupado] }), ['09:00', '10:30']);
    // Una ocupada a las 09:35 sí deja a 09:00 sin su pausa.
    const pegada = { inicioMs: bog('2026-11-23T09:35:00'), finMs: bog('2026-11-23T10:00:00') };
    assert.deepEqual(franjas(d, { ocupados: [pegada] }), ['10:30']);
    assert.equal(chocan({ inicioMs: 0, finMs: 30 * MIN }, { inicioMs: 35 * MIN, finMs: 60 * MIN }, 15 * MIN), true);
  });

  it('una cita ocupada que se traslapa parcialmente quita las franjas que toca', () => {
    const ocupado = { inicioMs: bog('2026-11-23T09:15:00'), finMs: bog('2026-11-23T09:45:00') };
    assert.deepEqual(franjas(disp(), { ocupados: [ocupado] }), ['10:00', '10:30']);
  });

  it('un festivo quita el día entero', () => {
    assert.deepEqual(franjas(disp(), { festivos: ['2026-11-23'] }), []);
  });

  it('una excepción de varios días (vacaciones) bloquea todos sus días, incluidos los extremos', () => {
    const d = disp({ semana: [1, 2, 3].map((dia) => ({ dia, desde: '09:00', hasta: '10:00' })),
      excepciones: [{ desde: '2026-11-24', hasta: '2026-11-25', motivo: 'Vacaciones' }] });
    const f = calcularFranjasAsesor({
      disp: d, ocupados: [], ahoraMs: AHORA, desdeMs: AHORA, hastaMs: AHORA + 4 * 24 * 60 * MIN, antelacionMin: 0, festivos: [],
    }).map((x) => isoBogota(x.inicioMs).slice(0, 10));
    assert.deepEqual([...new Set(f)], ['2026-11-23']);
  });

  it('una excepción por horas solo bloquea esas horas', () => {
    const d = disp({ excepciones: [{ desde: '2026-11-23', hasta: '2026-11-23', horaDesde: '09:30', horaHasta: '10:30' }] });
    assert.deepEqual(franjas(d), ['09:00', '10:30']);
  });

  it('el horario del equipo es un tope: recorta y quita días', () => {
    const equipo = { activo: true, dias: [1], desde: '09:30', hasta: '10:30' };
    assert.deepEqual(franjas(disp(), { horarioEquipo: equipo }), ['09:30', '10:00']);
    assert.deepEqual(franjas(disp(), { horarioEquipo: { ...equipo, dias: [2] } }), []);
    // Equipo sin horario activo: no recorta.
    assert.deepEqual(franjas(disp(), { horarioEquipo: { ...equipo, activo: false } }), ['09:00', '09:30', '10:00', '10:30']);
  });

  it('un asesor inactivo, sin áreas o sin semana no ofrece nada', () => {
    assert.deepEqual(franjas(disp({ activo: false })), []);
    assert.deepEqual(franjas(disp({ areas: [] })), []);
    assert.deepEqual(franjas(disp({ semana: [] })), []);
  });

  it('recorre varios días y respeta el día de la semana', () => {
    const d = disp({ semana: [{ dia: 1, desde: '09:00', hasta: '09:30' }, { dia: 3, desde: '14:00', hasta: '14:30' }] });
    const f = calcularFranjasAsesor({
      disp: d, ocupados: [], ahoraMs: AHORA, desdeMs: AHORA, hastaMs: AHORA + 8 * 24 * 60 * MIN, antelacionMin: 0, festivos: [],
    }).map((x) => isoBogota(x.inicioMs).slice(0, 16));
    assert.deepEqual(f, ['2026-11-23T09:00', '2026-11-25T14:00', '2026-11-30T09:00']);
  });

  it('ignorarOcupados solo valida que encaje en la disponibilidad', () => {
    const ocupado = { inicioMs: bog('2026-11-23T09:00:00'), finMs: bog('2026-11-23T09:30:00') };
    assert.equal(franjas(disp(), { ocupados: [ocupado] }).includes('09:00'), false);
    assert.equal(franjas(disp(), { ocupados: [ocupado], ignorarOcupados: true }).includes('09:00'), true);
  });
});

describe('validación de la disponibilidad', () => {
  const buena = { activo: true, areas: ['ti'], duracionMin: 30, pausaMin: 5, semana: [{ dia: 2, desde: '08:00', hasta: '12:00' }], excepciones: [] };

  it('acepta y normaliza', () => {
    const d = validarDisponibilidad({ ...buena, areas: ['ti', 'ti'] }, 'laura');
    assert.deepEqual(d.areas, ['ti']);
    assert.equal(d.asesor, 'laura');
  });

  it('rechaza horas mal formadas, tramos invertidos y traslapados', () => {
    const falla = (cambio: Record<string, unknown>) =>
      assert.throws(() => validarDisponibilidad({ ...buena, ...cambio }, 'laura'), AgendaValidacionError);
    falla({ semana: [{ dia: 2, desde: '8:00', hasta: '12:00' }] });
    falla({ semana: [{ dia: 2, desde: '12:00', hasta: '08:00' }] });
    falla({ semana: [{ dia: 7, desde: '08:00', hasta: '09:00' }] });
    falla({ semana: [{ dia: 2, desde: '08:00', hasta: '10:00' }, { dia: 2, desde: '09:00', hasta: '11:00' }] });
    falla({ duracionMin: 5 });
    falla({ pausaMin: 90 });
    falla({ areas: ['ventas'] });
    falla({ areas: [] });
    falla({ excepciones: [{ desde: '2026-02-30', hasta: '2026-03-01' }] });
    falla({ excepciones: [{ desde: '2026-03-05', hasta: '2026-03-01' }] });
  });

  it('un asesor inactivo puede guardarse sin áreas', () => {
    assert.equal(validarDisponibilidad({ ...buena, activo: false, areas: [] }, 'laura').activo, false);
  });

  it('valida la configuración general', () => {
    const c = validarConfigAgenda({ antelacionMin: 60, maxCitasFuturas: 2, diasVentana: 14, festivos: ['2026-12-25', '2026-12-08', '2026-12-25'] });
    assert.deepEqual(c.festivos, ['2026-12-08', '2026-12-25']);
    assert.throws(() => validarConfigAgenda({ antelacionMin: -1, maxCitasFuturas: 2, diasVentana: 14 }), AgendaValidacionError);
    assert.throws(() => validarConfigAgenda({ antelacionMin: 0, maxCitasFuturas: 0, diasVentana: 14 }), AgendaValidacionError);
    assert.throws(() => validarConfigAgenda({ antelacionMin: 0, maxCitasFuturas: 1, diasVentana: 14, festivos: ['mañana'] }), AgendaValidacionError);
  });
});

describe('fechas en palabras', () => {
  it('dice la fecha y la hora completas en español', () => {
    assert.equal(fechaEnPalabras(bog('2026-11-25T15:00:00')), 'miércoles 25 de noviembre a las 3:00 p. m.');
    assert.equal(fechaEnPalabras(bog('2026-12-01T09:30:00')), 'martes 1 de diciembre a las 9:30 a. m.');
  });

  it('usa "a la" con la una y 12 para mediodía y medianoche', () => {
    assert.equal(fechaEnPalabras(bog('2026-11-25T13:00:00')), 'miércoles 25 de noviembre a la 1:00 p. m.');
    assert.equal(horaEnPalabras(bog('2026-11-25T12:00:00')), '12:00 p. m.');
    assert.equal(horaEnPalabras(bog('2026-11-25T00:15:00')), '12:15 a. m.');
  });

  it('dice hoy y mañana respecto al ahora de Bogotá, no el de UTC', () => {
    // 22:30 del lunes en Bogotá ya es martes en UTC.
    const ahora = bog('2026-11-23T22:30:00');
    assert.equal(fechaEnPalabras(bog('2026-11-23T23:00:00'), ahora), 'hoy lunes 23 de noviembre a las 11:00 p. m.');
    assert.equal(fechaEnPalabras(bog('2026-11-24T09:00:00'), ahora), 'mañana martes 24 de noviembre a las 9:00 a. m.');
    assert.equal(diaEnPalabras(bog('2026-11-26T09:00:00'), ahora), 'jueves 26 de noviembre');
  });

  it('el título de la fila de la lista cabe en 24 caracteres', () => {
    assert.equal(tituloFilaFranja(bog('2026-11-25T15:00:00')), 'mié 25 nov · 3:00 p. m.');
    assert.ok(tituloFilaFranja(bog('2026-09-30T10:30:00')).length <= 24);
  });
});

describe('elegir franjas variadas', () => {
  const f = (inicio: string) => ({ inicio: `${inicio}-05:00` });
  it('prefiere días distintos y completa con las siguientes si no alcanzan', () => {
    const lista = [f('2026-11-23T09:00:00'), f('2026-11-23T09:30:00'), f('2026-11-24T09:00:00'), f('2026-11-25T09:00:00'), f('2026-11-25T09:30:00')];
    assert.deepEqual(elegirVariadas(lista, 3).map((x) => x.inicio.slice(0, 16)), ['2026-11-23T09:00', '2026-11-24T09:00', '2026-11-25T09:00']);
    const mismoDia = [f('2026-11-23T09:00:00'), f('2026-11-23T09:30:00'), f('2026-11-23T10:00:00'), f('2026-11-23T10:30:00')];
    assert.deepEqual(elegirVariadas(mismoDia, 3).map((x) => x.inicio.slice(11, 16)), ['09:00', '09:30', '10:00']);
    assert.deepEqual(elegirVariadas([], 3), []);
  });
});

describe('qué recordatorios se programan', () => {
  const inicio = bog('2026-11-30T10:00:00');
  const reserva = bog('2026-11-23T08:00:00');
  const plan = (o: { inicioMs: number; ultimoEntranteMs?: number | null; adaptador: 'meta' | 'evolution' }) =>
    planearRecordatorios({ ahoraMs: reserva, ultimoEntranteMs: reserva, ...o });

  it('con Evolution programa los dos', () => {
    const r = plan({ inicioMs: inicio, adaptador: 'evolution' });
    assert.deepEqual(r.programar.map((x) => x.tipo), ['24h', '1h']);
    assert.equal(r.programar[0].cuandoMs, bog('2026-11-29T10:00:00'));
    assert.equal(r.sinVentana.length, 0);
  });

  it('con Meta, lo que saldría fuera de las 24 h del último mensaje queda pendiente de plantilla', () => {
    const r = plan({ inicioMs: inicio, adaptador: 'meta' });
    assert.deepEqual(r.programar, []);
    assert.deepEqual(r.sinVentana.map((x) => x.tipo), ['24h', '1h']);
  });

  it('con Meta, una cita para dentro de 20 h sí alcanza a mandar el recordatorio de 1 h', () => {
    // Cita en 20 h: el de 24 h ya pasó (se omite) y el de 1 h sale a las 19 h del último mensaje, dentro de la ventana.
    const r = plan({ inicioMs: reserva + 20 * 60 * MIN, adaptador: 'meta' });
    assert.deepEqual(r.programar.map((x) => x.tipo), ['1h']);
    assert.deepEqual(r.sinVentana, []);
  });

  it('con Meta, la referencia es el ÚLTIMO MENSAJE de la persona, no el momento de la reserva', () => {
    // El asesor agenda desde el panel a alguien que escribió hace 3 días: la ventana ya está cerrada.
    const hace3Dias = plan({ inicioMs: reserva + 6 * 60 * MIN, ultimoEntranteMs: reserva - 3 * 24 * 60 * MIN, adaptador: 'meta' });
    assert.deepEqual(hace3Dias.programar, []);
    assert.deepEqual(hace3Dias.sinVentana.map((x) => x.tipo), ['1h']);
    // Escribió hace 23 h: la ventana cierra en 1 h; el recordatorio de las 5 h ya no cabe.
    const hace23h = plan({ inicioMs: reserva + 6 * 60 * MIN, ultimoEntranteMs: reserva - 23 * 60 * MIN, adaptador: 'meta' });
    assert.deepEqual(hace23h.sinVentana.map((x) => x.tipo), ['1h']);
    // Nunca escribió por WhatsApp (agendó por llamada): con Meta no hay ventana.
    const nunca = plan({ inicioMs: reserva + 6 * 60 * MIN, ultimoEntranteMs: null, adaptador: 'meta' });
    assert.deepEqual(nunca, { programar: [], sinVentana: [{ tipo: '1h', cuandoMs: reserva + 5 * 60 * MIN }] });
    // Con Evolution no hay ventana: da igual cuándo escribió.
    assert.deepEqual(plan({ inicioMs: reserva + 6 * 60 * MIN, ultimoEntranteMs: null, adaptador: 'evolution' }).programar.map((x) => x.tipo), ['1h']);
  });

  it('una cita que empieza en menos de 1 h no programa nada', () => {
    const r = plan({ inicioMs: reserva + 30 * MIN, adaptador: 'evolution' });
    assert.deepEqual(r, { programar: [], sinVentana: [] });
  });
});

describe('festivos de Colombia', () => {
  // Calendario oficial (Ley 51 de 1983, «Ley Emiliani», y fechas de Pascua: 5 de abril de 2026, 28 de marzo de 2027).
  it('2026: los 18 festivos oficiales', () => {
    assert.deepEqual(festivosColombia(2026), [
      '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01', '2026-05-18', '2026-06-08',
      '2026-06-15', '2026-06-29', '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16',
      '2026-12-08', '2026-12-25',
    ]);
  });

  it('2027: los 18 festivos oficiales', () => {
    assert.deepEqual(festivosColombia(2027), [
      '2027-01-01', '2027-01-11', '2027-03-22', '2027-03-25', '2027-03-26', '2027-05-01', '2027-05-10', '2027-05-31',
      '2027-06-07', '2027-07-05', '2027-07-20', '2027-08-07', '2027-08-16', '2027-10-18', '2027-11-01', '2027-11-15',
      '2027-12-08', '2027-12-25',
    ]);
  });

  it('nadie recibe citas un festivo aunque la configuración no traiga ninguno, y la configuración agrega días', () => {
    const semana = disp({ semana: [1, 2, 3, 4, 5].map((dia) => ({ dia, desde: '09:00', hasta: '10:00' })) });
    const dias = (festivos: string[]) => [...new Set(calcularFranjasAsesor({
      disp: semana, ocupados: [], ahoraMs: AHORA, desdeMs: AHORA, hastaMs: bog('2026-12-12T00:00:00'),
      antelacionMin: 0, festivos,
    }).map((f) => isoBogota(f.inicioMs).slice(0, 10)))];
    const sinConfig = dias([]);
    assert.equal(sinConfig.includes('2026-12-08'), false, 'Inmaculada Concepción (martes)');
    assert.ok(sinConfig.includes('2026-12-07') && sinConfig.includes('2026-12-09'));
    assert.equal(dias(['2026-12-09']).includes('2026-12-09'), false, 'un día extra de la configuración');
  });
});

