import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOTONES_OFRECER_ASESOR, BOTONES_SIN_PREGRADO, BOTONES_TECNICO, DATOS_RECHAZADOS, PREFIJO_SUGERENCIA, PREGUNTAS, SUGERENCIAS_RESPALDO, botonesSugeridos,
  cabeConBotones, datosAceptados, detectarPerfil, esAgradecimiento, esBaja, esPedidoAsesor, esSaludo, infoAceptada, interpretarRespuestaEscrita,
  limpiarNombre, nivelDeBoton, pareceUnaPregunta, parseBoton, parseSugerencia, saludoCortoRegreso, saludoRegreso,
  separarSugerencias, sinPregrado, siguientePregunta, textoPregrado,
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
    assert.equal(siguientePregunta({ datos: 'si', sinPregrado: '1' }), null);
  });

  it('sus botones también caben en WhatsApp y se reconocen', () => {
    for (const b of [...BOTONES_SIN_PREGRADO, ...BOTONES_TECNICO]) {
      assert.ok([...b.displayText].length <= 20, b.displayText);
      assert.equal(parseBoton(b.id), b.id);
    }
  });
});

describe('conversación: qué preguntar', () => {
  it('primero la autorización de datos, aunque no tenga pregrado', () => {
    assert.equal(siguientePregunta({}), 'datos');
    assert.equal(siguientePregunta({ sinPregrado: '1' }), 'datos');
    // Quien ya respondió lo de recibir información (antes de existir esta pregunta) no la repite.
    assert.equal(siguientePregunta({ info: 'si' }), 'estudia_utb');
  });

  it('pregunta relación, carrera y nivel, en ese orden', () => {
    assert.equal(siguientePregunta({ datos: 'si' }), 'estudia_utb');
    assert.equal(siguientePregunta({ datos: 'si', relacion: 'externo' }), 'pregrado');
    assert.equal(siguientePregunta({ datos: 'si', relacion: 'externo', familiaId: 'salud' }), 'nivel');
    const perfil = { datos: 'si', relacion: 'egresado_utb', pregradoId: 'x', nivelListo: '1', nivel: '' };
    assert.equal(siguientePregunta(perfil), 'info', 'con el perfil completo pregunta si quiere recibir información');
    assert.equal(siguientePregunta({ ...perfil, info: 'si' }), 'nombre_info');
    assert.equal(siguientePregunta({ ...perfil, info: 'si', nombre: 'Ana' }), null);
    assert.equal(siguientePregunta({ ...perfil, info: 'no' }), null);
    // Sin autorización de datos no se le ofrece recibir información.
    assert.equal(siguientePregunta({ ...perfil, datos: 'no' }), null);
  });

  it('la pregunta de la carrera depende de la relación con la UTB', () => {
    assert.match(textoPregrado('egresado_utb'), /estudiaste en la UTB/);
    assert.match(textoPregrado('estudiante_utb'), /estudias en la UTB/);
    assert.doesNotMatch(textoPregrado('externo'), /UTB/);
  });
});

describe('conversación: autorización para recibir información', () => {
  it('la pregunta explica la finalidad, la ley y cómo darse de baja', () => {
    assert.match(PREGUNTAS.info.texto, /Ley 1581 de 2012/);
    assert.match(PREGUNTAS.info.texto, /BAJA/);
    assert.deepEqual(PREGUNTAS.info.botones?.map((b) => b.id), ['conv_info_si', 'conv_info_no']);
  });

  it('acepta el sí o el no escritos', () => {
    assert.deepEqual(interpretarRespuestaEscrita('info', 'sí'), { boton: 'conv_info_si' });
    assert.deepEqual(interpretarRespuestaEscrita('info', 'no gracias'), { boton: 'conv_info_no' });
  });

  it('reconoce la baja escrita en cualquier momento', () => {
    for (const t of ['BAJA', 'darme de baja', 'No quiero recibir más mensajes', 'no me envíen más']) assert.equal(esBaja(t), true, t);
    for (const t of ['¿hay becas?', 'bajar el precio']) assert.equal(esBaja(t), false, t);
  });

  it('limpia el nombre y rechaza lo que no es un nombre', () => {
    assert.equal(limpiarNombre('  ana   maría 😊 '), 'ana maría');
    assert.equal(limpiarNombre('Sí'), null);
    assert.equal(limpiarNombre('12345'), null);
    assert.match(infoAceptada('Ana María Pérez'), /^¡Listo, Ana!/);
  });
});

