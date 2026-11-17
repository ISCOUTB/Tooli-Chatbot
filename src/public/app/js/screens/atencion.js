import { api } from '../core/api.js';
import { $, $$, emoji, escapeHtml, haptic, toast } from '../core/dom.js';
import { avatarTone, colorTextoLegible, formatTelefono, formatWhatsApp, initialsFor, relativeTime } from '../core/format.js';
import { icon } from '../core/icons.js';
import { parametrosRuta } from '../core/router.js';
import { actualizarResumenAtencion, cambiarPreferencias, estadoConexion, marcarConversacionVisible, pedirPermisoAvisos, permisoAvisos, preferenciasAvisos } from '../core/realtime.js';
import { screenInterval, seguirTeclado, setPullToRefresh } from '../core/screen.js';
import { sesion } from '../core/session.js';
import { buildSegmented } from '../ui/controls.js';
import { nombreParaSaludo } from '../core/plantillas.js';
import { abrirEnviarPlantilla } from '../ui/enviar-plantilla.js';
import { abrirRespuestasRapidas } from '../ui/quick-replies.js';
import { ActionSheet } from '../ui/sheet.js';
import { avisoVentanaHtml, htmlFicha, ultimoEntrante } from './atencion-ficha.js';
import { abrirConversacion } from './conversaciones.js';

/* ============= ATENCIÓN =============
   Las conversaciones que el bot pasó a un asesor, atendidas desde el panel:
   responder, dejar notas privadas, asignar y resolver. Por detrás siguen
   viviendo en Chatwoot (que ya no se usa directamente), así que lo que se hace
   aquí queda en el mismo historial y el webhook lo entrega por WhatsApp. */

const ESTADOS = {
  open: { label: 'Abierta', plural: 'Abiertas', color: '#16a34a' },
  pending: { label: 'Pendiente', plural: 'Pendientes', color: '#d97706' },
  resolved: { label: 'Resuelta', plural: 'Resueltas', color: '#64748b' },
};
const ESTADOS_PRESENCIA = {
  disponible: { label: 'Disponible', color: '#16a34a' },
  ocupado: { label: 'Ocupado', color: '#d97706' },
  ausente: { label: 'Ausente', color: '#64748b' },
  desconectado: { label: 'Desconectado', color: '#94a3b8' },
};
// Con la conexión en vivo los cambios llegan solos; el sondeo queda de respaldo
// para cuando se cae (cada 20 s) y como red de seguridad (cada 90 s).
const SONDEO_MS = 20_000;
const RESPALDO_EN_VIVO_MS = 90_000;
const ESPERA_EVENTO_MS = 400;
const MAX_ADJUNTO = 3 * 1024 * 1024;
const TIPOS_ADJUNTO = new Set([
  'image/jpeg', 'image/png', 'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
]);

function etiquetaEstado(estado) {
  return ESTADOS[estado] ?? { label: estado, plural: estado, color: '#64748b' };
}

function textoEstadoPresencia(estado) {
  return ESTADOS_PRESENCIA[estado]?.label ?? 'Desconocido';
}

function armarConfigAtencion(valores) {
  return {
    asignacionAutomatica: valores.asignacionAutomatica === true || valores.asignacionAutomatica === 'true',
    maxAbiertasPorAsesor: Number(valores.maxAbiertasPorAsesor),
    encuestaSatisfaccion: valores.encuestaSatisfaccion === true || valores.encuestaSatisfaccion === 'true',
    avisosCorreo: valores.avisosCorreo === true || valores.avisosCorreo === 'true',
    horario: {
      activo: valores.horarioActivo === true || valores.horarioActivo === 'true',
      dias: [...(valores.dias ?? [])].map(Number).sort((a, b) => a - b),
      desde: String(valores.desde ?? ''),
      hasta: String(valores.hasta ?? ''),
    },
  };
}

function validarConfigAtencion(config) {
  if (!Number.isInteger(config.maxAbiertasPorAsesor) || config.maxAbiertasPorAsesor < 1 || config.maxAbiertasPorAsesor > 50) {
    return 'El máximo de conversaciones debe estar entre 1 y 50.';
  }
  if (config.horario.activo && !config.horario.dias.length) return 'Selecciona al menos un día de atención.';
  if (!/^\d{2}:\d{2}$/.test(config.horario.desde) || !/^\d{2}:\d{2}$/.test(config.horario.hasta) || config.horario.desde >= config.horario.hasta) {
    return 'La hora «desde» debe ser anterior a la hora «hasta».';
  }
  return null;
}

/** Lo que se ve bajo el nombre en la lista: quién habló último y qué dijo. */
function vistaPrevia(ultimo) {
  if (!ultimo) return 'Sin mensajes';
  // Sin las marcas de WhatsApp (*negrita*, _cursiva_, ~tachado~): en una
  // sola línea solo estorban.
  const texto = (ultimo.texto || '').replace(/(^|\s)[*_~]+|[*_~]+(?=\s|$|[.,!?])/g, '$1').replace(/\s+/g, ' ').trim() || '(archivo adjunto)';
  if (ultimo.tipo === 'nota') return `📝 Nota: ${texto}`;
  if (ultimo.tipo === 'out') return `Asesor: ${texto}`;
  if (ultimo.tipo === 'sistema') return texto;
  return texto;
}

function vistaPreviaHtml(ultimo) {
  const texto = vistaPrevia(ultimo);
  return ultimo?.tipo === 'nota'
    ? `${emoji('📝')} ${escapeHtml(texto.replace(/^📝\s*/, ''))}`
    : escapeHtml(texto);
}

/** Texto del botón de asignación según quién la tiene. */
function textoAsignacion(asignado, yo) {
  if (!asignado) return 'Sin asignar';
  return yo && asignado.id === yo ? 'Asignada a ti' : `Asignada a ${asignado.nombre}`;
}

/** Bajo el nombre en el celular. Quien no tiene número llega con "Usuario de
    WhatsApp" como nombre y como teléfono: ahí aporta más saber quién la atiende. */
function subtituloMovil(c, yo) {
  const telefono = c.contacto.telefono ? formatTelefono(c.contacto.telefono) : '';
  return telefono && telefono !== c.contacto.nombre ? telefono : textoAsignacion(c.asignado, yo);
}

/** Las acciones que en el celular salen de la cabecera. Cada una pulsa el botón
    oculto que sigue ahí, para que los manejadores vivan en un solo lugar. */
function accionesDetalles(c) {
  return [
    ...(c.contacto.telefono ? [
      { label: 'Ficha', icon: icon('user', 15), onClick: () => $('#atnFichaBtn')?.click() },
      { label: 'Historial', icon: icon('message', 15), onClick: () => $('#atnHistorial')?.click() },
    ] : []),
    { label: 'Macros', icon: icon('bolt', 15), onClick: () => $('#atnMacrosHilo')?.click() },
    ...(c.estado === 'open'
      ? [{ label: 'Pendiente', icon: icon('clock', 15), onClick: () => $('.atn-acciones [data-estado="pending"]')?.click() }]
      : c.estado === 'pending'
        ? [{ label: 'Abrir', icon: icon('clock', 15), onClick: () => $('.atn-acciones [data-estado="open"]')?.click() }]
        : []),
  ];
}

