import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { claveDeRespuesta, normalizarPregunta, preguntaGuardable } from './respuestasFrecuentes';

const PROMPT = 'prompt de posgrados v1';
const NOV = new Date('2026-11-21T12:00:00Z');

describe('respuestas frecuentes', () => {
  it('la misma pregunta escrita distinto es la misma', () => {
    assert.equal(normalizarPregunta('Hola!! ¿Cuánto cuesta el MBA?'), 'cuanto cuesta el mba');
    assert.equal(normalizarPregunta('cuanto cuesta el mba por favor'), 'cuanto cuesta el mba');
    assert.equal(normalizarPregunta('Cuántooo cuesta el MBA???'), 'cuanto cuesta el mba');
    assert.equal(
      claveDeRespuesta('posgrados', '¿Cuánto cuesta el MBA?', PROMPT, NOV),
      claveDeRespuesta('posgrados', 'hola, cuanto cuesta el mba', PROMPT, NOV),
    );
  });

  it('cambia la clave si cambia el prompt, el contexto, el área o el mes', () => {
    const base = claveDeRespuesta('posgrados', '¿Hay becas?', PROMPT, NOV);
    assert.ok(base?.startsWith('ia:respuesta:'));
    assert.notEqual(claveDeRespuesta('posgrados', '¿Hay becas?', `${PROMPT}\ncontexto: ingeniería`, NOV), base);
    assert.notEqual(claveDeRespuesta('posgrados', '¿Hay becas?', 'prompt de posgrados v2', NOV), base);
    assert.notEqual(claveDeRespuesta('admisiones', '¿Hay becas?', PROMPT, NOV), base);
    assert.notEqual(claveDeRespuesta('posgrados', '¿Hay becas?', PROMPT, new Date('2026-12-02T12:00:00Z')), base);
    assert.notEqual(claveDeRespuesta('posgrados', '¿Hay becas para el MBA?', PROMPT, NOV), base);
  });

  it('nunca guarda preguntas con datos personales', () => {
    for (const t of [
      'Hola, soy Ana, ¿cuánto cuesta el MBA?', 'me llamo Pedro y quiero una maestría', 'mi correo es ana@gmail.com',
      'llámenme al 300 123 4567', 'mi cédula es 1047123456',
    ]) {
      assert.equal(preguntaGuardable(t), null, t);
      assert.equal(claveDeRespuesta('posgrados', t, PROMPT, NOV), null, t);
    }
  });

  it('un perfil sin nombre sí se guarda', () => {
    for (const t of ['soy egresado de la UTB, ¿hay descuento?', 'soy ingeniera industrial, ¿qué maestría me sirve?', 'soy de Cartagena, ¿hay clases virtuales?']) {
      assert.ok(preguntaGuardable(t), t);
    }
  });

  it('descarta lo muy corto, lo vacío y lo muy largo', () => {
    for (const t of ['', 'hola', '?', 'ok', 'x'.repeat(200)]) assert.equal(preguntaGuardable(t), null, t);
  });
});