describe('conversación: preguntas sugeridas', () => {
  it('separa la línea de sugerencias de la respuesta', () => {
    const r = separarSugerencias('La maestría dura 2 años.\n\nSUGERENCIAS: ¿Hay becas? | ¿Cuándo inicia?');
    assert.equal(r.texto, 'La maestría dura 2 años.');
    assert.deepEqual(r.sugerencias, ['¿Hay becas?', '¿Cuándo inicia?']);
  });

  it('acepta la etiqueta en negrita o minúsculas y quita comillas', () => {
    const r = separarSugerencias('Texto\n**Sugerencias:** "¿Es virtual?" | ¿Cuánto cuesta?');
    assert.equal(r.texto, 'Texto');
    assert.deepEqual(r.sugerencias, ['¿Es virtual?', '¿Cuánto cuesta?']);
  });

  it('descarta las que no caben en un botón y deja a lo sumo dos', () => {
    const r = separarSugerencias('X\nSUGERENCIAS: ¿Cuáles son los requisitos de admisión? | ¿Hay becas? | ¿Hay becas? | ¿Es presencial? | ¿Y en inglés?');
    assert.deepEqual(r.sugerencias, ['¿Hay becas?', '¿Es presencial?']);
  });

  it('sin línea de sugerencias, la respuesta queda igual', () => {
    const r = separarSugerencias('Solo la respuesta.');
    assert.equal(r.texto, 'Solo la respuesta.');
    assert.deepEqual(r.sugerencias, []);
  });

  it('los botones: dos sugerencias y una salida, todos válidos para WhatsApp', () => {
    const botones = botonesSugeridos(['¿Hay becas?', '¿Es virtual?'], 'posgrados');
    assert.equal(botones.length, 3);
    assert.equal(botones[2].id, 'conv_asesor');
    for (const b of botones) {
      assert.ok([...b.displayText].length <= 20, b.displayText);
      assert.ok(b.id.length <= 256);
    }
    assert.equal(parseSugerencia(botones[0].id), '¿Hay becas?');
  });

  it('si la IA no sugiere nada, quedan las de respaldo; sin pregrado, la salida son los pregrados', () => {
    const botones = botonesSugeridos([], 'admisiones');
    assert.deepEqual(botones.slice(0, 2).map((b) => b.displayText), [...SUGERENCIAS_RESPALDO.admisiones]);
    assert.equal(botones[2].id, 'conv_pregrados');
  });

  it('no sugiere lo mismo que la persona acaba de preguntar', () => {
    const botones = botonesSugeridos(['¿Hay becas?', '¿Es virtual?'], 'posgrados', 'hay becas');
    assert.deepEqual(botones.map((b) => b.displayText), ['¿Es virtual?', '👤 Hablar con asesor']);
    const respaldo = botonesSugeridos(['¿Hay becas?'], 'posgrados', '¿Hay becas?');
    assert.deepEqual(respaldo.map((b) => b.displayText), ['¿Cuándo inician?', '👤 Hablar con asesor']);
  });

  it('un toque en una sugerencia se lee como pregunta; lo demás no', () => {
    assert.equal(parseSugerencia(`${PREFIJO_SUGERENCIA}¿Cuándo inicia?`), '¿Cuándo inicia?');
    assert.equal(parseSugerencia(PREFIJO_SUGERENCIA), null);
    assert.equal(parseSugerencia('conv_asesor'), null);
    assert.equal(parseBoton(`${PREFIJO_SUGERENCIA}¿Hay becas?`), null);
  });

  it('la respuesta va con sus botones si es corta y sin enlaces', () => {
    assert.equal(cabeConBotones('La maestría dura 2 años.'), true);
    assert.equal(cabeConBotones('Mira: https://www.utb.edu.co/posgrados'), false);
    assert.equal(cabeConBotones('a'.repeat(1001)), false);
  });
});

