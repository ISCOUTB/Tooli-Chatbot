import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOTONES_OFRECER_ASESOR, BOTONES_SIN_PREGRADO, BOTONES_TECNICO, DATOS_RECHAZADOS, PREFIJO_SUGERENCIA, PREGUNTAS, SUGERENCIAS_RESPALDO, botonesSugeridos,
  cabeConBotones, datoPersonal, datosAceptados, detectarPerfil, esAgradecimiento, esBaja, esConfusion, esEspera, esQueja, esRuido, esPedidoAsesor, esSaludo, infoAceptada, interpretarRespuestaEscrita,
  limpiarNombre, nivelDeBoton, pareceUnaPregunta, parseBoton, parseSugerencia, saludoCortoRegreso, saludoEnConversacion, saludoRegreso,
  SALUDO_CONVERSACION, SALUDO_CORTO, SUGERENCIAS_SALUDO,
  separarSugerencias, sinPregrado, siguientePregunta, textoPregrado,
  buscaNivel, cambioDeNombre, carreraEnLaFrase, datosDeLaFrase, esCorreccion, soloCuentaDatos,
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
    const sin = separarSugerencias('No tengo ese dato.\nSIN_DATO: sí\nSUGERENCIAS: ¿Hay becas? | ¿Es virtual?');
    assert.equal(sin.sinDato, true);
    assert.equal(sin.texto, 'No tengo ese dato.');
    assert.equal(separarSugerencias('Texto').sinDato, false);
    assert.equal(separarSugerencias('Solo texto').asesor, false);
  });

  it('los botones de ofrecer asesor caben y se reconocen', () => {
    for (const b of BOTONES_OFRECER_ASESOR) {
      assert.ok([...b.displayText].length <= 20, b.displayText);
      assert.equal(parseBoton(b.id), b.id);
    }
  });
});

describe('conversación: bienvenida de Tooli Posgrados', () => {
  it('se presenta como Tooli Posgrados y dice de qué se le puede preguntar', () => {
    assert.match(SALUDO_CONVERSACION, /Soy \*Tooli Posgrados\*, tu asistente/);
    assert.match(SALUDO_CONVERSACION, /Puedes preguntarme sobre:/);
    for (const tema of ['maestrías', 'Costos', 'financiación', 'Horarios', 'Requisitos']) assert.ok(SALUDO_CONVERSACION.includes(tema), tema);
    assert.match(SALUDO_CORTO, /Tooli Posgrados\*, tu asistente/);
  });

  it('quien ya venía conversando y saluda recibe la presentación con su nombre', () => {
    const texto = saludoEnConversacion('ana maría pérez');
    assert.match(texto, /^¡Hola, Ana! 👋 Soy \*Tooli Posgrados\*, tu asistente/);
    assert.match(texto, /Puedes preguntarme sobre:/);
    assert.match(saludoEnConversacion(), /^¡Hola! 👋/);
    const botones = botonesSugeridos(SUGERENCIAS_SALUDO, 'posgrados');
    assert.deepEqual(botones.map((b) => b.displayText).slice(0, 2), ['¿Qué programas hay?', '¿Cuánto cuesta?']);
    assert.equal(botones.length, 3);
  });

  it('reconoce saludos con errores de tipeo o letras de más', () => {
    for (const t of ['Hols', 'ola', 'holaaa', 'Holaa!', 'hoal', 'wenas', 'Buenasss tardes', 'holis', 'Hols buenas']) assert.equal(esSaludo(t), true, t);
    for (const t of ['hora', 'sola', 'hols quiero el MBA', 'cola']) assert.equal(esSaludo(t), false, t);
  });
});

