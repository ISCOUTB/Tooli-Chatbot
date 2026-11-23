import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cargarVoces, crearBoca, crearLlamadaVoz, crearOido, dividirFrases, duracionLlamada, elegirVoz, errorDeMicrofono, etiquetaVoz,
  pistaDeVoz, retrasoReinicio, soporteVoz, textoParaSubtitulo, vocesEnEspanol,
} from './llamada-voz.js';

/* ── Dobles ─────────────────────────────────────────────────────────────── */

const vaciar = async () => { for (let i = 0; i < 6; i++) await new Promise(r => setImmediate(r)); };

/** Reloj de mentira: las esperas solo corren cuando la prueba avanza el tiempo. */
function relojFalso() {
  let t = 1_000_000;
  let n = 0;
  const tareas = new Map();
  return {
    ahora: () => t,
    esperar(fn, ms) { const id = ++n; tareas.set(id, { fn, en: t + ms }); return id; },
    cancelar(id) { tareas.delete(id); },
    pendientes: () => tareas.size,
    async avanzar(ms) {
      const fin = t + ms;
      for (;;) {
        const prox = [...tareas.entries()].filter(([, x]) => x.en <= fin).sort((a, b) => a[1].en - b[1].en)[0];
        if (!prox) break;
        tareas.delete(prox[0]);
        t = prox[1].en;
        prox[1].fn();
        await vaciar();
      }
      t = fin;
      await vaciar();
    },
  };
}

/** Voz del navegador de mentira: cada frase espera a que la prueba la termine. */
function bocaFalsa() {
  const dichas = [];
  let actual = null;
  return {
    dichas,
    callada: 0,
    hablar(texto, voz) {
      dichas.push({ texto, voz });
      return new Promise((resolve) => { actual = resolve; });
    },
    callar() { this.callada++; if (actual) { const r = actual; actual = null; r('cortada'); } },
    async terminarFrase() { const r = actual; actual = null; r?.('fin'); await vaciar(); },
    async terminarTodo() { while (actual) await this.terminarFrase(); },
    get hablando() { return Boolean(actual); },
  };
}

function oidoFalso() {
  return {
    encendido: false, veces: 0,
    alParcial: () => {}, alFinal: () => {}, alError: () => {},
    encender() { if (!this.encendido) this.veces++; this.encendido = true; },
    apagar() { this.encendido = false; },
  };
}

/** API del simulador de mentira: cada llamada queda pendiente hasta que la prueba la responda. */
function apiFalsa() {
  const llamadas = [];
  const pedir = (tipo) => (...args) => new Promise((resolve, reject) => { llamadas.push({ tipo, args, resolve, reject }); });
  return {
    llamadas,
    iniciar: pedir('iniciar'), decir: pedir('decir'), silencio: pedir('silencio'), colgar: pedir('colgar'),
    ultima(tipo) { return [...llamadas].reverse().find(l => l.tipo === tipo); },
    de(tipo) { return llamadas.filter(l => l.tipo === tipo); },
    async responder(tipo, r) { this.ultima(tipo).resolve(r); await vaciar(); },
    async fallar(tipo, status) { this.ultima(tipo).reject(Object.assign(new Error('x'), { status })); await vaciar(); },
  };
}

const ID = '11111111-2222-3333-4444-555555555555';
const decir = (texto) => ({ tipo: 'decir', texto, encolado: false });
function resp(comandos, extra = {}) {
  return { ok: true, llamadaId: ID, estado: 'activa', resultado: 'en_curso', fase: 'libre', verificado: false, transcripcion: [], comandos, ...extra };
}

function montar(opciones = {}) {
  const reloj = relojFalso();
  const boca = bocaFalsa();
  const oido = oidoFalso();
  const api = apiFalsa();
  const cambios = [];
  const llamada = crearLlamadaVoz({ api, boca, oido, relojes: reloj, alCambiar: (e) => cambios.push(e), ...opciones });
  return { reloj, boca, oido, api, llamada, cambios, get e() { return llamada.estado; } };
}

/** Llamada ya contestada y en «Te escucho». */
async function enEscucha(opciones) {
  const m = montar(opciones);
  m.llamada.iniciar();
  await m.api.responder('iniciar', resp([decir('Hola, te atiende Túli de la U T B. ¿En qué te ayudo?')]));
  await m.boca.terminarTodo();
  assert.equal(m.e.fase, 'escuchando');
  return m;
}

/* ── Elegir la voz ──────────────────────────────────────────────────────── */

const V = (name, lang, extra = {}) => ({ name, lang, localService: false, voiceURI: name, ...extra });
const GONZALO = V('Microsoft Gonzalo Online (Natural) - Spanish (Colombia)', 'es-CO');
const SALOME = V('Microsoft Salome Online (Natural) - Spanish (Colombia)', 'es-CO');
const JORGE = V('Microsoft Jorge Online (Natural) - Spanish (Mexico)', 'es-MX');
const DALIA = V('Microsoft Dalia Online (Natural) - Spanish (Mexico)', 'es-MX');
const SABINA = V('Microsoft Sabina - Spanish (Mexico)', 'es-MX', { localService: true });
const HELENA = V('Microsoft Helena - Spanish (Spain)', 'es-ES', { localService: true });
const GOOGLE_US = V('Google español de Estados Unidos', 'es-US');
const GOOGLE_ES = V('Google español', 'es-ES');
const INGLES = V('Microsoft Aria Online (Natural) - English (United States)', 'en-US');