describe('conversación: quien vuelve', () => {
  it('lo saluda por su primer nombre y le recuerda lo que buscaba', () => {
    assert.equal(
      saludoRegreso('Laura Gómez', 'Ingeniería Industrial', 'maestria'),
      '¡Hola de nuevo, Laura! 👋 La última vez buscabas *maestrías* para *Ingeniería Industrial*. ¿Seguimos?',
    );
    assert.equal(
      saludoRegreso(undefined, 'Economía'),
      '¡Hola de nuevo! 👋 La última vez hablamos de posgrados para *Economía*. ¿Seguimos?',
    );
    assert.equal(saludoCortoRegreso(''), '¡Hola de nuevo! 👋');
  });

  it('«sí» retoma y «no» empieza de nuevo', () => {
    assert.deepEqual(interpretarRespuestaEscrita('regreso', 'sí'), { boton: 'conv_seguir_perfil' });
    assert.deepEqual(interpretarRespuestaEscrita('regreso', 'mejor empezar de nuevo'), { boton: 'conv_reiniciar' });
    assert.deepEqual(interpretarRespuestaEscrita('regreso', 'no'), { boton: 'conv_reiniciar' });
    assert.equal(parseBoton('conv_seguir_perfil'), 'conv_seguir_perfil');
    assert.equal(parseBoton('conv_reiniciar'), 'conv_reiniciar');
  });
});

describe('conversación: autorización de datos en el primer contacto', () => {
  it('nombra la ley, las finalidades y cómo revocarla, y cabe en WhatsApp', () => {
    const texto = PREGUNTAS.datos.texto;
    assert.match(texto, /Ley 1581 de 2012/);
    assert.match(texto, /registrarte/);
    assert.match(texto, /asesor te contacte/);
    assert.match(texto, /BAJA/);
    assert.ok([...texto].length <= 1024);
    assert.deepEqual(PREGUNTAS.datos.botones?.map((b) => b.id), ['conv_datos_si', 'conv_datos_no']);
  });

  it('entiende la respuesta escrita', () => {
    assert.deepEqual(interpretarRespuestaEscrita('datos', 'sí'), { boton: 'conv_datos_si' });
    assert.deepEqual(interpretarRespuestaEscrita('datos', 'acepto'), { boton: 'conv_datos_si' });
    assert.deepEqual(interpretarRespuestaEscrita('datos', 'no acepto'), { boton: 'conv_datos_no' });
    assert.deepEqual(interpretarRespuestaEscrita('datos', 'no'), { boton: 'conv_datos_no' });
    assert.equal(interpretarRespuestaEscrita('datos', '¿cuánto cuesta el MBA?'), null);
  });

  it('confirma el registro por su primer nombre y recuerda cómo darse de baja', () => {
    assert.match(datosAceptados('Laura Gómez'), /^¡Gracias, Laura! Ya quedaste registrado/);
    assert.match(datosAceptados('Laura'), /BAJA/);
    assert.match(DATOS_RECHAZADOS, /no guardaré tus datos/);
  });
});

