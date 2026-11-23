import { api } from '../core/api.js';
import { escapeHtml } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { resultadoLlamada } from '../core/llamadas.js';
import {
  cargarVoces, crearBoca, crearLlamadaVoz, crearOido, duracionLlamada, elegirVoz, errorDeMicrofono, etiquetaVoz, soporteVoz, vocesEnEspanol,
} from '../core/llamada-voz.js';

/* ============= LLAMAR CON VOZ (pantalla Llamadas) =============
   Interfaz de llamada tipo teléfono sobre el MISMO simulador de la línea:
   el navegador escucha (SpeechRecognition) y habla (speechSynthesis); los
   turnos, el silencio y los comandos viven en core/llamada-voz.js.
   Cada pestaña abre su propia llamada: nada se comparte entre pestañas. */

const relojes = { ahora: () => Date.now(), esperar: (fn, ms) => setTimeout(fn, ms), cancelar: (id) => clearTimeout(id) };

/* La voz que eligió la persona en la lista. Vive en esta pestaña y se pierde al
   recargar: a propósito no va a localStorage, que comparten todas las pestañas. */
let vozElegida = null;
let abierta = null;

async function pedirVoz(ruta, opciones = {}) {
  const r = await api(ruta, { method: 'POST', ...opciones });
  if (!r) throw Object.assign(new Error('sesion'), { status: 401 });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || 'error'), { status: r.status });
  return data;
}

const apiVoz = {
  iniciar: (o) => pedirVoz('/api/tools/voz/simular', { body: JSON.stringify({ desdeNumeroDelEstudiante: Boolean(o?.desdeNumeroDelEstudiante) }) }),
  decir: (id, texto) => pedirVoz(`/api/tools/voz/simular/${encodeURIComponent(id)}/decir`, { body: JSON.stringify({ texto }) }),
  silencio: (id) => pedirVoz(`/api/tools/voz/simular/${encodeURIComponent(id)}/silencio`),
  // Al cerrar la pestaña la petición tiene que sobrevivir a la página: keepalive.
  colgar: (id, o) => pedirVoz(`/api/tools/voz/simular/${encodeURIComponent(id)}/colgar`, o?.salida ? { keepalive: true } : {}),
};

/* Qué pasó y qué hacer, en palabras de quien usa el panel. */
const PASOS_PERMISO = [
  'Toca el candado (o el ícono de ajustes) a la izquierda de la dirección del panel.',
  'En <strong>Micrófono</strong>, elige <strong>Permitir</strong>.',
  'Vuelve aquí y toca <strong>Intentar de nuevo</strong>.',
];
const PROBLEMAS = {
  sin_reconocimiento: {
    titulo: 'Este navegador no puede escucharte',
    texto: 'La llamada con voz usa el reconocimiento de voz de <strong>Microsoft Edge</strong> o <strong>Google Chrome</strong>. Abre el panel en Edge (tiene la voz de Gonzalo, la misma de la línea) o en Chrome, en el computador o en un Android.',
  },
  sin_sintesis: {
    titulo: 'Este navegador no puede hablar',
    texto: 'Falta la voz del navegador. Abre el panel en <strong>Microsoft Edge</strong> o <strong>Google Chrome</strong>.',
  },
  inseguro: {
    titulo: 'Hace falta una conexión segura',
    texto: 'El navegador solo presta el micrófono en páginas con <strong>https</strong>. Abre el panel con su dirección https.',
  },
  sin_microfono: {
    titulo: 'No encontramos un micrófono',
    texto: 'Conecta un micrófono o unos audífonos con micrófono y vuelve a intentarlo. En Windows, revisa <strong>Configuración → Sistema → Sonido → Entrada</strong>.',
    reintentar: true,
  },
  microfono_ocupado: {
    titulo: 'Otro programa está usando el micrófono',
    texto: 'Cierra Teams, Zoom u otra llamada que lo tenga abierto y vuelve a intentarlo.',
    reintentar: true,
  },
  microfono: { titulo: 'No se pudo abrir el micrófono', texto: 'Revisa que esté conectado y vuelve a intentarlo.', reintentar: true },
  permiso: {
    titulo: 'El panel no tiene permiso para el micrófono',
    texto: 'Para hablar con Tooli, el navegador tiene que dejar que el panel use el micrófono:',
    pasos: PASOS_PERMISO,
    nota: 'Si el navegador ya lo permite, revisa en Windows <strong>Configuración → Privacidad y seguridad → Micrófono</strong>.',
    reintentar: true,
  },
  servicio_voz: {
    titulo: 'El reconocimiento de voz está apagado',
    texto: 'El navegador no deja usar el dictado aquí (pasa en ventanas privadas o con políticas de la universidad). Prueba en una ventana normal de Edge o Chrome.',
    reintentar: true,
  },
  red: {
    titulo: 'El reconocimiento de voz necesita internet',
    texto: 'Edge y Chrome pasan tu voz a texto en sus servidores. Revisa la conexión y vuelve a intentarlo.',
    reintentar: true,
  },
  reconocimiento: { titulo: 'El navegador dejó de escuchar', texto: 'Vuelve a intentarlo. Si pasa seguido, usa el simulador escrito.', reintentar: true },
  tope: { titulo: 'Se alcanzó el tope de simulaciones de hoy', texto: 'Un administrador puede subirlo en <strong>Llamadas → Ajustes → Tope de simulaciones por día</strong>.' },
  servidor: { titulo: 'La línea no contestó', texto: 'El simulador no respondió. Espera un momento y vuelve a intentarlo.', reintentar: true },
};

