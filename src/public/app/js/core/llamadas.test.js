import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dolares, duracionCorta, etiquetaVerificacionNegada, faseLegible, horarioATexto, porcentajeUso, resultadoLlamada, rolLinea,
  telefonosLegibles, textoAHorario,
} from './llamadas.js';

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
    assert.equal(etiquetaVerificacionNegada('espera'), 'Verificación en pausa');
    assert.equal(etiquetaVerificacionNegada('bloqueado'), 'Verificación bloqueada');
    assert.equal(etiquetaVerificacionNegada(null), '');
  });
  it('fase del simulador en palabras, sin claves internas', () => {
    assert.equal(faseLegible('pide_codigo_estudiantil'), 'pide el código estudiantil');
    assert.equal(faseLegible('libre'), 'conversación libre');
    // Una fase que el panel todavía no conoce no muestra guiones bajos.
    assert.equal(faseLegible('fase_nueva_rara'), 'fase nueva rara');
    assert.equal(faseLegible(undefined), '—');
  });
  it('teléfonos de los avisos y dólares como en el resto del panel', () => {
    assert.equal(telefonosLegibles('Llamada 573005550141: pidió que le devuelvan la llamada.'), 'Llamada +57 300 555 0141: pidió que le devuelvan la llamada.');
    assert.equal(telefonosLegibles('la llamada 573005550145 quedó'), 'la llamada +57 300 555 0145 quedó');
    // Ni enmascarados, ni ya escritos, ni números más largos.
    assert.equal(telefonosLegibles('****0101 y +573005550141'), '****0101 y +573005550141');
    assert.equal(telefonosLegibles('id 15730055501419'), 'id 15730055501419');
    assert.equal(dolares(1.68), '1,68');
    assert.equal(dolares('x'), '0,00');
  });
});