describe('conversación: cuándo entra el asesor', () => {
  it('reconoce más formas de pedir una persona', () => {
    for (const t of ['asesor porfa', '¿Puedo hablar con una persona?', 'necesito alguien que me explique',
      'que me llamen por favor', '¿me pueden llamar?', 'llámenme', 'quiero un asesor']) {
      assert.equal(esPedidoAsesor(t), true, t);
    }
  });

  it('no confunde preguntas que solo mencionan a una persona', () => {
    for (const t of ['quiero saber si una persona sin título puede entrar', '¿qué hace un asesor financiero?',
      'busco una maestría para una persona que trabaja', '¿Cuánto cuesta el MBA?']) {
      assert.equal(esPedidoAsesor(t), false, t);
    }
  });

  it('la IA marca cuándo hace falta una persona, y la marca no llega al texto', () => {
    const r = separarSugerencias('Para inscribirte entra al portal.\nSUGERENCIAS: ¿Hay becas? | ¿Fechas?\nASESOR: sí');
    assert.equal(r.texto, 'Para inscribirte entra al portal.');
    assert.equal(r.asesor, true);
    assert.equal(separarSugerencias('Texto\n**Asesor:** Sí.').asesor, true);
    assert.equal(separarSugerencias('Texto\nASESOR: no').asesor, false);
    assert.equal(separarSugerencias('Solo texto').asesor, false);
  });

  it('los botones de ofrecer asesor caben y se reconocen', () => {
    for (const b of BOTONES_OFRECER_ASESOR) {
      assert.ok([...b.displayText].length <= 20, b.displayText);
      assert.equal(parseBoton(b.id), b.id);
    }
  });
});

describe('conversación: lo que encontraron las 100 simulaciones', () => {
  it('un saludo con relleno sigue siendo saludo, pero una pregunta no', () => {
    for (const t of ['Hola Tooli', 'Hola, info por favor', 'buenas tardes, cómo estás?', 'Hola!!']) assert.equal(esSaludo(t), true, t);
    for (const t of ['hola quiero info de la maestría', 'Hola, ¿cuánto cuesta el MBA?']) assert.equal(esSaludo(t), false, t);
  });

  it('reconoce agradecimientos sin confundirlos con preguntas', () => {
    for (const t of ['gracias', 'Muchas gracias', '👍', 'me sirvió', 'ok', 'listo gracias']) assert.equal(esAgradecimiento(t), true, t);
    for (const t of ['¿gracias a qué?', 'ok pero ¿cuánto cuesta?', 'Ingeniería Industrial']) assert.equal(esAgradecimiento(t), false, t);
  });

  it('«tecnología en…» es un título técnico', () => {
    assert.equal(sinPregrado('tecnología en gestión logística'), 'tecnico');
    assert.equal(sinPregrado('tecnologia de la informacion es lo que me interesa'), null);
  });

  it('la relación con la UTB se pregunta una sola vez, con tres botones', () => {
    assert.deepEqual(PREGUNTAS.estudia_utb.botones?.map((b) => b.id), ['conv_egresado', 'conv_estudiante', 'conv_utb_no']);
    assert.deepEqual(interpretarRespuestaEscrita('estudia_utb', 'soy egresado'), { boton: 'conv_egresado' });
    assert.deepEqual(interpretarRespuestaEscrita('estudia_utb', 'estudio en la UTB'), { boton: 'conv_estudiante' });
    assert.deepEqual(interpretarRespuestaEscrita('estudia_utb', 'estudié en otra universidad'), { boton: 'conv_utb_no' });
    assert.deepEqual(interpretarRespuestaEscrita('estudia_utb', 'sí'), { boton: 'conv_utb_si' });
    // Una pregunta que menciona "egresado" no es la respuesta.
    assert.equal(interpretarRespuestaEscrita('estudia_utb', '¿Hay descuento por ser egresado?'), null);
  });

  it('un pedido largo también es una pregunta para la IA', () => {
    assert.equal(pareceUnaPregunta('quiero el plan de estudios completo de la maestría'), true);
    assert.equal(pareceUnaPregunta('Ingeniería Industrial'), false);
    assert.equal(pareceUnaPregunta('quiero asesor'), false);
  });
});
