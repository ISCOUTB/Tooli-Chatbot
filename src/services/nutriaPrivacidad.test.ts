/**
 * Fija que por la puerta pública de NutriA no sale un teléfono completo.
 *
 * El endpoint `GET /nutria/encuestas` devolvía las filas crudas del Sheet
 * —columna B: el WhatsApp real del participante— sin ninguna autenticación,
 * junto con su edad, su género y sus hábitos. Esta prueba es lo que impide
 * que vuelva.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { COLUMNA_WHATSAPP, filaSinTelefono } from './nutriaPrivacidad';

/** Una fila como la escribe `guardarEncuestaNutria`: `[fecha, whatsapp, ...]`. */
const fila = [
  '19/09/26, 14:03',
  '573001234567',
  '20 años',
  'Femenino',
  'Entre 4 y 6 horas',
];

describe('filaSinTelefono', () => {
  it('enmascara el WhatsApp de la columna B', () => {
    assert.equal(filaSinTelefono(fila)[COLUMNA_WHATSAPP], '****4567');
  });

  it('no deja el número completo en ninguna columna', () => {
    const salida = filaSinTelefono(fila).join('|');
    assert.ok(
      !salida.includes('573001234567'),
      'el número completo sigue saliendo por la respuesta pública',
    );
  });

  it('conserva el número de columnas: la landing las indexa por posición', () => {
    assert.equal(filaSinTelefono(fila).length, fila.length);
  });

  it('no toca las demás columnas', () => {
    const salida = filaSinTelefono(fila);
    assert.equal(salida[0], fila[0]);
    assert.deepEqual(salida.slice(2), fila.slice(2));
  });

  it('no muta la fila original', () => {
    const copia = [...fila];
    filaSinTelefono(fila);
    assert.deepEqual(fila, copia);
  });

  it('aguanta una fila corta sin teléfono', () => {
    assert.deepEqual(filaSinTelefono(['19/09/26, 14:03']), ['19/09/26, 14:03']);
    assert.deepEqual(filaSinTelefono([]), []);
  });

  it('una celda vacía no se convierte en un número inventado', () => {
    assert.equal(filaSinTelefono(['fecha', ''])[COLUMNA_WHATSAPP], '****');
  });
});
