/* Llamada con voz en el navegador: la lógica, sin DOM.
 *
 * Usa el MISMO simulador de la línea (POST /api/tools/voz/simular…): el
 * servidor decide qué decir, cuándo transferir y cuándo colgar; aquí solo se
 * pone la boca (speechSynthesis) y el oído (SpeechRecognition) del navegador,
 * se reparten los turnos y se cuenta el silencio como lo haría Telnyx.
 *
 * Todo entra por parámetros (API, oído, boca, relojes) para probarlo con
 * dobles en llamada-voz.test.js. Cada llamada es un objeto propio: dos
 * pestañas son dos llamadas que no comparten nada.
 */

/* ── La voz ─────────────────────────────────────────────────────────────── */

const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const idiomaDe = (voz) => String(voz?.lang ?? '').replace('_', '-');

/** La voz de los Ajustes de la línea («Azure.es-CO-GonzaloNeural») en nombre e idioma. */
export function pistaDeVoz(id) {
  const azure = /^Azure\.([a-z]{2})-([A-Z]{2})-([A-Za-z]+?)(?:Multilingual)?Neural$/.exec(String(id ?? ''));
  if (azure) return { nombre: sinTildes(azure[3]), lang: `${azure[1]}-${azure[2]}` };
  const polly = /^AWS\.Polly\.([A-Za-z]+?)(?:-Neural)?$/.exec(String(id ?? ''));
  if (polly) return { nombre: sinTildes(polly[1]), lang: null };
  return null;
}

const LATAM = new Set(['es-mx', 'es-us', 'es-419']);
const esNatural = (voz) => /natural|neural/i.test(voz?.name ?? '');

/* Puntaje de una voz: -1 si no es español. La configurada en la línea va
   primero; después Colombia, México / EE. UU. / Latinoamérica y cualquier
   español; entre iguales, la natural (las «Online (Natural)» de Edge suenan
   como la línea real porque son las mismas voces de Azure). */
function puntaje(voz, pista) {
  const lang = idiomaDe(voz).toLowerCase();
  if (!lang.startsWith('es')) return -1;
  let p = lang === 'es-co' ? 30 : LATAM.has(lang) ? 20 : 10;
  if (esNatural(voz)) p += 5;
  if (pista && new RegExp(`\\b${pista.nombre}\\b`).test(sinTildes(voz.name))) p += 100;
  return p;
}

function motivoDe(voz, p) {
  if (p >= 100) return 'configurada';
  const lang = idiomaDe(voz).toLowerCase();
  if (lang === 'es-co') return esNatural(voz) ? 'natural_co' : 'colombia';
  return LATAM.has(lang) ? 'latam' : 'espanol';
}

/** Las voces en español, la mejor primero (para el selector). */
export function vocesEnEspanol(voces, idConfigurada) {
  const pista = pistaDeVoz(idConfigurada);
  return (voces ?? [])
    .map((voz, i) => ({ voz, i, p: puntaje(voz, pista) }))
    .filter(x => x.p >= 0)
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .map(x => x.voz);
}

/**
 * La voz con la que habla el bot. `elegida` es el voiceURI que la persona
 * escogió en la lista (si todavía existe, manda).
 */
export function elegirVoz(voces, idConfigurada, elegida) {
  const lista = voces ?? [];
  if (elegida) {
    const v = lista.find(x => (x.voiceURI === elegida || x.name === elegida) && idiomaDe(x).toLowerCase().startsWith('es'));
    if (v) return { voz: v, motivo: 'elegida' };
  }
  const pista = pistaDeVoz(idConfigurada);
  const [mejor] = vocesEnEspanol(lista, idConfigurada);
  if (!mejor) return { voz: null, motivo: 'sin_voz' };
  return { voz: mejor, motivo: motivoDe(mejor, puntaje(mejor, pista)) };
}

const REGIONES = { CO: 'Colombia', MX: 'México', US: 'EE. UU.', ES: 'España', AR: 'Argentina', CL: 'Chile', PE: 'Perú', VE: 'Venezuela', EC: 'Ecuador', '419': 'Latinoamérica' };

/** «Microsoft Gonzalo Online (Natural) - Spanish (Colombia)» → «Gonzalo · Colombia · natural». */
export function etiquetaVoz(voz) {
  if (!voz) return 'Voz del sistema';
  const nombre = String(voz.name ?? '').replace(/^Microsoft\s+/, '').replace(/\s+Online\s*\(Natural\)/i, '').replace(/\s+-\s+.*$/, '').trim();
  const region = idiomaDe(voz).split('-')[1];
  return [nombre || 'Voz', REGIONES[region?.toUpperCase()] ?? idiomaDe(voz), esNatural(voz) ? 'natural' : null].filter(Boolean).join(' · ');
}

