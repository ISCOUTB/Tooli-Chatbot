import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  agruparPorDia, citasPorTramo, disponibilidadDesdeForm, errorDeForm, etiquetaDia, etiquetaDiaLarga, formDesdeDisponibilidad,
  horaCorta, hoyBogota, lineaDelDia, lunesDe, nombreDeCita, parseFestivos, porMarcar, sumarDias,
} from './agenda.js';

describe('fechas de Bogotá', () => {
  it('hoyBogota usa UTC-5 aunque el navegador esté en otra zona', () => {
    // 02:00 UTC del 24 = 21:00 del 23 en Bogotá.
    assert.equal(hoyBogota(Date.parse('2026-11-24T02:00:00Z')), '2026-11-23');
    assert.equal(hoyBogota(Date.parse('2026-11-24T05:00:00Z')), '2026-11-24');
  });

  it('sumarDias y lunesDe cruzan mes y año', () => {
    assert.equal(sumarDias('2026-12-31', 1), '2027-01-01');
    assert.equal(sumarDias('2026-03-01', -1), '2026-02-28');
    assert.equal(lunesDe('2026-11-23'), '2026-11-23');
    assert.equal(lunesDe('2026-11-29'), '2026-11-23', 'el domingo pertenece a la semana que termina');
    assert.equal(lunesDe('2026-12-02'), '2026-11-30');
  });

  it('etiquetas y hora en español', () => {
    assert.equal(etiquetaDia('2026-11-25'), 'mié 25 nov');
    assert.equal(etiquetaDiaLarga('2026-11-25'), 'miércoles 25 de noviembre');
    assert.equal(horaCorta('2026-11-24T09:00:00-05:00'), '9:00 a. m.');
    assert.equal(horaCorta('2026-11-24T13:30:00-05:00'), '1:30 p. m.');
    assert.equal(horaCorta('2026-11-24T00:05:00-05:00'), '12:05 a. m.');
    assert.equal(horaCorta('basura'), '');
  });
});

describe('citas por día', () => {
  const c = (inicio, id = inicio) => ({ id, inicio: `${inicio}-05:00`, fin: `${inicio}-05:00`, estado: 'confirmada' });
  it('agrupa por la fecha local y ordena por hora', () => {
    const g = agruparPorDia([c('2026-11-24T10:00:00', 'b'), c('2026-11-23T09:00:00', 'a'), c('2026-11-24T09:00:00', 'c')]);
    assert.deepEqual(Object.keys(g), ['2026-11-23', '2026-11-24']);
    assert.deepEqual(g['2026-11-24'].map(x => x.id), ['c', 'b']);
  });

  it('una cita de las 11 p. m. cuenta en su día de Bogotá, no en el de UTC', () => {
    const g = agruparPorDia([c('2026-11-23T23:00:00')]);
    assert.deepEqual(Object.keys(g), ['2026-11-23']);
  });

  it('mezcla citas y franjas libres en orden, la cita primero si coinciden', () => {
    const linea = lineaDelDia(
      [{ inicio: '2026-11-24T09:30:00-05:00', fin: '2026-11-24T10:00:00-05:00', id: 'x' }],
      [{ inicio: '2026-11-24T09:00:00-05:00', fin: '2026-11-24T09:30:00-05:00' }, { inicio: '2026-11-24T09:30:00-05:00', fin: '2026-11-24T10:00:00-05:00' }],
    );
    assert.deepEqual(linea.map(i => `${i.tipo}@${i.inicio.slice(11, 16)}`), ['libre@09:00', 'cita@09:30', 'libre@09:30']);
  });

  it('señala las citas que ya empezaron y siguen sin marcar', () => {
    const ahora = Date.parse('2026-11-24T10:00:00-05:00');
    const citas = [
      { id: 1, estado: 'confirmada', inicio: '2026-11-24T09:00:00-05:00' },
      { id: 2, estado: 'confirmada', inicio: '2026-11-24T11:00:00-05:00' },
      { id: 3, estado: 'atendida', inicio: '2026-11-24T08:00:00-05:00' },
    ];
    assert.deepEqual(porMarcar(citas, ahora).map(x => x.id), [1]);
  });
});

