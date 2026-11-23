/* «Llamar con voz» (pantalla Llamadas) contra el mock
   (node tools/mock-panel-server.cjs; QA_BASE_URL si corre en otro puerto).

   El navegador sin cabeza no tiene micrófono ni voces: SpeechRecognition y
   speechSynthesis se reemplazan por dobles (abajo, DOBLES) y el micrófono es
   el falso de Chromium (--use-fake-device-for-media-stream), que sí mueve el
   medidor de Web Audio. El simulador de la línea es el REAL del mock.

   Recorre a 320, 375, 800 y 1280 píxeles: el bot hablando, escuchando con
   subtítulo en vivo, el silencio («¿Sigues ahí?»), la transferencia, volver a
   llamar y colgar, más un navegador sin reconocimiento y el permiso negado.
   A 375 y 1280 además: interrumpir con audífonos, salir de la pantalla en
   plena llamada, dos pestañas a la vez y movimiento reducido. Revisa
   desbordes, textos cortados, botones de menos de 44 px, foco y que el
   micrófono quede libre al terminar.

   Con QA_CAPTURAS=<carpeta> guarda capturas. Inicia muchas simulaciones
   (tope de 60 al día en el mock): reiniciar el mock antes de repetirla. */
const { chromium } = require('playwright');
const path = require('node:path');

const BASE = process.env.QA_BASE_URL || 'http://localhost:4599';
const PANEL = `${BASE}/app/index.html`;
const CAPTURAS = process.env.QA_CAPTURAS || '';
const ANCHOS = (process.env.QA_ANCHOS || '320,375,800,1280').split(',').map(Number);
const fallos = [];
let revisiones = 0;

function revisar(condicion, mensaje, detalle) {
  revisiones++;
  if (condicion) return;
  fallos.push(detalle === undefined ? mensaje : `${mensaje}: ${JSON.stringify(detalle)}`);
  console.log(`  FALLA ${mensaje}${detalle === undefined ? '' : ` ${JSON.stringify(detalle)}`}`);
}

async function captura(page, nombre, opciones = {}) {
  if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, `${nombre}.png`), ...opciones });
}