/** Espera las voces: Chrome y Edge las cargan después de abrir la página («voiceschanged»). */
export function cargarVoces(synth, relojes, ms = 1500) {
  const ya = synth?.getVoices?.() ?? [];
  if (ya.length || !synth) return Promise.resolve(ya);
  return new Promise((resolve) => {
    let listo = false;
    let tope = null;
    const fin = () => {
      if (listo) return;
      listo = true;
      relojes.cancelar(tope);
      synth.removeEventListener?.('voiceschanged', alCambiar);
      resolve(synth.getVoices?.() ?? []);
    };
    const alCambiar = () => { if ((synth.getVoices?.() ?? []).length) fin(); };
    synth.addEventListener?.('voiceschanged', alCambiar);
    tope = relojes.esperar(fin, ms);
  });
}

/* ── Los textos ─────────────────────────────────────────────────────────── */

/* El servidor manda el texto ya pasado por el léxico de pronunciación
   (src/voice/texto.ts, LEXICO): se oye «Túli», pero en el subtítulo se lee «Tooli». */
const LEXICO_INVERSO = [
  [/\bU T B\b/g, 'UTB'],
  [/\bTúli\b/g, 'Tooli'],
  [/\bguasap\b/gi, 'WhatsApp'],
  [/\beme be a\b/g, 'MBA'],
  [/\bpe hache de\b/g, 'PhD'],
  [/\bese ese te\b/g, 'SST'],
];

export function textoParaSubtitulo(texto) {
  return LEXICO_INVERSO.reduce((t, [re, por]) => t.replace(re, por), String(texto ?? ''));
}

/**
 * Un turno en frases: el subtítulo marca la que suena y una frase corta no se
 * corta a la mitad en Chrome. Solo se parte tras «. ! ? …» seguido de
 * mayúscula, «¿» o «¡»: «a. m., o» y «17.900.000» quedan enteros. Una frase de
 * una sola palabra («Claro.») va con la siguiente.
 */
