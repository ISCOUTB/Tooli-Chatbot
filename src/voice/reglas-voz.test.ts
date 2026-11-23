// Reglas del entendedor y del turno que salieron del corpus de llamadas simuladas (tools/corpus-voz.ts), probadas con
// frases PROPIAS que no están en el corpus: la regla debe cubrir la familia, no la frase. Y lo que no debe disparar.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { correrTurno, type DepsTurno, type ResultadoTurno } from './dialogo';
import { entenderPorReglas } from './entender';
import { montosDelCatalogo } from './posgrados';
import { academicoSimulado, agendaSimulada } from './simulados';
import {
  codigoEstudiantilDictado, isCallbackRequest, isGoodbye, isHoldRequest, isHumanRequest, isNoiseOnly, isRepeatRequest, lineCheck,
  replyAmountsAllowed, sanitizeCallerText,
} from './texto';
import { DIALOGO_VACIO, leerDialogo, type EstadoDialogo } from './tipos';

const AHORA = new Date('2026-11-23T15:00:00Z');

function deps(over: Partial<DepsTurno> = {}): DepsTurno & { enviados: { telefono: string; codigo: string }[] } {
  const enviados: { telefono: string; codigo: string }[] = [];
  return {
    academico: academicoSimulado(), agenda: agendaSimulada(AHORA), ia: null,
    enviarCodigo: async (telefono, codigo) => { enviados.push({ telefono, codigo }); return true; },
    generarCodigo: () => '482913', secreto: 'secreto-de-prueba', ahora: () => AHORA, telefonoLlamante: '573009998877',
    asesoresEnVivo: false, ...over, enviados,
  } as DepsTurno & { enviados: { telefono: string; codigo: string }[] };
}

async function conversar(frases: string[], d: DepsTurno, inicial: EstadoDialogo = DIALOGO_VACIO): Promise<ResultadoTurno[]> {
  const out: ResultadoTurno[] = [];
  let s = inicial;
  for (const f of frases) { const r = await correrTurno(f, s, d); out.push(r); s = r.estado; }
  return out;
}

const regla = (t: string) => entenderPorReglas(sanitizeCallerText(t));
const SALUDO = 'Hola, gracias por llamar a Posgrados de la UTB. ¿En qué te ayudo?';

describe('repetir solo con frases cortas', () => {
  it('«otra vez» dentro de una frase larga NO es pedir que repita', () => {
    for (const f of [
      'mi esposo quiere volver a estudiar otra vez una maestría',
      'llamé otra vez porque ayer no me dieron razón del doctorado',
      'quiero empezar de nuevo a estudiar, qué especializaciones hay',
    ]) assert.equal(isRepeatRequest(f), false, f);
  });
  it('sí lo es con frases cortas o pedidos explícitos', () => {
    for (const f of ['¿otra vez?', '¿cómo?', 'perdón, ¿qué me dijo?', 'repítamelo por favor', 'no le oí nada', '¿me puede repetir lo del valor de la matrícula?', 'uh… ¿qué?']) {
      assert.equal(isRepeatRequest(f), true, f);
    }
  });
  it('en la llamada: la frase larga se atiende, no repite el saludo', async () => {
    const [r] = await conversar(['mi sobrino quiere estudiar otra vez, ¿qué doctorados tienen?'], deps(), { ...DIALOGO_VACIO, ultimaRespuesta: SALUDO });
    assert.notEqual(r.respuesta, SALUDO);
    assert.match(r.respuesta, /doctorado/i);
  });
});