/* ── Dobles del navegador (corren antes que el panel) ── */
function DOBLES({ soporte, permiso, msPorLetra }) {
  const qa = { reconocedores: [], arranques: 0, habladas: [], canceladas: 0, streams: [] };
  window.__qa = qa;
  if (soporte === 'sin_reconocimiento') {
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true, writable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true, writable: true });
    return;
  }
  class Reconocimiento {
    constructor() { this.activo = false; qa.reconocedores.push(this); qa.rec = this; }
    start() {
      if (this.activo) throw new DOMException('ya escucha', 'InvalidStateError');
      this.activo = true; qa.arranques++;
    }
    stop() { this.fin(); }
    abort() { this.fin(); }
    fin() { if (!this.activo) return; this.activo = false; setTimeout(() => this.onend?.(), 0); }
  }
  Object.defineProperty(window, 'SpeechRecognition', { value: Reconocimiento, configurable: true, writable: true });
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: Reconocimiento, configurable: true, writable: true });
  const resultado = (texto, final) => Object.assign([{ transcript: texto, confidence: 0.9 }], { isFinal: final });
  window.__qaParcial = (texto) => { const r = qa.rec; if (!r?.activo) return false; r.onresult?.({ resultIndex: 0, results: [resultado(texto, false)] }); return true; };
  window.__qaFinal = (texto) => { const r = qa.rec; if (!r?.activo) return false; r.onresult?.({ resultIndex: 0, results: [resultado(texto, true)] }); return true; };
  window.__qaEscuchando = () => Boolean(qa.rec?.activo);

  const V = (name, lang) => ({ name, lang, voiceURI: name, localService: false, default: false });
  const voces = [
    V('Microsoft Aria Online (Natural) - English (United States)', 'en-US'),
    V('Microsoft Helena - Spanish (Spain)', 'es-ES'),
    V('Microsoft Dalia Online (Natural) - Spanish (Mexico)', 'es-MX'),
    V('Microsoft Jorge Online (Natural) - Spanish (Mexico)', 'es-MX'),
    V('Microsoft Salome Online (Natural) - Spanish (Colombia)', 'es-CO'),
    V('Microsoft Gonzalo Online (Natural) - Spanish (Colombia)', 'es-CO'),
  ];
  const oyentes = {};
  const synth = {
    speaking: false, paused: false, pending: false, actual: null, listas: false,
    getVoices() { return this.listas ? voces : []; },
    addEventListener(t, f) { (oyentes[t] ||= new Set()).add(f); },
    removeEventListener(t, f) { oyentes[t]?.delete(f); },
    speak(u) {
      qa.habladas.push({ texto: u.text, voz: u.voice?.name ?? null, lang: u.lang });
      this.actual = u; this.speaking = true;
      u.t1 = setTimeout(() => u.onstart?.({}), 20);
      u.t2 = setTimeout(() => { if (this.actual === u) { this.actual = null; this.speaking = false; } u.onend?.({}); }, Math.min(2600, 250 + u.text.length * msPorLetra));
    },
    cancel() {
      qa.canceladas++;
      const u = this.actual;
      if (!u) return;
      clearTimeout(u.t2); this.actual = null; this.speaking = false;
      u.onerror?.({ error: 'interrupted' });
    },
    pause() {}, resume() {},
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  // Como en Edge: las voces llegan un poco después de cargar la página.
  setTimeout(() => { synth.listas = true; oyentes.voiceschanged?.forEach(f => f()); }, 300);

  const original = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  if (navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia = async (c) => {
      if (permiso === 'negado') throw new DOMException('Permission denied', 'NotAllowedError');
      const s = await original(c);
      qa.streams.push(s);
      return s;
    };
  }
  window.__qaMicrofonoLibre = () => qa.streams.every(s => s.getTracks().every(t => t.readyState === 'ended'));
}

/* ── Medidas dentro de la llamada ── */
const medir = () => {
  const lv = document.querySelector('.lv');
  const tel = document.querySelector('.lv-tel');
  const visibles = (sel) => [...document.querySelectorAll(sel)].filter(el => el.getClientRects().length && !el.closest('[hidden]'));
  const chicos = visibles('.lv button, .lv select')
    .map(b => { const r = b.getBoundingClientRect(); return { t: (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 24), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; })
    .filter(b => b.w < 43.5 || b.h < 43.5);
  const recortados = visibles('.lv *')
    // Fuera los textos solo para lectores de pantalla (1 px, recortados a propósito).
    .filter(el => el.children.length === 0 && el.textContent.trim() && !el.closest('.sr-only') && el.getBoundingClientRect().width > 1)
    .filter(el => { const cs = getComputedStyle(el); return cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && (cs.overflow === 'hidden' || cs.overflowX === 'hidden'); })
    .map(el => el.textContent.trim().slice(0, 30));
  const fuera = visibles('.lv-tel *')
    .filter(el => { const r = el.getBoundingClientRect(); const t = tel.getBoundingClientRect(); return r.width && (r.left < t.left - 1 || r.right > t.right + 1); })
    .map(el => el.className || el.tagName).slice(0, 5);
  return {
    doc: document.documentElement.scrollWidth > innerWidth + 1,
    lv: lv ? lv.scrollWidth > lv.clientWidth + 1 : null,
    chicos, recortados, fuera,
  };
};

async function revisarMedidas(page, etiqueta) {
  const m = await page.evaluate(medir);
  revisar(!m.doc && !m.lv, `${etiqueta}: sin desborde horizontal`, m);
  revisar(m.chicos.length === 0, `${etiqueta}: botones de 44 px o más`, m.chicos);
  revisar(m.recortados.length === 0, `${etiqueta}: sin texto cortado`, m.recortados);
  revisar(m.fuera.length === 0, `${etiqueta}: nada se sale del teléfono`, m.fuera);
}

const fase = (page) => page.evaluate(() => document.querySelector('.lv-tel')?.dataset.fase ?? null);
const esperarFase = (page, f, timeout = 15000) => page.waitForFunction((x) => document.querySelector('.lv-tel')?.dataset.fase === x, f, { timeout });
const esperarOido = (page, timeout = 8000) => page.waitForFunction(() => window.__qaEscuchando(), null, { timeout });

async function nuevaPagina(browser, ancho, opciones = {}) {
  const movil = ancho < 760;
  const contexto = await browser.newContext({
    viewport: { width: ancho, height: opciones.alto ?? (movil ? (ancho <= 320 ? 640 : 812) : 860) },
    hasTouch: movil, isMobile: movil, reducedMotion: opciones.reducedMotion ?? 'no-preference',
  });
  await contexto.grantPermissions(['microphone'], { origin: BASE });
  await contexto.addInitScript(DOBLES, { soporte: opciones.soporte ?? 'ok', permiso: opciones.permiso ?? 'ok', msPorLetra: 22 });
  const page = await contexto.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(e.message));
  page.on('dialog', d => d.dismiss());
  await page.goto(`${PANEL}#llamadas`);
  await page.locator('#simVoz').waitFor();
  await page.locator('#vozEstado .voz-estado').waitFor(); // los Ajustes (voz y nombre) ya llegaron
  return { contexto, page, errores };
}