export function dividirFrases(texto) {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const partes = t.split(/(?<=[.!?…]["»”)]?)\s+(?=[¿¡A-ZÁÉÍÓÚÑ0-9])/u);
  const frases = [];
  let arrastre = '';
  partes.forEach((p, i) => {
    const frase = arrastre ? `${arrastre} ${p}` : p;
    if (!/\s/.test(frase) && i < partes.length - 1) { arrastre = frase; return; }
    arrastre = '';
    frases.push(frase);
  });
  return frases;
}

/** Cronómetro «m:ss» desde que contestó; quieto al terminar. */
export function duracionLlamada(estado, ahora) {
  if (!estado?.inicio) return '0:00';
  const s = Math.max(0, Math.floor(((estado.fin ?? ahora) - estado.inicio) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ── El navegador ───────────────────────────────────────────────────────── */

/** Lo que hace falta: reconocimiento (Edge, Chrome), síntesis, https y micrófono. */
export function soporteVoz(win) {
  if (!win?.SpeechRecognition && !win?.webkitSpeechRecognition) return { ok: false, motivo: 'sin_reconocimiento' };
  if (!win.speechSynthesis || !win.SpeechSynthesisUtterance) return { ok: false, motivo: 'sin_sintesis' };
  if (win.isSecureContext === false) return { ok: false, motivo: 'inseguro' };
  if (!win.navigator?.mediaDevices?.getUserMedia) return { ok: false, motivo: 'sin_microfono' };
  return { ok: true };
}

/** El error de getUserMedia en una clave del panel. */
export function errorDeMicrofono(err) {
  const nombre = err?.name ?? '';
  if (['NotAllowedError', 'SecurityError', 'PermissionDeniedError'].includes(nombre)) return 'permiso';
  if (['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError'].includes(nombre)) return 'sin_microfono';
  if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(nombre)) return 'microfono_ocupado';
  return 'microfono';
}

/** Espera antes de volver a encender el reconocimiento tras `n` cortes seguidos: 250 ms, 500, 1 s… hasta 4 s. */
export function retrasoReinicio(n) {
  return Math.min(4000, 250 * 2 ** Math.max(0, n));
}

/* ── El oído: SpeechRecognition ─────────────────────────────────────────── */

const ERRORES_FATALES = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);

/**
 * Chrome y Edge cortan el reconocimiento tras unos segundos de silencio y a
 * veces sin razón. Mientras la llamada quiera escuchar, se vuelve a encender
 * el MISMO reconocedor (no pide permiso otra vez). Si se corta seguido sin oír
 * nada, espera cada vez más; si pasa muchas veces, se rinde y avisa una vez.
 * Sin permiso no se insiste nunca. Con la pestaña oculta (`oculto()`), Chrome
 * corta el reconocimiento: no se cuenta ni se reintenta hasta `reanudar()`.
 */
export function crearOido({ Reconocimiento, idiomas = ['es-CO', 'es-ES'], relojes, maxCortes = 6, oculto = () => false }) {
  let rec = null;
  let quiere = false;
  let activo = false;
  let idioma = 0;
  let cortes = 0;
  let desde = 0;
  let oyoAlgo = false;
  let ultimoError = null;
  let espera = null;

  const yo = {
    alParcial: () => {},
    alFinal: () => {},
    alError: () => {},
    get escuchando() { return activo; },
    encender() {
      quiere = true;
      if (activo || espera) return;
      cortes = 0;
      arrancar();
    },
    /** La pestaña volvió a verse: si la llamada quería escuchar, se enciende otra vez. */
    reanudar() {
      if (quiere && !activo && !espera) arrancar();
    },
    apagar() {
      quiere = false;
      relojes.cancelar(espera);
      espera = null;
      if (activo) { try { rec.abort(); } catch { activo = false; } }
    },
  };

  function crear() {
    rec = new Reconocimiento();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      if (!quiere) return;
      oyoAlgo = true;
      cortes = 0;
      let parcial = '';
      for (let i = e.resultIndex ?? 0; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r?.[0]?.transcript ?? '';
        if (r.isFinal) { if (t.trim()) yo.alFinal(t.trim()); } else parcial += t;
      }
      if (parcial.trim()) yo.alParcial(parcial.trim());
    };
    rec.onerror = (e) => {
      ultimoError = e?.error ?? 'desconocido';
      if (ultimoError === 'language-not-supported' && idioma < idiomas.length - 1) { idioma++; return; }
      if (ERRORES_FATALES.has(ultimoError) && quiere) { quiere = false; yo.alError(ultimoError); }
    };
    rec.onend = () => {
      activo = false;
      if (!quiere || oculto()) return;
      const rapido = ultimoError === 'network' || (!oyoAlgo && relojes.ahora() - desde < 1500);
      cortes = rapido ? cortes + 1 : 0;
      if (cortes > maxCortes) {
        quiere = false;
        yo.alError(ultimoError && ultimoError !== 'no-speech' && ultimoError !== 'aborted' ? ultimoError : 'se_corta');
        return;
      }
      espera = relojes.esperar(arrancar, retrasoReinicio(cortes - 1));
    };
  }

  function arrancar() {
    espera = null;
    if (!quiere) return;
    if (!rec) crear();
    rec.lang = idiomas[idioma];
    oyoAlgo = false;
    ultimoError = null;
    desde = relojes.ahora();
    try {
      rec.start();
      activo = true;
    } catch (err) {
      // Ya estaba encendido (Chrome tarda en soltar tras abort): llegará su «end».
      if (err?.name === 'InvalidStateError') { activo = true; return; }
      quiere = false;
      yo.alError('no_arranca');
    }
  }

  return yo;
}

/* ── La boca: speechSynthesis ───────────────────────────────────────────── */

/**
 * Dice una frase y avisa cuándo terminó: 'fin', 'cortada' (callar o
 * interrupción) o 'error'. Si el navegador nunca avisa el final (pasa en
 * Chrome), un tope generoso por largo del texto evita que la llamada se quede
 * muda esperando.
 */
export function crearBoca({ synth, Utterance, relojes }) {
  let actual = null;
  const soltar = (resultado) => {
    if (!actual) return;
    const a = actual;
    actual = null;
    relojes.cancelar(a.tope);
    a.resolve(resultado);
  };
  return {
    get hablando() { return Boolean(actual); },
    hablar(texto, voz, { alEmpezar } = {}) {
      soltar('cortada');
      return new Promise((resolve) => {
        const u = new Utterance(texto);
        if (voz) u.voice = voz;
        u.lang = idiomaDe(voz) || 'es-CO';
        u.rate = 1;
        u.pitch = 1;
        const yo = { resolve, tope: null, u }; // u se guarda: Chrome pierde el «end» si la frase se recolecta
        actual = yo;
        u.onstart = () => { if (actual === yo) alEmpezar?.(); };
        u.onend = () => { if (actual === yo) soltar('fin'); };
        u.onerror = (e) => { if (actual === yo) soltar(e?.error === 'interrupted' || e?.error === 'canceled' ? 'cortada' : 'error'); };
        yo.tope = relojes.esperar(() => { if (actual === yo) soltar('fin'); }, 6000 + String(texto).length * 150);
        synth.speak(u);
        if (synth.paused) synth.resume?.();
      });
    },
    callar() {
      const a = actual;
      try { synth.cancel(); } catch { /* sin voz no hay nada que callar */ }
      if (a && actual === a) soltar('cortada');
    },
  };
}

/* ── La llamada ─────────────────────────────────────────────────────────── */

const ERROR_DE_OIDO = {
  'not-allowed': 'permiso', 'service-not-allowed': 'servicio_voz', 'audio-capture': 'sin_microfono', network: 'red',
};
const AVISO_SIN_RESPUESTA = 'La línea no respondió. Repítelo, por favor.';
const AVISO_SIN_VOZ = 'El navegador no pudo leer la respuesta en voz alta: va en los subtítulos.';

/**
 * Fases: lista → llamando → hablando ⇄ escuchando → pensando → … → terminada
 * (o transfiriendo → terminada). Los tiempos de silencio son los de la línea
 * real (`silencioMs = [6000, 7000]` en src/voice/manejador.ts).
 *
 * @param {object} d
 * @param {{ iniciar: Function, decir: Function, silencio: Function, colgar: Function }} d.api
 * @param {ReturnType<typeof crearBoca>} d.boca
 * @param {ReturnType<typeof crearOido>} d.oido
 * @param {{ ahora: Function, esperar: Function, cancelar: Function }} d.relojes
 * @param {(estado: object) => void} [d.alCambiar]
 * @param {() => SpeechSynthesisVoice|null} [d.voz]
 */
export function crearLlamadaVoz({
  api, boca, oido, relojes, alCambiar = () => {}, voz = () => null,
  silencioMs = [6000, 7000], finFraseMs = 900, parcialMs = 8000, transferirMs = 2600,
}) {
  const nuevo = (previo = {}) => ({
    fase: 'lista', llamadaId: null, bot: { frases: [], actual: -1 }, persona: '', dijo: '', transcripcion: [],
    microApagado: Boolean(previo.microApagado), interrumpir: Boolean(previo.interrumpir),
    inicio: null, fin: null, motivoFin: null, transferirA: null, error: null, aviso: null, sistema: null,
    resultado: null, faseDialogo: null, verificado: false,
  });
  let e = nuevo();
  let gen = 0;          // cambia con cada llamada y al terminar: respuestas viejas se ignoran
  let habla = 0;        // cambia al callar al bot: el resto del turno se descarta
  let cola = [];
  let terminal = null;  // { tipo: 'colgar' } | { tipo: 'transferir', a } que el servidor ya decidió
  let silencios = 0;
  let acumulado = '';
  let salio = false;
  const t = { silencio: null, envio: null, parcial: null, transferir: null };

  const copia = () => ({ ...e, bot: { ...e.bot, frases: [...e.bot.frases] }, transcripcion: e.transcripcion.map(l => ({ ...l })) });
  const emitir = () => alCambiar(copia());
  const parar = (k) => { relojes.cancelar(t[k]); t[k] = null; };
  const pararTodo = () => Object.keys(t).forEach(parar);
  const terminada = () => e.fase === 'lista' || e.fase === 'terminada';
  /** La petición sale ya (no en la próxima vuelta) y un error síncrono también llega al catch. */
  const intentar = (fn) => { try { return Promise.resolve(fn()); } catch (err) { return Promise.reject(err); } };
  const sinProvisional = () => { e.transcripcion = e.transcripcion.filter(l => !l.provisional); };

  /* El micrófono escucha cuando le toca a la persona y, con audífonos, también
     mientras habla el bot (para poder interrumpirlo), salvo en la despedida. */
  function ajustarOido() {
    const abrir = !e.microApagado && (e.fase === 'escuchando' || (e.fase === 'hablando' && e.interrumpir && !terminal));
    if (abrir) oido.encender(); else oido.apagar();
  }

  function cerrar(motivo, error = null) {
    gen++;
    habla++;
    cola = [];
    acumulado = '';
    pararTodo();
    boca.callar();
    oido.apagar();
    sinProvisional();
    Object.assign(e, { fase: 'terminada', motivoFin: motivo, error, fin: relojes.ahora(), persona: '' });
    emitir();
  }

  /** Lo que el servidor ya decidió al terminar de hablar: pasar a un asesor o colgar. */
  function cumplirFinal() {
    if (terminal?.tipo === 'transferir') {
      pararTodo();
      oido.apagar();
      Object.assign(e, { fase: 'transfiriendo', transferirA: terminal.a ?? null, persona: '' });
      emitir();
      t.transferir = relojes.esperar(() => cerrar('transferida'), transferirMs); // colgar antes lo cancela (pararTodo)
      return;
    }
    cerrar('colgo');
  }

  function armarSilencio() {
    parar('silencio');
    t.silencio = relojes.esperar(alSilencio, silencioMs[Math.min(silencios, silencioMs.length - 1)]);
  }

  function escuchar() {
    e.fase = 'escuchando';
    e.persona = '';
    ajustarOido();
    armarSilencio();
    emitir();
  }

  function aplicar(r) {
    if (Array.isArray(r.transcripcion)) {
      const antes = e.transcripcion.filter(l => !l.provisional).length;
      e.transcripcion = r.transcripcion.map(l => ({ r: l.r, t: l.t }));
      const sistema = e.transcripcion.slice(antes).filter(l => l.r === 's');
      if (sistema.length) e.sistema = sistema.at(-1).t;
    }
    e.resultado = r.resultado ?? e.resultado;
    e.faseDialogo = r.fase ?? e.faseDialogo;
    e.verificado = Boolean(r.verificado);
    const comandos = Array.isArray(r.comandos) ? r.comandos : [];
    const pasar = comandos.find(c => c.tipo === 'transferir');
    if (pasar) terminal = { tipo: 'transferir', a: pasar.a };
    else if (comandos.some(c => c.tipo === 'colgar') || r.estado === 'cerrada') terminal = { tipo: 'colgar' };
    if (comandos.some(c => c.tipo === 'cortar_audio')) { habla++; cola = []; boca.callar(); }
    const textos = comandos.filter(c => c.tipo === 'decir' && String(c.texto ?? '').trim()).map(c => c.texto);
    if (textos.length) { cola.push(...textos); hablarCola(); return; }
    if (terminal) { cumplirFinal(); return; }
    escuchar();
  }

  function hablarCola() {
    const h = ++habla;
    const g = gen;
    const vigente = () => h === habla && g === gen;
    pararTodo();
    e.fase = 'hablando';
    e.persona = '';
    ajustarOido();
    emitir();
    (async () => {
      while (cola.length) {
        const frases = dividirFrases(cola.shift());
        const legibles = frases.map(textoParaSubtitulo);
        for (let i = 0; i < frases.length; i++) {
          if (!vigente()) return;
          e.bot = { frases: legibles, actual: i };
          emitir();
          const r = await boca.hablar(frases[i], voz());
          if (!vigente()) return;
          if (r === 'error') { e.aviso = AVISO_SIN_VOZ; emitir(); }
        }
      }
      if (!vigente()) return;
      if (terminal) cumplirFinal(); else escuchar();
    })();
  }

  /** Espera la respuesta de la línea; si no llega, avisa y vuelve a escuchar. */
  function pensar(pedir) {
    const g = gen;
    pararTodo();
    e.fase = 'pensando';
    e.persona = '';
    ajustarOido();
    emitir();
    intentar(pedir).then((r) => {
      if (g !== gen) return;
      if (!r) throw new Error('sin_respuesta');
      aplicar(r);
    }).catch((err) => {
      if (g !== gen) return;
      sinProvisional();
      if (err?.status === 409 || err?.status === 404) { terminal = { tipo: 'colgar' }; cumplirFinal(); return; }
      e.aviso = AVISO_SIN_RESPUESTA;
      escuchar();
    });
  }

  function alSilencio() {
    t.silencio = null;
    if (e.fase !== 'escuchando') return;
    silencios++;
    e.dijo = '';
    pensar(() => api.silencio(e.llamadaId));
  }

  function enviar() {
    t.envio = null;
    const texto = acumulado.trim();
    acumulado = '';
    if (e.fase !== 'escuchando') return;
    if (!texto) { escuchar(); return; }
    silencios = 0;
    e.dijo = texto; // queda a la vista mientras la línea piensa y contesta
    e.transcripcion.push({ r: 'c', t: texto, provisional: true });
    pensar(() => api.decir(e.llamadaId, texto.slice(0, 300)));
  }

  /** Un murmullo que nunca terminó en frase: se borra y el silencio vuelve a contar. */
  function murmullo() {
    t.parcial = null;
    if (e.fase !== 'escuchando') return;
    if (acumulado) { enviar(); return; }
    e.persona = '';
    armarSilencio();
    emitir();
  }

  /** ¿Se acepta lo que oyó el micrófono? Con audífonos, hablar encima corta al bot. */
  function puedeOir() {
    if (e.microApagado) return false;
    if (e.fase === 'escuchando') return true;
    if (e.fase !== 'hablando' || !e.interrumpir || terminal) return false;
    habla++;
    cola = [];
    boca.callar();
    e.fase = 'escuchando';
    return true;
  }

  oido.alParcial = (texto) => {
    if (!puedeOir()) return;
    e.persona = `${acumulado} ${texto}`.trim();
    e.aviso = null;
    parar('silencio');
    parar('envio');
    parar('parcial');
    t.parcial = relojes.esperar(murmullo, parcialMs);
    emitir();
  };

  oido.alFinal = (texto) => {
    if (!puedeOir()) return;
    acumulado = `${acumulado} ${texto}`.trim();
    e.persona = acumulado;
    e.aviso = null;
    parar('silencio');
    parar('parcial');
    parar('envio');
    t.envio = relojes.esperar(enviar, finFraseMs);
    emitir();
  };

  oido.alError = (codigo) => {
    if (terminada()) return;
    const id = e.llamadaId;
    const colgarEnServidor = id && !terminal; // sin id todavía llama; con terminal, ya colgó el servidor
    cerrar('error', ERROR_DE_OIDO[codigo] ?? 'reconocimiento');
    if (colgarEnServidor) Promise.resolve(api.colgar(id)).catch(() => {});
  };

  function colgarPor(motivo, opciones) {
    if (terminada()) return;
    const id = e.llamadaId;
    const colgarEnServidor = id && !terminal; // sin id todavía llama; con terminal, ya colgó el servidor
    cerrar(motivo);
    if (!colgarEnServidor) return;
    const pedido = opciones ? api.colgar(id, opciones) : api.colgar(id);
    Promise.resolve(pedido).then((r) => {
      if (!r || e.llamadaId !== id || e.fase !== 'terminada') return;
      if (Array.isArray(r.transcripcion)) e.transcripcion = r.transcripcion.map(l => ({ r: l.r, t: l.t }));
      e.resultado = r.resultado ?? e.resultado;
      emitir();
    }).catch(() => {});
  }

  return {
    get estado() { return copia(); },

    iniciar(opciones = {}) {
      if (!terminada()) return;
      gen++;
      const g = gen;
      cola = [];
      terminal = null;
      silencios = 0;
      acumulado = '';
      salio = false;
      pararTodo();
      e = { ...nuevo(e), fase: 'llamando' };
      emitir();
      intentar(() => api.iniciar(opciones)).then((r) => {
        if (g !== gen) {
          // Colgó (o salió) antes de que contestara: se cuelga en cuanto hay llamada.
          if (r?.llamadaId && r.estado !== 'cerrada') Promise.resolve(salio ? api.colgar(r.llamadaId, { salida: true }) : api.colgar(r.llamadaId)).catch(() => {});
          return;
        }
        if (!r?.llamadaId) throw new Error('sin_respuesta');
        e.llamadaId = r.llamadaId;
        e.inicio = relojes.ahora();
        aplicar(r);
      }).catch((err) => {
        if (g !== gen) return;
        cerrar('error', err?.status === 429 ? 'tope' : 'servidor');
      });
    },

    /** Botón Colgar. */
    colgar() { colgarPor('colgaste'); },

    /** Al salir de la pantalla o cerrar la pestaña: cuelga sin esperar respuesta. */
    salir() {
      if (terminada()) return;
      salio = true;
      colgarPor('salida', { salida: true });
    },

    silenciarMicro(apagado) {
      e.microApagado = Boolean(apagado);
      if (e.microApagado) {
        acumulado = '';
        parar('parcial');
        parar('envio');
        e.persona = '';
        // Callado también cuenta como silencio, igual que en una llamada de verdad.
        if (e.fase === 'escuchando' && !t.silencio) armarSilencio();
      }
      ajustarOido();
      emitir();
    },

    ponerInterrumpir(si) {
      e.interrumpir = Boolean(si);
      ajustarOido();
      emitir();
    },
  };
}