describe('comprobación de línea', () => {
  it('reconoce ¿aló?, ¿me escucha?, ¿hay alguien? y ¿hola?', () => {
    for (const f of ['¿Aló?', '¿me escuchan?', '¿Hay alguien ahí?', '¿hola? ¿hola?', 'oiga, ¿sí me oye?', '¿sigue ahí, señorita?']) {
      assert.equal(lineCheck(f), 'corta', f);
    }
  });
  it('no la confunde con una pregunta de verdad', () => {
    for (const f of ['aló, quiero saber cuánto vale la maestría en derecho', '¿me escucha? necesito mi recibo de matrícula de este semestre ya']) {
      assert.notEqual(lineCheck(f), 'corta', f);
    }
  });
  it('responde breve y sigue donde iba, sin reiniciar ni contar fallo', async () => {
    const d = deps();
    const [r1, r2] = await conversar(['quiero ver mi horario', '¿aló? ¿me oyen bien?'], d);
    assert.equal(r1.estado.fase, 'pide_codigo_estudiantil');
    assert.match(r2.respuesta, /^Sí, te escucho\./);
    assert.match(r2.respuesta, /código estudiantil/);
    assert.equal(r2.estado.fase, 'pide_codigo_estudiantil');
    assert.equal(r2.estado.fallos, r1.estado.fallos);
    assert.equal(r2.estado.ultimaRespuesta, r1.estado.ultimaRespuesta);
  });
  it('en fase libre: «Sí, te escucho. ¿En qué te ayudo?»', async () => {
    const [r] = await conversar(['¿hay alguien?'], deps(), { ...DIALOGO_VACIO, ultimaRespuesta: SALUDO });
    assert.equal(r.respuesta, 'Sí, te escucho. ¿En qué te ayudo?');
  });
  it('lo dicho a otra persona y luego «¿aló?»: comprobación', async () => {
    const [r] = await conversar(['pásame el control de la tele que está encima de la mesa… ¿aló?'], deps());
    assert.match(r.respuesta, /^Sí, te escucho/);
  });
  it('anotaciones del transcriptor y letras estiradas son ruido', () => {
    assert.equal(isNoiseOnly(sanitizeCallerText('[música de fondo]')), true);
    assert.equal(isNoiseOnly('eeeeh mmmm ajááá'), true);
    assert.equal(isNoiseOnly('hey parce ajá'), true);
    assert.equal(isNoiseOnly('bueno'), false); // puede ser un «sí»
  });
  it('«espere un momentico» se espera sin tocar el estado; «me equivoqué de número» se despide', async () => {
    assert.equal(isHoldRequest('ya vengo, un segundito'), true);
    assert.equal(isHoldRequest('espere que le pregunto a mi jefe cuánto cuesta la maestría en finanzas'), false);
    const [r] = await conversar(['espéreme un momentico'], deps(), { ...DIALOGO_VACIO, fase: 'confirma_franja' });
    assert.equal(r.respuesta, 'Claro, aquí te espero.');
    assert.equal(r.estado.fase, 'confirma_franja');
    assert.equal(isGoodbye('ay perdón, marqué mal'), true);
    assert.equal(isGoodbye('me equivoqué de programa, era la maestría en educación la que quería'), false);
  });
});

describe('devolución de la llamada', () => {
  it('reconoce la familia de frases', () => {
    for (const f of [
      '¿me pueden llamar mañana en la mañana?', 'mejor llámeme usted cuando tenga a alguien', 'márquenme a eso de las cuatro',
      'que me regresen la llamada por favor', 'hágame el favor y me da un timbrazo luego', 'apunte mi celular que ya me tengo que ir',
      'mi número es el 312 456 7890, me contactan', 'contácteme más tarde',
    ]) assert.equal(isCallbackRequest(f), true, f);
  });
  it('no la confunde con otras cosas', () => {
    for (const f of [
      'me llamo Andrea y quiero saber del MBA', 'me están llamando por la otra línea, un segundo', 'me llama la atención la maestría en educación',
      'quiero que me devuelvan la plata del recibo', 'me mandaron a llamar para preguntar por los doctorados', 'mi número es la te cero cero nueve ocho siete seis cinco cuatro',
      'voy a llamar a mi jefe primero',
    ]) assert.equal(isCallbackRequest(f), false, f);
  });
  it('deja la devolución al número que llama, sin franjas ni volver a preguntar', async () => {
    const [r] = await conversar(['ahorita no puedo hablar, mejor me marcan en la tarde'], deps());
    assert.equal(r.resultado, 'devolver_llamada');
    assert.equal(r.estado.fase, 'libre');
    assert.doesNotMatch(r.respuesta, /\d/); // no inventa una hora
  });
  it('sin número visible no la promete', async () => {
    const [r] = await conversar(['llámenme después'], deps({ telefonoLlamante: 'anonymous' }));
    assert.notEqual(r.resultado, 'devolver_llamada');
    assert.equal(r.estado.fase, 'ofrece_asesor');
  });
  it('mientras pide el código, «llámenme luego» sale de esa fase', async () => {
    const [, r] = await conversar(['quiero mis notas', 'no tengo el código a la mano, llámenme luego'], deps());
    assert.equal(r.resultado, 'devolver_llamada');
  });
});