describe('llamada con voz: qué voz del navegador usar', () => {
  it('lee la voz de los Ajustes de la línea', () => {
    assert.deepEqual(pistaDeVoz('Azure.es-CO-GonzaloNeural'), { nombre: 'gonzalo', lang: 'es-CO' });
    assert.deepEqual(pistaDeVoz('Azure.es-CO-SalomeNeural'), { nombre: 'salome', lang: 'es-CO' });
    assert.deepEqual(pistaDeVoz('Azure.es-MX-JorgeNeural'), { nombre: 'jorge', lang: 'es-MX' });
    assert.deepEqual(pistaDeVoz('AWS.Polly.Mia-Neural'), { nombre: 'mia', lang: null });
    assert.equal(pistaDeVoz(''), null);
    assert.equal(pistaDeVoz(undefined), null);
  });

  it('la voz configurada gana; si no está, la natural de Colombia; luego Colombia, México o EE. UU., y cualquier español', () => {
    const todas = [INGLES, HELENA, SABINA, JORGE, SALOME, GONZALO, GOOGLE_US];
    assert.equal(elegirVoz(todas, 'Azure.es-CO-GonzaloNeural').voz, GONZALO);
    assert.equal(elegirVoz(todas, 'Azure.es-CO-SalomeNeural').voz, SALOME);
    assert.equal(elegirVoz(todas, 'Azure.es-MX-JorgeNeural').voz, JORGE);
    assert.equal(elegirVoz(todas, 'Azure.es-CO-GonzaloNeural').motivo, 'configurada');
    // Sin Gonzalo (Chrome no tiene las voces de Edge): cualquier natural de Colombia.
    assert.deepEqual(elegirVoz([INGLES, SABINA, SALOME], 'Azure.es-CO-GonzaloNeural'), { voz: SALOME, motivo: 'natural_co' });
    assert.deepEqual(elegirVoz([HELENA, V('Voz local', 'es-CO', { localService: true }), JORGE], 'Azure.es-CO-GonzaloNeural').motivo, 'colombia');
    // Latinoamérica antes que España; entre ellas, la natural primero.
    assert.equal(elegirVoz([HELENA, SABINA, DALIA], 'Azure.es-CO-GonzaloNeural').voz, DALIA);
    assert.equal(elegirVoz([HELENA, GOOGLE_US], 'x').voz, GOOGLE_US);
    assert.deepEqual(elegirVoz([INGLES, HELENA], 'x'), { voz: HELENA, motivo: 'espanol' });
    assert.deepEqual(elegirVoz([INGLES], 'x'), { voz: null, motivo: 'sin_voz' });
    assert.deepEqual(elegirVoz([], 'x'), { voz: null, motivo: 'sin_voz' });
  });

  it('acepta el idioma con guion bajo y la «Salomé» con tilde', () => {
    const salomeTilde = V('Microsoft Salomé Online (Natural) - Spanish (Colombia)', 'es_CO');
    assert.equal(elegirVoz([GONZALO, salomeTilde], 'Azure.es-CO-SalomeNeural').voz, salomeTilde);
  });

  it('la que la persona eligió en la lista manda sobre todo, mientras exista', () => {
    const todas = [GONZALO, SALOME, JORGE];
    assert.deepEqual(elegirVoz(todas, 'Azure.es-CO-GonzaloNeural', JORGE.voiceURI), { voz: JORGE, motivo: 'elegida' });
    assert.equal(elegirVoz(todas, 'Azure.es-CO-GonzaloNeural', 'ya-no-existe').voz, GONZALO);
  });

  it('la lista del selector: solo español, la mejor primero y con nombres cortos', () => {
    const lista = vocesEnEspanol([INGLES, HELENA, GOOGLE_ES, SABINA, GONZALO, JORGE], 'Azure.es-CO-GonzaloNeural');
    assert.deepEqual(lista.slice(0, 3), [GONZALO, JORGE, SABINA]);
    assert.equal(lista.length, 5);
    assert.ok(!lista.includes(INGLES));
    assert.ok(lista.indexOf(JORGE) < lista.indexOf(HELENA), 'México antes que España');
    assert.equal(etiquetaVoz(GONZALO), 'Gonzalo · Colombia · natural');
    assert.equal(etiquetaVoz(JORGE), 'Jorge · México · natural');
    assert.equal(etiquetaVoz(HELENA), 'Helena · España');
    assert.equal(etiquetaVoz(GOOGLE_US), 'Google español de Estados Unidos · EE. UU.');
    assert.equal(etiquetaVoz(null), 'Voz del sistema');
  });
});

/* ── Textos ─────────────────────────────────────────────────────────────── */