describe('conversación: lo que encontraron las 1.000 simulaciones', () => {
  it('«no entiendo» o «no sé» a la autorización de datos no es un «no»', () => {
    assert.equal(interpretarRespuestaEscrita('datos', 'no entiendo'), null);
    assert.equal(interpretarRespuestaEscrita('datos', 'no sé'), null);
    assert.equal(interpretarRespuestaEscrita('datos', '¿qué?'), null);
    assert.deepEqual(interpretarRespuestaEscrita('datos', 'no'), { boton: 'conv_datos_no' });
    assert.deepEqual(interpretarRespuestaEscrita('datos', 'nel'), { boton: 'conv_datos_no' });
  });

  it('«algo virtual» al preguntar el nivel pide los programas virtuales', () => {
    assert.deepEqual(interpretarRespuestaEscrita('nivel', 'algo virtual'), { nivel: '', virtual: true });
    assert.deepEqual(interpretarRespuestaEscrita('nivel', 'una maestría virtual'), { nivel: 'maestria', virtual: true });
    assert.deepEqual(interpretarRespuestaEscrita('nivel', 'especialización en línea'), { nivel: 'especializacion', virtual: true });
    assert.deepEqual(interpretarRespuestaEscrita('nivel', 'no sé'), { nivel: '' });
  });

  it('una foto no se toma como nombre', () => {
    assert.equal(limpiarNombre('__image__'), null);
    assert.equal(limpiarNombre('Laura Gómez'), 'Laura Gómez');
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

describe('conversación: respuestas como se escriben en WhatsApp', () => {
  it('"dale", "ok", "sii", "de una" son sí; "nel", "nooo", "no gracias" son no', () => {
    for (const t of ['dale', 'ok', 'sii', 'de una', 'bueno', 'listo']) assert.deepEqual(interpretarRespuestaEscrita('info', t), { boton: 'conv_info_si' }, t);
    for (const t of ['nel', 'nooo', 'no gracias', 'para nada']) assert.deepEqual(interpretarRespuestaEscrita('info', t), { boton: 'conv_info_no' }, t);
    assert.equal(interpretarRespuestaEscrita('info', 'bueno pero ¿cuánto cuesta el MBA?'), null);
  });

  it('el nivel escrito elige ese nivel, salvo que nombre dos', () => {
    assert.deepEqual(interpretarRespuestaEscrita('nivel', 'una maestría'), { boton: 'conv_mae' });
    assert.deepEqual(interpretarRespuestaEscrita('nivel', 'especializacion'), { boton: 'conv_esp' });
    assert.deepEqual(interpretarRespuestaEscrita('nivel', 'doctorado'), { boton: 'conv_doc' });
    assert.equal(interpretarRespuestaEscrita('nivel', 'maestría o especialización'), null);
  });
});

describe('conversación: lo que encontraron las 500 simulaciones', () => {
  it('solo registra nombres: ni ruido, ni frases, ni datos sueltos', () => {
    for (const [t, esperado] of [['Laura Gómez', 'Laura Gómez'], ['me llamo Andrés', 'Andrés'], ['Hola, soy Camilo Ortiz', 'Camilo Ortiz'],
      ['María de la Hoz', 'María de la Hoz'], ['kelly', 'kelly']] as const) assert.equal(limpiarNombre(t), esperado, t);
    for (const t of ['jajaja', 'un momento', 'soy de Barranquilla', 'tengo 32 años', 'mi correo es a@b.co', 'estoy en Cartagena', 'qué?', 'ok', 'mmm']) {
      assert.equal(limpiarNombre(t), null, t);
    }
  });

  it('distingue ruido, espera, confusión y quejas', () => {
    for (const t of ['mmm', 'jajaja', '😂', '?', '...', 'ey', 'k']) assert.equal(esRuido(t), true, t);
    for (const t of ['👍', 'Hola?', 'maestría', 'gracias']) assert.equal(esRuido(t), false, t);
    assert.equal(esEspera('un momento'), true);
    assert.equal(esConfusion('no entiendo'), true);
    assert.equal(esConfusion('¿qué?'), true);
    assert.equal(esQueja('esto no sirve'), true);
    assert.equal(esQueja('¿sirve para trabajar en el exterior?'), false);
  });

  it('reconoce datos personales sueltos para no mandarlos a la IA', () => {
    assert.deepEqual(datoPersonal('mi correo es laura.gomez@gmail.com'), { tipo: 'correo', valor: 'laura.gomez@gmail.com' });
    assert.deepEqual(datoPersonal('+57 300 123 4567'), { tipo: 'telefono' });
    assert.deepEqual(datoPersonal('cc 1.143.256.789'), { tipo: 'documento' });
    assert.equal(datoPersonal('maestría 2027'), null);
    assert.equal(datoPersonal('tengo 32 años'), null);
  });

  it('«la más corta» es la especialización', () => {
    assert.deepEqual(interpretarRespuestaEscrita('nivel', 'la más corta'), { boton: 'conv_esp' });
  });
});

// Frases reales que se perdían (nov-2026): el bot volvía a pedir la carrera o no dejaba cambiar el nombre.
describe('conversación: lo que trae una frase escrita', () => {
  const carrera = (t: string) => {
    const c = carreraEnLaFrase(t);
    return c ? ('pregradoId' in c ? c.pregradoId : c.familiaId) : null;
  };

  it('saca la carrera dicha de paso, con tildes, mayúsculas, abreviada o mal escrita', () => {
    for (const [t, id] of [
      ['No, estudio ingeniería de sistemas', 'ingenieria-de-sistemas-y-computacion'],
      ['NO ESTUDIO INGENIERIA DE SISTEMAS', 'ingenieria-de-sistemas-y-computacion'],
      ['no estudio ing sistemas 😅', 'ingenieria-de-sistemas-y-computacion'],
      ['estudiando sistemas', 'ingenieria-de-sistemas-y-computacion'],
      ['nop, estudie derecho', 'derecho'],
      ['sí, soy egresado de industrial', 'ingenieria-industrial'],
      ['estudio ingenieria indsutrial', 'ingenieria-industrial'],
      ['Soy abogada', 'derecho'],
      ['soy ingeniero civil', 'ingenieria-civil'],
      ['estudio quinto semestre de psicologia', 'psicologia'],
      ['Me gradué como contador público', 'contaduria-publica'],
      ['estudio en la utb ingenieria industrial', 'ingenieria-industrial'],
      ['no, me equivoqué, estudio civil', 'ingenieria-civil'],
      ['estudio enfermería', 'salud'],
    ] as const) assert.equal(carrera(t), id, t);
  });

  it('no toma por carrera el posgrado que busca ni lo que no es una carrera', () => {
    for (const t of ['quiero una maestría en finanzas', 'estudio una maestría en finanzas', 'estudio en la UTB', 'estudio en otra universidad',
      'soy de cartagena', 'soy Laura', 'estudio y trabajo', '¿qué maestrías hay en finanzas?']) assert.equal(carrera(t), null, t);
  });

  it('saca la relación con la UTB aunque no la diga con las palabras del botón', () => {
    assert.equal(detectarPerfil('soy egresado de la tecnológica').relacion, 'egresado_utb');
    assert.equal(detectarPerfil('me gradue de economia en la utb').relacion, 'egresado_utb');
    assert.equal(detectarPerfil('soy ingeniera de sistemas de la UTB').relacion, 'egresado_utb');
    assert.equal(detectarPerfil('no, estudié en la Universidad de Cartagena, derecho').relacion, 'externo');
    assert.equal(detectarPerfil('estudie medicina en otra universidad').relacion, 'externo');
    assert.equal(detectarPerfil('Soy egresado').relacion, undefined, 'sin decir de dónde no se asume nada');
  });

  it('«una especialización», «no, un posgrado»: dice solo qué nivel busca', () => {
    assert.deepEqual(buscaNivel('Especialización'), { nivel: 'especializacion', virtual: false });
    assert.deepEqual(buscaNivel('no, una especialización'), { nivel: 'especializacion', virtual: false });
    assert.deepEqual(buscaNivel('quiero hacer un doctorado'), { nivel: 'doctorado', virtual: false });
    assert.deepEqual(buscaNivel('MAESTRIA'), { nivel: 'maestria', virtual: false });
    assert.deepEqual(buscaNivel('una especializacion en linea porfa'), { nivel: 'especializacion', virtual: true });
    assert.deepEqual(buscaNivel('no, un posgrado'), { nivel: '', virtual: false }, 'posgrado a secas no fija nivel');
    for (const t of ['maestria en finanzas', '¿cuánto cuesta la maestría?', 'ok', 'no']) assert.equal(buscaNivel(t), null, t);
    assert.equal(datosDeLaFrase('no, una especialización').buscaNivel?.nivel, 'especializacion');
  });

  it('un «no» seguido de datos sigue siendo un «no»; una corrección no contesta la pregunta', () => {
    assert.deepEqual(interpretarRespuestaEscrita('tiene_programa', 'No, estudio ingeniería de sistemas'), { boton: 'conv_elegir' });
    assert.deepEqual(interpretarRespuestaEscrita('tiene_programa', 'no, un posgrado'), { boton: 'conv_elegir' });
    assert.deepEqual(interpretarRespuestaEscrita('tiene_programa', 'Especialización'), { boton: 'conv_elegir' });
    assert.equal(interpretarRespuestaEscrita('tiene_programa', 'no, pero quiero saber cuánto cuesta'), null, 'eso es una pregunta');
    assert.deepEqual(interpretarRespuestaEscrita('estudia_utb', 'no, soy de otra universidad, estudié derecho'), { boton: 'conv_utb_no' });
    assert.deepEqual(interpretarRespuestaEscrita('estudia_utb', 'egresado de otra universidad'), { boton: 'conv_utb_no' });
    assert.equal(interpretarRespuestaEscrita('estudia_utb', 'no, me equivoqué, estudio civil'), null);
    assert.equal(interpretarRespuestaEscrita('estudia_utb', 'ya te dije que estudio sistemas'), null);
    assert.ok(esCorreccion('No, me equivoqué'));
    assert.ok(!esCorreccion('no gracias'));
  });

  it('«estudio sistemas en la UTB» solo cuenta datos; una pregunta no', () => {
    assert.ok(soloCuentaDatos('estudio sistemas en la UTB'));
    assert.ok(soloCuentaDatos('no, me equivoqué, estudio civil'));
    for (const t of ['soy egresado de la UTB, ¿cuánto cuesta la maestría?', 'estudio derecho y quiero saber los horarios', 'estudié derecho, hay becas']) {
      assert.ok(!soloCuentaDatos(t), t);
    }
  });
});

describe('conversación: cambiar el nombre', () => {
  it('reconoce el nombre nuevo en las formas en que se dice', () => {
    for (const [t, nombre] of [
      ['me llamo Laura', 'Laura'], ['Me llamo LAURA GÓMEZ', 'LAURA GÓMEZ'], ['mi nombre es Laura Gómez', 'Laura Gómez'],
      ['cámbiame el nombre a Laura', 'Laura'], ['cambia mi nombre a Laura Pérez', 'Laura Pérez'], ['ese no es mi nombre, soy Laura', 'Laura'],
      ['no me llamo Pedro, me llamo Laura', 'Laura'], ['no soy Pedro, soy Laura', 'Laura'], ['mi nombre real es Laura', 'Laura'],
      ['ponme de nombre Laura', 'Laura'], ['me llamo ana 👋', 'ana'], ['me llamo laura.', 'laura'],
      ['mi nombre es María José de la Hoz', 'María José de la Hoz'],
    ] as const) {
      const r = cambioDeNombre(t);
      assert.ok(r && 'nombre' in r && r.nombre === nombre, `${t} → ${JSON.stringify(r)}`);
    }
  });

  it('separa lo que dijo después del nombre', () => {
    assert.deepEqual(cambioDeNombre('hola, me llamo Laura y estudio derecho'), { nombre: 'Laura', resto: 'estudio derecho' });
    assert.deepEqual(cambioDeNombre('me llamo Laura, quiero info de la maestría'), { nombre: 'Laura', resto: 'quiero info de la maestría' });
    assert.deepEqual(cambioDeNombre('me llamo Laura pero me dicen Lau'), { nombre: 'Laura', resto: '' });
  });

  it('«quiero cambiar mi nombre» sin decir cuál: se le pregunta', () => {
    for (const t of ['quiero cambiar mi nombre', 'Quiero cambiar mi nombre por favor', 'cambiar nombre', 'Ese no es mi nombre']) {
      assert.deepEqual(cambioDeNombre(t), { pedir: true }, t);
    }
  });

  it('no confunde con un cambio de nombre lo que no lo es', () => {
    for (const t of ['me llamo la atención la maestría', 'me llamó mucho la atención', '¿cómo se llama el programa?', 'me llamaron ayer',
      'Me llamaron de la UTB', 'no soy de cartagena, soy de barranquilla', 'no soy egresado, soy estudiante', 'mi nombre es 😀',
      'me llamo jajaja', 'soy ingeniera', 'estudio derecho', '__image__']) {
      assert.equal(cambioDeNombre(t), null, t);
    }
  });

  it('«estudio derecho» o «soy ingeniero» no se registran como nombre', () => {
    assert.equal(limpiarNombre('estudio derecho'), null);
    assert.equal(limpiarNombre('soy ingeniero'), null);
  });
});
