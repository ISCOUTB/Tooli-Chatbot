import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HitosAtencion,
  armarInformeAtencion,
  encuestaVencida,
  mediana,
  parsearCalificacion,
} from './atencionInformesService';

const base = (cambios: Partial<HitosAtencion> = {}): HitosAtencion => ({
  conversacionId: 1,
  creadaEn: Date.parse('2026-10-28T14:00:00Z'),
  equipo: 'admisiones',
  primeraRespuestaEn: null,
  primeraRespuestaPor: null,
  resueltaEn: null,
  resueltaPor: null,
  csat: null,
  csatEn: null,
  parcial: false,
  ...cambios,
});

describe('reglas puras de informes de atención', () => {
  it('calcula medianas pares, impares y vacías sin mutar la entrada', () => {
    const valores = [9, 1, 5, 3];
    assert.equal(mediana(valores), 4);
    assert.deepEqual(valores, [9, 1, 5, 3]);
    assert.equal(mediana([7, 2, 4]), 4);
    assert.equal(mediana([]), null);
  });

  it('acepta solo calificaciones completas del 1 al 5', () => {
    assert.equal(parsearCalificacion(' 4 '), 4);
    assert.equal(parsearCalificacion('5 estrellas'), 5);
    assert.equal(parsearCalificacion('1 estrella'), 1);
    for (const texto of ['0', '6', '4.5', 'califico 5', '5 estrellas gracias']) {
      assert.equal(parsearCalificacion(texto), null);
    }
  });

  it('vence solo después de dos horas', () => {
    const inicio = 1_000_000;
    assert.equal(encuestaVencida(inicio, inicio + 2 * 60 * 60 * 1000), false);
    assert.equal(encuestaVencida(inicio, inicio + 2 * 60 * 60 * 1000 + 1), true);
    assert.equal(encuestaVencida(Number.NaN, inicio), true);
  });

  it('arma totales, asesores, días y excluye parciales de los tiempos', () => {
    const ahora = Date.parse('2026-10-30T15:00:00Z');
    const hitos = [
      base({
        conversacionId: 1,
        primeraRespuestaEn: Date.parse('2026-10-28T14:10:00Z'),
        primeraRespuestaPor: 'ana',
        resueltaEn: Date.parse('2026-10-28T15:00:00Z'),
        resueltaPor: 'ana', csat: 5, csatEn: Date.parse('2026-10-28T15:01:00Z'),
      }),
      base({
        conversacionId: 2, creadaEn: Date.parse('2026-10-29T14:00:00Z'),
        primeraRespuestaEn: Date.parse('2026-10-29T14:30:00Z'),
        primeraRespuestaPor: null,
        resueltaEn: Date.parse('2026-10-29T16:00:00Z'),
        resueltaPor: null, csat: 3, csatEn: Date.parse('2026-10-29T16:01:00Z'),
      }),
      base({ conversacionId: 3, creadaEn: Date.parse('2026-10-30T14:00:00Z') }),
      base({
        conversacionId: 4, creadaEn: Date.parse('2026-10-30T13:00:00Z'), parcial: true,
        primeraRespuestaEn: Date.parse('2026-10-30T14:40:00Z'), primeraRespuestaPor: 'ana',
      }),
    ];
    const informe = armarInformeAtencion(hitos, [{ username: 'ana', fullName: 'Ana Pérez' }], 7, ahora);
    assert.deepEqual(informe.totales, {
      recibidas: 4, respondidas: 3, resueltas: 2, sinResponder: 1,
      primeraRespuestaMedianaMin: 20, resolucionMedianaMin: 90,
      csatPromedio: 4, csatRespuestas: 2,
      csatDistribucion: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 1 },
    });
    assert.deepEqual(informe.porDia.map((dia) => [dia.fecha, dia.recibidas, dia.resueltas]), [
      ['2026-10-24', 0, 0], ['2026-10-25', 0, 0], ['2026-10-26', 0, 0], ['2026-10-27', 0, 0],
      ['2026-10-28', 1, 1], ['2026-10-29', 1, 1], ['2026-10-30', 2, 0],
    ]);
    assert.deepEqual(informe.porAsesor.map((asesor) => [asesor.username, asesor.nombre, asesor.respondidas, asesor.resueltas]), [
      ['ana', 'Ana Pérez', 2, 1], [null, null, 1, 1],
    ]);
    assert.match(informe.notas[1], /^1 conversaciones/);
  });
});