describe('llamada con voz: subtítulos y frases', () => {
  it('el subtítulo deshace el léxico de pronunciación (se oye «Túli», se lee «Tooli»)', () => {
    assert.equal(textoParaSubtitulo('Te atiende Túli, de la U T B. Te escribo por guasap.'), 'Te atiende Tooli, de la UTB. Te escribo por WhatsApp.');
    assert.equal(textoParaSubtitulo('El eme be a y el pe hache de'), 'El MBA y el PhD');
    assert.equal(textoParaSubtitulo('U T B Virtual'), 'UTB Virtual');
    assert.equal(textoParaSubtitulo(''), '');
  });

  it('parte el turno en frases sin romper «a. m.» ni los números', () => {
    assert.deepEqual(dividirFrases('Hola, gracias por llamar. ¿En qué te ayudo?'), ['Hola, gracias por llamar.', '¿En qué te ayudo?']);
    assert.deepEqual(dividirFrases('Tengo mañana a las 9:00 a. m., o a las 10:30 a. m. ¿Cuál prefieres?'), ['Tengo mañana a las 9:00 a. m., o a las 10:30 a. m.', '¿Cuál prefieres?']);
    assert.deepEqual(dividirFrases('¡Qué bueno que llamas! Quedó agendada.'), ['¡Qué bueno que llamas!', 'Quedó agendada.']);
    assert.deepEqual(dividirFrases('Vale 17.900.000 pesos. Gracias'), ['Vale 17.900.000 pesos.', 'Gracias']);
    assert.deepEqual(dividirFrases('  '), []);
    // Una frase de una palabra se une a la siguiente: dos pausas seguidas suenan cortadas.
    assert.deepEqual(dividirFrases('Claro. Déjame revisar.'), ['Claro. Déjame revisar.']);
  });

  it('la duración del cronómetro', () => {
    assert.equal(duracionLlamada({ inicio: null }, 5000), '0:00');
    assert.equal(duracionLlamada({ inicio: 1000, fin: null }, 66_000), '1:05');
    assert.equal(duracionLlamada({ inicio: 1000, fin: 31_000 }, 999_999), '0:30');
  });
});

/* ── Soporte del navegador y micrófono ──────────────────────────────────── */

describe('llamada con voz: qué hace falta en el navegador', () => {
  const ok = { isSecureContext: true, webkitSpeechRecognition: function W() {}, speechSynthesis: {}, SpeechSynthesisUtterance: function U() {}, navigator: { mediaDevices: { getUserMedia() {} } } };
  it('Edge y Chrome sí; Firefox y Safari sin reconocimiento no', () => {
    assert.equal(soporteVoz(ok).ok, true);
    assert.equal(soporteVoz({ ...ok, webkitSpeechRecognition: undefined, SpeechRecognition: function S() {} }).ok, true);
    assert.deepEqual(soporteVoz({ ...ok, webkitSpeechRecognition: undefined }), { ok: false, motivo: 'sin_reconocimiento' });
    assert.deepEqual(soporteVoz({ ...ok, speechSynthesis: undefined }), { ok: false, motivo: 'sin_sintesis' });
    assert.deepEqual(soporteVoz({ ...ok, isSecureContext: false }), { ok: false, motivo: 'inseguro' });
    assert.deepEqual(soporteVoz({ ...ok, navigator: {} }), { ok: false, motivo: 'sin_microfono' });
  });

  it('los errores del micrófono en palabras', () => {
    assert.equal(errorDeMicrofono({ name: 'NotAllowedError' }), 'permiso');
    assert.equal(errorDeMicrofono({ name: 'SecurityError' }), 'permiso');
    assert.equal(errorDeMicrofono({ name: 'NotFoundError' }), 'sin_microfono');
    assert.equal(errorDeMicrofono({ name: 'NotReadableError' }), 'microfono_ocupado');
    assert.equal(errorDeMicrofono(new Error('raro')), 'microfono');
  });
});

/* ── Escuchar: el reconocimiento de voz del navegador ───────────────────── */

function reconocimientoFalso() {
  const instancias = [];
  class Reconocimiento {
    constructor() { this.arranques = 0; this.activo = false; instancias.push(this); }
    start() {
      if (this.activo) throw Object.assign(new Error('ya'), { name: 'InvalidStateError' });
      this.activo = true; this.arranques++;
    }
    stop() { this.terminar(); }
    abort() { this.terminar(); }
    terminar() { if (!this.activo) return; this.activo = false; this.onend?.(); }
    oir(partes) {
      // partes: [[texto, esFinal], ...] como un SpeechRecognitionEvent
      const results = partes.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f }));
      this.onresult?.({ resultIndex: 0, results });
    }
    fallar(error) { this.onerror?.({ error }); }
  }
  return { Reconocimiento, instancias };
}

function montarOido() {
  const reloj = relojFalso();
  const { Reconocimiento, instancias } = reconocimientoFalso();
  const oido = crearOido({ Reconocimiento, relojes: reloj });
  const parciales = []; const finales = []; const errores = [];
  oido.alParcial = t => parciales.push(t);
  oido.alFinal = t => finales.push(t);
  oido.alError = c => errores.push(c);
  return { reloj, oido, instancias, parciales, finales, errores, get rec() { return instancias[0]; } };
}