async function abrir(page) {
  await page.locator('#simVoz').click();
  await page.locator('.lv-fondo.lv-abre').waitFor();
  await page.waitForTimeout(450); // la entrada dura 0,38 s: medir y capturar ya quieta
}

/* ── Recorrido completo a un ancho ── */
async function recorrido(browser, ancho) {
  const { contexto, page, errores } = await nuevaPagina(browser, ancho);
  const p = `${ancho}`;
  try {
    if (CAPTURAS) await page.locator('#vozSimulador').screenshot({ path: path.join(CAPTURAS, `${p}-00-entrada.png`) });
    const boton = await page.locator('#simVoz').boundingBox();
    revisar(boton.height >= 43.5, `${p} botón «Llamar con voz» de 44 px`, boton);

    await abrir(page);
    await esperarFase(page, 'hablando');
    await page.waitForTimeout(700);
    const voz = await page.evaluate(() => ({ opcion: document.querySelector('#lvVoz').selectedOptions[0]?.textContent, usada: window.__qa.habladas[0]?.voz, lang: window.__qa.habladas[0]?.lang, opciones: [...document.querySelector('#lvVoz').options].map(o => o.textContent) }));
    revisar(voz.usada === 'Microsoft Gonzalo Online (Natural) - Spanish (Colombia)', `${p} habla con Gonzalo (la voz de la línea)`, voz);
    revisar(voz.opcion === 'Gonzalo · Colombia · natural', `${p} el selector muestra la voz usada`, voz);
    revisar(!voz.opciones.some(o => /English/i.test(o)) && voz.opciones.length === 5, `${p} solo voces en español`, voz.opciones);
    const primera = await page.evaluate(() => window.__qa.habladas[0].texto);
    revisar(/U T B/.test(primera) && !/Tooli/.test(primera), `${p} se pronuncia con el léxico («U T B», «Túli»)`, primera);
    const sub = await page.locator('.lv-sub-bot .lv-sub-txt').textContent();
    revisar(/UTB/.test(sub) && !/U T B/.test(sub), `${p} el subtítulo se lee «UTB»`, sub);
    revisar(await page.evaluate(() => document.activeElement?.closest('.lv-colgar') !== null), `${p} el foco queda en Colgar`);
    revisar(!(await page.evaluate(() => window.__qaEscuchando())), `${p} sin audífonos no escucha mientras habla el bot`);
    await revisarMedidas(page, `${p} hablando`);
    if (ancho < 760) {
      const colgar = await page.locator('.lv-colgar .lv-btn-circulo').boundingBox();
      revisar(colgar.y + colgar.height <= (ancho <= 320 ? 640 : 812), `${p} Colgar se ve sin desplazar`, colgar);
    }
    await captura(page, `${p}-01-bot-hablando`);

    // Escuchando con subtítulo en vivo.
    await esperarFase(page, 'escuchando', 30000);
    await esperarOido(page);
    revisar(await page.evaluate(() => window.__qaParcial('quiero información de')), `${p} el oído está encendido al terminar el bot`);
    await page.waitForTimeout(150);
    revisar((await page.locator('.lv-sub-persona .lv-sub-txt').textContent()) === 'quiero información de', `${p} subtítulo en vivo de la persona`);
    const nivel = await page.evaluate(() => getComputedStyle(document.querySelector('.lv-tel')).getPropertyValue('--nivel'));
    await captura(page, `${p}-02-escuchando-subtitulo`);
    await page.evaluate(() => window.__qaFinal('quiero información de posgrados'));
    await esperarFase(page, 'pensando', 3000);
    await esperarFase(page, 'hablando', 8000);
    const lineas = await page.locator('.lv-lineas .lv-l').count();
    revisar(lineas >= 3, `${p} la transcripción del servidor se ve`, lineas);
    revisar(Number(nivel) >= 0, `${p} el medidor del micrófono tiene nivel`, nivel);
    await page.waitForTimeout(500);
    await captura(page, `${p}-03-respuesta`);

    // Silencio: a los ~6 s la línea pregunta si sigue ahí.
    await esperarFase(page, 'escuchando', 30000);
    const t0 = Date.now();
    await page.waitForRequest(r => /\/silencio$/.test(r.url()), { timeout: 9000 });
    const espera = Date.now() - t0;
    revisar(espera > 5000 && espera < 7500, `${p} el silencio llega a los ~6 s`, espera);
    await esperarFase(page, 'hablando', 8000);
    await page.waitForTimeout(400);
    const sigues = await page.locator('.lv-sub-bot').textContent();
    revisar(/Sigues ahí/i.test(sigues), `${p} dice «¿Sigues ahí?»`, sigues);
    await captura(page, `${p}-04-silencio`);

    // Transferencia.
    await esperarFase(page, 'escuchando', 15000);
    await esperarOido(page);
    await page.evaluate(() => window.__qaFinal('quiero hablar con un asesor'));
    await esperarFase(page, 'transfiriendo', 15000);
    revisar(/asesor/i.test(await page.locator('.lv-estado-txt').textContent()), `${p} «Pasando con un asesor…»`);
    await captura(page, `${p}-05-transfiriendo`);
    await esperarFase(page, 'terminada', 6000);
    await page.waitForTimeout(400);
    revisar((await page.locator('.lv-fin-titulo').textContent()) === 'Te pasó con un asesor', `${p} termina como transferida`);
    revisar(await page.evaluate(() => window.__qaMicrofonoLibre()), `${p} el micrófono queda libre al terminar`);
    await revisarMedidas(page, `${p} fin`);
    await captura(page, `${p}-06-fin-transferida`);

    // Volver a llamar y colgar a mitad del saludo.
    await page.locator('[data-accion="otra"]').click();
    await esperarFase(page, 'hablando');
    revisar(!(await page.locator('.lv-asesor').isVisible()), `${p} la llamada nueva no arrastra al asesor de la anterior`);
    revisar(await page.evaluate(() => window.__qa.streams.length === 2), `${p} volver a llamar pide el micrófono otra vez`);
    await page.locator('.lv-colgar').click();
    await esperarFase(page, 'terminada', 3000);
    revisar((await page.locator('.lv-fin-titulo').textContent()) === 'Colgaste', `${p} Colgar termina la llamada`);
    revisar(await page.evaluate(() => window.__qa.canceladas > 0), `${p} colgar calla la voz`);
    revisar(await page.evaluate(() => window.__qaMicrofonoLibre()), `${p} colgar suelta el micrófono`);
    await page.waitForTimeout(350);
    await captura(page, `${p}-07-colgaste`);

    if (ancho < 760) {
      await page.locator('.lv-fin [data-accion="cerrar"]').waitFor();
      await page.evaluate(() => document.querySelector('.lv-registro').scrollIntoView());
      await page.waitForTimeout(200);
      await captura(page, `${p}-08-transcripcion`);
      await page.evaluate(() => document.querySelector('.lv').scrollTo(0, 0));
    }

    // Escape con la llamada terminada cierra y el foco vuelve al botón.
    await page.keyboard.press('Escape');
    await page.locator('.lv-fondo').waitFor({ state: 'detached', timeout: 3000 });
    revisar(await page.evaluate(() => document.activeElement?.id === 'simVoz'), `${p} el foco vuelve a «Llamar con voz»`);
    revisar(errores.length === 0, `${p} sin errores de JavaScript`, errores);
  } finally {
    await contexto.close();
  }
}