const ESTADOS = {
  preparando: 'Abriendo el micrófono…',
  llamando: 'Llamando…',
  pensando: 'Pensando…',
  transfiriendo: 'Pasando con un asesor…',
  terminada: 'Llamada terminada',
};

/* La figura de Tooli (la misma del ícono del panel), para el avatar. */
const TOOLI_SVG = `
  <svg class="lv-tooli" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path d="M21 48H29L21 55V48Z" fill="#fff"/>
    <rect x="10" y="17" width="44" height="32" rx="11" fill="#fff"/>
    <g class="lv-ojos"><circle cx="24" cy="33" r="4" fill="#003087"/><circle cx="40" cy="33" r="4" fill="#003087"/></g>
    <path d="M32 17V10" stroke="#5eead4" stroke-width="3" stroke-linecap="round"/>
    <circle class="lv-antena" cx="32" cy="8" r="3" fill="#5eead4"/>
  </svg>`;

/* Medidor del micrófono con Web Audio: barato (un AnalyserNode y un
   requestAnimationFrame) y solo mientras la llamada está a la vista. */
function crearMedidor(stream, destino) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return { encender() {}, apagar() {}, cerrar() {} };
  const ctx = new Ctx();
  const analizador = ctx.createAnalyser();
  analizador.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analizador);
  const datos = new Uint8Array(analizador.fftSize);
  let cuadro = 0;
  let nivel = 0;
  const paso = () => {
    cuadro = requestAnimationFrame(paso);
    analizador.getByteTimeDomainData(datos);
    let suma = 0;
    for (let i = 0; i < datos.length; i++) { const v = (datos[i] - 128) / 128; suma += v * v; }
    const objetivo = Math.min(1, Math.sqrt(suma / datos.length) * 5);
    nivel = objetivo > nivel ? objetivo : nivel * 0.86 + objetivo * 0.14; // sube rápido, baja suave
    destino.style.setProperty('--nivel', nivel.toFixed(3));
  };
  const apagar = () => {
    cancelAnimationFrame(cuadro);
    cuadro = 0;
    nivel = 0;
    destino.style.setProperty('--nivel', '0');
  };
  return {
    encender() {
      if (cuadro) return;
      ctx.resume?.().catch?.(() => {});
      cuadro = requestAnimationFrame(paso);
    },
    apagar,
    cerrar() { apagar(); ctx.close?.().catch?.(() => {}); },
  };
}