describe('llamada con voz: el oído (SpeechRecognition)', () => {
  it('escucha en es-CO, continuo y con resultados intermedios', () => {
    const m = montarOido();
    m.oido.encender();
    assert.equal(m.rec.lang, 'es-CO');
    assert.equal(m.rec.continuous, true);
    assert.equal(m.rec.interimResults, true);
    assert.equal(m.rec.activo, true);
    m.oido.encender();
    assert.equal(m.rec.arranques, 1, 'encender dos veces no arranca dos veces');
  });

  it('entrega los intermedios y las frases finales', () => {
    const m = montarOido();
    m.oido.encender();
    m.rec.oir([['quiero infor', false]]);
    m.rec.oir([['quiero información', true], [' de la maes', false]]);
    assert.deepEqual(m.parciales, ['quiero infor', 'de la maes']);
    assert.deepEqual(m.finales, ['quiero información']);
  });

  it('se vuelve a encender solo cuando Chrome lo corta por silencio, con calma si se corta seguido', async () => {
    const m = montarOido();
    m.oido.encender();
    await m.reloj.avanzar(5000);
    m.rec.terminar();                // corte normal tras un rato
    assert.equal(m.rec.activo, false);
    await m.reloj.avanzar(retrasoReinicio(0));
    assert.equal(m.rec.activo, true);
    assert.equal(m.instancias.length, 1, 'reusa el mismo reconocedor: no vuelve a pedir permiso');
    // Cortes inmediatos seguidos: cada reinicio espera más.
    m.rec.terminar();
    await m.reloj.avanzar(retrasoReinicio(0));
    m.rec.terminar();
    await m.reloj.avanzar(retrasoReinicio(1) - 1);
    assert.equal(m.rec.activo, false, 'todavía no: espera más');
    await m.reloj.avanzar(1);
    assert.equal(m.rec.activo, true);
    assert.ok(retrasoReinicio(1) > retrasoReinicio(0));
    assert.ok(retrasoReinicio(50) <= 4000, 'con tope');
  });

  it('si se corta una y otra vez sin oír nada, se rinde y avisa (sin bucle)', async () => {
    const m = montarOido();
    m.oido.encender();
    for (let i = 0; i < 12; i++) {
      m.rec.fallar('network');
      m.rec.terminar();
      await m.reloj.avanzar(5000);
    }
    assert.deepEqual(m.errores, ['network']);
    assert.ok(m.rec.arranques <= 8, `arranques: ${m.rec.arranques}`);
    assert.equal(m.rec.activo, false);
  });

  it('sin permiso no insiste', async () => {
    const m = montarOido();
    m.oido.encender();
    m.rec.fallar('not-allowed');
    m.rec.terminar();
    await m.reloj.avanzar(10_000);
    assert.deepEqual(m.errores, ['not-allowed']);
    assert.equal(m.rec.arranques, 1);
  });

  it('«no-speech» y «aborted» no son errores para la llamada', async () => {
    const m = montarOido();
    m.oido.encender();
    m.rec.fallar('no-speech');
    m.rec.terminar();
    await m.reloj.avanzar(retrasoReinicio(0));
    assert.deepEqual(m.errores, []);
    assert.equal(m.rec.activo, true);
  });

  it('si es-CO no existe en el navegador, usa es-ES', async () => {
    const m = montarOido();
    m.oido.encender();
    m.rec.fallar('language-not-supported');
    m.rec.terminar();
    await m.reloj.avanzar(retrasoReinicio(0));
    assert.equal(m.rec.lang, 'es-ES');
    assert.equal(m.rec.activo, true);
    assert.deepEqual(m.errores, []);
  });

  it('apagado no se reenciende ni entrega lo que quedó a medias', async () => {
    const m = montarOido();
    m.oido.encender();
    m.oido.apagar();
    assert.equal(m.rec.activo, false);
    m.rec.oir([['tarde', true]]);
    await m.reloj.avanzar(10_000);
    assert.equal(m.rec.activo, false);
    assert.deepEqual(m.finales, []);
  });
});

/* ── Hablar: speechSynthesis ─────────────────────────────────────────────── */

function sintesisFalsa() {
  const habladas = [];
  return {
    habladas, canceladas: 0,
    speak(u) { habladas.push(u); },
    cancel() { this.canceladas++; const u = habladas.at(-1); u?.onerror?.({ error: 'interrupted' }); },
    getVoices() { return this.voces ?? []; },
    addEventListener(tipo, fn) { this.oyentes = { ...(this.oyentes ?? {}), [tipo]: fn }; },
    removeEventListener(tipo) { if (this.oyentes) delete this.oyentes[tipo]; },
  };
}
class UtteranceFalsa { constructor(text) { this.text = text; } }