/* ── Casos que no necesitan todo el recorrido ── */
async function sinSoporte(browser, ancho) {
  const { contexto, page, errores } = await nuevaPagina(browser, ancho, { soporte: 'sin_reconocimiento' });
  try {
    await abrir(page);
    await page.locator('.lv-problema-titulo').waitFor();
    const t = await page.locator('.lv-problema').textContent();
    revisar(/no puede escucharte/.test(t) && /Edge/.test(t) && /Chrome/.test(t), `${ancho} sin soporte: dice qué navegador usar`, t.slice(0, 120));
    await revisarMedidas(page, `${ancho} sin soporte`);
    await captura(page, `${ancho}-09-sin-soporte`);
    await page.locator('[data-accion="escrito"]').click();
    await page.locator('.lv-fondo').waitFor({ state: 'detached', timeout: 3000 });
    revisar(await page.evaluate(() => document.activeElement?.id === 'simIniciar'), `${ancho} sin soporte: lleva al simulador escrito`);
    revisar(errores.length === 0, `${ancho} sin soporte: sin errores`, errores);
  } finally { await contexto.close(); }
}

async function permisoNegado(browser, ancho) {
  const { contexto, page, errores } = await nuevaPagina(browser, ancho, { permiso: 'negado' });
  try {
    await abrir(page);
    await page.locator('.lv-problema-titulo').waitFor();
    const t = await page.locator('.lv-problema').textContent();
    revisar(/permiso/.test(t) && /Permitir/.test(t), `${ancho} permiso negado: explica cómo darlo`, t.slice(0, 140));
    revisar(await page.locator('[data-accion="reintentar"]').isVisible(), `${ancho} permiso negado: se puede reintentar`);
    revisar(await page.evaluate(() => document.activeElement?.classList.contains('lv-problema-titulo')), `${ancho} permiso negado: el foco va al mensaje`);
    const llamadas = await page.evaluate(() => performance.getEntriesByType('resource').filter(r => /\/voz\/simular$/.test(r.name)).length);
    revisar(llamadas === 0, `${ancho} permiso negado: no se abre una llamada en el servidor`, llamadas);
    await revisarMedidas(page, `${ancho} permiso negado`);
    await captura(page, `${ancho}-10-permiso-negado`);
    revisar(errores.length === 0, `${ancho} permiso negado: sin errores`, errores);
  } finally { await contexto.close(); }
}