function formatoTamano(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function validarArchivo(archivo) {
  if (!archivo) return 'Selecciona un archivo.';
  if (!TIPOS_ADJUNTO.has(archivo.type)) return 'Tipo de archivo no permitido. Usa imagen, PDF, Office o texto.';
  if (archivo.size > MAX_ADJUNTO) return 'El archivo supera el máximo de 3 MB.';
  return null;
}

function resumenMacro(macro) {
  const a = macro?.acciones ?? {};
  const partes = [];
  if (a.nota) partes.push('Nota');
  if (a.mensaje) partes.push('Mensaje');
  if (a.etiquetas?.length) partes.push(...a.etiquetas.slice(0, 2).map(e => `Etiqueta ${e}`));
  if (Object.hasOwn(a, 'equipoId')) partes.push(a.equipoId == null ? 'Quita equipo' : 'Cambia equipo');
  if (Object.hasOwn(a, 'asesorId')) partes.push(a.asesorId == null ? 'Quita asesor' : a.asesorId === 'yo' ? 'Te asigna' : 'Cambia asesor');
  if (a.estado) partes.push(a.estado === 'resolved' ? 'Resuelve' : a.estado === 'pending' ? 'Deja pendiente' : 'Abre');
  return partes.join(' · ') || 'Sin acciones';
}

function construirAccionesMacro(valores) {
  const acciones = {};
  const nota = String(valores.nota ?? '').trim();
  const mensaje = String(valores.mensaje ?? '').trim();
  const etiquetas = String(valores.etiquetas ?? '').split(',').map(e => e.trim()).filter(Boolean);
  if (nota) acciones.nota = nota;
  if (mensaje) acciones.mensaje = mensaje;
  if (etiquetas.length) acciones.etiquetas = etiquetas;
  if (valores.equipoId !== '') acciones.equipoId = valores.equipoId === 'null' ? null : Number(valores.equipoId);
  if (valores.asesorId !== '') acciones.asesorId = valores.asesorId === 'null' ? null : valores.asesorId === 'yo' ? 'yo' : Number(valores.asesorId);
  if (valores.estado) acciones.estado = valores.estado;
  return acciones;
}

let filtros = { estado: 'open', asignado: 'todas', equipo: '', etiqueta: '' };
let equipo = { agentes: [], equipos: [], yo: null, miEquipoId: null };
let etiquetasCuenta = [];
let equipoCargado = false;
let lista = [];
let abierta = null;       // id de la conversación abierta
let listaSeq = 0;
let hiloSeq = 0;
const borradores = new Map(); // id → { texto, privado }
let adjuntoActual = null;      // { conversacionId, archivo }
let cabeceraPintada = '';    // estado y asignación que muestra la cabecera del hilo
let cabeceraActual = null;   // la conversación que muestra la cabecera, siempre la más reciente
let detallesAbiertos = false;
let dejarDeSeguirTeclado = null;
let ultimaCargaLista = 0;
let ultimaCargaHilo = 0;
let eventoTimer = null;
let idsConEvento = new Set();
let miPresencia = null;
let actualizandoPresencia = false;
let refrescarEquipoAbierto = null;
let refrescarEsperaAbierta = null;
/* Ficha de la persona de la conversación abierta. `seq` descarta respuestas
   que llegan cuando ya se abrió otra conversación. */
const FICHA_VACIA = { id: null, conv: null, datos: null, pidiendo: false, error: '', cerradaPorServidor: false, ultimoIn: 0, resumen: { estado: 'nada' } };
let ficha = { ...FICHA_VACIA };
let fichaSeq = 0;
let fichaAbierta = false;

async function renderAtencion(main) {
  const params = parametrosRuta();
  filtros.estado = ['open', 'pending', 'resolved'].includes(params.get('estado')) ? params.get('estado') : 'open';
  filtros.asignado = ['mias', 'sin_asignar', 'todas'].includes(params.get('asignado')) ? params.get('asignado') : 'todas';
  abierta = null;
  marcarConversacionVisible(null);
  hiloSeq++;
  main.innerHTML = `
    <div class="page-header">
      <div><h1>${icon('headset', 26)} Atención</h1><div class="subtitle">Conversaciones que el bot pasó a un asesor: responde, asigna y resuelve desde aquí.</div></div>
      <div class="atn-avisos" id="atnAvisos"></div>
    </div>
    <div class="inbox" id="atnInbox">
      <div class="inbox-list glass" id="atnLista">
        <div class="atn-filtros">
          <div id="atnAsignadoWrap" class="atn-asignado"></div>
          <div class="atn-filtros-linea" id="atnFiltrosLinea"></div>
        </div>
        <div class="inbox-rows" id="atnFilas" aria-busy="true" aria-label="Cargando conversaciones">${filasEsqueleto()}</div>
      </div>
      <div class="inbox-thread glass" id="atnHilo">
        <div class="inbox-empty"><div class="atn-vacio-icono">${icon('headset', 36)}</div>Selecciona una conversación</div>
      </div>
      <aside class="atn-ficha glass" id="atnFicha" hidden aria-labelledby="atnFichaTitulo"></aside>
    </div>
  `;
  pintarFiltrosActivos();
  setPullToRefresh(() => cargarLista());
  screenInterval(() => {
    const respaldo = estadoConexion() !== 'conectado' ? SONDEO_MS : RESPALDO_EN_VIVO_MS;
    if (Date.now() - ultimaCargaLista >= respaldo - 1000) cargarLista({ silencioso: true });
    if (abierta && Date.now() - ultimaCargaHilo >= respaldo - 1000) cargarHilo(abierta, { silencioso: true });
  }, SONDEO_MS);
  escucharEnVivo();
  pintarAvisos();
  cargarPresenciaPropia();

  if (!equipoCargado) await cargarEquipo();
  pintarFiltrosActivos();
  cargarLista();
}

/* Los oyentes viven en window y la pantalla no tiene un "al salir": cada uno
   se quita solo la primera vez que llega un evento y la bandeja ya no está. */
function escucharEnVivo() {
  const enPantalla = () => !!$('#atnInbox');
  const alEvento = (e) => {
    if (!enPantalla()) { window.removeEventListener('tooli:atencion', alEvento); return; }
    if (e.detail?.tipo === 'presencia') {
      cargarPresenciaPropia();
      refrescarEquipoAbierto?.();
      return;
    }
    // Varios eventos seguidos (el panel y el webhook avisan del mismo
    // mensaje) se resuelven con una sola recarga.
    idsConEvento.add(e.detail?.conversacionId);
    clearTimeout(eventoTimer);
    eventoTimer = setTimeout(() => {
      const ids = idsConEvento;
      idsConEvento = new Set();
      cargarLista({ silencioso: true });
      if (abierta && ids.has(abierta)) cargarHilo(abierta, { silencioso: true });
      refrescarEsperaAbierta?.();
    }, ESPERA_EVENTO_MS);
  };
  const alConexion = () => {
    if (!enPantalla()) { window.removeEventListener('tooli:conexion', alConexion); return; }
    pintarAvisos();
  };
  const alAbrir = (e) => {
    if (!enPantalla()) { window.removeEventListener('tooli:abrir-atencion', alAbrir); return; }
    abrirPendiente(Number(e.detail));
  };
  window.addEventListener('tooli:atencion', alEvento);
  window.addEventListener('tooli:conexion', alConexion);
  window.addEventListener('tooli:abrir-atencion', alAbrir);
}

/** Un aviso del sistema pidió abrir esta conversación. */
function abrirPendiente(id) {
  try { sessionStorage.removeItem('atencion.abrir'); } catch { /* nada que limpiar */ }
  if (!id) return;
  // Puede estar en otra pestaña de estado o filtro: se muestra igual.
  abrirHilo(id);
}

function pintarAvisos() {
  const wrap = $('#atnAvisos');
  if (!wrap) return;
  const conexion = estadoConexion();
  const prefs = preferenciasAvisos();
  const permiso = permisoAvisos();
  const avisoTexto = permiso === 'granted' ? (prefs.escritorio ? 'Avisos activados' : 'Avisos pausados')
    : permiso === 'denied' ? 'Avisos bloqueados' : permiso === 'default' ? 'Activar avisos' : '';
  const avisosActivos = permiso === 'granted' && prefs.escritorio;
  const tituloAvisos = permiso === 'denied' ? 'El navegador bloqueó los avisos: actívalos en la configuración del sitio'
    : permiso === 'granted' ? `${avisoTexto}: avisos del sistema cuando llega un mensaje y no estás mirando esta pestaña` : 'Avisos del sistema cuando llega un mensaje y no estás mirando esta pestaña';
  wrap.innerHTML = `
    <span class="atn-conexion atn-conexion-${conexion}" role="status">${conexion === 'conectado' ? 'En vivo' : conexion === 'reconectando' ? 'Reconectando…' : 'Actualiza cada 20 s'}</span>
    <label class="atn-mi-estado" title="${conexion === 'conectado' ? 'Con Disponible recibes conversaciones automáticamente' : 'La sesión en vivo no está conectada'}">
      <span class="atn-presencia-punto atn-presencia-${escapeHtml(miPresencia?.estado ?? 'desconectado')}" aria-hidden="true"></span>
      <span class="ini-sr-only">Mi estado</span>
      <select class="atn-select" id="atnMiEstado" aria-label="Mi estado" ${actualizandoPresencia ? 'disabled' : ''}>
        ${['disponible', 'ocupado', 'ausente'].map(estado => `<option value="${estado}" ${miPresencia?.estado === estado ? 'selected' : ''}>${textoEstadoPresencia(estado)}</option>`).join('')}
      </select>
    </label>
    ${permiso === 'default' ? `<button type="button" class="atn-icono-btn atn-icono-btn-texto" id="atnAvisoBtn" aria-label="Activar avisos" title="${tituloAvisos}">${icon('bell', 16)}<span>Activar avisos</span></button>`
      : avisoTexto ? `<button type="button" class="atn-icono-btn" id="atnAvisoBtn" aria-pressed="${avisosActivos}" aria-label="${avisoTexto}" title="${tituloAvisos}">${icon(avisosActivos ? 'bell' : 'bellOff', 18)}</button>` : ''}
    <button type="button" class="atn-icono-btn" id="atnSonidoBtn" aria-pressed="${prefs.sonido}" aria-label="Tono cuando llega un mensaje: ${prefs.sonido ? 'activado' : 'desactivado'}" title="${prefs.sonido ? 'Sonido activado' : 'Sonido desactivado'}">${icon(prefs.sonido ? 'volume' : 'volumeOff', 18)}</button>
    ${sesion.user?.role === 'admin' ? `<button type="button" class="btn btn-ghost atn-accion" id="atnGestionEquipo" aria-label="Gestionar equipo">${icon('users', 14)}<span class="hide-sm">Equipo</span></button><button type="button" class="btn btn-ghost atn-accion" id="atnGestionMacros" aria-label="Gestionar macros">${icon('bolt', 14)}<span class="hide-sm">Macros</span></button>` : ''}
  `;
  $('#atnMiEstado').addEventListener('change', cambiarMiPresencia);
  $('#atnAvisoBtn')?.addEventListener('click', async () => {
    if (permiso === 'default') {
      const r = await pedirPermisoAvisos();
      toast(r === 'granted' ? 'Listo: te avisaremos cuando llegue un mensaje' : 'Sin permiso, solo verás los avisos dentro del panel');
    } else if (permiso === 'granted') {
      cambiarPreferencias({ escritorio: !prefs.escritorio });
    } else {
      toast('El navegador bloqueó los avisos: actívalos en la configuración del sitio');
    }
    pintarAvisos();
  });
  $('#atnSonidoBtn').addEventListener('click', () => {
    cambiarPreferencias({ sonido: !prefs.sonido });
    pintarAvisos();
  });
  $('#atnGestionMacros')?.addEventListener('click', abrirGestionMacros);
  $('#atnGestionEquipo')?.addEventListener('click', abrirGestionEquipo);
}

async function cargarPresenciaPropia() {
  try {
    const r = await api('/api/tools/atencion/presencia');
    if (!r?.ok) return;
    miPresencia = (await r.json()).yo;
    pintarAvisos();
  } catch { /* la conexión general ya comunica que los datos pueden estar desactualizados */ }
}

async function cambiarMiPresencia(e) {
  const nuevo = e.target.value;
  const anterior = miPresencia?.estado;
  actualizandoPresencia = true;
  pintarAvisos();
  try {
    const r = await api('/api/tools/atencion/presencia', { method: 'POST', body: JSON.stringify({ estado: nuevo }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message);
    miPresencia = { ...(miPresencia ?? {}), estado: data.estado };
    toast(`Tu estado ahora es ${textoEstadoPresencia(data.estado)}`);
  } catch {
    miPresencia = { ...(miPresencia ?? {}), estado: anterior };
    toast('No se pudo guardar tu estado');
  } finally {
    actualizandoPresencia = false;
    pintarAvisos();
  }
}

function filasEsqueleto() {
  return Array.from({ length: 6 }).map(() => `
    <div class="inbox-row">
      <div class="skeleton" style="width:44px;height:44px;border-radius:50%;flex-shrink:0;"></div>
      <div style="flex:1;min-width:0;">
        <div class="skeleton skeleton-line" style="width:60%;height:13px;margin-bottom:8px;"></div>
        <div class="skeleton skeleton-line" style="width:85%;height:11px;"></div>
      </div>
    </div>`).join('');
}

async function cargarEquipo() {
  try {
    // Se traen juntas porque ambas listas cambian poco y alimentan todos los
    // filtros/editores de la pantalla.
    const [rEquipo, rEtiquetas] = await Promise.all([
      api('/api/tools/atencion/equipo'),
      api('/api/tools/atencion/etiquetas'),
    ]);
    if (!rEquipo?.ok) return;
    equipo = await rEquipo.json();
    if (rEtiquetas?.ok) etiquetasCuenta = (await rEtiquetas.json()).etiquetas ?? [];
    equipoCargado = true;
    // Primera vez: el asesor de un área ve primero las de su equipo.
    if (equipo.miEquipoId && !filtros.equipo) filtros.equipo = String(equipo.miEquipoId);
  } catch { /* sin equipo la bandeja funciona igual, solo sin filtros ni asignación */ }
}

function pintarFiltroEtiquetas() {
  const sel = $('#atnEtiqueta');
  if (!sel) return;
  sel.innerHTML = '<option value="">Todas las etiquetas</option>' +
    etiquetasCuenta.map(e => `<option value="${escapeHtml(e.nombre)}">${escapeHtml(e.nombre)}</option>`).join('');
  sel.value = filtros.etiqueta;
}

function pintarFiltroEquipo() {
  const sel = $('#atnEquipo');
  if (!sel) return;
  sel.innerHTML = '<option value="">Todos los equipos</option>' +
    equipo.equipos.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)}</option>`).join('');
  sel.value = filtros.equipo;
  sel.hidden = equipo.equipos.length === 0;
}

/* La lista deja a la vista solo Mías / Sin asignar / Todas. Estado, equipo y
   etiqueta viven en la hoja Filtros; lo que esté activo queda como etiqueta con
   su × para quitarlo sin abrir la hoja. */
function filtrosActivos() {
  const activos = [];
  if (filtros.estado !== 'open') activos.push({ clave: 'estado', texto: ESTADOS[filtros.estado]?.plural ?? filtros.estado });
  if (filtros.equipo) activos.push({ clave: 'equipo', texto: equipo.equipos.find(e => String(e.id) === String(filtros.equipo))?.nombre ?? 'Equipo' });
  if (filtros.etiqueta) activos.push({ clave: 'etiqueta', texto: filtros.etiqueta });
  return activos;
}

function pintarFiltrosActivos() {
  const linea = $('#atnFiltrosLinea');
  if (!linea) return;
  const activos = filtrosActivos();
  linea.innerHTML = `
    <button type="button" class="atn-filtrar" id="atnFiltrar" aria-haspopup="dialog">${icon('funnel', 14)}<span>Filtros</span>${activos.length ? `<span class="atn-filtrar-cuenta">${activos.length}<span class="ini-sr-only"> activos</span></span>` : ''}</button>
    ${activos.map(f => `<span class="atn-filtro-chip">${escapeHtml(f.texto)}<button type="button" data-quitar="${f.clave}" aria-label="Quitar filtro ${escapeHtml(f.texto)}">${icon('x', 12)}</button></span>`).join('')}`;
  $('#atnFiltrar').addEventListener('click', abrirFiltros);
  linea.querySelectorAll('[data-quitar]').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.quitar === 'estado') filtros.estado = 'open';
    else filtros[btn.dataset.quitar] = '';
    pintarFiltrosActivos();
    $('#atnFiltrar')?.focus();
    cargarLista();
  }));
}

function abrirFiltros() {
  const hoja = document.createElement('div');
  hoja.className = 'atn-filtros-hoja';
  hoja.innerHTML = `
    <p class="atn-filtros-campo" id="atnEstadoTitulo">Estado</p>
    <div id="atnEstadoWrap"></div>
    <label class="atn-filtros-campo" for="atnEquipo" id="atnEquipoTitulo">Equipo</label>
    <select id="atnEquipo" class="atn-select atn-select-bloque"></select>
    <label class="atn-filtros-campo" for="atnEtiqueta">Etiqueta</label>
    <select id="atnEtiqueta" class="atn-select atn-select-bloque"></select>`;
  const aplicar = () => { pintarFiltrosActivos(); cargarLista(); };
  ActionSheet.open({
    title: 'Filtrar conversaciones',
    clase: 'atn-filtros-sheet',
    contenido: hoja,
    groups: [
      ...(filtrosActivos().length ? [[{ label: 'Quitar filtros', onClick: () => { filtros.estado = 'open'; filtros.equipo = ''; filtros.etiqueta = ''; aplicar(); } }]] : []),
      [{ label: 'Listo', cancel: true }],
    ],
  });
  const estado = buildSegmented(Object.entries(ESTADOS).map(([value, e]) => ({ value, label: e.plural })), filtros.estado, (v) => { filtros.estado = v; aplicar(); });
  estado.setAttribute('aria-labelledby', 'atnEstadoTitulo');
  $('#atnEstadoWrap').appendChild(estado);
  pintarFiltroEquipo();
  pintarFiltroEtiquetas();
  $('#atnEquipoTitulo').hidden = $('#atnEquipo').hidden;
  $('#atnEquipo').addEventListener('change', (e) => { filtros.equipo = e.target.value; aplicar(); });
  $('#atnEtiqueta').addEventListener('change', (e) => { filtros.etiqueta = e.target.value; aplicar(); });
}

async function cargarLista({ silencioso = false } = {}) {
  const filas = $('#atnFilas');
  if (!filas) return;
  const seq = ++listaSeq;
  if (!silencioso) { filas.setAttribute('aria-busy', 'true'); filas.innerHTML = filasEsqueleto(); }
  const params = new URLSearchParams({
    estado: filtros.estado,
    asignado: filtros.asignado,
    ...(filtros.equipo ? { equipo: filtros.equipo } : {}),
    ...(filtros.etiqueta ? { etiqueta: filtros.etiqueta } : {}),
  });
  try {
    const r = await api(`/api/tools/atencion/conversaciones?${params}`);
    if (!r || seq !== listaSeq || !filas.isConnected) return;
    const data = await r.json();
    if (!r.ok) throw Object.assign(new Error(data.message), { codigo: data.error });
    lista = data.conversaciones;
    ultimaCargaLista = Date.now();
    pintarFiltroAsignado(data.conteos);
    pintarFilas(data.truncado);
    let pendiente = null;
    try { pendiente = Number(sessionStorage.getItem('atencion.abrir')) || null; } catch { /* sin almacenamiento */ }
    if (pendiente && !abierta) abrirPendiente(pendiente);
  } catch (err) {
    if (seq !== listaSeq || !filas.isConnected) return;
    if (silencioso) return; // un sondeo fallido no borra lo que el asesor está viendo
    filas.setAttribute('aria-busy', 'false');
    filas.innerHTML = `
      <div class="alert ${err.codigo === 'chatwoot_no_configurado' ? 'alert-info' : 'alert-error'}" role="alert" style="margin:12px;display:flex;flex-direction:column;gap:8px;align-items:flex-start;">
        <span>${escapeHtml(err.codigo === 'chatwoot_no_configurado' ? err.message : 'No se pudo cargar la bandeja de atención. Revisa tu conexión.')}</span>
        ${err.codigo === 'chatwoot_no_configurado' ? '' : '<button type="button" class="btn btn-secondary" id="atnReintentar" style="font-size:13px;padding:8px 16px;">Reintentar</button>'}
      </div>`;
    $('#atnReintentar')?.addEventListener('click', () => cargarLista());
  }
}

function pintarFiltroAsignado(conteos) {
  const wrap = $('#atnAsignadoWrap');
  if (!wrap) return;
  const opciones = [
    ...(equipo.yo ? [{ value: 'mias', label: `Mías (${conteos.mias})` }] : []),
    { value: 'sin_asignar', label: `Sin asignar (${conteos.sin_asignar})` },
    { value: 'todas', label: `Todas (${conteos.todas})` },
  ];
  if (!opciones.some(o => o.value === filtros.asignado)) filtros.asignado = 'todas';
  wrap.innerHTML = '';
  wrap.appendChild(buildSegmented(opciones, filtros.asignado, (v) => { filtros.asignado = v; cargarLista(); }));
}

function colorEtiqueta(nombre) {
  const color = etiquetasCuenta.find(e => e.nombre === nombre)?.color;
  return /^#[0-9a-f]{3,8}$/i.test(color ?? '') ? color : '#64748b';
}

function htmlEtiqueta(nombre, quitable = false) {
  const seguro = escapeHtml(nombre);
  const color = colorEtiqueta(nombre);
  return `<span class="atn-chip atn-chip-etiqueta" style="--atn-etiqueta:${color};--atn-etiqueta-texto:${colorTextoLegible(color)}" title="${seguro}">
    ${seguro}${quitable ? `<button type="button" class="atn-etiqueta-quitar" data-etiqueta="${seguro}" aria-label="Quitar etiqueta ${seguro}">×</button>` : ''}
  </span>`;
}

function pintarFilas(truncado) {
  const filas = $('#atnFilas');
  filas.setAttribute('aria-busy', 'false');
  filas.setAttribute('aria-label', 'Conversaciones de atención');
  if (!lista.length) {
    filas.innerHTML = `
      <div class="inbox-empty" style="height:auto;padding:44px 20px;flex-direction:column;text-align:center;gap:6px;">
        <div class="inbox-empty-icon">${filtros.estado === 'resolved' ? '✅' : '🎉'}</div>
        <div class="inbox-empty-title">${filtros.estado === 'open' ? 'Nadie esperando' : 'Nada por aquí'}</div>
        <div class="inbox-empty-sub">${filtros.estado === 'open' ? 'Cuando el bot pase a alguien con un asesor, aparecerá aquí.' : 'No hay conversaciones con este filtro.'}</div>
      </div>`;
    return;
  }
  filas.innerHTML = lista.map(c => {
    const tags = c.etiquetas ?? [];
    return `
    <button type="button" class="inbox-row atn-row${c.id === abierta ? ' activa' : ''}" data-id="${c.id}">
      <div class="avatar" style="background:${avatarTone(c.contacto.telefono || String(c.id))}">${initialsFor(c.contacto.telefono, c.contacto.nombre)}</div>
      <div class="inbox-row-body">
        <div class="inbox-row-top">
          <span class="inbox-row-name">${escapeHtml(c.contacto.nombre)}</span>
          <span class="inbox-row-time">${c.actividadTs ? relativeTime(c.actividadTs) : ''}</span>
        </div>
        <div class="inbox-row-preview">${vistaPreviaHtml(c.ultimoMensaje)}</div>
        <div class="atn-row-meta">
          <span class="atn-chip ${c.asignado ? '' : 'atn-chip-alerta'}">${icon('user', 11)} ${escapeHtml(textoAsignacion(c.asignado, equipo.yo))}</span>
          ${c.equipo ? `<span class="atn-chip">${escapeHtml(c.equipo.nombre)}</span>` : ''}
          ${tags.slice(0, 2).map(nombre => htmlEtiqueta(nombre)).join('')}
          ${tags.length > 2 ? `<span class="atn-chip">+${tags.length - 2}</span>` : ''}
          ${c.noLeidos ? `<span class="atn-no-leidos" aria-label="${c.noLeidos} sin leer">${c.noLeidos}</span>` : ''}
        </div>
      </div>
    </button>
  `; }).join('') + (truncado ? '<div class="atn-truncado">Se muestran las 100 más recientes.</div>' : '');
  $$('.atn-row', filas).forEach(row => row.addEventListener('click', () => abrirHilo(Number(row.dataset.id))));
}

function abrirHilo(id) {
  if (detallesAbiertos) ActionSheet.close();
  guardarBorrador();
  abierta = id;
  marcarConversacionVisible(id);
  $$('.atn-row').forEach(r => r.classList.toggle('activa', Number(r.dataset.id) === id));
  $('#atnInbox').classList.add('thread-open');
  reiniciarFicha(id);
  const hilo = $('#atnHilo');
  hilo.innerHTML = `
    <div class="inbox-thread-header">
      <button type="button" class="mobile-only back-link" id="atnVolver" aria-label="Volver a la lista" style="margin:0;">${icon('chevronLeft', 18)}</button>
      <div class="skeleton skeleton-line" style="width:140px;height:16px;"></div>
    </div>
    <div class="inbox-messages" aria-busy="true"></div>`;
  $('#atnVolver').addEventListener('click', cerrarHilo);
  cargarHilo(id);
}

function cerrarHilo() {
  if (detallesAbiertos) ActionSheet.close();
  guardarBorrador();
  dejarDeSeguirTeclado?.();
  dejarDeSeguirTeclado = null;
  abierta = null;
  marcarConversacionVisible(null);
  hiloSeq++;
  fichaSeq++;
  ficha = { ...FICHA_VACIA };
  pintarFicha();
  $('#atnInbox')?.classList.remove('thread-open');
  const hilo = $('#atnHilo');
  if (hilo) hilo.innerHTML = `<div class="inbox-empty"><div class="atn-vacio-icono">${icon('headset', 36)}</div>Selecciona una conversación</div>`;
  $$('.atn-row').forEach(r => r.classList.remove('activa'));
}

function guardarBorrador() {
  const input = $('#atnTexto');
  if (abierta && input) borradores.set(abierta, { texto: input.value, privado: modoPrivado() });
}

function modoPrivado() {
  return $('#atnModo .active')?.dataset.value === 'nota';
}

async function cargarHilo(id, { silencioso = false } = {}) {
  const seq = ++hiloSeq;
  try {
    const r = await api(`/api/tools/atencion/conversaciones/${id}`);
    if (!r || seq !== hiloSeq || abierta !== id) return;
    const data = await r.json();
    if (!r.ok) throw new Error(data.message);
    ultimaCargaHilo = Date.now();
    if (silencioso && $('#atnMensajes')) {
      // Refresco: solo los mensajes y la cabecera; el borrador no se toca.
      const msgs = $('#atnMensajes');
      const alFondo = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80;
      // Repintar la cabecera cerraría un selector que el asesor tenga abierto:
      // solo se hace si cambió el estado o la asignación.
      if (claveCabecera(data.conversacion) !== cabeceraPintada) pintarCabecera(data.conversacion);
      msgs.innerHTML = htmlMensajes(data.mensajes, data.hayAnteriores);
      cablearAnteriores(id, data.mensajes);
      if (alFondo) msgs.scrollTop = msgs.scrollHeight;
      // Si la persona escribió, la ventana de 24 h se reabre: la ficha se pone al día.
      const ultimoIn = ultimoEntrante(data.mensajes);
      if (ficha.id === id && ultimoIn > ficha.ultimoIn) {
        ficha.ultimoIn = ultimoIn;
        ficha.cerradaPorServidor = false;
        void cargarFicha({ silencioso: true });
      }
      return;
    }
    pintarHilo(data);
  } catch (err) {
    if (silencioso || seq !== hiloSeq || abierta !== id) return;
    $('#atnHilo').innerHTML = `
      <div class="inbox-thread-header"><button type="button" class="mobile-only back-link" id="atnVolver" aria-label="Volver a la lista" style="margin:0;">${icon('chevronLeft', 18)}</button></div>
      <div class="alert alert-error" role="alert" style="margin:16px;">${escapeHtml(err.message || 'No se pudo abrir la conversación.')}</div>`;
    $('#atnVolver').addEventListener('click', cerrarHilo);
  }
}

function htmlMensajes(mensajes, hayAnteriores) {
  const cuerpo = mensajes.map(m => {
    if (m.tipo === 'sistema') return `<div class="thread-meta">${escapeHtml(m.texto)}</div>`;
    const hora = m.ts ? new Date(m.ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '';
    const adjuntos = m.adjuntos.map(a => a.tipo === 'image'
      ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener"><img class="atn-adjunto-img" src="${escapeHtml(a.url)}" alt="Imagen adjunta"></a>`
      : `<a class="atn-adjunto" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${icon('external', 12)} ${escapeHtml(a.nombre || 'Archivo adjunto')}</a>`).join('');
    if (m.tipo === 'nota') {
      return `<div class="atn-nota"><div class="atn-nota-autor">${emoji('📝')} Nota privada${m.autor ? ` · ${escapeHtml(m.autor)}` : ''}</div>${formatWhatsApp(escapeHtml(m.texto))}${adjuntos}<span class="bubble-time">${hora}</span></div>`;
    }
    const lado = m.tipo === 'out' ? 'out' : 'in';
    return `
      <div class="bubble-row ${lado} group-start">
        <div class="bubble ${lado}">
          ${lado === 'out' && m.autor ? `<span class="atn-autor">${escapeHtml(m.autor)}</span>` : ''}
          ${formatWhatsApp(escapeHtml(m.texto))}${adjuntos}
          <span class="bubble-time">${hora}</span>
        </div>
      </div>`;
  }).join('');
  return (hayAnteriores ? '<button type="button" class="btn btn-ghost atn-anteriores" id="atnAnteriores">Cargar mensajes anteriores</button>' : '') +
    (cuerpo || '<div class="inbox-empty-sub" style="text-align:center;padding:32px;">Sin mensajes todavía.</div>');
}

