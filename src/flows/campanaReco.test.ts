import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CampanaInvalidaError,
  formatearNombre,
  parseRespuestaCampana,
  perfilDeContexto,
  prepararDestinatariosCampana,
  saludoCampana,
} from './campanaReco';

/**
 * Campañas que inicia el bot: la lista de la UTB se convierte en
 * destinatarios con sus variables y su contexto, y la respuesta de la
 * persona se lee sin confundir un "no" de otro paso con una baja.
 */
describe('prepararDestinatariosCampana', () => {
  it('egresado UTB: la plantilla lleva el nombre oficial del pregrado y el contexto su id', () => {
    const [d] = prepararDestinatariosCampana(
      [{ telefono: '+57 300 111 2233', nombre: 'LAURA GÓMEZ', pregrado: 'INGENIERIA INDUSTRIAL' }],
      'egresado_utb',
    );
    assert.equal(d.telefono, '+57 300 111 2233', 'el teléfono lo valida y normaliza la cola');
    assert.deepEqual(d.parametros, ['Laura Gómez', 'Ingeniería Industrial']);
    assert.deepEqual(d.contexto, { relacion: 'egresado_utb', nombre: 'Laura Gómez', pregradoId: 'ingenieria-industrial' });
  });

  it('otra universidad: la plantilla nombra lo que estudió, aunque se asocie a un pregrado UTB', () => {
    const [prod, medicina, raro] = prepararDestinatariosCampana([
      { telefono: '573004445566', nombre: 'Pedro', pregrado: 'Ingeniería de Producción' },
      { telefono: '573007778899', nombre: 'Ana', pregrado: 'Medicina' },
      { telefono: '573001010101', nombre: 'Luis', pregrado: 'Agronomía' },
    ], 'externo');
    assert.deepEqual(prod.parametros, ['Pedro', 'Ingeniería de Producción']);
    assert.equal(prod.contexto.pregradoId, 'ingenieria-industrial');
    assert.equal(medicina.contexto.familiaId, 'salud');
    assert.deepEqual(raro.contexto, { relacion: 'externo', nombre: 'Luis' }, 'sin asociación no se inventa un perfil');
    assert.equal(raro.parametros[1], 'Agronomía');
  });

  it('rechaza una relación o una lista inválidas', () => {
    assert.throws(() => prepararDestinatariosCampana([], 'amigo'), CampanaInvalidaError);
    assert.throws(() => prepararDestinatariosCampana('573001112233', 'externo'), CampanaInvalidaError);
  });
});

describe('formatearNombre', () => {
  it('solo cambia los nombres escritos en mayúsculas', () => {
    assert.equal(formatearNombre('LAURA GÓMEZ'), 'Laura Gómez');
    assert.equal(formatearNombre("MARÍA JOSÉ O'NEIL"), "María José O'Neil");
    assert.equal(formatearNombre('Laura de la Hoz'), 'Laura de la Hoz');
    assert.equal(formatearNombre(undefined), '');
  });
});

describe('parseRespuestaCampana', () => {
  it('los textos de los botones valen en cualquier paso', () => {
    assert.deepEqual(parseRespuestaCampana('Ver mis opciones'), { tipo: 'ver', fuerte: true });
    assert.deepEqual(parseRespuestaCampana('No me interesa'), { tipo: 'baja', fuerte: true });
    assert.deepEqual(parseRespuestaCampana('No me interesa, gracias'), { tipo: 'baja', fuerte: true });
    assert.deepEqual(parseRespuestaCampana('Darme de baja'), { tipo: 'baja', fuerte: true });
  });

  it('un sí o un no sueltos son débiles: solo cuentan al inicio', () => {
    assert.deepEqual(parseRespuestaCampana('Sí'), { tipo: 'ver', fuerte: false });
    assert.deepEqual(parseRespuestaCampana('hola'), { tipo: 'ver', fuerte: false });
    assert.deepEqual(parseRespuestaCampana('no'), { tipo: 'baja', fuerte: false });
  });

  it('lo demás no es una respuesta a la campaña', () => {
    for (const t of ['', 'necesito mi recibo', '¿Cuánto cuesta el MBA?', '2']) assert.equal(parseRespuestaCampana(t), null, t);
  });
});

describe('perfil y saludo desde el contexto', () => {
  it('usa el pregrado o la familia guardados, solo si siguen existiendo', () => {
    assert.deepEqual(perfilDeContexto({ pregradoId: 'derecho' }), { pregradoId: 'derecho', familiaId: '' });
    assert.deepEqual(perfilDeContexto({ familiaId: 'salud' }), { pregradoId: '', familiaId: 'salud' });
    assert.equal(perfilDeContexto({ pregradoId: 'no-existe' }), null);
    assert.equal(perfilDeContexto({}), null);
  });

  it('saluda con el nombre de la lista y nombra el pregrado', () => {
    const s = saludoCampana({ nombre: 'Laura Gómez', pregradoId: 'ingenieria-industrial' });
    assert.match(s, /¡Hola, Laura Gómez!/);
    assert.match(s, /Ingeniería Industrial/);
    assert.equal(saludoCampana({}), '¡Hola! 👋 Qué bueno que te interese.');
  });
});
