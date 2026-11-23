import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  esTextoVozLimpio, fechaConDiaEnPalabras, fechaEnPalabras, horaEnPalabras, leerFecha, limpiarParaVoz,
  montoEnPalabras, notaEnPalabras, numeroEnPalabras, unirConY,
} from './voz';

const AHORA = new Date('2026-11-22T15:00:00-05:00');

describe('números y montos dichos como se dicen en Colombia', () => {
  it('cuenta bien los casos que suelen fallar', () => {
    assert.equal(numeroEnPalabras(0), 'cero');
    assert.equal(numeroEnPalabras(16), 'dieciséis');
    assert.equal(numeroEnPalabras(21), 'veintiuno');
    assert.equal(numeroEnPalabras(100), 'cien');
    assert.equal(numeroEnPalabras(101), 'ciento uno');
    assert.equal(numeroEnPalabras(1000), 'mil');
    assert.equal(numeroEnPalabras(21_000), 'veintiún mil');
    assert.equal(numeroEnPalabras(31_000), 'treinta y un mil');
    assert.equal(numeroEnPalabras(1_000_000), 'un millón');
    assert.equal(numeroEnPalabras(2_500_000), 'dos millones quinientos mil');
    assert.equal(numeroEnPalabras(21_000_000), 'veintiún millones');
  });

  it('dice el valor del recibo en pesos', () => {
    assert.equal(montoEnPalabras(8_363_000), 'ocho millones trescientos sesenta y tres mil pesos');
    assert.equal(montoEnPalabras(7_000_000), 'siete millones de pesos');
    assert.equal(montoEnPalabras(1_021_000), 'un millón veintiún mil pesos');
    assert.equal(montoEnPalabras(1), 'un peso');
    assert.equal(montoEnPalabras(-5), 'un valor que no pude leer bien');
  });

  it('dice las notas con punto', () => {
    assert.equal(notaEnPalabras(4.5), 'cuatro punto cinco');
    assert.equal(notaEnPalabras('3,25'), 'tres punto dos cinco');
    assert.equal(notaEnPalabras(5), 'cinco');
    assert.equal(notaEnPalabras('abc'), 'sin nota');
  });
});

describe('fechas y horas', () => {
  it('lee los formatos del portal y de la hoja', () => {
    assert.deepEqual(leerFecha('15/12/2026'), { dia: 15, mes: 12, anio: 2026 });
    assert.deepEqual(leerFecha('5/1/27'), { dia: 5, mes: 1, anio: 2027 });
    assert.deepEqual(leerFecha('2026-12-15T10:00:00Z'), { dia: 15, mes: 12, anio: 2026 });
    assert.equal(leerFecha('32/13/2026'), null);
    assert.equal(leerFecha('pronto'), null);
  });

  it('dice la fecha sin el año cuando es el actual', () => {
    assert.equal(fechaEnPalabras('15/12/2026', AHORA), 'el quince de diciembre');
    assert.equal(fechaEnPalabras('01/02/2026', AHORA), 'el primero de febrero');
    assert.equal(fechaEnPalabras('15/01/2027', AHORA), 'el quince de enero de dos mil veintisiete');
    assert.equal(fechaEnPalabras('sin fecha', AHORA), 'sin fecha');
  });

  it('usa la hora de Colombia para el día de la semana', () => {
    // 2026-12-15 02:00 UTC = 14 de diciembre 21:00 en Colombia (lunes).
    assert.equal(fechaConDiaEnPalabras('2026-12-15T02:00:00Z', AHORA), 'el lunes catorce de diciembre');
  });

  it('dice la hora como se dice', () => {
    assert.equal(horaEnPalabras('08:00'), 'las ocho de la mañana');
    assert.equal(horaEnPalabras('14:30'), 'las dos y media de la tarde');
    assert.equal(horaEnPalabras('13:00'), 'la una de la tarde');
    assert.equal(horaEnPalabras('12:00'), 'las doce del día');
    assert.equal(horaEnPalabras('19:15'), 'las siete y cuarto de la noche');
    assert.equal(horaEnPalabras('00:00'), 'las doce de la noche');
    assert.equal(horaEnPalabras('17:45'), 'las cinco y cuarenta y cinco de la tarde');
  });
});

describe('texto para la llamada', () => {
  it('quita emojis, markdown, enlaces y saltos', () => {
    const sucio = '📊 *Tus notas*\n\n• Cálculo: _4.5_ https://savio.utb.edu.co/my/ `ok` #1 > [x]';
    const limpio = limpiarParaVoz(sucio);
    assert.equal(esTextoVozLimpio(limpio), true, limpio);
    assert.ok(limpio.includes('Cálculo'));
  });

  it('el detector rechaza lo que no se puede leer en voz alta', () => {
    assert.equal(esTextoVozLimpio('Hola 😀'), false);
    assert.equal(esTextoVozLimpio('*negrita*'), false);
    assert.equal(esTextoVozLimpio('mira https://x.co'), false);
    assert.equal(esTextoVozLimpio('uno\ndos'), false);
    assert.equal(esTextoVozLimpio('pagas $8.000'), false);
    assert.equal(esTextoVozLimpio('Frase normal, con coma.'), true);
  });

  it('une con y', () => {
    assert.equal(unirConY(['a']), 'a');
    assert.equal(unirConY(['a', 'b']), 'a y b');
    assert.equal(unirConY(['a', 'b', 'c']), 'a, b y c');
  });
});