describe('pedir una persona y pedir cita', () => {
  it('más formas', () => {
    for (const f of [
      'comuníqueme con alguien de admisiones', 'me transfiere con la coordinadora', 'pásenme con tesorería', 'necesito sacar una cita',
      'quiero programar una reunión con alguien de posgrados', 'agéndeme para el lunes', 'hablar con un ser humano por favor', 'quiero una as esora',
    ]) assert.equal(isHumanRequest(f), true, f);
    // «pasa con» de «qué pasa con…» no es pasar a alguien.
    assert.equal(isHumanRequest('qué pasa con mi recibo que no me llega'), false);
  });
  it('¿hablo con una máquina? es una pregunta, no un pedido', async () => {
    for (const f of ['¿estoy hablando con una máquina?', '¿usted es una persona real?']) assert.equal(isHumanRequest(f), false, f);
    const [r] = await conversar(['¿usted es un robot o una persona?'], deps());
    assert.match(r.respuesta, /asistente virtual/);
    assert.equal(r.estado.fase, 'libre');
  });
});

describe('consultas de estudiante', () => {
  it('sinónimos y formas sin «mi»', () => {
    assert.equal(regla('necesito el horario de este semestre').tipo, 'horario');
    assert.equal(regla('qué materias me tocan el otro periodo').tipo, 'cursos');
    assert.equal(regla('quiero ver mis nota s del corte').tipo, 'notas');
  });
  it('falsos positivos', () => {
    assert.notEqual(regla('tengo turno de noche en la clínica, por eso pregunto si es virtual').herramienta, 'datos_estudiante');
    assert.notEqual(regla('¿piden certificado de notas del pregrado para la maestría en finanzas?').herramienta, 'datos_estudiante');
    assert.notEqual(regla('¿cuál es el horario de atención?').herramienta, 'datos_estudiante');
  });
  it('«…no, mejor…»: se queda con lo de después', () => {
    assert.equal(regla('quiero mi turno, ah no, mejor dicho mi horario').tipo, 'horario');
    const r = regla('cuánto vale la especialización en finanzas… no espere, ¿es virtual?');
    assert.equal(r.herramienta, 'info_programa');
    assert.equal(r.aspecto, 'modalidad');
    assert.match(r.programa ?? '', /Finanzas/);
  });
  it('código dictado solo: pregunta qué consultar y no lo vuelve a pedir', async () => {
    const d = deps();
    const [r1, r2] = await conversar(['te cero cero cero uno dos tres cuatro cinco', 'mis notas'], d);
    assert.match(r1.respuesta, /Qué quieres consultar/);
    assert.equal(r1.estado.codigoDictado, 'T00012345');
    assert.doesNotMatch(r2.respuesta, /Cuál es tu código/);
    assert.ok(['pide_otp', 'pide_codigo_estudiantil'].includes(r2.estado.fase));
  });
  it('el código en la misma frase no suma números de después', () => {
    assert.equal(codigoEstudiantilDictado('es la te cero cero uno dos tres cuatro cinco seis y tengo una duda'), 'T00123456');
  });
  it('el estado guardado conserva el código dictado solo si es válido', () => {
    assert.equal(leerDialogo({ codigoDictado: 'T12345678' }).codigoDictado, 'T12345678');
    assert.equal(leerDialogo({ codigoDictado: 'x; borrar' }).codigoDictado, null);
  });
});