function cablearAnteriores(id, mensajes) {
  $('#atnAnteriores')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const r = await api(`/api/tools/atencion/conversaciones/${id}?antesDe=${mensajes[0]?.id ?? ''}`);
      const data = await r.json();
      if (!r.ok || abierta !== id) return;
      const msgs = $('#atnMensajes');
      const alto = msgs.scrollHeight;
      const todos = [...data.mensajes, ...mensajes];
      msgs.innerHTML = htmlMensajes(todos, data.hayAnteriores);
      cablearAnteriores(id, todos);
      msgs.scrollTop = msgs.scrollHeight - alto; // conserva lo que se estaba leyendo
    } catch { btn.disabled = false; toast('No se pudieron cargar los mensajes anteriores'); }
  });
}

function claveCabecera(c) {
  return JSON.stringify([c.id, c.estado, c.asignado?.id ?? null, c.equipo?.id ?? null, c.etiquetas ?? []]);
}

function pintarCabecera(c) {
  cabeceraActual = c;
  cabeceraPintada = claveCabecera(c);
  const est = etiquetaEstado(c.estado);
  const cab = $('#atnCabecera');
  if (!cab) return;
  const asigActual = $('#atnAsignacion');
  const focoId = detallesAbiertos && asigActual?.contains(document.activeElement) ? document.activeElement.id : '';
  cab.innerHTML = `
    <button type="button" class="mobile-only back-link" id="atnVolver" aria-label="Volver a la lista" style="margin:0;">${icon('chevronLeft', 18)}</button>
    <div class="avatar" style="background:${avatarTone(c.contacto.telefono || String(c.id))};width:36px;height:36px;font-size:13px;">${initialsFor(c.contacto.telefono, c.contacto.nombre)}</div>
    <div class="atn-cabecera-info">
      <div class="atn-cabecera-nombre">${escapeHtml(c.contacto.nombre)}</div>
      <div class="atn-cabecera-sub"><span class="atn-solo-escritorio">${c.contacto.telefono ? formatTelefono(c.contacto.telefono) : ''} </span><span class="atn-estado atn-solo-escritorio" style="color:${colorTextoLegible(est.color)};background:${est.color}1a;">${est.label}</span><span class="atn-solo-movil">${escapeHtml(subtituloMovil(c, equipo.yo))}</span></div>
    </div>
    <div class="atn-acciones">
    ${c.contacto.telefono ? `<button type="button" class="btn btn-ghost atn-accion atn-solo-escritorio${fichaVisible() ? ' activa' : ''}" id="atnFichaBtn" aria-controls="atnFicha" aria-expanded="${fichaVisible()}" aria-label="Ficha" title="Lo que se sabe de la persona">${icon('user', 14)}<span class="hide-sm">Ficha</span></button>` : ''}
    ${c.contacto.telefono ? `<button type="button" class="btn btn-ghost atn-accion atn-solo-escritorio" id="atnHistorial" aria-label="Historial" title="Todo lo que habló con el bot">${icon('message', 14)}<span class="hide-sm">Historial</span></button>` : ''}
    <button type="button" class="btn btn-ghost atn-accion atn-solo-escritorio" id="atnMacrosHilo" aria-label="Macros" title="Macros">${icon('bolt', 14)}<span>Macros</span></button>
    ${c.estado === 'resolved'
      ? '<button type="button" class="btn btn-secondary atn-accion" data-estado="open">Reabrir</button>'
      : `${c.estado === 'open' ? '<button type="button" class="btn btn-ghost atn-accion atn-solo-escritorio" data-estado="pending" title="Esperando algo de la persona o de otra área">Pendiente</button>' : '<button type="button" class="btn btn-ghost atn-accion atn-solo-escritorio" data-estado="open">Abrir</button>'}
         <button type="button" class="btn btn-primary atn-accion" data-estado="resolved" title="Cierra la conversación y se lo avisa a la persona">Resolver</button>`}
    <button type="button" class="btn btn-ghost atn-accion atn-solo-movil" id="atnDetalles" aria-label="Detalles de la conversación" aria-haspopup="dialog" aria-expanded="${detallesAbiertos}">${icon('more', 20)}</button>
    </div>
  `;
  $('#atnVolver').addEventListener('click', cerrarHilo);
  $('#atnFichaBtn')?.addEventListener('click', () => alternarFicha());
  $('#atnHistorial')?.addEventListener('click', () => abrirConversacion(c.contacto.telefono));
  $('#atnMacrosHilo')?.addEventListener('click', () => abrirMacrosHilo(c));
  $('#atnDetalles')?.addEventListener('click', abrirDetalles);
  $$('.atn-accion[data-estado]', cab).forEach(b => b.addEventListener('click', () => cambiarEstado(c, b.dataset.estado, b)));

  pintarAsignacion(c);
  if (focoId) document.getElementById(focoId)?.focus({ preventScroll: true });
}

