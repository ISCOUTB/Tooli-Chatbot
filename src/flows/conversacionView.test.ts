import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOTONES_SIN_PREGRADO, BOTONES_TECNICO, PREGUNTAS, detectarPerfil, esPedidoAsesor, esSaludo, interpretarRespuestaEscrita,
  nivelDeBoton, pareceUnaPregunta, parseBoton, sinPregrado, siguientePregunta, textoPregrado,
} from './conversacionView';

describe('conversación: botones', () => {
  it('cada pregunta trae a lo sumo 3 botones de 20 caracteres, como exige WhatsApp', () => {
    for (const pregunta of Object.values(PREGUNTAS)) {
      const botones = pregunta.botones ?? [];
      assert.ok(botones.length <= 3, pregunta.pendiente);
      for (const b of botones) assert.ok([...b.displayText].length <= 20, b.displayText);
    }
  });

  it('reconoce solo los ids de sus propios botones', () => {
    assert.equal(parseBoton('conv_elegir'), 'conv_elegir');
    assert.equal(parseBoton(' conv_mae '), 'conv_mae');
    assert.equal(parseBoton('1'), null);
    assert.equal(parseBoton('conv_otro'), null);
  });

  it('traduce los botones de nivel', () => {
    assert.equal(nivelDeBoton('conv_esp'), 'especializacion');
    assert.equal(nivelDeBoton('conv_mae'), 'maestria');
    assert.equal(nivelDeBoton('conv_doc'), 'doctorado');
    assert.equal(nivelDeBoton('conv_reco'), null);
  });
});

describe('conversación: lo que escribe la persona', () => {
  it('distingue un saludo suelto de una pregunta', () => {
    for (const t of ['Hola', 'Buenas tardes!', 'hola, buenos días', 'info', '']) assert.equal(esSaludo(t), true, t);
    for (const t of ['¿Cuánto cuesta el MBA?', 'Hola, quiero una maestría']) assert.equal(esSaludo(t), false, t);
  });

  it('entiende cuando pide un asesor', () => {
    assert.equal(esPedidoAsesor('Asesor'), true);
    assert.equal(esPedidoAsesor('Quiero hablar con un asesor'), true);
    assert.equal(esPedidoAsesor('asesoría de tesis'), false);
  });

  it('detecta preguntas aunque el bot espere la carrera', () => {
    assert.equal(pareceUnaPregunta('¿Cuánto cuesta?'), true);
    assert.equal(pareceUnaPregunta('qué maestrías hay'), true);
    assert.equal(pareceUnaPregunta('Ingeniería Industrial'), false);
  });

  it('acepta respuestas escritas en vez de tocar el botón', () => {
    assert.deepEqual(interpretarRespuestaEscrita('tiene_programa', 'no sé, ayúdame'), { boton: 'conv_elegir' });
    assert.deepEqual(interpretarRespuestaEscrita('tiene_programa', 'Sí'), { boton: 'conv_tengo' });
    assert.deepEqual(interpretarRespuestaEscrita('estudia_utb', 'sí'), { boton: 'conv_utb_si' });
    assert.deepEqual(interpretarRespuestaEscrita('estudia_utb', 'No, en otra universidad'), { boton: 'conv_utb_no' });
    assert.deepEqual(interpretarRespuestaEscrita('estudia_utb', 'soy egresado'), { boton: 'conv_egresado' });
    assert.deepEqual(interpretarRespuestaEscrita('egresado', 'ya me gradué'), { boton: 'conv_egresado' });
    assert.deepEqual(interpretarRespuestaEscrita('egresado', 'aún estoy estudiando'), { boton: 'conv_estudiante' });
    assert.deepEqual(interpretarRespuestaEscrita('nivel', 'no sé'), { nivel: '' });
    assert.deepEqual(interpretarRespuestaEscrita('ofrecer', 'sí, por favor'), { boton: 'conv_reco' });
  });

  it('no confunde una pregunta con la respuesta a un botón', () => {
    assert.equal(interpretarRespuestaEscrita('estudia_utb', '¿la maestría es virtual?'), null);
    assert.equal(interpretarRespuestaEscrita('nivel', '¿cuánto dura?'), null);
    assert.equal(interpretarRespuestaEscrita('', 'sí'), null);
    assert.equal(interpretarRespuestaEscrita('tiene_programa', 'sí, quiero saber cuánto cuesta la maestría en ciberseguridad'), null);
  });

  it('saca de una frase libre la relación y el nivel, nunca el texto', () => {
    assert.deepEqual(detectarPerfil('Soy egresado de la UTB y quiero una maestría'), { relacion: 'egresado_utb', nivel: 'maestria' });
    assert.deepEqual(detectarPerfil('estudio en otra universidad'), { relacion: 'externo' });
    assert.deepEqual(detectarPerfil('¿La especialización en gerencia es virtual?'), { nivel: 'especializacion' });
    assert.deepEqual(detectarPerfil('Soy egresado'), {}, 'sin decir de dónde no se asume la UTB');
  });
});

describe('conversación: quien todavía no tiene pregrado', () => {
  it('reconoce que no ha estudiado una carrera o que es técnico', () => {
    for (const t of ['Ninguna no he estudiado', 'ninguna', 'No tengo carrera', 'soy bachiller', 'aún no he estudiado', 'apenas salí del colegio']) {
      assert.equal(sinPregrado(t), 'ninguno', t);
    }
    for (const t of ['Soy tecnólogo', 'técnico en sistemas']) assert.equal(sinPregrado(t), 'tecnico', t);
    for (const t of ['Ingeniería Industrial', 'Contaduría Pública', 'Administración de empresas']) assert.equal(sinPregrado(t), null, t);
  });

  it('no le sigue preguntando ni le ofrece recomendaciones', () => {
    assert.equal(siguientePregunta({ sinPregrado: '1' }), null);
  });

  it('sus botones también caben en WhatsApp y se reconocen', () => {
    for (const b of [...BOTONES_SIN_PREGRADO, ...BOTONES_TECNICO]) {
      assert.ok([...b.displayText].length <= 20, b.displayText);
      assert.equal(parseBoton(b.id), b.id);
    }
  });
});

describe('conversación: qué preguntar', () => {
  it('pregunta relación, carrera y nivel, en ese orden', () => {
    assert.equal(siguientePregunta({}), 'estudia_utb');
    assert.equal(siguientePregunta({ relacion: 'externo' }), 'pregrado');
    assert.equal(siguientePregunta({ relacion: 'externo', familiaId: 'salud' }), 'nivel');
    assert.equal(siguientePregunta({ relacion: 'egresado_utb', pregradoId: 'x', nivelListo: '1', nivel: '' }), null);
  });

  it('la pregunta de la carrera depende de la relación con la UTB', () => {
    assert.match(textoPregrado('egresado_utb'), /estudiaste en la UTB/);
    assert.match(textoPregrado('estudiante_utb'), /estudias en la UTB/);
    assert.doesNotMatch(textoPregrado('externo'), /UTB/);
  });
});