describe('aspectos, varios a la vez y listas por área', () => {
  it('sinónimos de costo, fechas, requisitos y financiación', () => {
    assert.equal(regla('¿cuánto me toca pagar por la maestría en educación?').aspecto, 'costo');
    assert.equal(regla('¿cuándo comienza el próximo grupo de la maestría en derecho?').aspecto, 'fechas');
    assert.equal(regla('¿qué documentación hay que llevar para la especialización en finanzas?').aspecto, 'requisitos');
    assert.equal(regla('¿se puede pagar en euros la maestría en derecho?').aspecto, 'financiacion');
  });
  it('«cuánto es la duración» es duración, no costo', () => {
    assert.deepEqual(regla('cuánto es la duración de la maestría en educación').aspectos, ['duracion']);
  });
  it('dos aspectos: contesta los dos con datos del catálogo', async () => {
    const [r] = await conversar(['¿cuánto dura el MBA y cuánto cuesta?'], deps());
    assert.match(r.respuesta, /dura 3 semestres/);
    assert.match(r.respuesta, /17 millones 900 mil pesos/);
    assert.ok(replyAmountsAllowed(r.respuesta, montosDelCatalogo()));
    assert.equal((r.respuesta.match(/\?/g) ?? []).length, 1);
  });
  it('«la virtual esa» nombra la versión: no es pregunta de modalidad', () => {
    assert.deepEqual(regla('la especialización en ingeniería de software, la virtual esa, cuánto me toca pagar').aspectos, ['costo']);
  });
  it('lista por área, con nombres del catálogo y sin cifras inventadas', async () => {
    const [r] = await conversar(['¿qué maestrías tienen sobre educación?'], deps());
    assert.match(r.respuesta, /^En educación tengo \d+ posgrados/);
    assert.match(r.respuesta, /Maestría en Educación/);
    assert.doesNotMatch(r.respuesta, /Especialización/); // pidió maestrías
  });
  it('un área sin programas lo dice', async () => {
    const [r] = await conversar(['qué doctorados hay en educación'], deps());
    assert.match(r.respuesta, /no veo posgrados/);
  });
});

describe('fuera de alcance', () => {
  it('pregrado: lo dice y ofrece asesor; la cita va a pregrado', async () => {
    const d = deps();
    const [r] = await conversar(['mi hija termina el colegio y quiere estudiar psicología en la UTB'], d);
    assert.match(r.respuesta, /posgrados/);
    assert.equal(r.estado.fase, 'ofrece_asesor');
    assert.equal(r.estado.pregrado, true);
  });
  it('programa que no existe: lo dice, no lista otros', async () => {
    for (const f of ['¿tienen la maestría en odontología?', 'quiero el doctorado en veterinaria']) {
      const [r] = await conversar([f], deps());
      assert.match(r.respuesta, /No encuentro ese programa/, f);
    }
  });
  it('visas, homologación, admitidos, director: ofrece asesor sin inventar', async () => {
    for (const f of ['¿ustedes me ayudan con la visa de estudiante?', '¿ya publicaron los admitidos del doctorado?', '¿cómo se llama el director del programa de derecho?', '¿convalidan títulos de México?']) {
      const [r] = await conversar([f], deps());
      assert.equal(r.estado.fase, 'ofrece_asesor', f);
      assert.doesNotMatch(r.respuesta, /\d/, f);
    }
  });
  it('trámite junto a una pregunta del catálogo: contesta lo que hay y deriva lo demás', async () => {
    const [r] = await conversar(['¿cuánto vale la maestría en derecho y me sirve mi visa de turista?'], deps());
    assert.match(r.respuesta, /10 millones 950 mil pesos/);
    assert.match(r.respuesta, /te lo confirma un asesor/);
    assert.equal(r.estado.fase, 'ofrece_asesor');
  });
  it('un «no» que trae otra pregunta no rechaza: la atiende', async () => {
    const [r] = await conversar(['no, lo que quiero saber es cuánto vale la maestría en educación'], deps(), { ...DIALOGO_VACIO, fase: 'ofrece_asesor' });
    assert.equal(r.resultado, 'consulta');
  });
});
