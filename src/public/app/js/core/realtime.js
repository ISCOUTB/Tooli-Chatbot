import { api } from './api.js';
import { $$, toast } from './dom.js';

/* ============= EN VIVO =============
   Una conexión por pestaña (Server-Sent Events) trae cada cambio en las
   conversaciones con asesor: la pantalla Atención se pone al día sola, el menú
   muestra cuántas esperan y, si llega un mensaje mientras el asesor está en
   otra pantalla u otra pestaña, suena un tono y aparece un aviso del sistema.
   EventSource se reconecta solo; si el servidor no tiene la bandeja
   configurada, todo esto queda apagado sin molestar. */

const PREFS_KEY = 'tooli.avisos';
const RETRASO_RESUMEN_MS = 1200;

let fuente = null;
let estado = 'apagado';      // apagado | conectado | reconectando
let deshabilitado = false;
let tituloBase = '';
let resumenTimer = null;
let visibleId = null;        // conversación que el asesor tiene abierta en pantalla
let audio = null;

function preferenciasAvisos() {
  const base = { sonido: true, escritorio: true };
  try { return { ...base, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return base; }
}

function cambiarPreferencias(cambios) {
  const prefs = { ...preferenciasAvisos(), ...cambios };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* sin almacenamiento, vale solo esta sesión */ }
  return prefs;
}

/** 'granted' | 'denied' | 'default' | 'no-soportado' */
function permisoAvisos() {
  return typeof Notification === 'undefined' ? 'no-soportado' : Notification.permission;
}

async function pedirPermisoAvisos() {
  if (permisoAvisos() !== 'default') return permisoAvisos();
  try { return await Notification.requestPermission(); } catch { return permisoAvisos(); }
}

function estadoConexion() {
  return estado;
}

function marcarConversacionVisible(id) {
  visibleId = id;
}

function cambiarEstado(nuevo) {
  if (nuevo === estado) return;
  estado = nuevo;
  window.dispatchEvent(new CustomEvent('tooli:conexion', { detail: estado }));
}

/* Los navegadores no dejan sonar audio hasta el primer toque del usuario: el
   contexto se crea ahí y queda listo para los avisos siguientes. */
function desbloquearAudio() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { /* sin audio, los avisos siguen siendo visuales */ }
}

function tono() {
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  [880, 1175].forEach((frecuencia, i) => {
    const osc = audio.createOscillator();
    const vol = audio.createGain();
    const inicio = t + i * 0.13;
    osc.type = 'sine';
    osc.frequency.value = frecuencia;
    vol.gain.setValueAtTime(0.0001, inicio);
    vol.gain.exponentialRampToValueAtTime(0.12, inicio + 0.02);
    vol.gain.exponentialRampToValueAtTime(0.0001, inicio + 0.18);
    osc.connect(vol).connect(audio.destination);
    osc.start(inicio);
    osc.stop(inicio + 0.2);
  });
}

/** Lleva a la conversación desde un aviso, esté o no en la pantalla Atención. */
function abrirEnAtencion(id) {
  try { sessionStorage.setItem('atencion.abrir', String(id)); } catch { /* sin almacenamiento solo se abre la bandeja */ }
  if (location.hash === '#atencion') window.dispatchEvent(new CustomEvent('tooli:abrir-atencion', { detail: id }));
  else location.hash = 'atencion';
}

function avisar(evento) {
  const prefs = preferenciasAvisos();
  const pestanaVisible = document.visibilityState === 'visible';
  const yaLaEstaViendo = pestanaVisible && location.hash === '#atencion' && visibleId === evento.conversacionId;
  if (yaLaEstaViendo) return;
  if (prefs.sonido) tono();
  const titulo = evento.tipo === 'nueva' ? 'Alguien espera a un asesor' : `Mensaje de ${evento.nombre || 'una persona'}`;
  if (!pestanaVisible && prefs.escritorio && permisoAvisos() === 'granted') {
    try {
      const aviso = new Notification(titulo, { body: evento.texto || '', tag: `atencion-${evento.conversacionId}` });
      aviso.onclick = () => { window.focus(); abrirEnAtencion(evento.conversacionId); aviso.close(); };
    } catch { /* algunos navegadores móviles solo avisan desde el service worker */ }
  } else if (pestanaVisible && location.hash !== '#atencion') {
    toast(`💬 ${titulo}${evento.texto ? `: ${evento.texto}` : ''}`);
  }
}

function pintarInsignia(n) {
  const elementos = [...$$('#nav a[data-route="atencion"]'), ...$$('#tabBar .tab-item[data-tab="atencion"] .tab-icon')];
  elementos.forEach(el => {
    let insignia = el.querySelector('.nav-insignia');
    if (!n) { insignia?.remove(); return; }
    if (!insignia) {
      insignia = document.createElement('span');
      insignia.className = 'nav-insignia';
      el.appendChild(insignia);
    }
    insignia.textContent = n > 99 ? '99+' : String(n);
    insignia.setAttribute('aria-label', `${n} ${n === 1 ? 'conversación espera' : 'conversaciones esperan'} atención`);
  });
  document.title = n ? `(${n}) ${tituloBase}` : tituloBase;
}

async function actualizarResumen() {
  try {
    const r = await api('/api/tools/atencion/resumen');
    if (!r) return;
    if (r.status === 503) { apagar(); return; }
    if (!r.ok) return;
    const { pendientes } = await r.json();
    pintarInsignia(pendientes);
  } catch { /* sin red se reintenta con el siguiente evento */ }
}

function programarResumen() {
  clearTimeout(resumenTimer);
  resumenTimer = setTimeout(actualizarResumen, RETRASO_RESUMEN_MS);
}

function apagar() {
  deshabilitado = true;
  fuente?.close();
  fuente = null;
  pintarInsignia(0);
  cambiarEstado('apagado');
}

function iniciarTiempoReal() {
  if (fuente || deshabilitado || typeof EventSource === 'undefined') return;
  tituloBase = document.title;
  document.addEventListener('pointerdown', desbloquearAudio, { once: true, capture: true });
  fuente = new EventSource('/api/tools/atencion/eventos');
  fuente.addEventListener('open', () => { cambiarEstado('conectado'); programarResumen(); });
  fuente.addEventListener('error', () => {
    // CLOSED: el servidor la rechazó (sin bandeja o sin sesión) y no se reintenta.
    if (fuente?.readyState === EventSource.CLOSED) apagar();
    else cambiarEstado('reconectando');
  });
  fuente.addEventListener('atencion', (e) => {
    let evento;
    try { evento = JSON.parse(e.data); } catch { return; }
    window.dispatchEvent(new CustomEvent('tooli:atencion', { detail: evento }));
    programarResumen();
    if (evento.entrante) avisar(evento);
  });
  actualizarResumen();
}

export {
  iniciarTiempoReal, estadoConexion, marcarConversacionVisible, preferenciasAvisos,
  cambiarPreferencias, permisoAvisos, pedirPermisoAvisos, actualizarResumen as actualizarResumenAtencion,
};
