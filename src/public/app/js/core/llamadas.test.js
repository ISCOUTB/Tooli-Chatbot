import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { duracionCorta, horarioATexto, porcentajeUso, resultadoLlamada, rolLinea, textoAHorario } from './llamadas.js';

describe('pantalla Llamadas: utilidades', () => {
  it('duración corta y porcentaje de uso', () => {
    assert.equal(duracionCorta(65), '1:05');
    assert.equal(duracionCorta(-3), '0:00');
    assert.equal(porcentajeUso(30, 120), 25);
    assert.equal(porcentajeUso(500, 120), 100);
    assert.equal(porcentajeUso(0, 0), 100);
  });
  it('horario de asesores ida y vuelta', () => {
    const franjas = [{ dias: [1, 2, 3, 4, 5], desde: '08:00', hasta: '18:00' }, { dias: [6], desde: '08:00', hasta: '12:00' }];
    const texto = horarioATexto(franjas);
    assert.equal(texto, 'L M X J V 08:00-18:00\nS 08:00-12:00');
    assert.deepEqual(textoAHorario(texto), { franjas, errores: [] });
    assert.deepEqual(textoAHorario('l,m 9:00-10').errores, ['l,m 9:00-10']);
  });
  it('etiquetas', () => {
    assert.equal(resultadoLlamada('cita').label, 'Cita agendada');
    assert.equal(resultadoLlamada('raro').label, 'raro');
    assert.equal(rolLinea('c'), 'Persona');
  });
});