async function interrumpir(browser, ancho) {
  const { contexto, page } = await nuevaPagina(browser, ancho);
  try {
    await abrir(page);
    await esperarFase(page, 'hablando');
    await page.locator('.lv-audif').click();
    revisar((await page.locator('.lv-audif').getAttribute('aria-checked')) === 'true', `${ancho} audífonos: el interruptor queda encendido`);
    await esperarOido(page, 3000);
    await page.waitForTimeout(300);
    revisar(await page.evaluate(() => document.querySelector('.lv-tel').classList.contains('lv-oye')), `${ancho} audífonos: el medidor se enciende mientras habla el bot`);
    await captura(page, `${ancho}-11-audifonos`);
    const antes = await page.evaluate(() => window.__qa.canceladas);
    await page.evaluate(() => window.__qaParcial('quiero hablar'));
    await page.waitForTimeout(100);
    revisar((await fase(page)) === 'escuchando', `${ancho} audífonos: hablar encima calla al bot`);
    revisar(await page.evaluate((n) => window.__qa.canceladas > n, antes), `${ancho} audífonos: speechSynthesis.cancel()`);
    await page.locator('.lv-mic').click();
    await page.waitForTimeout(250);
    revisar((await page.locator('.lv-mic').getAttribute('aria-pressed')) === 'true' && !(await page.evaluate(() => window.__qaEscuchando())), `${ancho} silenciar apaga el reconocimiento`);
    await captura(page, `${ancho}-12-silenciado`);
    // Escape en plena llamada no cuelga: lleva a Colgar.
    await page.keyboard.press('Escape');
    revisar(await page.locator('.lv-fondo').count() === 1 && await page.evaluate(() => document.activeElement?.classList.contains('lv-colgar')), `${ancho} Escape en llamada lleva a Colgar sin colgar`);
    // Tab no sale del diálogo.
    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
    revisar(await page.evaluate(() => Boolean(document.activeElement?.closest('.lv'))), `${ancho} el foco no sale de la llamada`);
    // Cerrar con la X en plena llamada: cuelga y el foco vuelve al botón de entrada.
    const colgarX = page.waitForRequest(r => /\/colgar$/.test(r.url()), { timeout: 4000 });
    await page.locator('.lv-x').click();
    await colgarX;
    await page.locator('.lv-fondo').waitFor({ state: 'detached', timeout: 3000 });
    await page.waitForTimeout(100);
    revisar(await page.evaluate(() => document.activeElement?.id === 'simVoz'), `${ancho} cerrar en plena llamada devuelve el foco`, await page.evaluate(() => document.activeElement?.id || document.activeElement?.className));
    revisar(await page.evaluate(() => window.__qaMicrofonoLibre()), `${ancho} cerrar en plena llamada suelta el micrófono`);
    // Salir de la pantalla en plena llamada cuelga y suelta el micrófono.
    await abrir(page);
    await esperarFase(page, 'hablando');
    const colgar = page.waitForRequest(r => /\/colgar$/.test(r.url()), { timeout: 4000 });
    await page.evaluate(() => { location.hash = '#home'; });
    await colgar;
    await page.locator('.lv-fondo').waitFor({ state: 'detached', timeout: 3000 });
    revisar(await page.evaluate(() => window.__qaMicrofonoLibre()), `${ancho} salir de la pantalla suelta el micrófono`);
  } finally { await contexto.close(); }
}