describe('formulario de disponibilidad', () => {
  const api = {
    activo: true, areas: ['posgrados'], duracionMin: 30, pausaMin: 5,
    semana: [{ dia: 1, desde: '09:00', hasta: '12:00' }, { dia: 1, desde: '14:00', hasta: '17:00' }, { dia: 0, desde: '10:00', hasta: '11:00' }],
    excepciones: [{ desde: '2026-12-24', hasta: '2026-12-26', motivo: 'Vacaciones' }],
  };

  it('ida y vuelta sin perder nada', () => {
    const form = formDesdeDisponibilidad(api);
    assert.equal(form.dias[1].length, 2);
    assert.equal(form.dias[2].length, 0);
    const cuerpo = disponibilidadDesdeForm(form);
    assert.deepEqual(cuerpo.semana, [
      { dia: 1, desde: '09:00', hasta: '12:00' }, { dia: 1, desde: '14:00', hasta: '17:00' }, { dia: 0, desde: '10:00', hasta: '11:00' },
    ]);
    assert.deepEqual(cuerpo.excepciones, api.excepciones);
    assert.equal(cuerpo.pausaMin, 5);
  });

  it('una excepción de un solo día repite la fecha y las horas solo van si están completas', () => {
    const form = formDesdeDisponibilidad(api);
    form.excepciones = [{ desde: '2026-12-08', hasta: '', horaDesde: '10:00', horaHasta: '' }];
    assert.deepEqual(disponibilidadDesdeForm(form).excepciones, [{ desde: '2026-12-08', hasta: '2026-12-08' }]);
  });

  it('detecta los mismos errores que el servidor', () => {
    const base = () => formDesdeDisponibilidad(api);
    assert.equal(errorDeForm(base()), null);
    let f = base(); f.areas = []; assert.match(errorDeForm(f), /al menos un área/);
    f = base(); f.duracionMin = 5; assert.match(errorDeForm(f), /entre 10 y 180/);
    f = base(); f.pausaMin = 90; assert.match(errorDeForm(f), /pausa/);
    f = base(); f.dias[2] = [{ desde: '10:00', hasta: '09:00' }]; assert.match(errorDeForm(f), /martes: la hora de inicio/);
    f = base(); f.dias[3] = [{ desde: '09:00', hasta: '11:00' }, { desde: '10:00', hasta: '12:00' }]; assert.match(errorDeForm(f), /miércoles: dos tramos se traslapan/);
    f = base(); f.excepciones = [{ desde: '2026-02-30', hasta: '' }]; assert.match(errorDeForm(f), /fecha inválida/);
    f = base(); f.excepciones = [{ desde: '2026-03-05', hasta: '2026-03-01' }]; assert.match(errorDeForm(f), /no puede ser posterior/);
    f = base(); f.activo = false; f.areas = []; assert.equal(errorDeForm(f), null, 'inactivo no exige áreas');
  });

  it('calcula cuántas citas caben en un tramo', () => {
    assert.equal(citasPorTramo({ desde: '09:00', hasta: '12:00' }, 30, 0), 6);
    assert.equal(citasPorTramo({ desde: '09:00', hasta: '11:00' }, 30, 15), 3);
    assert.equal(citasPorTramo({ desde: '09:00', hasta: '09:20' }, 30, 0), 0);
    assert.equal(citasPorTramo({ desde: '12:00', hasta: '09:00' }, 30, 0), 0);
  });

  it('lee festivos escritos a mano y separa los inválidos', () => {
    const r = parseFestivos('2026-12-08, 2026-12-25\n2026-12-08 25/12/2026\n2026-02-30');
    assert.deepEqual(r.validos, ['2026-12-08', '2026-12-25']);
    assert.deepEqual(r.invalidos, ['25/12/2026', '2026-02-30']);
    assert.deepEqual(parseFestivos('').validos, []);
  });
});

describe('nombreDeCita', () => {
  it('usa el nombre si lo hay y si no avisa que falta', () => {
    assert.equal(nombreDeCita({ nombre: 'Carlos Pérez', telefonoMasc: '****0101' }), 'Carlos Pérez');
    assert.equal(nombreDeCita({ telefonoMasc: '****0101' }), 'Sin nombre · ****0101');
    assert.equal(nombreDeCita({ nombre: '   ', telefonoMasc: '****0101' }), 'Sin nombre · ****0101', 'un nombre en blanco no cuenta');
    assert.equal(nombreDeCita({ nombre: null }), 'Sin nombre');
  });
});