function pintarAsignacion(c) {
  const asig = $('#atnAsignacion');
  if (!asig) return;
  asig.innerHTML = `
    <label class="atn-campo">${icon('user', 12)}
      <select id="atnAsesor" class="atn-select" aria-label="Asesor asignado">
        <option value="">Sin asignar</option>
        ${equipo.agentes.map(a => `<option value="${a.id}">${escapeHtml(a.nombre)}${a.id === equipo.yo ? ' (tú)' : ''}</option>`).join('')}
      </select>
    </label>
    ${equipo.equipos.length ? `
      <label class="atn-campo">${icon('users', 12)}
        <select id="atnEquipoConv" class="atn-select" aria-label="Equipo">
          <option value="">Sin equipo</option>
          ${equipo.equipos.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)}</option>`).join('')}
        </select>
      </label>` : ''}
    ${equipo.yo && c.asignado?.id !== equipo.yo ? '<button type="button" class="btn btn-secondary atn-accion" id="atnAsignarme">Asignármela</button>' : ''}
    <div class="atn-etiquetas" aria-label="Etiquetas de la conversación">
      ${(c.etiquetas ?? []).map(nombre => htmlEtiqueta(nombre, true)).join('')}
      <button type="button" class="btn btn-ghost atn-etiqueta-agregar" id="atnAgregarEtiqueta">+ Etiqueta</button>
    </div>
    <form class="atn-etiqueta-form" id="atnEtiquetaForm" hidden>
      <input class="atn-etiqueta-input" id="atnEtiquetaNueva" list="atnEtiquetasCuenta" maxlength="40" placeholder="Nombre de etiqueta" aria-label="Nombre de etiqueta">
      <datalist id="atnEtiquetasCuenta">${etiquetasCuenta.map(e => `<option value="${escapeHtml(e.nombre)}"></option>`).join('')}</datalist>
      <button type="submit" class="btn btn-secondary atn-accion">Agregar</button>
    </form>
  `;
  $('#atnAsesor').value = c.asignado ? String(c.asignado.id) : '';
  if ($('#atnEquipoConv')) $('#atnEquipoConv').value = c.equipo ? String(c.equipo.id) : '';
  $('#atnAsesor').addEventListener('change', (e) => asignarConv(c.id, { asesorId: e.target.value ? Number(e.target.value) : null }));
  $('#atnEquipoConv')?.addEventListener('change', (e) => asignarConv(c.id, { equipoId: e.target.value ? Number(e.target.value) : null }));
  $('#atnAsignarme')?.addEventListener('click', () => asignarConv(c.id, { asesorId: 'yo' }));
  $$('.atn-etiqueta-quitar', asig).forEach(btn => btn.addEventListener('click', () => {
    guardarEtiquetas(c, (c.etiquetas ?? []).filter(e => e !== btn.dataset.etiqueta));
  }));
  $('#atnAgregarEtiqueta').addEventListener('click', () => {
    const form = $('#atnEtiquetaForm');
    form.hidden = !form.hidden;
    if (!form.hidden) $('#atnEtiquetaNueva').focus();
  });
  $('#atnEtiquetaForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const nombre = $('#atnEtiquetaNueva').value.trim();
    if (nombre && !(c.etiquetas ?? []).includes(nombre)) guardarEtiquetas(c, [...(c.etiquetas ?? []), nombre]);
  });
}

/* La hoja Detalles del celular. #atnAsignacion se muda a ella mientras está
   abierta, así los cambios que llegan en vivo la siguen actualizando. */
function abrirDetalles() {
  const c = cabeceraActual;
  const asig = $('#atnAsignacion');
  if (!c || !asig) return;
  detallesAbiertos = true;
  $('#atnDetalles')?.setAttribute('aria-expanded', 'true');
  const telefono = c.contacto.telefono ? formatTelefono(c.contacto.telefono) : '';
  const subtitle = [etiquetaEstado(c.estado).label, ...(telefono && telefono !== c.contacto.nombre ? [telefono] : [])].join(' · ');
  ActionSheet.open({
    title: 'Detalles',
    subtitle,
    clase: 'atn-detalles',
    contenido: asig,
    groups: [accionesDetalles(c), [{ label: 'Cerrar', cancel: true }]],
    alCerrar: () => {
      // Lo que queda en la hoja se va con la animación de salida; sin ids para
      // no chocar con la asignación nueva que vuelve al hilo.
      asig.removeAttribute('id');
      asig.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      const mensajes = $('#atnMensajes');
      const nuevo = document.createElement('div');
      nuevo.className = 'atn-asignacion';
      nuevo.id = 'atnAsignacion';
      mensajes?.before(nuevo);
      detallesAbiertos = false;
      if (mensajes) pintarAsignacion(cabeceraActual);
      $('#atnDetalles')?.setAttribute('aria-expanded', 'false');
      if (document.activeElement === document.body) $('#atnDetalles')?.focus({ preventScroll: true });
    },
  });
}

function pintarHilo(data) {
  const c = data.conversacion;
  const hilo = $('#atnHilo');
  const borrador = borradores.get(c.id) ?? { texto: '', privado: false };
  if (adjuntoActual?.conversacionId !== c.id) adjuntoActual = null;
  hilo.innerHTML = `
    <div class="inbox-thread-header atn-cabecera" id="atnCabecera"></div>
    <div class="atn-asignacion" id="atnAsignacion"></div>
    <div class="inbox-messages" id="atnMensajes">${htmlMensajes(data.mensajes, data.hayAnteriores)}</div>
    <div class="atn-ventana" id="atnVentana" role="status" hidden></div>
    <div class="inbox-thread-footer">
      <div id="atnModoWrap" class="atn-modo"></div>
      <div class="atn-archivo-chip" id="atnArchivoChip" hidden></div>
      <form class="composer${borrador.privado ? ' atn-composer-nota' : ''}" id="atnComposer" autocomplete="off">
        <div class="atn-composer-tools">
          <button type="button" class="atn-composer-tool" id="atnAdjuntar" aria-label="Adjuntar archivo" title="Adjuntar archivo">${icon('paperclip', 19)}</button>
          <button type="button" class="atn-composer-tool" id="atnRapidas" aria-label="Respuestas rápidas" title="Respuestas rápidas">${icon('bolt', 18)}</button>
        </div>
        <input type="file" id="atnArchivo" hidden accept=".jpg,.jpeg,.png,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,image/jpeg,image/png,application/pdf,text/plain">
        <textarea class="composer-input" id="atnTexto" rows="1" maxlength="4096" enterkeyhint="send" aria-label="Escribir a ${escapeHtml(c.contacto.nombre)}"></textarea>
        <button type="submit" class="composer-send" id="atnEnviar" disabled aria-label="Enviar">${icon('send', 18)}</button>
      </form>
      <div class="composer-hint" id="atnPista" aria-live="polite"></div>
    </div>`;
  prepararFicha(c, data.mensajes);
  pintarCabecera(c);
  cablearAnteriores(c.id, data.mensajes);

  const modo = buildSegmented([{ value: 'responder', label: 'Responder' }, { value: 'nota', iconHtml: icon('note', 14), label: 'Nota privada' }],
    borrador.privado ? 'nota' : 'responder', () => actualizarModo());
  modo.id = 'atnModo';
  $('#atnModoWrap').appendChild(modo);

  const input = $('#atnTexto');
  input.value = borrador.texto;
  const ajustar = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    $('#atnEnviar').disabled = !input.value.trim() && !adjuntoActual?.archivo;
  };
  input.addEventListener('input', ajustar);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#atnComposer').requestSubmit(); }
  });
  $('#atnComposer').addEventListener('submit', (e) => { e.preventDefault(); enviar(c); });
  $('#atnAdjuntar').addEventListener('click', () => $('#atnArchivo').click());
  $('#atnArchivo').addEventListener('change', (e) => {
    const archivo = e.target.files?.[0];
    const error = validarArchivo(archivo);
    if (error) { $('#atnPista').textContent = error; e.target.value = ''; return; }
    adjuntoActual = { conversacionId: c.id, archivo };
    pintarArchivoSeleccionado(ajustar);
  });
  $('#atnRapidas').addEventListener('click', () => abrirRespuestasRapidas(input, ajustar, c.contacto.nombre));
  actualizarModo();
  pintarArchivoSeleccionado(ajustar);
  ajustar();
  const msgs = $('#atnMensajes');
  msgs.scrollTop = msgs.scrollHeight;
  // La lista se refresca aparte; al abrir, Chatwoot la marca como leída.
  const fila = $(`.atn-row[data-id="${c.id}"] .atn-no-leidos`);
  fila?.remove();
  actualizarResumenAtencion();
  dejarDeSeguirTeclado?.();
  dejarDeSeguirTeclado = seguirTeclado($('#atnHilo'));
}

function pintarArchivoSeleccionado(sync) {
  const chip = $('#atnArchivoChip');
  if (!chip) return;
  const archivo = adjuntoActual?.archivo;
  chip.hidden = !archivo;
  chip.innerHTML = archivo ? `${icon('external', 13)} <span>${escapeHtml(archivo.name)}</span><small>${formatoTamano(archivo.size)}</small><button type="button" aria-label="Quitar archivo">×</button>` : '';
  chip.querySelector('button')?.addEventListener('click', () => {
    adjuntoActual = null;
    const input = $('#atnArchivo');
    if (input) input.value = '';
    pintarArchivoSeleccionado(sync);
    sync?.();
  });
  sync?.();
}

function actualizarModo() {
  const privado = modoPrivado();
  $('#atnComposer')?.classList.toggle('atn-composer-nota', privado);
  const input = $('#atnTexto');
  const movil = globalThis.matchMedia?.('(max-width: 880px)')?.matches;
  if (input) input.placeholder = movil
    ? (privado ? 'Nota para el equipo…' : 'Escribe por WhatsApp…')
    : (privado ? 'Nota solo para el equipo (la persona no la ve)…' : 'Escribe la respuesta por WhatsApp…');
  const pista = $('#atnPista');
  // Sin pista de teclado: la línea solo aparece para la nota privada o un error.
  if (pista) pista.textContent = privado ? 'La nota queda en la conversación y solo la ve el equipo.' : '';
}

async function enviar(c) {
  const input = $('#atnTexto');
  const texto = input.value.trim();
  const archivo = adjuntoActual?.conversacionId === c.id ? adjuntoActual.archivo : null;
  if (!texto && !archivo) return;
  const privado = modoPrivado();
  const btn = $('#atnEnviar');
  btn.disabled = true;
  haptic(10);
  try {
    let ruta = `/api/tools/atencion/conversaciones/${c.id}/mensajes`;
    let body = { texto, privado };
    if (archivo) {
      ruta = `/api/tools/atencion/conversaciones/${c.id}/adjuntos`;
      body = { nombre: archivo.name, tipo: archivo.type, base64: await leerBase64(archivo), texto, privado };
    }
    const r = await api(ruta, { method: 'POST', body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      // El borrador se queda: el asesor no pierde lo que escribió.
      $('#atnPista').textContent = data.message || 'No se pudo enviar.';
      btn.disabled = false;
      if (data.error === 'fuera_de_ventana' && ficha.id === c.id) {
        // El aviso con «Enviar plantilla» aparece aunque la ficha no lo supiera aún.
        ficha.cerradaPorServidor = true;
        pintarVentana();
      }
      return;
    }
    input.value = '';
    input.style.height = 'auto';
    adjuntoActual = null;
    const archivoInput = $('#atnArchivo');
    if (archivoInput) archivoInput.value = '';
    pintarArchivoSeleccionado();
    btn.disabled = true;
    borradores.delete(c.id);
    toast(privado ? 'Nota guardada' : 'Mensaje enviado');
    await cargarHilo(c.id, { silencioso: true });
    const msgs = $('#atnMensajes');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
    cargarLista({ silencioso: true });
  } catch {
    $('#atnPista').textContent = 'Sin conexión: el mensaje no se envió.';
    btn.disabled = false;
  }
}

/* ── Ficha de la persona ── */

const esMovil = () => !!globalThis.matchMedia?.('(max-width: 880px)')?.matches;

/** En escritorio la ficha recuerda si se dejó abierta; si nunca se tocó, abre en pantallas anchas. */
function preferenciaFicha() {
  try {
    const guardada = localStorage.getItem('atencion.ficha');
    if (guardada === '1' || guardada === '0') return guardada === '1';
  } catch { /* sin almacenamiento, el valor por defecto */ }
  // Abre sola donde cabe como columna; en pantallas más angostas taparía el chat.
  return !!globalThis.matchMedia?.('(min-width: 1360px)')?.matches;
}

function fichaVisible() {
  return fichaAbierta && abierta !== null && ficha.id === abierta && !!(ficha.conv?.contacto.telefono ?? true);
}

function reiniciarFicha(id) {
  fichaSeq++;
  ficha = { ...FICHA_VACIA, id, resumen: { estado: 'nada' } };
  fichaAbierta = !esMovil() && preferenciaFicha();
  pintarFicha();
}

function prepararFicha(c, mensajes) {
  if (ficha.id !== c.id) reiniciarFicha(c.id);
  ficha.conv = c;
  ficha.ultimoIn = Math.max(ficha.ultimoIn, ultimoEntrante(mensajes));
  if (c.contacto.telefono) {
    if (!ficha.datos && !ficha.pidiendo) void cargarFicha();
    if (fichaAbierta && ficha.resumen.estado === 'nada') void cargarResumen();
  }
  pintarFicha();
  pintarVentana();
}

async function cargarFicha({ silencioso = false } = {}) {
  const id = ficha.id;
  const seq = fichaSeq;
  if (!id || !ficha.conv?.contacto.telefono) return;
  ficha.pidiendo = true;
  if (!silencioso) { ficha.error = ''; pintarFicha(); }
  try {
    const r = await api(`/api/tools/atencion/conversaciones/${id}/ficha`);
    if (!r || seq !== fichaSeq) return;
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ficha) throw new Error(data.message || 'No se pudo cargar la ficha.');
    ficha.datos = data.ficha;
    ficha.error = '';
    if (data.ficha.ventana?.abierta) ficha.cerradaPorServidor = false;
  } catch (err) {
    if (seq !== fichaSeq) return;
    // Un refresco que falla deja a la vista lo que ya se sabía.
    if (!ficha.datos) ficha.error = err?.message || 'No se pudo cargar la ficha.';
  } finally {
    if (seq === fichaSeq) ficha.pidiendo = false;
  }
  pintarFicha();
  pintarVentana();
}

async function cargarResumen(forzar = false) {
  const id = ficha.id;
  const seq = fichaSeq;
  if (!id) return;
  const anterior = ficha.resumen.datos ?? null;
  ficha.resumen = { estado: 'cargando', datos: anterior };
  pintarFicha();
  try {
    const r = await api(`/api/tools/atencion/conversaciones/${id}/resumen`, { method: 'POST', body: JSON.stringify({ forzar }) });
    if (!r || seq !== fichaSeq) return;
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || 'No se pudo hacer el resumen.');
    ficha.resumen = { estado: 'listo', datos: data.resumen ?? null };
  } catch (err) {
    if (seq !== fichaSeq) return;
    ficha.resumen = { estado: 'error', mensaje: err?.message || 'No se pudo hacer el resumen.', datos: anterior };
  }
  pintarFicha();
}

function alternarFicha(abrir = !fichaVisible()) {
  if (!ficha.conv?.contacto.telefono) return;
  fichaAbierta = abrir;
  if (!esMovil()) {
    try { localStorage.setItem('atencion.ficha', abrir ? '1' : '0'); } catch { /* solo no se recuerda */ }
  }
  const foco = $('#atnFicha')?.contains(document.activeElement);
  pintarFicha({ entrando: abrir });
  if (abrir) {
    if (!ficha.datos && !ficha.pidiendo) void cargarFicha();
    if (ficha.resumen.estado === 'nada') void cargarResumen();
    $('#atnFicha .atn-ficha-cerrar')?.focus({ preventScroll: true });
  } else if (foco) {
    (esMovil() ? $('#atnDetalles') : $('#atnFichaBtn'))?.focus({ preventScroll: true });
  }
}

function pintarFicha({ entrando = false } = {}) {
  const aside = $('#atnFicha');
  if (!aside) return;
  const visible = fichaVisible();
  aside.hidden = !visible;
  $('#atnInbox')?.classList.toggle('con-ficha', visible);
  $('#atnFichaBtn')?.setAttribute('aria-expanded', String(visible));
  $('#atnFichaBtn')?.classList.toggle('activa', visible);
  if (!visible) { aside.innerHTML = ''; return; }
  // Superpuesta (pantallas angostas) arranca bajo la cabecera del chat: Resolver sigue a mano.
  aside.style.setProperty('--atn-ficha-top', `${$('#atnCabecera')?.offsetHeight ?? 0}px`);
  const cuerpoPrevio = aside.querySelector('.atn-ficha-cuerpo');
  const scroll = cuerpoPrevio?.scrollTop ?? 0;
  const focoId = aside.contains(document.activeElement) ? (document.activeElement.dataset.resumen || document.activeElement.dataset.ficha || '') : '';
  aside.innerHTML = htmlFicha({ datos: ficha.datos, error: ficha.error, resumen: ficha.resumen });
  aside.classList.toggle('entrando', entrando);
  const cuerpo = aside.querySelector('.atn-ficha-cuerpo');
  if (cuerpo) cuerpo.scrollTop = scroll;
  aside.querySelector('.atn-ficha-cerrar')?.addEventListener('click', () => alternarFicha(false));
  aside.querySelector('[data-ficha="reintentar"]')?.addEventListener('click', () => cargarFicha());
  aside.querySelector('[data-ficha="historial"]')?.addEventListener('click', () => {
    if (ficha.conv?.contacto.telefono) abrirConversacion(ficha.conv.contacto.telefono);
  });
  aside.querySelectorAll('[data-resumen]').forEach(b => b.addEventListener('click', () => cargarResumen(b.dataset.resumen === 'actualizar')));
  aside.querySelector('.atn-enviar-plantilla')?.addEventListener('click', abrirPlantillaDesdeChat);
  aside.onkeydown = (e) => { if (e.key === 'Escape' && esMovil()) { e.preventDefault(); alternarFicha(false); } };
  if (focoId) aside.querySelector(`[data-resumen="${focoId}"], [data-ficha="${focoId}"]`)?.focus({ preventScroll: true });
}

function nombreDeFicha() {
  return nombreParaSaludo(ficha.datos?.interes?.nombre) || nombreParaSaludo(ficha.conv?.contacto.nombre);
}

/** El aviso sobre la caja de texto: solo cuando pasaron las 24 horas. */
function pintarVentana() {
  const caja = $('#atnVentana');
  if (!caja) return;
  const telefono = ficha.conv?.contacto.telefono ?? '';
  const ventana = ficha.id === abierta ? ficha.datos?.ventana : null;
  const cerrada = ficha.id === abierta && !!telefono && (ficha.cerradaPorServidor || (ventana ? !ventana.abierta : false));
  if (!cerrada) { caja.hidden = true; caja.innerHTML = ''; return; }
  const puede = ficha.datos ? ficha.datos.puedeRecibirPlantilla : /^[1-9]\d{9,14}$/.test(telefono);
  const yaVisible = !caja.hidden;
  caja.innerHTML = avisoVentanaHtml({ nombre: nombreDeFicha(), puedeRecibirPlantilla: puede });
  caja.hidden = false;
  caja.classList.toggle('entrando', !yaVisible);
  caja.querySelector('.atn-enviar-plantilla')?.addEventListener('click', abrirPlantillaDesdeChat);
}

/* La plantilla sale por la cola de envíos, que no pasa por Chatwoot: se deja
   una nota privada con lo que se envió para que el equipo lo vea en el hilo. */
function abrirPlantillaDesdeChat() {
  const c = ficha.conv;
  if (!c?.contacto.telefono) return;
  const id = c.id;
  const nombre = nombreDeFicha();
  abrirEnviarPlantilla({
    telefono: c.contacto.telefono,
    nombre,
    programa: ficha.datos?.interes?.programa ?? '',
    bajaCampanas: ficha.datos?.bajaCampanas === true,
    etiqueta: `Atención: ${nombre || formatTelefono(c.contacto.telefono)}`,
    alEnviar: async ({ plantilla, texto, estado }) => {
      const nota = `Plantilla «${plantilla.name}» ${estado === 'enviado' ? 'enviada' : 'en camino (falta que WhatsApp la confirme)'}:\n\n${texto}`;
      try {
        await api(`/api/tools/atencion/conversaciones/${id}/mensajes`, { method: 'POST', body: JSON.stringify({ texto: nota.slice(0, 4096), privado: true }) });
      } catch { /* la plantilla ya salió; la nota es solo para el equipo */ }
      if (abierta !== id) return;
      void cargarHilo(id, { silencioso: true });
      if (ficha.id === id) void cargarFicha({ silencioso: true });
    },
  });
}

function leerBase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error('No se pudo leer el archivo'));
    lector.onload = () => resolve(String(lector.result).split(',')[1] ?? '');
    lector.readAsDataURL(archivo);
  });
}

async function guardarEtiquetas(c, nuevas) {
  try {
    const r = await api(`/api/tools/atencion/conversaciones/${c.id}/etiquetas`, {
      method: 'POST', body: JSON.stringify({ etiquetas: nuevas }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { toast(data.message || 'No se pudieron actualizar las etiquetas'); return; }
    c.etiquetas = data.etiquetas;
    const fila = lista.find(item => item.id === c.id);
    if (fila) fila.etiquetas = data.etiquetas;
    pintarCabecera(c);
    pintarFilas(false);
    toast('Etiquetas actualizadas');
  } catch { toast('No se pudieron actualizar las etiquetas'); }
}

async function obtenerMacros() {
  const r = await api('/api/tools/atencion/macros');
  const data = await r.json().catch(() => ({}));
  if (!r?.ok) throw new Error(data.message || 'No se pudieron cargar las macros');
  return data.macros ?? [];
}

async function abrirMacrosHilo(c) {
  let macros;
  try { macros = await obtenerMacros(); } catch (err) { toast(err.message); return; }
  if (!macros.length) { toast('No hay macros. Un administrador puede crearlas desde la cabecera de Atención.'); return; }
  ActionSheet.open({
    title: 'Macros',
    subtitle: 'Elige una secuencia de acciones para esta conversación.',
    groups: [macros.map(m => ({
      label: `${m.nombre} — ${resumenMacro(m)}`,
      icon: icon('bolt', 15),
      onClick: () => confirmarMacro(c, m),
    })), [{ label: 'Cancelar', cancel: true }]],
  });
}

function confirmarMacro(c, macro) {
  ActionSheet.open({
    title: `Aplicar «${macro.nombre}»`,
    subtitle: resumenMacro(macro),
    groups: [[{
      label: `Aplicar «${macro.nombre}»`,
      icon: icon('bolt', 15),
      onClick: async () => {
        try {
          const r = await api(`/api/tools/atencion/conversaciones/${c.id}/macros/${macro.id}`, { method: 'POST' });
          const data = await r.json().catch(() => ({}));
          if (!r.ok) { toast(data.message || 'No se pudo aplicar la macro'); return; }
          toast((data.hechos ?? []).join(' · ') || 'Macro aplicada');
          await cargarHilo(c.id, { silencioso: true });
          cargarLista({ silencioso: true });
        } catch { toast('No se pudo aplicar la macro'); }
      },
    }], [{ label: 'Cancelar', cancel: true }]],
  });
}

function abrirGestionEquipo() {
  const opener = $('#atnGestionEquipo');
  const overlay = document.createElement('div');
  overlay.className = 'sheet-backdrop atn-modal-backdrop';
  overlay.innerHTML = `
    <div class="action-sheet atn-equipo-modal" role="dialog" aria-modal="true" aria-labelledby="atnEquipoTitulo">
      <div class="atn-macro-cuerpo">
        <div class="atn-equipo-titulo"><div><div class="sheet-title" id="atnEquipoTitulo">Gestión del equipo</div><p class="field-help">Presencia, asignación automática, horario, encuesta de satisfacción y avisos por correo.</p></div><button type="button" class="btn btn-ghost" id="atnEquipoCerrar" aria-label="Cerrar">×</button></div>
        <div id="atnEquipoError" class="atn-macro-error" role="alert"></div>
        <div id="atnEquipoContenido" aria-live="polite">Cargando…</div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let cerrada = false;
  let asignacionAutomatica = false;
  let horarioActivo = false;
  let encuestaSatisfaccion = false;
  let avisosCorreo = false;
  const cerrar = () => {
    if (cerrada) return;
    cerrada = true;
    refrescarEquipoAbierto = null;
    refrescarEsperaAbierta = null;
    document.removeEventListener('keydown', alTeclado);
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 260);
    const destino = $('#atnGestionEquipo') ?? opener;
    if (destino?.isConnected) destino.focus({ preventScroll: true });
  };
  const alTeclado = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cerrar(); return; }
    if (e.key !== 'Tab') return;
    const controles = Array.from(overlay.querySelectorAll('input, button')).filter(el => !el.disabled);
    if (!controles.length) return;
    if (e.shiftKey && document.activeElement === controles[0]) { e.preventDefault(); controles.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === controles.at(-1)) { e.preventDefault(); controles[0].focus(); }
  };
  document.addEventListener('keydown', alTeclado);
  overlay.addEventListener('click', e => { if (e.target === overlay) cerrar(); });
  $('#atnEquipoCerrar').addEventListener('click', cerrar);
  requestAnimationFrame(() => { overlay.classList.add('open'); $('#atnEquipoCerrar')?.focus({ preventScroll: true }); });

  const pintarLista = (integrantes) => {
    const listaEl = $('#atnEquipoLista');
    if (!listaEl) return;
    listaEl.innerHTML = integrantes.map(persona => {
      const estado = persona.conectado ? persona.estado : 'desconectado';
      return `<div class="atn-equipo-persona">
        <span class="atn-presencia-punto atn-presencia-${escapeHtml(estado)}" aria-hidden="true"></span>
        <span><strong>${escapeHtml(persona.nombre)}</strong><small>${escapeHtml(persona.area || 'Sin área')} · ${textoEstadoPresencia(estado)}</small>${persona.chatwootVinculado ? '' : '<em>No tiene cuenta de Atención vinculada; no puede recibir asignaciones. Vincúlala en Asesores.</em>'}</span>
      </div>`;
    }).join('') || '<div class="inbox-empty-sub">No hay integrantes en el equipo.</div>';
  };

  const cargarPresenciasModal = async () => {
    try {
      const r = await api('/api/tools/atencion/presencia');
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.message);
      miPresencia = data.yo;
      pintarLista(data.equipo ?? []);
    } catch (err) {
      const errorEl = $('#atnEquipoError');
      if (errorEl) errorEl.textContent = err.message || 'No se pudo actualizar el equipo.';
    }
  };
  refrescarEquipoAbierto = cargarPresenciasModal;

  // Cada asignación o cierre llega como aviso a la bandeja, que vuelve a
  // pedir el conteo; si falla, la ventana sigue sirviendo sin él.
  const pintarEnEspera = async () => {
    try {
      const r = await api('/api/tools/atencion/en-espera');
      const data = await r.json().catch(() => ({}));
      const el = $('#atnEnEspera');
      if (!r.ok || !el || !Number.isInteger(data.enEspera)) return;
      el.innerHTML = data.enEspera === 0 ? 'No hay conversaciones en espera.'
        : `En espera ahora: <strong>${data.enEspera}</strong> ${data.enEspera === 1 ? 'conversación' : 'conversaciones'}.`;
      el.hidden = false;
    } catch { /* el conteo es informativo */ }
  };
  refrescarEsperaAbierta = pintarEnEspera;

  const cargar = async () => {
    const errorEl = $('#atnEquipoError');
    try {
      const [rPresencia, rConfig] = await Promise.all([
        api('/api/tools/atencion/presencia'), api('/api/tools/atencion/config'),
      ]);
      const presencia = await rPresencia.json().catch(() => ({}));
      const configData = await rConfig.json().catch(() => ({}));
      if (cerrada) return;
      if (!rPresencia.ok || !rConfig.ok) throw new Error(configData.message || presencia.message || 'No se pudo cargar la gestión del equipo.');
      const config = configData.config;
      asignacionAutomatica = config.asignacionAutomatica;
      horarioActivo = config.horario.activo;
      encuestaSatisfaccion = config.encuestaSatisfaccion;
      avisosCorreo = config.avisosCorreo === true;
      miPresencia = presencia.yo;
      $('#atnEquipoContenido').innerHTML = `
        <section class="atn-equipo-seccion"><h3>Equipo</h3><div id="atnEquipoLista" class="atn-equipo-lista"></div></section>
        <form id="atnEquipoForm" class="atn-equipo-form">
          <section class="atn-equipo-seccion"><h3>Asignación automática</h3><div id="atnAutoWrap"></div>
            <label>Máximo de conversaciones abiertas por asesor<input id="atnMaxAbiertas" type="number" min="1" max="50" required value="${escapeHtml(config.maxAbiertasPorAsesor)}"></label>
            <p class="field-help">Cada conversación va al asesor Disponible con menos chats abiertos. Si no hay nadie disponible o todos llegaron al máximo, queda en espera y se asigna al primero que se conecte o libere un cupo.</p>
            <p class="field-help" id="atnEnEspera" hidden></p>
          </section>
          <section class="atn-equipo-seccion"><h3>Horario de atención</h3><div id="atnHorarioWrap"></div>
            <div class="atn-dias" aria-label="Días de atención">${[['L', 1, 'Lunes'], ['M', 2, 'Martes'], ['X', 3, 'Miércoles'], ['J', 4, 'Jueves'], ['V', 5, 'Viernes'], ['S', 6, 'Sábado'], ['D', 0, 'Domingo']].map(([dia, valor, nombre]) => `<button type="button" class="atn-dia${config.horario.dias.includes(valor) ? ' activo' : ''}" data-dia="${valor}" aria-label="${nombre}" aria-pressed="${config.horario.dias.includes(valor)}">${dia}</button>`).join('')}</div>
            <div class="atn-horas"><label>Desde<input id="atnHorarioDesde" type="time" required value="${escapeHtml(config.horario.desde)}"></label><label>Hasta<input id="atnHorarioHasta" type="time" required value="${escapeHtml(config.horario.hasta)}"></label></div>
            <p class="field-help">Fuera de horario el bot avisa que responderemos en el próximo horario, y lo que quede en espera se asigna al empezar.</p>
          </section>
          <section class="atn-equipo-seccion"><h3>Encuesta de satisfacción</h3><div id="atnEncuestaWrap"></div>
            <p class="field-help">Al resolver una conversación el bot le pide a la persona calificar la atención del 1 al 5; la respuesta solo cuenta durante 2 horas.</p>
          </section>
          <section class="atn-equipo-seccion"><h3>Avisos por correo</h3><div id="atnAvisosCorreoWrap"></div>
            <p class="field-help">Si una conversación lleva 2 minutos en espera y nadie de su área está Disponible en el panel, se avisa por correo a los asesores vinculados de esa área que tengan el panel cerrado y no estén Ausentes. Máximo un correo cada 30 minutos por persona, sin datos del estudiante y solo dentro del horario.</p>
          </section>
          <div class="atn-modal-acciones"><button type="button" class="btn btn-secondary" id="atnEquipoCancelar">Cerrar</button><button type="submit" class="btn btn-primary" id="atnEquipoGuardar">Guardar</button></div>
        </form>`;
      pintarLista(presencia.equipo ?? []);
      pintarEnEspera();
      $('#atnAutoWrap').appendChild(buildSegmented([{ value: 'true', label: 'Sí' }, { value: 'false', label: 'No' }], String(asignacionAutomatica), v => { asignacionAutomatica = v === 'true'; }));
      $('#atnHorarioWrap').appendChild(buildSegmented([{ value: 'true', label: 'Sí' }, { value: 'false', label: 'No' }], String(horarioActivo), v => { horarioActivo = v === 'true'; }));
      $('#atnEncuestaWrap').appendChild(buildSegmented([{ value: 'true', label: 'Sí' }, { value: 'false', label: 'No' }], String(encuestaSatisfaccion), v => { encuestaSatisfaccion = v === 'true'; }));
      $('#atnAvisosCorreoWrap').appendChild(buildSegmented([{ value: 'true', label: 'Sí' }, { value: 'false', label: 'No' }], String(avisosCorreo), v => { avisosCorreo = v === 'true'; }));
      $$('.atn-dia', overlay).forEach(btn => btn.addEventListener('click', () => {
        const activo = btn.getAttribute('aria-pressed') !== 'true';
        btn.setAttribute('aria-pressed', String(activo));
        btn.classList.toggle('activo', activo);
      }));
      $('#atnEquipoCancelar').addEventListener('click', cerrar);
      $('#atnEquipoForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const configNueva = armarConfigAtencion({
          asignacionAutomatica, maxAbiertasPorAsesor: $('#atnMaxAbiertas').value, encuestaSatisfaccion, avisosCorreo,
          horarioActivo, dias: $$('.atn-dia[aria-pressed="true"]', overlay).map(btn => btn.dataset.dia),
          desde: $('#atnHorarioDesde').value, hasta: $('#atnHorarioHasta').value,
        });
        const error = validarConfigAtencion(configNueva);
        if (error) { errorEl.textContent = error; return; }
        const guardar = $('#atnEquipoGuardar');
        guardar.disabled = true;
        errorEl.textContent = '';
        try {
          const r = await api('/api/tools/atencion/config', { method: 'PUT', body: JSON.stringify({ config: configNueva }) });
          const data = await r.json().catch(() => ({}));
          if (!r.ok) { errorEl.textContent = data.message || 'No se pudo guardar la configuración.'; return; }
          toast('Configuración del equipo guardada');
        } catch { errorEl.textContent = 'Sin conexión: no se pudo guardar la configuración.'; }
        finally { guardar.disabled = false; }
      });
    } catch (err) {
      const contenido = $('#atnEquipoContenido');
      if (contenido) contenido.innerHTML = '';
      if (errorEl?.isConnected) errorEl.textContent = err.message;
    }
  };
  cargar();
}