async function dosPestanas(browser) {
  const { contexto, page } = await nuevaPagina(browser, 1280);
  try {
    const otra = await contexto.newPage();
    await otra.goto(`${PANEL}#llamadas`);
    await otra.locator('#simVoz').waitFor();
    await otra.locator('#vozEstado .voz-estado').waitFor();
    const idOtra = otra.waitForResponse(r => /\/voz\/simular$/.test(r.url())).then(r => r.json()).then(j => j.llamadaId);
    await abrir(page);
    await abrir(otra);
    await esperarFase(page, 'hablando');
    await esperarFase(otra, 'hablando');
    await page.locator('.lv-colgar').click();
    await esperarFase(page, 'terminada', 3000);
    await otra.waitForTimeout(300);
    const f2 = await fase(otra);
    revisar(f2 === 'hablando' || f2 === 'escuchando', 'dos pestañas: colgar en una no cuelga la otra', f2);
    await esperarFase(otra, 'escuchando', 30000);
    await esperarOido(otra);
    await otra.evaluate(() => window.__qaFinal('quiero información de posgrados'));
    await esperarFase(otra, 'hablando', 8000);
    revisar(await otra.locator('.lv-lineas .lv-l').count() >= 3, 'dos pestañas: la otra sigue su conversación');
    // Cerrar la pestaña en plena llamada: cuelga con keepalive (se mira en el servidor).
    const id = await idOtra;
    await otra.close({ runBeforeUnload: true });
    let resultado = 'en_curso';
    for (let i = 0; i < 20 && resultado === 'en_curso'; i++) {
      await page.waitForTimeout(200);
      resultado = (await page.evaluate(async (x) => (await (await fetch(`/api/tools/voz/llamadas/${x}`)).json()).llamada?.resultado, id));
    }
    revisar(resultado && resultado !== 'en_curso', 'cerrar la pestaña cuelga la llamada en el servidor', resultado);
  } finally { await contexto.close(); }
}