describe('llamada con voz: la boca (speechSynthesis)', () => {
  it('habla con la voz y el idioma elegidos y termina al acabar la frase', async () => {
    const reloj = relojFalso();
    const synth = sintesisFalsa();
    const boca = crearBoca({ synth, Utterance: UtteranceFalsa, relojes: reloj });
    const fin = boca.hablar('Hola.', GONZALO);
    const u = synth.habladas[0];
    assert.equal(u.voice, GONZALO);
    assert.equal(u.lang, 'es-CO');
    assert.equal(u.text, 'Hola.');
    u.onend();
    assert.equal(await fin, 'fin');
  });

  it('callar corta la frase', async () => {
    const reloj = relojFalso();
    const synth = sintesisFalsa();
    const boca = crearBoca({ synth, Utterance: UtteranceFalsa, relojes: reloj });
    const fin = boca.hablar('Una frase larga.', null);
    boca.callar();
    assert.equal(await fin, 'cortada');
    assert.equal(synth.canceladas, 1);
    assert.equal(synth.habladas[0].lang, 'es-CO', 'sin voz, español de Colombia');
  });

  it('callar suelta la frase aunque el navegador no avise que la cortó', async () => {
    const reloj = relojFalso();
    const synth = { ...sintesisFalsa(), cancel() {} };
    const boca = crearBoca({ synth, Utterance: UtteranceFalsa, relojes: reloj });
    const fin = boca.hablar('Una frase larga.', null);
    boca.callar();
    assert.equal(await fin, 'cortada');
    assert.equal(boca.hablando, false);
  });

  it('si el navegador nunca avisa el final, no se queda colgada', async () => {
    const reloj = relojFalso();
    const synth = sintesisFalsa();
    const boca = crearBoca({ synth, Utterance: UtteranceFalsa, relojes: reloj });
    let resultado = null;
    boca.hablar('Hola, ¿en qué te ayudo?', GONZALO).then(r => { resultado = r; });
    await reloj.avanzar(3000);
    assert.equal(resultado, null);
    await reloj.avanzar(20_000);
    assert.equal(resultado, 'fin');
  });

  it('las voces llegan tarde: espera a «voiceschanged», con tope', async () => {
    const reloj = relojFalso();
    const synth = sintesisFalsa();
    const promesa = cargarVoces(synth, reloj);
    synth.voces = [GONZALO];
    synth.oyentes.voiceschanged();
    assert.deepEqual(await promesa, [GONZALO]);
    const vacia = sintesisFalsa();
    const p2 = cargarVoces(vacia, reloj);
    await reloj.avanzar(2000);
    assert.deepEqual(await p2, []);
    synth.voces = [JORGE];
    assert.deepEqual(await cargarVoces(synth, reloj), [JORGE], 'si ya están, no espera');
  });
});

/* ── La llamada: estados, turnos, silencio y comandos ───────────────────── */

