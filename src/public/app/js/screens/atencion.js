import { api } from '../core/api.js';
import { $, $$, escapeHtml, haptic, toast } from '../core/dom.js';
import { avatarTone, formatTelefono, formatWhatsApp, initialsFor, relativeTime } from '../core/format.js';
import { icon } from '../core/icons.js';
import { actualizarResumenAtencion, cambiarPreferencias, estadoConexion, marcarConversacionVisible, pedirPermisoAvisos, permisoAvisos, preferenciasAvisos } from '../core/realtime.js';
import { screenInterval, setPullToRefresh } from '../core/screen.js';
import { buildSegmented } from '../ui/controls.js';
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
// Con la conexión en vivo los cambios llegan solos; el sondeo queda de respaldo
// para cuando se cae (cada 20 s) y como red de seguridad (cada 90 s).
const SONDEO_MS = 20_000;
const RESPALDO_EN_VIVO_MS = 90_000;
const ESPERA_EVENTO_MS = 400;

function etiquetaEstado(estado) {
  return ESTADOS[estado] ?? { label: estado, plural: estado, color: '#64748b' };
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

/** Texto del botón de asignación según quién la tiene. */
function textoAsignacion(asignado, yo) {
  if (!asignado) return 'Sin asignar';
  return yo && asignado.id === yo ? 'Asignada a ti' : `Asignada a ${asignado.nombre}`;
}

let filtros = { estado: 'open', asignado: 'todas', equipo: '' };
let equipo = { agentes: [], equipos: [], yo: null, miEquipoId: null };
let equipoCargado = false;
let lista = [];
let abierta = null;       // id de la conversación abierta
let listaSeq = 0;
let hiloSeq = 0;
const borradores = new Map(); // id → { texto, privado }
let cabeceraPintada = '';    // estado y asignación que muestra la cabecera del hilo
let ultimaCargaLista = 0;
let ultimaCargaHilo = 0;
let eventoTimer = null;
let idsConEvento = new Set();

async function renderAtencion(main) {
  abierta = null;
  marcarConversacionVisible(null);
  hiloSeq++;
  main.innerHTML = `
    <div class="page-header">
      <div><h1>🎧 Atención</h1><div class="subtitle">Conversaciones que el bot pasó a un asesor: responde, asigna y resuelve desde aquí.</div></div>
      <div class="atn-avisos" id="atnAvisos"></div>
    </div>
    <div class="inbox" id="atnInbox">
      <div class="inbox-list glass" id="atnLista">
        <div class="inbox-filter-wrap" id="atnEstadoWrap"></div>
        <div class="atn-filtros">
          <div id="atnAsignadoWrap" class="atn-asignado"></div>
          <select id="atnEquipo" class="atn-select" aria-label="Filtrar por equipo"><option value="">Todos los equipos</option></select>
        </div>
        <div class="inbox-rows" id="atnFilas" aria-busy="true" aria-label="Cargando conversaciones">${filasEsqueleto()}</div>
      </div>
      <div class="inbox-thread glass" id="atnHilo">
        <div class="inbox-empty"><div style="font-size:40px;">🎧</div>Selecciona una conversación</div>
      </div>
    </div>
  `;
  $('#atnEstadoWrap').appendChild(buildSegmented(
    Object.entries(ESTADOS).map(([value, e]) => ({ value, label: e.plural })),
    filtros.estado, (v) => { filtros.estado = v; cargarLista(); },
  ));
  $('#atnEquipo').addEventListener('change', (e) => { filtros.equipo = e.target.value; cargarLista(); });
  setPullToRefresh(() => cargarLista());
  screenInterval(() => {
    const respaldo = estadoConexion() !== 'conectado' ? SONDEO_MS : RESPALDO_EN_VIVO_MS;
    if (Date.now() - ultimaCargaLista >= respaldo - 1000) cargarLista({ silencioso: true });
    if (abierta && Date.now() - ultimaCargaHilo >= respaldo - 1000) cargarHilo(abierta, { silencioso: true });
  }, SONDEO_MS);
  escucharEnVivo();
  pintarAvisos();

  if (!equipoCargado) await cargarEquipo();
  pintarFiltroEquipo();
  cargarLista();
}

/* Los oyentes viven en window y la pantalla no tiene un "al salir": cada uno
   se quita solo la primera vez que llega un evento y la bandeja ya no está. */
function escucharEnVivo() {
  const enPantalla = () => !!$('#atnInbox');
  const alEvento = (e) => {
    if (!enPantalla()) { window.removeEventListener('tooli:atencion', alEvento); return; }
    // Varios eventos seguidos (el panel y el webhook avisan del mismo
    // mensaje) se resuelven con una sola recarga.
    idsConEvento.add(e.detail?.conversacionId);
    clearTimeout(eventoTimer);
    eventoTimer = setTimeout(() => {
      const ids = idsConEvento;
      idsConEvento = new Set();
      cargarLista({ silencioso: true });
      if (abierta && ids.has(abierta)) cargarHilo(abierta, { silencioso: true });
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
  wrap.innerHTML = `
    <span class="atn-conexion atn-conexion-${conexion}" role="status">${conexion === 'conectado' ? 'En vivo' : conexion === 'reconectando' ? 'Reconectando…' : 'Actualiza cada 20 s'}</span>
    ${avisoTexto ? `<button type="button" class="btn btn-ghost atn-accion" id="atnAvisoBtn" ${permiso === 'denied' ? 'title="El navegador los bloqueó: actívalos en la configuración del sitio"' : 'title="Avisos del sistema cuando llega un mensaje y no estás mirando esta pestaña"'}>${icon('bell', 14)}<span>${avisoTexto}</span></button>` : ''}
    <button type="button" class="btn btn-ghost atn-accion" id="atnSonidoBtn" aria-pressed="${prefs.sonido}" title="Tono cuando llega un mensaje">${prefs.sonido ? '🔊' : '🔇'}<span class="hide-sm">${prefs.sonido ? 'Sonido' : 'Sin sonido'}</span></button>
  `;
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
    const r = await api('/api/tools/atencion/equipo');
    if (!r?.ok) return;
    equipo = await r.json();
    equipoCargado = true;
    // Primera vez: el asesor de un área ve primero las de su equipo.
    if (equipo.miEquipoId && !filtros.equipo) filtros.equipo = String(equipo.miEquipoId);
  } catch { /* sin equipo la bandeja funciona igual, solo sin filtros ni asignación */ }
}

function pintarFiltroEquipo() {
  const sel = $('#atnEquipo');
  if (!sel) return;
  sel.innerHTML = '<option value="">Todos los equipos</option>' +
    equipo.equipos.map(e => `<option value="${e.id}">${escapeHtml(e.nombre)}</option>`).join('');
  sel.value = filtros.equipo;
  sel.hidden = equipo.equipos.length === 0;
}

async function cargarLista({ silencioso = false } = {}) {
  const filas = $('#atnFilas');
  if (!filas) return;
  const seq = ++listaSeq;
  if (!silencioso) { filas.setAttribute('aria-busy', 'true'); filas.innerHTML = filasEsqueleto(); }
  const params = new URLSearchParams({ estado: filtros.estado, asignado: filtros.asignado, ...(filtros.equipo ? { equipo: filtros.equipo } : {}) });
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
  filas.innerHTML = lista.map(c => `
    <button type="button" class="inbox-row atn-row${c.id === abierta ? ' activa' : ''}" data-id="${c.id}">
      <div class="avatar" style="background:${avatarTone(c.contacto.telefono || String(c.id))}">${initialsFor(c.contacto.telefono, c.contacto.nombre)}</div>
      <div class="inbox-row-body">
        <div class="inbox-row-top">
          <span class="inbox-row-name">${escapeHtml(c.contacto.nombre)}</span>
          <span class="inbox-row-time">${c.actividadTs ? relativeTime(c.actividadTs) : ''}</span>
        </div>
        <div class="inbox-row-preview">${escapeHtml(vistaPrevia(c.ultimoMensaje))}</div>
        <div class="atn-row-meta">
          <span class="atn-chip ${c.asignado ? '' : 'atn-chip-alerta'}">${icon('user', 11)} ${escapeHtml(textoAsignacion(c.asignado, equipo.yo))}</span>
          ${c.equipo ? `<span class="atn-chip">${escapeHtml(c.equipo.nombre)}</span>` : ''}
          ${c.noLeidos ? `<span class="atn-no-leidos" aria-label="${c.noLeidos} sin leer">${c.noLeidos}</span>` : ''}
        </div>
      </div>
    </button>
  `).join('') + (truncado ? '<div class="atn-truncado">Se muestran las 100 más recientes.</div>' : '');
  $$('.atn-row', filas).forEach(row => row.addEventListener('click', () => abrirHilo(Number(row.dataset.id))));
}

function abrirHilo(id) {
  guardarBorrador();
  abierta = id;
  marcarConversacionVisible(id);
  $$('.atn-row').forEach(r => r.classList.toggle('activa', Number(r.dataset.id) === id));
  $('#atnInbox').classList.add('thread-open');
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
  guardarBorrador();
  abierta = null;
  marcarConversacionVisible(null);
  hiloSeq++;
  $('#atnInbox')?.classList.remove('thread-open');
  const hilo = $('#atnHilo');
  if (hilo) hilo.innerHTML = '<div class="inbox-empty"><div style="font-size:40px;">🎧</div>Selecciona una conversación</div>';
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
      return `<div class="atn-nota"><div class="atn-nota-autor">📝 Nota privada${m.autor ? ` · ${escapeHtml(m.autor)}` : ''}</div>${formatWhatsApp(escapeHtml(m.texto))}${adjuntos}<span class="bubble-time">${hora}</span></div>`;
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
  return JSON.stringify([c.id, c.estado, c.asignado?.id ?? null, c.equipo?.id ?? null]);
}

function pintarCabecera(c) {
  cabeceraPintada = claveCabecera(c);
  const est = etiquetaEstado(c.estado);
  const cab = $('#atnCabecera');
  if (!cab) return;
  cab.innerHTML = `
    <button type="button" class="mobile-only back-link" id="atnVolver" aria-label="Volver a la lista" style="margin:0;">${icon('chevronLeft', 18)}</button>
    <div class="avatar" style="background:${avatarTone(c.contacto.telefono || String(c.id))};width:36px;height:36px;font-size:13px;">${initialsFor(c.contacto.telefono, c.contacto.nombre)}</div>
    <div class="atn-cabecera-info">
      <div class="atn-cabecera-nombre">${escapeHtml(c.contacto.nombre)}</div>
      <div class="atn-cabecera-sub">${c.contacto.telefono ? formatTelefono(c.contacto.telefono) : ''}
        <span class="atn-estado" style="color:${est.color};background:${est.color}1a;">${est.label}</span></div>
    </div>
    <div class="atn-acciones">
    ${c.contacto.telefono ? `<button type="button" class="btn btn-ghost atn-accion" id="atnHistorial" title="Todo lo que habló con el bot">${icon('message', 14)}<span class="hide-sm">Historial</span></button>` : ''}
    ${c.estado === 'resolved'
      ? '<button type="button" class="btn btn-secondary atn-accion" data-estado="open">Reabrir</button>'
      : `${c.estado === 'open' ? '<button type="button" class="btn btn-ghost atn-accion" data-estado="pending" title="Esperando algo de la persona o de otra área">Pendiente</button>' : '<button type="button" class="btn btn-ghost atn-accion" data-estado="open">Abrir</button>'}
         <button type="button" class="btn btn-primary atn-accion" data-estado="resolved" title="Cierra la conversación y se lo avisa a la persona">Resolver</button>`}
    </div>
  `;
  $('#atnVolver').addEventListener('click', cerrarHilo);
  $('#atnHistorial')?.addEventListener('click', () => abrirConversacion(c.contacto.telefono));
  $$('.atn-accion[data-estado]', cab).forEach(b => b.addEventListener('click', () => cambiarEstado(c, b.dataset.estado, b)));

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
  `;
  $('#atnAsesor').value = c.asignado ? String(c.asignado.id) : '';
  if ($('#atnEquipoConv')) $('#atnEquipoConv').value = c.equipo ? String(c.equipo.id) : '';
  $('#atnAsesor').addEventListener('change', (e) => asignarConv(c.id, { asesorId: e.target.value ? Number(e.target.value) : null }));
  $('#atnEquipoConv')?.addEventListener('change', (e) => asignarConv(c.id, { equipoId: e.target.value ? Number(e.target.value) : null }));
  $('#atnAsignarme')?.addEventListener('click', () => asignarConv(c.id, { asesorId: 'yo' }));
}

function pintarHilo(data) {
  const c = data.conversacion;
  const hilo = $('#atnHilo');
  const borrador = borradores.get(c.id) ?? { texto: '', privado: false };
  hilo.innerHTML = `
    <div class="inbox-thread-header atn-cabecera" id="atnCabecera"></div>
    <div class="atn-asignacion" id="atnAsignacion"></div>
    <div class="inbox-messages" id="atnMensajes">${htmlMensajes(data.mensajes, data.hayAnteriores)}</div>
    <div class="inbox-thread-footer">
      <div id="atnModoWrap" class="atn-modo"></div>
      <form class="composer${borrador.privado ? ' atn-composer-nota' : ''}" id="atnComposer" autocomplete="off">
        <textarea class="composer-input" id="atnTexto" rows="1" maxlength="4096" aria-label="Escribir a ${escapeHtml(c.contacto.nombre)}"></textarea>
        <button type="submit" class="composer-send" id="atnEnviar" disabled aria-label="Enviar">${icon('send', 18)}</button>
      </form>
      <div class="composer-hint" id="atnPista" aria-live="polite"></div>
    </div>`;
  pintarCabecera(c);
  cablearAnteriores(c.id, data.mensajes);

  const modo = buildSegmented([{ value: 'responder', label: 'Responder' }, { value: 'nota', label: '📝 Nota privada' }],
    borrador.privado ? 'nota' : 'responder', () => actualizarModo());
  modo.id = 'atnModo';
  $('#atnModoWrap').appendChild(modo);

  const input = $('#atnTexto');
  input.value = borrador.texto;
  const ajustar = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    $('#atnEnviar').disabled = !input.value.trim();
  };
  input.addEventListener('input', ajustar);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#atnComposer').requestSubmit(); }
  });
  $('#atnComposer').addEventListener('submit', (e) => { e.preventDefault(); enviar(c); });
  actualizarModo();
  ajustar();
  const msgs = $('#atnMensajes');
  msgs.scrollTop = msgs.scrollHeight;
  // La lista se refresca aparte; al abrir, Chatwoot la marca como leída.
  const fila = $(`.atn-row[data-id="${c.id}"] .atn-no-leidos`);
  fila?.remove();
  actualizarResumenAtencion();
}

function actualizarModo() {
  const privado = modoPrivado();
  $('#atnComposer')?.classList.toggle('atn-composer-nota', privado);
  const input = $('#atnTexto');
  if (input) input.placeholder = privado ? 'Nota solo para el equipo (la persona no la ve)…' : 'Escribe la respuesta por WhatsApp…';
  const pista = $('#atnPista');
  if (pista) pista.textContent = privado ? 'La nota queda en la conversación y solo la ve el equipo.' : 'Enter envía · Shift+Enter salta de línea';
}

async function enviar(c) {
  const input = $('#atnTexto');
  const texto = input.value.trim();
  if (!texto) return;
  const privado = modoPrivado();
  const btn = $('#atnEnviar');
  btn.disabled = true;
  haptic(10);
  try {
    const r = await api(`/api/tools/atencion/conversaciones/${c.id}/mensajes`, { method: 'POST', body: JSON.stringify({ texto, privado }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      // El borrador se queda: el asesor no pierde lo que escribió.
      $('#atnPista').textContent = data.message || 'No se pudo enviar.';
      btn.disabled = false;
      return;
    }
    input.value = '';
    input.style.height = 'auto';
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

export { renderAtencion, etiquetaEstado, vistaPrevia, textoAsignacion };