async function movimientoReducido(browser, ancho) {
  const { contexto, page, errores } = await nuevaPagina(browser, ancho, { reducedMotion: 'reduce' });
  try {
    await abrir(page);
    await esperarFase(page, 'hablando');
    const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.lv-onda')).animationName);
    revisar(anim === 'none', `${ancho} movimiento reducido: sin ondas animadas`, anim);
    await captura(page, `${ancho}-13-movimiento-reducido`);
    await page.locator('.lv-colgar').click();
    revisar(errores.length === 0, `${ancho} movimiento reducido: sin errores`, errores);
  } finally { await contexto.close(); }
}

/* Proyector o portátil bajo: la llamada cabe entera, sin desplazar el teléfono. */
async function pantallaBaja(browser, ancho, alto) {
  const { contexto, page } = await nuevaPagina(browser, ancho, { alto });
  try {
    await abrir(page);
    await esperarFase(page, 'hablando');
    const m = await page.evaluate(() => { const t = document.querySelector('.lv-tel'); return { scroll: t.scrollHeight - t.clientHeight }; });
    revisar(m.scroll <= 1, `${ancho}×${alto}: el teléfono cabe sin desplazar`, m);
    await captura(page, `${ancho}x${alto}-14-pantalla-baja`);
    await page.locator('.lv-colgar').click();
  } finally { await contexto.close(); }
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.QA_BROWSER_EXECUTABLE || undefined,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    // La transferencia necesita asesores «en horario» a cualquier hora de la prueba.
    const r = await fetch(`${BASE}/api/tools/voz/ajustes`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ horarioAsesores: [{ dias: [0, 1, 2, 3, 4, 5, 6], desde: '00:00', hasta: '23:59' }] }) });
    if (!r.ok) throw new Error(`no se pudo ajustar el horario del mock (${r.status})`);
    for (const ancho of ANCHOS) {
      console.log(`— ${ancho} px`);
      await recorrido(browser, ancho);
      await sinSoporte(browser, ancho);
      await permisoNegado(browser, ancho);
      if (ancho === 375 || ancho === 1280) {
        await interrumpir(browser, ancho);
        await movimientoReducido(browser, ancho);
      }
    }
    console.log('— pantallas bajas');
    await pantallaBaja(browser, 1280, 720);
    await pantallaBaja(browser, 1366, 768);
    console.log('— dos pestañas');
    await dosPestanas(browser);
  } finally {
    await browser.close();
  }
  console.log(`\n${revisiones - fallos.length}/${revisiones} revisiones bien`);
  if (fallos.length) { console.log(fallos.join('\n')); process.exitCode = 1; }
})().catch((e) => { console.error(e); process.exitCode = 1; });