describe('llamada con voz: la llamada entera', () => {
  it('llama, habla el saludo en orden y en frases, y después escucha', async () => {
    const m = montar({ voz: () => GONZALO });
    assert.equal(m.e.fase, 'lista');
    m.llamada.iniciar({ desdeNumeroDelEstudiante: true });
    assert.equal(m.e.fase, 'llamando');
    assert.deepEqual(m.api.ultima('iniciar').args[0], { desdeNumeroDelEstudiante: true });
    await m.api.responder('iniciar', resp([
      { tipo: 'contestar' }, { tipo: 'escuchar' },
      decir('Hola, gracias por llamar a Posgrados de la U T B. Te atiende Túli. ¿En qué te ayudo?'),
      decir('Si prefieres un asesor, dilo.'),
    ], { transcripcion: [{ r: 'a', t: 'Hola, gracias por llamar a Posgrados de la UTB. Te atiende Tooli. ¿En qué te ayudo?' }] }));
    assert.equal(m.e.fase, 'hablando');
    assert.equal(m.e.llamadaId, ID);
    assert.ok(m.e.inicio, 'el cronómetro arranca al contestar');
    assert.equal(m.oido.encendido, false, 'sin audífonos el micrófono no escucha al bot');
    assert.equal(m.boca.dichas[0].texto, 'Hola, gracias por llamar a Posgrados de la U T B.');
    assert.equal(m.boca.dichas[0].voz, GONZALO);
    assert.equal(m.e.bot.frases[m.e.bot.actual], 'Hola, gracias por llamar a Posgrados de la UTB.', 'el subtítulo se lee bien');
    await m.boca.terminarFrase();
    assert.equal(m.boca.dichas[1].texto, 'Te atiende Túli.');
    await m.boca.terminarFrase();
    await m.boca.terminarFrase();
    assert.equal(m.boca.dichas[3].texto, 'Si prefieres un asesor, dilo.', 'la segunda frase del servidor va después de la primera');
    assert.equal(m.e.fase, 'hablando');
    await m.boca.terminarFrase();
    assert.equal(m.e.fase, 'escuchando');
    assert.equal(m.oido.encendido, true);
    assert.equal(m.e.transcripcion.length, 1);
  });

  it('una frase dicha va al servidor y vuelve con la respuesta', async () => {
    const m = await enEscucha();
    m.oido.alParcial('quiero información');
    assert.equal(m.e.persona, 'quiero información', 'subtítulo en vivo');
    m.oido.alFinal('quiero información de la maestría en gerencia');
    await m.reloj.avanzar(1000);
    assert.equal(m.e.fase, 'pensando');
    assert.equal(m.oido.encendido, false, 'mientras piensa no se escucha');
    assert.deepEqual(m.api.ultima('decir').args, [ID, 'quiero información de la maestría en gerencia']);
    assert.deepEqual(m.e.transcripcion.at(-1), { r: 'c', t: 'quiero información de la maestría en gerencia', provisional: true });
    await m.api.responder('decir', resp([decir('Claro, te cuento.')], { transcripcion: [{ r: 'a', t: 'Hola' }, { r: 'c', t: 'quiero información de la maestría en gerencia' }, { r: 'a', t: 'Claro, te cuento.' }] }));
    assert.equal(m.e.fase, 'hablando');
    assert.equal(m.e.transcripcion.length, 3, 'la del servidor reemplaza la provisional');
    assert.equal(m.e.transcripcion.some(l => l.provisional), false);
  });

  it('junta en un solo turno las frases finales seguidas y espera si la persona sigue hablando', async () => {
    const m = await enEscucha();
    m.oido.alFinal('quiero información');
    await m.reloj.avanzar(600);
    m.oido.alParcial('de la maes');
    await m.reloj.avanzar(800);
    assert.equal(m.api.de('decir').length, 0, 'sigue hablando: no se manda');
    m.oido.alFinal('de la maestría');
    await m.reloj.avanzar(900);
    assert.deepEqual(m.api.ultima('decir').args[1], 'quiero información de la maestría');
    assert.equal(m.api.de('decir').length, 1);
  });

  it('silencio: a los 6 s pregunta «¿sigues ahí?»; 7 s después se despide y cuelga, como la línea real', async () => {
    const m = await enEscucha();
    await m.reloj.avanzar(5999);
    assert.equal(m.api.de('silencio').length, 0);
    await m.reloj.avanzar(1);
    assert.equal(m.api.de('silencio').length, 1);
    assert.equal(m.e.fase, 'pensando');
    await m.api.responder('silencio', resp([decir('¿Sigues ahí? Si necesitas algo, dímelo.')]));
    await m.boca.terminarTodo();
    assert.equal(m.e.fase, 'escuchando');
    await m.reloj.avanzar(6999);
    assert.equal(m.api.de('silencio').length, 1, 'la segunda espera es de 7 s');
    await m.reloj.avanzar(1);
    assert.equal(m.api.de('silencio').length, 2);
    await m.api.responder('silencio', resp([decir('No te escucho, así que voy a colgar.'), { tipo: 'colgar' }], { estado: 'cerrada', resultado: 'silencio' }));
    assert.equal(m.e.fase, 'hablando', 'primero se despide');
    await m.boca.terminarTodo();
    assert.equal(m.e.fase, 'terminada');
    assert.equal(m.e.motivoFin, 'colgo');
    assert.equal(m.oido.encendido, false);
    assert.equal(m.api.de('colgar').length, 0, 'la colgó el servidor: no hace falta colgar otra vez');
    assert.equal(m.reloj.pendientes(), 0, 'no queda ningún temporizador vivo');
  });

  it('si la persona habla, el silencio vuelve a contar desde cero', async () => {
    const m = await enEscucha();
    await m.reloj.avanzar(5000);
    m.oido.alParcial('eh');
    await m.reloj.avanzar(5000);
    assert.equal(m.api.de('silencio').length, 0, 'mientras habla no hay silencio');
    m.oido.alFinal('eh, quería saber');
    await m.reloj.avanzar(1000);
    assert.equal(m.api.de('silencio').length, 0);
    assert.equal(m.api.de('decir').length, 1);
  });

  it('un murmullo que no termina en frase no deja la llamada muda para siempre', async () => {
    const m = await enEscucha();
    m.oido.alParcial('mmm');
    await m.reloj.avanzar(9000);
    assert.equal(m.e.persona, '', 'el subtítulo a medias se borra');
    await m.reloj.avanzar(6000);
    assert.equal(m.api.de('silencio').length, 1, 'y el silencio vuelve a contar');
  });

  it('transferir: «Pasando con un asesor…» y termina', async () => {
    const m = await enEscucha();
    m.oido.alFinal('quiero hablar con un asesor');
    await m.reloj.avanzar(1000);
    await m.api.responder('decir', resp([decir('Te paso con un asesor ahora mismo.'), { tipo: 'transferir', a: '+573005550100' }], { estado: 'cerrada', resultado: 'transferida' }));
    await m.boca.terminarTodo();
    assert.equal(m.e.fase, 'transfiriendo');
    assert.equal(m.e.transferirA, '+573005550100');
    await m.reloj.avanzar(3000);
    assert.equal(m.e.fase, 'terminada');
    assert.equal(m.e.motivoFin, 'transferida');
    assert.ok(m.e.fin >= m.e.inicio);
  });

  it('colgar a mitad de una frase: calla, apaga el micrófono y cuelga en el servidor', async () => {
    const m = montar();
    m.llamada.iniciar();
    await m.api.responder('iniciar', resp([decir('Hola, buenas tardes. ¿En qué te ayudo?')]));
    assert.equal(m.boca.hablando, true);
    m.llamada.colgar();
    assert.equal(m.e.fase, 'terminada');
    assert.equal(m.e.motivoFin, 'colgaste');
    assert.ok(m.boca.callada >= 1);
    assert.equal(m.oido.encendido, false);
    assert.deepEqual(m.api.ultima('colgar').args[0], ID);
    await vaciar();
    assert.equal(m.boca.dichas.length, 1, 'no sigue con la frase siguiente');
    await m.api.responder('colgar', resp([], { estado: 'cerrada', resultado: 'colgo', transcripcion: [{ r: 'a', t: 'Hola' }] }));
    assert.equal(m.e.resultado, 'colgo');
    m.llamada.colgar();
    assert.equal(m.api.de('colgar').length, 1, 'colgar dos veces no cuelga dos veces');
  });

  it('una respuesta que llega después de colgar no revive la llamada', async () => {
    const m = await enEscucha();
    const dichas = m.boca.dichas.length;
    m.oido.alFinal('hola');
    await m.reloj.avanzar(1000);
    m.llamada.colgar();
    await m.api.responder('decir', resp([decir('Te cuento algo nuevo.')]));
    assert.equal(m.e.fase, 'terminada');
    assert.equal(m.boca.dichas.length, dichas, 'no dice nada más');
  });

  it('tocar Llamar dos veces no abre dos llamadas', async () => {
    const m = montar();
    m.llamada.iniciar();
    m.llamada.iniciar();
    assert.equal(m.api.de('iniciar').length, 1);
    await m.api.responder('iniciar', resp([decir('Hola, buenas tardes.')]));
    m.llamada.iniciar();
    assert.equal(m.api.de('iniciar').length, 1, 'ni con la llamada en curso');
  });

  it('colgar mientras pasa con el asesor no vuelve a colgar en el servidor', async () => {
    const m = await enEscucha();
    m.oido.alFinal('quiero hablar con un asesor');
    await m.reloj.avanzar(1000);
    await m.api.responder('decir', resp([decir('Te paso con un asesor ahora mismo.'), { tipo: 'transferir', a: '+573005550100' }], { estado: 'cerrada' }));
    await m.boca.terminarTodo();
    assert.equal(m.e.fase, 'transfiriendo');
    m.llamada.colgar();
    assert.equal(m.e.fase, 'terminada');
    assert.equal(m.api.de('colgar').length, 0);
    await m.reloj.avanzar(5000);
    assert.equal(m.e.motivoFin, 'colgaste', 'el temporizador de la transferencia ya no cambia nada');
  });

  it('colgar mientras todavía está llamando cuelga en cuanto el servidor contesta', async () => {
    const m = montar();
    m.llamada.iniciar();
    m.llamada.colgar();
    assert.equal(m.e.fase, 'terminada');
    assert.equal(m.api.de('colgar').length, 0);
    await m.api.responder('iniciar', resp([decir('Hola.')]));
    assert.deepEqual(m.api.ultima('colgar').args[0], ID);
    assert.equal(m.boca.dichas.length, 0);
  });

  it('salir de la pantalla o cerrar la pestaña cuelga aunque la página se vaya', async () => {
    const m = await enEscucha();
    m.llamada.salir();
    assert.deepEqual(m.api.ultima('colgar').args, [ID, { salida: true }]);
    assert.equal(m.e.fase, 'terminada');
    assert.equal(m.oido.encendido, false);
  });

  it('sin audífonos: lo que se oye mientras habla el bot se ignora', async () => {
    const m = montar();
    m.llamada.iniciar();
    await m.api.responder('iniciar', resp([decir('Hola. ¿En qué te ayudo?')]));
    m.oido.alParcial('eco del bot');
    m.oido.alFinal('hola en qué te ayudo');
    assert.equal(m.e.fase, 'hablando');
    assert.equal(m.boca.callada, 0);
    await m.reloj.avanzar(2000);
    assert.equal(m.api.de('decir').length, 0);
  });

  it('con audífonos: hablar encima corta la voz del bot (barge-in) y la persona sigue', async () => {
    const m = montar();
    m.llamada.ponerInterrumpir(true);
    m.llamada.iniciar();
    await m.api.responder('iniciar', resp([decir('Hola. Te cuento de los programas. ¿Cuál te interesa?')]));
    assert.equal(m.oido.encendido, true, 'el micrófono queda abierto mientras habla');
    m.oido.alParcial('maestría');
    assert.ok(m.boca.callada >= 1);
    assert.equal(m.e.fase, 'escuchando');
    assert.equal(m.e.persona, 'maestría');
    await vaciar();
    assert.equal(m.boca.dichas.length, 1, 'lo que faltaba por decir se descarta');
    m.oido.alFinal('maestría en gerencia');
    await m.reloj.avanzar(1000);
    assert.deepEqual(m.api.ultima('decir').args[1], 'maestría en gerencia');
  });

  it('con audífonos, la despedida no se interrumpe: la llamada ya terminó', async () => {
    const m = await enEscucha({ });
    m.llamada.ponerInterrumpir(true);
    m.oido.alFinal('gracias, eso era todo');
    await m.reloj.avanzar(1000);
    await m.api.responder('decir', resp([decir('Con gusto. Que tengas buen día.'), { tipo: 'colgar' }], { estado: 'cerrada' }));
    assert.equal(m.oido.encendido, false, 'el micrófono no se abre para la despedida');
    m.oido.alParcial('chao');
    assert.equal(m.e.fase, 'hablando');
    assert.equal(m.boca.callada, 0);
    await m.boca.terminarTodo();
    assert.equal(m.e.fase, 'terminada');
    assert.equal(m.e.motivoFin, 'colgo');
  });

  it('cambiar el interruptor de audífonos mientras el bot habla abre o cierra el micrófono', async () => {
    const m = montar();
    m.llamada.iniciar();
    await m.api.responder('iniciar', resp([decir('Hola. ¿En qué te ayudo?')]));
    assert.equal(m.oido.encendido, false);
    m.llamada.ponerInterrumpir(true);
    assert.equal(m.oido.encendido, true);
    m.llamada.ponerInterrumpir(false);
    assert.equal(m.oido.encendido, false);
  });

  it('silenciar el micrófono lo apaga y al activarlo vuelve a escuchar', async () => {
    const m = await enEscucha();
    m.llamada.silenciarMicro(true);
    assert.equal(m.e.microApagado, true);
    assert.equal(m.oido.encendido, false);
    m.oido.alFinal('no debería llegar');
    await m.reloj.avanzar(1000);
    assert.equal(m.api.de('decir').length, 0);
    m.llamada.silenciarMicro(false);
    assert.equal(m.oido.encendido, true);
  });

  it('sin permiso para el reconocimiento: la llamada termina con el motivo y se cuelga en el servidor', async () => {
    const m = await enEscucha();
    m.oido.alError('not-allowed');
    assert.equal(m.e.fase, 'terminada');
    assert.equal(m.e.motivoFin, 'error');
    assert.equal(m.e.error, 'permiso');
    assert.equal(m.api.de('colgar').length, 1);
    const r = await enEscucha();
    r.oido.alError('network');
    assert.equal(r.e.error, 'red');
    const s = await enEscucha();
    s.oido.alError('audio-capture');
    assert.equal(s.e.error, 'sin_microfono');
  });

  it('si la línea no responde, avisa y vuelve a escuchar; si la llamada ya se cerró, termina', async () => {
    const m = await enEscucha();
    m.oido.alFinal('hola');
    await m.reloj.avanzar(1000);
    await m.api.fallar('decir', 500);
    assert.equal(m.e.fase, 'escuchando');
    assert.equal(m.e.aviso, 'La línea no respondió. Repítelo, por favor.');
    assert.equal(m.e.transcripcion.some(l => l.provisional), false, 'la línea provisional se quita');
    m.oido.alParcial('otra');
    assert.equal(m.e.aviso, null, 'el aviso se va cuando vuelve a hablar');
    m.oido.alFinal('otra vez');
    await m.reloj.avanzar(1000);
    await m.api.fallar('decir', 409);
    assert.equal(m.e.fase, 'terminada');
    assert.equal(m.e.motivoFin, 'colgo');
  });

  it('el tope de simulaciones o un servidor caído al llamar', async () => {
    const m = montar();
    m.llamada.iniciar();
    await m.api.fallar('iniciar', 429);
    assert.equal(m.e.fase, 'terminada');
    assert.equal(m.e.error, 'tope');
    const n = montar();
    n.llamada.iniciar();
    await n.api.fallar('iniciar', 503);
    assert.equal(n.e.error, 'servidor');
    n.llamada.iniciar();
    assert.equal(n.e.fase, 'llamando', 'se puede volver a llamar');
    assert.equal(n.e.error, null);
  });

  it('las líneas de sistema nuevas (el código simulado) se muestran aparte', async () => {
    const m = await enEscucha();
    m.oido.alFinal('te 12345');
    await m.reloj.avanzar(1000);
    await m.api.responder('decir', resp([decir('Te envié un código por guasap.')], { transcripcion: [{ r: 'a', t: 'Hola' }, { r: 'c', t: 'T00012345' }, { r: 's', t: 'Código enviado por WhatsApp (simulado): 482913' }, { r: 'a', t: 'Te envié un código por WhatsApp.' }] }));
    assert.equal(m.e.sistema, 'Código enviado por WhatsApp (simulado): 482913');
  });

  it('volver a llamar después de terminar empieza de cero', async () => {
    const m = await enEscucha();
    m.llamada.colgar();
    m.llamada.iniciar();
    assert.equal(m.e.fase, 'llamando');
    assert.equal(m.e.motivoFin, null);
    assert.deepEqual(m.e.transcripcion, []);
    assert.equal(m.e.inicio, null);
  });

  it('cada llamada es independiente (dos pestañas, dos llamadas)', async () => {
    const a = await enEscucha();
    const b = await enEscucha();
    a.llamada.colgar();
    assert.equal(a.e.fase, 'terminada');
    assert.equal(b.e.fase, 'escuchando');
    b.llamada.silenciarMicro(true);
    assert.equal(a.e.microApagado, false);
  });

  it('avisa cada cambio con una copia (la vista no puede romper el estado)', async () => {
    const m = await enEscucha();
    const antes = m.cambios.length;
    m.oido.alParcial('hola');
    assert.ok(m.cambios.length > antes);
    m.cambios.at(-1).persona = 'cambiado desde fuera';
    m.cambios.at(-1).transcripcion.push({ r: 'c', t: 'x' });
    assert.equal(m.e.persona, 'hola');
    assert.equal(m.e.transcripcion.length, 0);
  });
});