function lineasHtml(lineas, nombre) {
  if (!lineas.length) return '<li class="lv-vacio">La conversación aparece aquí mientras hablas.</li>';
  return lineas.map((l) => {
    const quien = l.r === 'c' ? 'Tú' : l.r === 's' ? 'Sistema' : nombre;
    return `<li class="lv-l lv-l-${escapeHtml(l.r)}${l.provisional ? ' lv-l-prov' : ''}"><strong>${escapeHtml(quien)}</strong><span>${escapeHtml(l.t)}</span></li>`;
  }).join('');
}

function problemaHtml(clave) {
  const p = PROBLEMAS[clave] ?? PROBLEMAS.servidor;
  return `
    <div class="lv-problema-icono" aria-hidden="true">${icon(clave === 'permiso' || clave === 'inseguro' ? 'lock' : clave === 'sin_reconocimiento' || clave === 'sin_sintesis' ? 'headset' : 'micOff', 30)}</div>
    <h3 class="lv-problema-titulo" id="lvProblemaTitulo" tabindex="-1">${p.titulo}</h3>
    <p>${p.texto}</p>
    ${p.pasos ? `<ol class="lv-pasos">${p.pasos.map(x => `<li>${x}</li>`).join('')}</ol>` : ''}
    ${p.nota ? `<p class="lv-nota-problema">${p.nota}</p>` : ''}
    <div class="lv-problema-botones">
      ${p.reintentar ? '<button type="button" class="lv-accion lv-accion-primaria" data-accion="reintentar">Intentar de nuevo</button>' : ''}
      <button type="button" class="lv-accion" data-accion="escrito">Usar el simulador escrito</button>
    </div>`;
}

/**
 * Abre la llamada. `vozConfigurada` y `nombreAgente` salen de los Ajustes de
 * la línea; `alCerrar(huboLlamada)` refresca el registro; `alUsarEscrito`
 * lleva al simulador escrito.
 */
