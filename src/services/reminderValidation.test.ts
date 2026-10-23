import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ReminderValidationError, MARGEN_MINIMO_MS,
  normalizarTelefono, validarTelefono, validarMensaje, parseFecha, validarFecha,
} from './reminderValidation';

/**
 * Un recordatorio mal validado no falla en el panel: falla horas después, solo,
 * dentro del worker y contra la API de Meta, donde nadie lo está mirando.
 */
describe('normalizarTelefono', () => {
  it('se queda solo con los dígitos', () => {
    assert.equal(normalizarTelefono('+57 (300) 123-4567'), '573001234567');
  });

  it('no se cae con entradas vacías', () => {
    assert.equal(normalizarTelefono(''), '');
    assert.equal(normalizarTelefono(undefined as unknown as string), '');
  });
});

describe('validarTelefono', () => {
  it('acepta un móvil colombiano con indicativo', () => {
    assert.equal(validarTelefono('573001234567'), '573001234567');
  });

  it('acepta el mismo número escrito con separadores', () => {
    assert.equal(validarTelefono('+57 300 123 4567'), '573001234567');
  });

  it('rechaza números demasiado cortos', () => {
    assert.throws(() => validarTelefono('300123'), ReminderValidationError);
  });

  it('rechaza números por encima del máximo de E.164', () => {
    assert.throws(() => validarTelefono('1'.repeat(16)), ReminderValidationError);
  });

  it('rechaza ceros iniciales y texto incrustado para evitar otro destinatario', () => {
    assert.throws(() => validarTelefono('0000000000'), ReminderValidationError);
    assert.throws(() => validarTelefono('llamar-573001234567-ahora'), ReminderValidationError);
  });

  it('acepta exactamente los límites, 10 y 15 dígitos', () => {
    assert.equal(validarTelefono('1'.repeat(10)).length, 10);
    assert.equal(validarTelefono('1'.repeat(15)).length, 15);
  });
});

describe('validarMensaje', () => {
  it('recorta los espacios de los extremos', () => {
    assert.equal(validarMensaje('  hola  '), 'hola');
  });

  it('rechaza un mensaje vacío o de solo espacios', () => {
    assert.throws(() => validarMensaje(''), ReminderValidationError);
    assert.throws(() => validarMensaje('    '), ReminderValidationError);
  });

  it('acepta el máximo de WhatsApp y rechaza un carácter más', () => {
    assert.equal(validarMensaje('a'.repeat(4096)).length, 4096);
    assert.throws(() => validarMensaje('a'.repeat(4097)), ReminderValidationError);
  });
});

describe('parseFecha', () => {
  it('acepta epoch en milisegundos', () => {
    assert.equal(parseFecha(1789435482440), 1789435482440);
  });

  it('acepta ISO 8601 con zona horaria', () => {
    assert.equal(parseFecha('2026-09-20T08:00:00-05:00'), Date.parse('2026-09-20T13:00:00Z'));
  });

  it('acepta lo que manda el formulario del panel', () => {
    // <input type="datetime-local"> convertido con toISOString()
    assert.equal(parseFecha('2026-09-20T13:00:00.000Z'), Date.parse('2026-09-20T13:00:00.000Z'));
  });

  it('rechaza texto que no es una fecha', () => {
    assert.throws(() => parseFecha('mañana a las 8'), ReminderValidationError);
    assert.throws(() => parseFecha('hola mundo'), ReminderValidationError);
  });

  it('rechaza lo que Date.parse aceptaría por permisivo', () => {
    // Date.parse('2027') devuelve el 1 de enero de 2027 y Date.parse('8')
    // devuelve agosto de 2001: entradas sin sentido que antes pasaban como
    // fecha válida y programaban el recordatorio en un momento arbitrario.
    assert.throws(() => parseFecha('2027'), ReminderValidationError);
    assert.throws(() => parseFecha('8'), ReminderValidationError);
    assert.throws(() => parseFecha('2026-09-20'), ReminderValidationError);   // sin hora
  });

  it('rechaza una fecha con formato correcto pero inexistente', () => {
    assert.throws(() => parseFecha('2026-02-31T10:00:00Z'), ReminderValidationError);
  });

  it('rechaza segundos fuera de rango sin normalizar en silencio', () => {
    assert.throws(() => parseFecha('2026-09-20T10:00:99Z'), ReminderValidationError);
    assert.equal(parseFecha('2026-09-20T10:00:45Z'), Date.parse('2026-09-20T10:00:45Z'));
  });

  it('rechaza offsets de zona imposibles (±14:00 es el máximo real)', () => {
    assert.throws(() => parseFecha('2026-09-20T10:00:00+15:00'), ReminderValidationError);
    assert.throws(() => parseFecha('2026-09-20T10:00:00-23:00'), ReminderValidationError);
    assert.equal(parseFecha('2026-09-20T10:00:00+14:00'), Date.parse('2026-09-20T10:00:00+14:00'));
  });

  it('rechaza epoch fraccionario o negativo', () => {
    assert.throws(() => parseFecha(1789435482440.5), ReminderValidationError);
    assert.throws(() => parseFecha(-1), ReminderValidationError);
    assert.throws(() => parseFecha(NaN), ReminderValidationError);
    assert.throws(() => parseFecha(1e20), ReminderValidationError);
    assert.throws(() => parseFecha(Number.MAX_SAFE_INTEGER), ReminderValidationError);
    assert.equal(parseFecha(8.64e15), 8.64e15);
  });
});

describe('validarFecha', () => {
  const ahora = Date.parse('2026-09-14T12:00:00Z');

  it('acepta una fecha con margen suficiente', () => {
    const cuando = ahora + 60_000;
    assert.equal(validarFecha(cuando, ahora), cuando);
  });

  it('rechaza una fecha ya pasada', () => {
    assert.throws(() => validarFecha(ahora - 1000, ahora), ReminderValidationError);
  });

  it('rechaza una fecha demasiado pegada al presente', () => {
    // El worker revisa la cola por intervalos: sin margen, el recordatorio se
    // programa para un instante que ya pasó cuando le toca el turno.
    assert.throws(() => validarFecha(ahora + MARGEN_MINIMO_MS - 1, ahora), ReminderValidationError);
  });

  it('acepta justo el margen mínimo', () => {
    const limite = ahora + MARGEN_MINIMO_MS;
    assert.equal(validarFecha(limite, ahora), limite);
  });
});