function abrirGestionMacros() {
  const opener = $('#atnGestionMacros');
  const overlay = document.createElement('div');
  overlay.className = 'sheet-backdrop atn-modal-backdrop';
  overlay.innerHTML = `
    <div class="action-sheet atn-macro-modal" role="dialog" aria-modal="true" aria-labelledby="atnMacroTitulo">
      <div class="atn-macro-cuerpo">
        <div class="sheet-title" id="atnMacroTitulo">Gestionar macros</div>
        <p class="field-help">Crea secuencias para resolver tareas repetitivas del equipo.</p>
        <div id="atnMacroError" class="atn-macro-error" role="alert"></div>
        <div id="atnMacroLista" class="atn-macro-lista" aria-live="polite">Cargando…</div>
        <form id="atnMacroForm" class="atn-macro-form">
          <h3>Nueva macro</h3>
          <label>Nombre<input id="atnMacroNombre" maxlength="60" required></label>
          <label>Nota privada<textarea id="atnMacroNota" rows="2"></textarea></label>
          <label>Mensaje<textarea id="atnMacroMensaje" rows="3"></textarea><small>Puedes usar {nombre}</small></label>
          <label>Etiquetas<input id="atnMacroEtiquetas" placeholder="beca, urgente"><small>Separadas por comas</small></label>
          <div class="atn-macro-selects">
            <label>Equipo<select id="atnMacroEquipo"><option value="">Sin cambio</option><option value="null">Quitar equipo</option>${equipo.equipos.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)}</option>`).join('')}</select></label>
            <label>Asesor<select id="atnMacroAsesor"><option value="">Sin cambio</option><option value="null">Quitar asesor</option><option value="yo">Quien la aplique</option>${equipo.agentes.map(a => `<option value="${a.id}">${escapeHtml(a.nombre)}</option>`).join('')}</select></label>
            <label>Estado<select id="atnMacroEstado"><option value="">Sin cambio</option><option value="open">Abierta</option><option value="pending">Pendiente</option><option value="resolved">Resuelta</option></select></label>
          </div>
          <div class="atn-modal-acciones"><button type="button" class="btn btn-secondary" id="atnMacroCerrar">Cerrar</button><button type="submit" class="btn btn-primary" id="atnMacroCrear">Crear macro</button></div>
        </form>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.classList.add('open'); $('#atnMacroNombre')?.focus({ preventScroll: true }); });

  let cerrada = false;
  const cerrar = () => {
    if (cerrada) return;
    cerrada = true;
    document.removeEventListener('keydown', alTeclado);
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 260);
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  };
  const alTeclado = (e) => {
    // El ActionSheet de confirmación va encima del modal y administra su
    // propio foco/Escape mientras exista.
    if (document.getElementById('activeSheet')) return;
    if (e.key === 'Escape') { e.preventDefault(); cerrar(); return; }
    if (e.key !== 'Tab') return;
    const controles = Array.from(overlay.querySelectorAll('input, textarea, select, button')).filter(el => !el.disabled);
    if (!controles.length) return;
    if (e.shiftKey && document.activeElement === controles[0]) { e.preventDefault(); controles.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === controles.at(-1)) { e.preventDefault(); controles[0].focus(); }
  };
  document.addEventListener('keydown', alTeclado);
  overlay.addEventListener('click', e => { if (e.target === overlay) cerrar(); });
  $('#atnMacroCerrar').addEventListener('click', cerrar);

  const errorEl = $('#atnMacroError');
  const pintarMacros = async () => {
    const listaEl = $('#atnMacroLista');
    try {
      const macros = await obtenerMacros();
      listaEl.innerHTML = macros.length ? macros.map(m => `
        <div class="atn-macro-fila"><div><strong>${escapeHtml(m.nombre)}</strong><small>${escapeHtml(resumenMacro(m))}</small></div>
          <button type="button" class="btn btn-ghost atn-macro-eliminar" data-id="${m.id}" data-nombre="${escapeHtml(m.nombre)}">Eliminar</button></div>`).join('') : '<div class="inbox-empty-sub">Todavía no hay macros.</div>';
      $$('.atn-macro-eliminar', listaEl).forEach(btn => btn.addEventListener('click', () => {
        ActionSheet.open({ title: `Eliminar «${btn.dataset.nombre}»`, groups: [[{
          label: 'Eliminar macro', destructive: true, onClick: async () => {
            try {
              const r = await api(`/api/tools/atencion/macros/${btn.dataset.id}`, { method: 'DELETE' });
              const data = await r.json().catch(() => ({}));
              if (!r.ok) { errorEl.textContent = data.message || 'No se pudo eliminar'; return; }
              toast('Macro eliminada');
              pintarMacros();
            } catch { errorEl.textContent = 'Sin conexión: no se pudo eliminar la macro.'; }
          },
        }], [{ label: 'Cancelar', cancel: true }]] });
      }));
    } catch (err) { listaEl.innerHTML = ''; errorEl.textContent = err.message; }
  };
  pintarMacros();

  $('#atnMacroForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    // currentTarget deja de existir después del primer await.
    const form = e.currentTarget;
    const acciones = construirAccionesMacro({
      nota: $('#atnMacroNota').value, mensaje: $('#atnMacroMensaje').value,
      etiquetas: $('#atnMacroEtiquetas').value, equipoId: $('#atnMacroEquipo').value,
      asesorId: $('#atnMacroAsesor').value, estado: $('#atnMacroEstado').value,
    });
    const btn = $('#atnMacroCrear');
    btn.disabled = true;
    errorEl.textContent = '';
    try {
      const r = await api('/api/tools/atencion/macros', { method: 'POST', body: JSON.stringify({ nombre: $('#atnMacroNombre').value.trim(), acciones }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { errorEl.textContent = data.message || 'No se pudo crear la macro'; return; }
      form.reset();
      toast('Macro creada');
      pintarMacros();
      $('#atnMacroNombre').focus();
    } catch { errorEl.textContent = 'Sin conexión: no se pudo crear la macro.'; } finally { btn.disabled = false; }
  });
}

async function cambiarEstado(c, estado, btn) {
  btn.disabled = true;
  try {
    const r = await api(`/api/tools/atencion/conversaciones/${c.id}/estado`, { method: 'POST', body: JSON.stringify({ estado }) });
    if (!r.ok) throw new Error();
    haptic([10, 20, 10]);
    toast(estado === 'resolved' ? 'Conversación resuelta: se le avisó a la persona' : `Marcada como ${etiquetaEstado(estado).label.toLowerCase()}`);
    // Sale de la pestaña actual: se cierra y la lista se pone al día.
    if (estado !== filtros.estado) cerrarHilo(); else cargarHilo(c.id, { silencioso: true });
    cargarLista({ silencioso: true });
  } catch {
    btn.disabled = false;
    toast('No se pudo cambiar el estado');
  }
}

async function asignarConv(id, cambios) {
  try {
    const r = await api(`/api/tools/atencion/conversaciones/${id}/asignar`, { method: 'POST', body: JSON.stringify(cambios) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { toast(data.message || 'No se pudo asignar'); cargarHilo(id, { silencioso: true }); return; }
    toast('Asignación actualizada');
    cargarHilo(id, { silencioso: true });
    cargarLista({ silencioso: true });
  } catch { toast('No se pudo asignar'); }
}

export {
  renderAtencion, etiquetaEstado, vistaPrevia, textoAsignacion,
  subtituloMovil, accionesDetalles,
  resumenMacro, construirAccionesMacro, validarArchivo, formatoTamano,
  textoEstadoPresencia, validarConfigAtencion, armarConfigAtencion,
};