export function abrirLlamadaVoz({ desdeNumeroDelEstudiante = false, vozConfigurada = 'Azure.es-CO-GonzaloNeural', nombreAgente = 'Tooli', alCerrar, alUsarEscrito } = {}) {
  if (abierta) { abierta.enfocar(); return abierta; }
  const nombre = String(nombreAgente || 'Tooli').slice(0, 30);
  const soporte = soporteVoz(window);
  const focoPrevio = document.activeElement;

  const fondo = document.createElement('div');
  fondo.className = 'lv-fondo';
  fondo.innerHTML = `
    <section class="lv" role="dialog" aria-modal="true" aria-labelledby="lvNombre" aria-describedby="lvAyuda">
      <div class="lv-tel" data-fase="preparando">
        <div class="lv-brillo" aria-hidden="true"></div>
        <header class="lv-cab">
          <span class="lv-chip">${icon('bot', 14)} Simulador · datos de ejemplo</span>
          <button type="button" class="lv-x" data-accion="cerrar" aria-label="Colgar y cerrar">${icon('x', 20)}</button>
        </header>
        <p class="sr-only" id="lvAyuda">Llamada de prueba con voz a la línea de posgrados. Habla después de que ${escapeHtml(nombre)} termine; el botón Colgar termina la llamada.</p>
        <div class="lv-quien">
          <div class="lv-avatares">
            <div class="lv-avatar">
              <span class="lv-onda" aria-hidden="true"></span><span class="lv-onda" aria-hidden="true"></span><span class="lv-onda" aria-hidden="true"></span>
              <span class="lv-oido" aria-hidden="true"></span>
              ${TOOLI_SVG}
            </div>
            <span class="lv-enlace" aria-hidden="true"></span>
            <div class="lv-asesor" aria-hidden="true">${icon('headset', 34)}</div>
          </div>
          <h2 class="lv-nombre" id="lvNombre">${escapeHtml(nombre)}</h2>
          <p class="lv-linea">Posgrados UTB · línea de voz</p>
          <p class="lv-estado" role="status"><span class="lv-punto" aria-hidden="true"></span><span class="lv-estado-txt">${ESTADOS.preparando}</span><span class="lv-crono" aria-label="Duración">0:00</span></p>
        </div>
        <div class="lv-cuerpo">
          <div class="lv-subs">
            <p class="lv-sub lv-sub-bot"><span class="lv-dice" aria-hidden="true">${escapeHtml(nombre)}</span><span class="lv-sub-txt" aria-live="polite" aria-atomic="true"></span></p>
            <p class="lv-sub lv-sub-persona"><span class="lv-dice" aria-hidden="true">Tú</span><span class="lv-sub-txt"></span></p>
            <p class="lv-sistema" hidden>${icon('lock', 15)}<span></span></p>
            <p class="lv-aviso" role="alert"></p>
          </div>
          <div class="lv-nivel" aria-hidden="true">${Array.from({ length: 11 }, (_, i) => `<i style="--k:${(1 - Math.abs(i - 5) / 6.5).toFixed(2)}"></i>`).join('')}</div>
          <div class="lv-controles">
            <button type="button" class="lv-btn lv-mic" aria-pressed="false" data-accion="micro"><span class="lv-btn-circulo">${icon('mic', 26)}</span><span class="lv-btn-txt">Silenciar</span></button>
            <button type="button" class="lv-btn lv-colgar" data-accion="colgar"><span class="lv-btn-circulo">${icon('handset', 30)}</span><span class="lv-btn-txt">Colgar</span></button>
            <button type="button" class="lv-btn lv-audif" role="switch" aria-checked="false" data-accion="interrumpir"><span class="lv-btn-circulo">${icon('headphones', 26)}</span><span class="lv-btn-txt">Puedo interrumpir<small>uso audífonos</small></span></button>
          </div>
          <div class="lv-opciones">
            <label for="lvVoz">${icon('volume', 16)} <span class="lv-txt-corto">Voz</span></label>
            <select id="lvVoz"><option>Cargando voces…</option></select>
            <button type="button" class="lv-ver-texto" data-accion="ver-texto" aria-label="Ver la transcripción">${icon('captions', 18)} <span class="lv-txt-corto" aria-hidden="true">Transcripción</span></button>
          </div>
          <p class="lv-voz-nota" hidden></p>
        </div>
        <div class="lv-fin" hidden>
          <div class="lv-fin-icono" aria-hidden="true">${icon('handset', 30)}</div>
          <h3 class="lv-fin-titulo" tabindex="-1"></h3>
          <p class="lv-fin-detalle"></p>
          <p class="lv-fin-nota" hidden></p>
          <div class="lv-fin-botones">
            <button type="button" class="lv-accion lv-accion-primaria" data-accion="otra">${icon('handset', 18)} Volver a llamar</button>
            <button type="button" class="lv-accion" data-accion="cerrar">Cerrar</button>
          </div>
        </div>
        <div class="lv-problema" hidden></div>
      </div>
      <aside class="lv-registro" aria-labelledby="lvRegistroTitulo">
        <div class="lv-registro-cab">
          <h3 id="lvRegistroTitulo">${icon('captions', 18)} Transcripción</h3>
          <p>La que guarda la línea, con los datos tapados.</p>
        </div>
        <ol class="lv-lineas"><li class="lv-vacio">La conversación aparece aquí mientras hablas.</li></ol>
      </aside>
    </section>`;
  document.body.appendChild(fondo);
  document.documentElement.classList.add('lv-abierta');

  const $ = (sel) => fondo.querySelector(sel);
  const dialogo = $('.lv');
  const tel = $('.lv-tel');
  const select = $('#lvVoz');
  const lineasBox = $('.lv-lineas');
  let estado = null;
  let cerrada = false;
  let huboLlamada = false;
  let stream = null;
  let medidor = null;
  let voces = [];
  let cronometro = 0;
  let pintado = { lineas: '', fase: '', bot: '', persona: '' };

  /* ── Voz del bot ── */
  const vozActual = () => elegirVoz(voces, vozConfigurada, vozElegida);
  function pintarVoces() {
    const lista = vocesEnEspanol(voces, vozConfigurada);
    const { voz, motivo } = vozActual();
    select.innerHTML = lista.length
      ? lista.map(v => `<option value="${escapeHtml(v.voiceURI)}" ${v === voz ? 'selected' : ''}>${escapeHtml(etiquetaVoz(v))}</option>`).join('')
      : '<option value="">Voz del sistema</option>';
    select.disabled = lista.length < 2;
    const nota = $('.lv-voz-nota');
    const configurada = (/-(\w+?)Neural$/.exec(vozConfigurada)?.[1] ?? '').replace('Salome', 'Salomé');
    let texto = '';
    if (!lista.length) texto = 'Este navegador no tiene voces en español: hablará con la voz del sistema.';
    else if (motivo !== 'configurada' && motivo !== 'elegida' && configurada) texto = `La voz de la línea (${configurada}) no está en este navegador. En Microsoft Edge suena igual que la línea real.`;
    nota.textContent = texto;
    nota.hidden = !texto;
  }
  select.addEventListener('change', () => {
    vozElegida = select.value || null;
    pintarVoces();
  });
  const alCambiarVoces = () => { voces = window.speechSynthesis?.getVoices?.() ?? []; pintarVoces(); };

  /* ── Llamada ── */
  const Reconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition;
  const oido = soporte.ok ? crearOido({ Reconocimiento, relojes }) : null;
  const boca = soporte.ok ? crearBoca({ synth: window.speechSynthesis, Utterance: window.SpeechSynthesisUtterance, relojes }) : null;
  const llamada = soporte.ok ? crearLlamadaVoz({ api: apiVoz, boca, oido, relojes, voz: () => vozActual().voz, alCambiar: (e) => pintar(e) }) : null;

  function soltarMicrofono() {
    medidor?.cerrar();
    medidor = null;
    stream?.getTracks().forEach(t => t.stop());
    stream = null;
  }

  function mostrarProblema(clave) {
    soltarMicrofono();
    const caja = $('.lv-problema');
    caja.innerHTML = problemaHtml(clave);
    caja.hidden = false;
    $('.lv-cuerpo').hidden = true;
    $('.lv-fin').hidden = true;
    tel.dataset.fase = 'problema';
    tel.dataset.problema = clave;
    // Sin conversación no hace falta la columna de la transcripción.
    dialogo.classList.toggle('lv-solo', !estado?.transcripcion?.length);
    $('.lv-estado-txt').textContent = PROBLEMAS[clave]?.titulo ?? 'No se pudo llamar';
    requestAnimationFrame(() => caja.querySelector('.lv-problema-titulo')?.focus({ preventScroll: true }));
  }

  async function empezar() {
    if (!soporte.ok) { mostrarProblema(soporte.motivo); return; }
    $('.lv-problema').hidden = true;
    $('.lv-fin').hidden = true;
    $('.lv-cuerpo').hidden = false;
    dialogo.classList.remove('lv-solo');
    tel.dataset.fase = 'preparando';
    delete tel.dataset.problema;
    $('.lv-estado-txt').textContent = ESTADOS.preparando;
    $('.lv-crono').textContent = '0:00';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      if (!cerrada) mostrarProblema(errorDeMicrofono(err));
      return;
    }
    if (cerrada) { soltarMicrofono(); return; }
    medidor = crearMedidor(stream, tel);
    huboLlamada = true;
    llamada.iniciar({ desdeNumeroDelEstudiante });
    requestAnimationFrame(() => $('.lv-colgar')?.focus({ preventScroll: true }));
  }

  function textoEstado(e) {
    if (e.fase === 'hablando') return `${nombre} habla`;
    if (e.fase === 'escuchando') return e.microApagado ? 'Micrófono silenciado' : 'Te escucho';
    return ESTADOS[e.fase] ?? '';
  }

  function pintarFin(e) {
    const fin = $('.lv-fin');
    const transferida = e.motivoFin === 'transferida';
    $('.lv-fin-titulo').textContent = transferida ? 'Te pasó con un asesor' : e.motivoFin === 'colgaste' ? 'Colgaste' : `${nombre} colgó`;
    const resultado = e.resultado && e.resultado !== 'en_curso' ? resultadoLlamada(e.resultado).label : '';
    // La duración ya va en la píldora de estado («Llamada terminada · 0:24»).
    $('.lv-fin-detalle').textContent = resultado;
    $('.lv-fin-detalle').hidden = !resultado;
    const nota = $('.lv-fin-nota');
    nota.hidden = !transferida;
    nota.textContent = transferida
      ? `En la línea real ahora sonaría el celular de los asesores${e.transferirA ? ` (${e.transferirA.replace(/^\+?57(\d{3})(\d{3})(\d{4})$/, '+57 $1 $2 $3')})` : ''}. El simulador no llama a nadie.`
      : '';
    tel.dataset.motivo = e.motivoFin ?? '';
    if (fin.hidden) {
      fin.hidden = false;
      $('.lv-cuerpo').hidden = true;
      requestAnimationFrame(() => $('.lv-fin-titulo')?.focus({ preventScroll: true }));
    }
  }

  function pintar(e) {
    if (cerrada) return;
    estado = e;
    if (pintado.fase !== e.fase) {
      tel.dataset.fase = e.fase;
      pintado.fase = e.fase;
    }
    tel.classList.toggle('lv-micro-apagado', e.microApagado);
    // El medidor se enciende solo cuando la línea de verdad te está oyendo.
    tel.classList.toggle('lv-oye', !e.microApagado && (e.fase === 'escuchando' || (e.fase === 'hablando' && e.interrumpir)));
    $('.lv-estado-txt').textContent = textoEstado(e);
    $('.lv-crono').textContent = duracionLlamada(e, Date.now());

    // Subtítulo del bot, como unos subtítulos en vivo: la frase anterior
    // apagada y, resaltada, la que suena. Todo el turno queda en la transcripción.
    const { frases, actual } = e.bot;
    const desde = Math.max(0, actual - 1);
    const bot = frases.slice(desde, actual + 1).map((f, i) => `<span class="${desde + i === actual && e.fase === 'hablando' ? 'lv-ahora' : 'lv-dicha'}">${escapeHtml(f)}</span>`).join(' ');
    if (bot !== pintado.bot) { $('.lv-sub-bot .lv-sub-txt').innerHTML = bot; pintado.bot = bot; }
    $('.lv-sub-bot').classList.toggle('lv-sub-vacio', !frases.length);

    const dicho = e.persona || (['pensando', 'hablando'].includes(e.fase) ? e.dijo : '');
    const persona = dicho || (e.fase === 'escuchando' && !e.microApagado ? 'Habla cuando quieras…' : '');
    if (persona !== pintado.persona) {
      $('.lv-sub-persona .lv-sub-txt').textContent = persona;
      pintado.persona = persona;
    }
    $('.lv-sub-persona').classList.toggle('lv-sub-espera', !dicho);
    $('.lv-sub-persona').classList.toggle('lv-sub-vacio', !persona);

    const sistema = $('.lv-sistema');
    sistema.hidden = !e.sistema;
    sistema.querySelector('span').textContent = e.sistema ?? '';
    $('.lv-aviso').textContent = e.aviso ?? '';

    const mic = $('.lv-mic');
    mic.setAttribute('aria-pressed', String(e.microApagado));
    mic.querySelector('.lv-btn-circulo').innerHTML = icon(e.microApagado ? 'micOff' : 'mic', 26);
    mic.querySelector('.lv-btn-txt').textContent = e.microApagado ? 'Activar micrófono' : 'Silenciar';
    mic.title = e.microApagado ? '' : 'Silenciado, la línea lo toma como silencio, como en una llamada real';
    $('.lv-audif').setAttribute('aria-checked', String(e.interrumpir));

    // La transcripción: la del servidor (datos tapados) más lo recién dicho.
    const lineas = lineasHtml(e.transcripcion, nombre);
    if (lineas !== pintado.lineas) {
      const abajo = lineasBox.scrollHeight - lineasBox.scrollTop - lineasBox.clientHeight < 60;
      lineasBox.innerHTML = lineas;
      pintado.lineas = lineas;
      if (abajo) lineasBox.scrollTop = lineasBox.scrollHeight;
    }

    const activa = !['lista', 'terminada'].includes(e.fase);
    if (activa && !e.microApagado && document.visibilityState === 'visible') medidor?.encender(); else medidor?.apagar();
    if (activa && !cronometro) cronometro = setInterval(() => { if (estado) $('.lv-crono').textContent = duracionLlamada(estado, Date.now()); }, 1000);
    if (!activa && cronometro) { clearInterval(cronometro); cronometro = 0; }

    if (e.fase === 'terminada') {
      soltarMicrofono();
      if (e.error) mostrarProblema(e.error); else pintarFin(e);
    }
  }

  /* ── Salir ── */
  function cerrar() {
    if (cerrada) return;
    llamada?.colgar();
    cerrada = true;
    clearInterval(cronometro);
    soltarMicrofono();
    oido?.apagar();
    boca?.callar();
    document.removeEventListener('keydown', alTeclear, true);
    document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    window.removeEventListener('hashchange', alSalirDePantalla);
    window.removeEventListener('pagehide', alCerrarPestana);
    window.speechSynthesis?.removeEventListener?.('voiceschanged', alCambiarVoces);
    document.documentElement.classList.remove('lv-abierta');
    abierta = null;
    fondo.classList.add('lv-saliendo');
    const quitar = () => fondo.remove();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) quitar(); else setTimeout(quitar, 220);
    if (focoPrevio?.isConnected) focoPrevio.focus({ preventScroll: true });
    alCerrar?.(huboLlamada);
  }
  const alSalirDePantalla = () => cerrar();
  // Cerrar la pestaña o recargar: colgar sin esperar (keepalive) y soltar el micrófono.
  const alCerrarPestana = () => { llamada?.salir(); soltarMicrofono(); };
  const alCambiarVisibilidad = () => { if (estado) pintar(estado); };

  const activa = () => estado && !['lista', 'terminada'].includes(estado.fase);
  function alTeclear(ev) {
    // Los atajos del panel («g», «/», «?») no corren encima de una llamada: navegar la colgaría.
    ev.stopPropagation();
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      // En plena llamada, Escape no cuelga por sorpresa: lleva al botón Colgar.
      if (activa()) $('.lv-colgar').focus(); else cerrar();
      return;
    }
    if (ev.key !== 'Tab') return;
    const focos = Array.from(dialogo.querySelectorAll('button, select, [tabindex="0"]'))
      .filter(el => !el.disabled && el.getClientRects().length && !el.closest('[hidden]'));
    if (!focos.length) return;
    const primero = focos[0];
    const ultimo = focos[focos.length - 1];
    const fuera = !dialogo.contains(document.activeElement);
    if (ev.shiftKey && (document.activeElement === primero || fuera)) { ev.preventDefault(); ultimo.focus(); }
    else if (!ev.shiftKey && (document.activeElement === ultimo || fuera)) { ev.preventDefault(); primero.focus(); }
  }

  fondo.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-accion]');
    if (!b) return;
    const accion = b.dataset.accion;
    if (accion === 'colgar') llamada?.colgar();
    else if (accion === 'cerrar') cerrar();
    else if (accion === 'micro' && estado) llamada.silenciarMicro(!estado.microApagado);
    else if (accion === 'interrumpir' && llamada) llamada.ponerInterrumpir(!(estado?.interrumpir));
    else if (accion === 'otra' || accion === 'reintentar') { pintado = { lineas: '', fase: '', bot: '', persona: '' }; empezar(); }
    else if (accion === 'escrito') { cerrar(); alUsarEscrito?.(); }
    else if (accion === 'ver-texto') $('.lv-registro').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  });

  document.addEventListener('keydown', alTeclear, true);
  document.addEventListener('visibilitychange', alCambiarVisibilidad);
  window.addEventListener('hashchange', alSalirDePantalla);
  window.addEventListener('pagehide', alCerrarPestana);
  requestAnimationFrame(() => fondo.classList.add('lv-abre'));

  if (soporte.ok) {
    window.speechSynthesis.addEventListener?.('voiceschanged', alCambiarVoces);
    cargarVoces(window.speechSynthesis, relojes).then((v) => { if (!cerrada) { voces = v; pintarVoces(); } });
  }
  empezar();

  abierta = {
    enfocar: () => ($('.lv-colgar:not([hidden])') ?? $('.lv-x')).focus(),
    cerrar,
  };
  return abierta;
}
