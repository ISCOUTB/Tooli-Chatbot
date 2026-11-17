import { api } from '../core/api.js';
import {
  ORIGENES, SECTORES, fechaEvento, filtrarAsistentes, firmaLista, nombreArchivoCsv, resumenAsistentes,
} from '../core/asistencia.js';
import { copyToClipboard, escapeHtml, haptic, toast } from '../core/dom.js';
import { colorTextoLegible, descargarCsv, formatTelefono, relativeTime } from '../core/format.js';
import { icon } from '../core/icons.js';
import { navigate, parametrosRuta } from '../core/router.js';
import { screenInterval, setPullToRefresh } from '../core/screen.js';
import { sesion } from '../core/session.js';
import { buildSegmented } from '../ui/controls.js';
import { abrirDialogo } from '../ui/dialog.js';
import { ActionSheet } from '../ui/sheet.js';

/* ============= ASISTENCIA A EVENTOS =============
   Un asesor crea el evento y proyecta su QR. Quien lo escanea le escribe al
   bot y queda en la lista al autorizar sus datos (src/flows/asistencia.ts).
   La lista también se puede cargar desde Excel o CSV. Todo queda separado por
   evento y por sector, listo para exportar o para enviarle una plantilla. */

const MAX_ARCHIVO_BYTES = 3 * 1024 * 1024;
const CAMPOS_IMPORTACION = [
  ['nombre', 'Nombre'], ['apellido', 'Apellido'], ['whatsapp', 'Celular'],
  ['correo', 'Correo'], ['documento', 'Identificación'], ['programa', 'Programa'],
];

let filtroSector = 'todos';

function badgeSector(sector) {
  const meta = SECTORES[sector] ?? SECTORES.otro;
  return `<span class="badge" style="background:${meta.color}1f;color:${colorTextoLegible(meta.color)};">${escapeHtml(meta.label)}</span>`;
}

function badgeEstado(estado) {
  return estado === 'abierto'
    ? '<span class="badge asis-abierto">Registro abierto</span>'
    : '<span class="badge asis-cerrado">Registro cerrado</span>';
}

async function leerJson(respuesta) {
  return respuesta.json().catch(() => ({}));
}

function renderAsistencia(main) {
  const eventoId = parametrosRuta().get('evento');
  return eventoId ? renderDetalle(main, eventoId) : renderLista(main);
}

/* ───────────────────────── Lista de eventos ───────────────────────── */

async function renderLista(main) {
  main.innerHTML = `
    <div class="page-header">
      <div><h1>${icon('qr', 26)} Asistencia</h1><div class="subtitle">Quién estuvo en cada evento: registro con QR por WhatsApp o lista importada</div></div>
      <div class="asis-acciones">
        <button type="button" class="btn btn-secondary" id="asisRefresh"><span class="refresh-icon">${icon('refresh', 16)}</span> Actualizar</button>
        <button type="button" class="btn btn-primary" id="asisNuevo">${icon('plus', 16)} Nuevo evento</button>
      </div>
    </div>
    <div id="asisFiltro" class="asis-filtro"></div>
    <div id="asisLista">
      ${Array.from({ length: 3 }).map(() => '<div class="card" style="margin-bottom:10px;"><div class="skeleton skeleton-line" style="width:45%;height:14px;margin-bottom:10px;"></div><div class="skeleton skeleton-line" style="width:70%;height:11px;"></div></div>').join('')}
    </div>`;

  let eventos = [];
  let secuencia = 0;
  const contenedor = main.querySelector('#asisLista');

  function pintar() {
    const visibles = filtroSector === 'todos' ? eventos : eventos.filter(e => e.sector === filtroSector);
    const filtro = main.querySelector('#asisFiltro');
    filtro.innerHTML = '';
    if (eventos.length) {
      const cuenta = sector => eventos.filter(e => e.sector === sector).length;
      filtro.appendChild(buildSegmented(
        [
          { value: 'todos', label: `Todos (${eventos.length})` },
          ...Object.entries(SECTORES).filter(([clave]) => cuenta(clave)).map(([clave, meta]) => ({ value: clave, label: `${meta.label} (${cuenta(clave)})` })),
        ],
        filtroSector,
        (valor) => { filtroSector = valor; pintar(); },
      ));
    }
    if (!visibles.length) {
      contenedor.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">${icon('qr', 42)}</div>
          <div class="empty-state-title">${eventos.length ? 'No hay eventos en este sector' : 'Aún no hay eventos'}</div>
          <div class="empty-state-sub">${eventos.length ? 'Prueba con otro filtro.' : 'Crea el primero: obtendrás un QR para que los asistentes se registren desde su WhatsApp.'}</div>
        </div>`;
      return;
    }
    contenedor.innerHTML = `<div class="asis-grid stagger-in">${visibles.map(e => `
      <button type="button" class="card asis-evento" data-evento="${escapeHtml(e.id)}">
        <span class="asis-evento-cuenta"><strong>${escapeHtml(e.asistentes)}</strong><span>asistente${e.asistentes === 1 ? '' : 's'}</span></span>
        <span class="asis-evento-info">
          <span class="asis-evento-nombre">${escapeHtml(e.nombre)}</span>
          <span class="asis-evento-meta">${[fechaEvento(e.fecha), e.lugar].filter(Boolean).map(escapeHtml).join(' · ') || 'Sin fecha ni lugar'}</span>
          <span class="asis-evento-badges">${badgeSector(e.sector)} ${badgeEstado(e.estado)}</span>
        </span>
        <span class="asis-evento-ir" aria-hidden="true">${icon('chevronRight', 16)}</span>
      </button>`).join('')}</div>`;
    contenedor.querySelectorAll('[data-evento]').forEach(boton => boton.addEventListener('click', () => {
      navigate('asistencia', { evento: boton.dataset.evento });
    }));
  }

  async function cargar() {
    const seq = ++secuencia;
    try {
      const r = await api('/api/tools/asistencia/eventos');
      if (!r?.ok) throw new Error('No se pudieron cargar los eventos');
      const data = await r.json();
      if (!contenedor.isConnected || seq !== secuencia) return;
      if (!Array.isArray(data.eventos)) throw new Error('Respuesta inválida');
      eventos = data.eventos;
      if (filtroSector !== 'todos' && !eventos.some(e => e.sector === filtroSector)) filtroSector = 'todos';
      pintar();
    } catch {
      if (!contenedor.isConnected || seq !== secuencia) return;
      contenedor.innerHTML = '<div class="alert alert-error" role="alert">No se pudieron cargar los eventos. <button type="button" class="btn btn-secondary" id="asisRetry">Reintentar</button></div>';
      contenedor.querySelector('#asisRetry')?.addEventListener('click', cargar);
    }
  }

  main.querySelector('#asisRefresh').addEventListener('click', () => {
    main.querySelector('#asisRefresh .refresh-icon')?.classList.add('spin-once');
    cargar();
  });
  main.querySelector('#asisNuevo').addEventListener('click', () => abrirFormularioEvento());
  setPullToRefresh(cargar);
  await cargar();
}

/** Crea un evento (sin `evento`) o edita sus datos. */
function abrirFormularioEvento(evento = null, alGuardar = null) {
  const hoy = new Date();
  const hoyLocal = new Date(hoy.getTime() - hoy.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const dialogo = abrirDialogo({
    titulo: evento ? 'Editar evento' : 'Nuevo evento',
    ayuda: evento ? '' : 'Al crearlo obtienes un QR para que los asistentes se registren desde su WhatsApp.',
    cuerpo: `
      <form id="evtForm" novalidate>
        <div class="field"><label for="evtNombre">Nombre del evento</label><input type="text" id="evtNombre" maxlength="100" value="${escapeHtml(evento?.nombre ?? '')}" placeholder="Feria de posgrados" required></div>
        <div class="field"><label for="evtSector">Sector</label>
          <select id="evtSector">${Object.entries(SECTORES).map(([clave, meta]) => `<option value="${clave}"${(evento?.sector ?? 'posgrado') === clave ? ' selected' : ''}>${escapeHtml(meta.label)}</option>`).join('')}</select>
          <div class="field-help">Sirve para separar los eventos y sus listas por área.</div>
        </div>
        <div class="field"><label for="evtFecha">Fecha</label><input type="date" id="evtFecha" value="${escapeHtml(evento ? evento.fecha : hoyLocal)}"></div>
        <div class="field"><label for="evtLugar">Lugar (opcional)</label><input type="text" id="evtLugar" maxlength="100" value="${escapeHtml(evento?.lugar ?? '')}" placeholder="Auditorio, Campus Tecnológico"></div>
        <div class="password-dialog-message" id="evtMensaje" role="alert" aria-live="polite"></div>
        <div class="password-dialog-actions"><button type="button" class="btn btn-ghost" data-cerrar>Cancelar</button><button type="submit" class="btn btn-primary" id="evtGuardar">${evento ? 'Guardar cambios' : 'Crear evento'}</button></div>
      </form>`,
  });
  const form = dialogo.el.querySelector('#evtForm');
  const mensaje = dialogo.el.querySelector('#evtMensaje');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const nombre = form.querySelector('#evtNombre').value.trim();
    if (nombre.length < 3) { mensaje.textContent = 'Escribe el nombre del evento (mínimo 3 caracteres).'; form.querySelector('#evtNombre').focus(); return; }
    const boton = form.querySelector('#evtGuardar');
    boton.disabled = true;
    mensaje.textContent = '';
    try {
      const cuerpo = { nombre, sector: form.querySelector('#evtSector').value, fecha: form.querySelector('#evtFecha').value, lugar: form.querySelector('#evtLugar').value.trim() };
      const r = await api(evento ? `/api/tools/asistencia/eventos/${evento.id}` : '/api/tools/asistencia/eventos', {
        method: evento ? 'PATCH' : 'POST', body: JSON.stringify(cuerpo),
      });
      if (!r || !dialogo.abierto()) return;
      const data = await leerJson(r);
      if (!r.ok) { mensaje.textContent = data.message || 'No se pudo guardar el evento.'; boton.disabled = false; return; }
      haptic([10, 20, 10]);
      dialogo.cerrar();
      if (evento) { toast('Evento actualizado ✓'); alGuardar?.(data.evento); }
      else { toast('Evento creado ✓'); navigate('asistencia', { evento: data.evento.id }); }
    } catch {
      if (dialogo.abierto()) { mensaje.textContent = 'No se pudo guardar. Revisa tu conexión.'; boton.disabled = false; }
    }
  });
}

/* ───────────────────────── Detalle de un evento ───────────────────────── */

async function renderDetalle(main, eventoId) {
  main.innerHTML = `
    <button type="button" class="back-link" id="asisVolver">${icon('chevronLeft', 16)} Eventos</button>
    <div id="asisDetalle">
      <div class="card"><div class="skeleton skeleton-line" style="width:40%;height:18px;margin-bottom:12px;"></div><div class="skeleton skeleton-line" style="width:65%;height:12px;"></div></div>
    </div>`;
  main.querySelector('#asisVolver').addEventListener('click', () => navigate('asistencia'));
  const raiz = main.querySelector('#asisDetalle');

  let evento = null;
  let asistentes = [];
  let qr = null;
  let busqueda = '';
  let firma = null;
  let cargando = false;
  let proyector = null;

  const puedeEliminar = () => sesion.user?.role === 'admin' || evento?.creadoPor === sesion.user?.username;

  function pintarEstructura() {
    const detalle = [badgeSector(evento.sector), badgeEstado(evento.estado)].join(' ');
    const meta = [fechaEvento(evento.fecha), evento.lugar, `Creado por ${evento.creadoPor}`].filter(Boolean).map(escapeHtml).join(' · ');
    raiz.innerHTML = `
      <div class="page-header">
        <div class="asis-titulo"><h1>${escapeHtml(evento.nombre)}</h1><div class="subtitle">${detalle} <span>${meta}</span></div></div>
        <div class="asis-acciones">
          <button type="button" class="btn btn-secondary" id="asisEditar">${icon('pencil', 15)} Editar</button>
          <button type="button" class="btn btn-secondary" id="asisEstado">${evento.estado === 'abierto' ? `${icon('lock', 15)} Cerrar registro` : `${icon('check', 15)} Reabrir registro`}</button>
        </div>
      </div>
      <div class="stats-grid asis-stats" id="asisStats"></div>
      <div class="asis-cuerpo">
        <section class="card asis-qr" id="asisQr" aria-label="Código QR del evento"></section>
        <section class="card asis-personas">
          <div class="asis-barra">
            <label class="sr-only" for="asisBuscar">Buscar en la lista</label>
            <input type="search" id="asisBuscar" placeholder="Buscar por nombre, correo o celular" value="${escapeHtml(busqueda)}">
            <div class="asis-barra-botones">
              <button type="button" class="btn btn-secondary" id="asisImportar">${icon('upload', 15)} Importar Excel</button>
              <button type="button" class="btn btn-secondary" id="asisAgregar">${icon('plus', 15)} Anotar</button>
              <button type="button" class="btn btn-secondary" id="asisExportar">${icon('download', 15)} Exportar</button>
              <button type="button" class="btn btn-primary" id="asisPlantilla">${icon('megaphone', 15)} Enviar plantilla</button>
            </div>
          </div>
          <div id="asisTabla"></div>
        </section>
      </div>
      ${puedeEliminar() ? `<div class="asis-peligro"><button type="button" class="btn btn-ghost" id="asisEliminar">${icon('trash', 15)} Eliminar evento y su lista</button></div>` : ''}`;

    raiz.querySelector('#asisBuscar').addEventListener('input', (event) => { busqueda = event.target.value; pintarTabla(); });
    raiz.querySelector('#asisEditar').addEventListener('click', () => abrirFormularioEvento(evento, (actualizado) => { evento = actualizado; pintarEstructura(); pintarDatos(true); }));
    raiz.querySelector('#asisEstado').addEventListener('click', cambiarEstado);
    raiz.querySelector('#asisImportar').addEventListener('click', () => abrirImportacion(evento, () => cargar()));
    raiz.querySelector('#asisAgregar').addEventListener('click', () => abrirAnotarPersona(evento, () => cargar()));
    raiz.querySelector('#asisExportar').addEventListener('click', exportar);
    raiz.querySelector('#asisPlantilla').addEventListener('click', () => navigate('plantillas', { evento: evento.id }));
    raiz.querySelector('#asisEliminar')?.addEventListener('click', eliminarEvento);
    pintarQr();
  }

  function pintarQr() {
    const caja = raiz.querySelector('#asisQr');
    if (!caja) return;
    const codigo = `<div class="asis-codigo" aria-label="Código del evento">${escapeHtml(evento.codigo)}</div>`;
    if (evento.estado !== 'abierto') {
      caja.classList.add('sin-imagen');
      caja.innerHTML = `
        <div class="asis-qr-info">
          <h2>Registro cerrado</h2>
          <p class="asis-qr-ayuda">El QR ya no anota a nadie. Puedes seguir importando una lista, anotar personas a mano o reabrir el registro.</p>
          ${codigo}
        </div>`;
      return;
    }
    if (!qr) {
      caja.classList.remove('sin-imagen');
      caja.innerHTML = '<div class="skeleton asis-qr-imagen"></div><div class="asis-qr-info"><h2>QR de asistencia</h2></div>';
      return;
    }
    caja.classList.toggle('sin-imagen', !qr.imagen);
    caja.innerHTML = `
      ${qr.imagen ? `<img class="asis-qr-imagen" src="${escapeHtml(qr.imagen)}" alt="Código QR para registrar la asistencia a ${escapeHtml(evento.nombre)}">` : ''}
      <div class="asis-qr-info">
        <h2>QR de asistencia</h2>
        ${qr.imagen
          ? '<p class="asis-qr-ayuda">Quien lo escanea abre WhatsApp con el mensaje listo. Al enviarlo y autorizar sus datos queda en la lista, sin que nadie la digite.</p>'
          : `<div class="alert alert-warning" role="status">No se conoce el número de WhatsApp del bot, así que no hay QR. Pide a los asistentes que le escriban al bot este mensaje:</div>
             <p class="asis-qr-texto">${escapeHtml(qr.texto)}</p>`}
        ${codigo}
        <div class="asis-qr-botones">
          ${qr.imagen ? `<button type="button" class="btn btn-primary" id="asisProyectar">${icon('expand', 15)} Proyectar</button>` : ''}
          <button type="button" class="btn btn-secondary" id="asisCopiar">${icon('copy', 15)} ${qr.enlace ? 'Copiar enlace' : 'Copiar mensaje'}</button>
          ${qr.imagen ? `<a class="btn btn-secondary" id="asisDescargar" href="${escapeHtml(qr.imagen)}" download="qr-${escapeHtml(evento.codigo)}.png">${icon('download', 15)} Descargar</a>` : ''}
        </div>
      </div>`;
    caja.querySelector('#asisCopiar')?.addEventListener('click', () => copyToClipboard(qr.enlace ?? qr.texto, qr.enlace ? 'Enlace copiado' : 'Mensaje copiado'));
    caja.querySelector('#asisProyectar')?.addEventListener('click', abrirProyector);
  }

  function pintarStats() {
    const r = resumenAsistentes(asistentes);
    const caja = raiz.querySelector('#asisStats');
    if (!caja) return;
    caja.innerHTML = [
      ['Asistentes', r.total, ''],
      ['Por QR', r.porQr, 'escanearon y le escribieron al bot'],
      ['Con WhatsApp', r.conWhatsapp, 'tienen un número registrado'],
      ['Se les puede escribir', r.contactables, 'autorizaron el contacto'],
    ].map(([label, valor, ayuda]) => `<div class="stat-card"><div class="label">${label}</div><div class="value">${escapeHtml(valor)}</div>${ayuda ? `<div class="asis-stat-ayuda">${ayuda}</div>` : ''}</div>`).join('');
    const cuenta = proyector?.querySelector('#asisProyectorCuenta');
    if (cuenta) cuenta.textContent = String(r.porQr);
  }

  function pintarTabla() {
    const caja = raiz.querySelector('#asisTabla');
    if (!caja) return;
    const visibles = filtrarAsistentes(asistentes, busqueda);
    if (!asistentes.length) {
      caja.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">${icon('users', 40)}</div>
          <div class="empty-state-title">Todavía no hay nadie en la lista</div>
          <div class="empty-state-sub">${evento.estado === 'abierto' ? 'Proyecta el QR: cada persona que lo escanee aparecerá aquí sola.' : 'Importa una lista o anota a los asistentes a mano.'}</div>
        </div>`;
      return;
    }
    if (!visibles.length) {
      caja.innerHTML = '<div class="widget-empty">Nadie coincide con esa búsqueda.</div>';
      return;
    }
    caja.innerHTML = `
      <div class="asis-tabla-wrap">
        <table>
          <caption class="sr-only">Asistentes de ${escapeHtml(evento.nombre)}</caption>
          <thead><tr><th scope="col">Nombre</th><th scope="col">WhatsApp</th><th scope="col">Correo</th><th scope="col">Programa</th><th scope="col">Origen</th><th scope="col">Registro</th><th scope="col"><span class="sr-only">Acciones</span></th></tr></thead>
          <tbody>${visibles.map(a => `
            <tr>
              <td><strong>${escapeHtml(a.nombre || 'Sin nombre')}</strong>${a.documento ? `<span class="asis-sub">ID ${escapeHtml(a.documento)}</span>` : ''}</td>
              <td>${a.whatsapp ? escapeHtml(formatTelefono(a.whatsapp)) : '<span class="asis-vacio">—</span>'}${a.whatsapp && !a.consentimiento ? '<span class="asis-sub">sin autorización de contacto</span>' : ''}</td>
              <td>${a.correo ? escapeHtml(a.correo) : '<span class="asis-vacio">—</span>'}</td>
              <td>${a.programa ? escapeHtml(a.programa) : '<span class="asis-vacio">—</span>'}</td>
              <td><span class="badge asis-origen-${escapeHtml(a.origen)}">${escapeHtml(ORIGENES[a.origen] ?? a.origen)}</span></td>
              <td title="${escapeHtml(new Date(a.registradoEn).toLocaleString('es-CO'))}">${escapeHtml(relativeTime(a.registradoEn))}</td>
              <td><button type="button" class="btn btn-ghost asis-quitar" data-clave="${escapeHtml(a.clave)}" aria-label="Quitar a ${escapeHtml(a.nombre || 'esta persona')} de la lista">${icon('x', 15)}</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="asis-pie">${visibles.length === asistentes.length ? `${asistentes.length} persona${asistentes.length === 1 ? '' : 's'}` : `${visibles.length} de ${asistentes.length} personas`}</div>`;
    caja.querySelectorAll('.asis-quitar').forEach(boton => boton.addEventListener('click', () => quitarPersona(boton.dataset.clave)));
  }

  function pintarDatos(forzar = false) {
    const nueva = firmaLista(asistentes);
    if (!forzar && nueva === firma) return;
    firma = nueva;
    pintarStats();
    pintarTabla();
  }

  async function cargar({ silencioso = false } = {}) {
    if (cargando) return;
    cargando = true;
    try {
      const r = await api(`/api/tools/asistencia/eventos/${encodeURIComponent(eventoId)}`);
      if (!raiz.isConnected || !r) return;
      if (r.status === 404) {
        raiz.innerHTML = '<div class="alert alert-error" role="alert">Este evento ya no existe.</div>';
        return;
      }
      if (!r.ok) throw new Error('No se pudo cargar el evento');
      const data = await r.json();
      if (!raiz.isConnected) return;
      const primera = !evento;
      const cambioEstado = evento && evento.estado !== data.evento.estado;
      evento = data.evento;
      asistentes = Array.isArray(data.asistentes) ? data.asistentes : [];
      if (primera || cambioEstado) { pintarEstructura(); pintarDatos(true); }
      else pintarDatos();
      if (primera) void cargarQr();
    } catch {
      if (raiz.isConnected && !silencioso && !evento) {
        raiz.innerHTML = '<div class="alert alert-error" role="alert">No se pudo cargar el evento. <button type="button" class="btn btn-secondary" id="asisRetry">Reintentar</button></div>';
        raiz.querySelector('#asisRetry')?.addEventListener('click', () => cargar());
      } else if (raiz.isConnected && !silencioso) {
        toast('No se pudo actualizar la lista');
      }
    } finally {
      cargando = false;
    }
  }

  async function cargarQr() {
    try {
      const r = await api(`/api/tools/asistencia/eventos/${encodeURIComponent(eventoId)}/qr`);
      if (!raiz.isConnected || !r?.ok) throw new Error();
      qr = await r.json();
    } catch {
      qr = { texto: `Registrar mi asistencia: ${evento.codigo}`, enlace: null, imagen: null };
    }
    if (raiz.isConnected) pintarQr();
  }

  async function cambiarEstado() {
    const cerrar = evento.estado === 'abierto';
    const boton = raiz.querySelector('#asisEstado');
    boton.disabled = true;
    try {
      const r = await api(`/api/tools/asistencia/eventos/${evento.id}`, { method: 'PATCH', body: JSON.stringify({ estado: cerrar ? 'cerrado' : 'abierto' }) });
      if (!raiz.isConnected || !r) return;
      const data = await leerJson(r);
      if (!r.ok) throw new Error(data.message);
      evento = data.evento;
      cerrarProyector();
      toast(cerrar ? 'Registro cerrado: el QR ya no anota a nadie' : 'Registro abierto de nuevo');
      pintarEstructura();
      pintarDatos(true);
    } catch (err) {
      if (raiz.isConnected) { toast(err?.message || 'No se pudo cambiar el estado'); boton.disabled = false; }
    }
  }

  function exportar() {
    if (!asistentes.length) { toast('La lista está vacía'); return; }
    const visibles = filtrarAsistentes(asistentes, busqueda);
    descargarCsv(
      nombreArchivoCsv(evento.nombre),
      ['Nombre', 'WhatsApp', 'Correo', 'Identificación', 'Programa', 'Origen', 'Autorizó contacto', 'Registro'],
      visibles.map(a => [
        a.nombre, a.whatsapp ? `+${a.whatsapp}` : '', a.correo, a.documento, a.programa, ORIGENES[a.origen] ?? a.origen,
        a.consentimiento ? 'Sí' : 'No', new Date(a.registradoEn).toLocaleString('es-CO'),
      ]),
    );
    toast(`${visibles.length} persona${visibles.length === 1 ? '' : 's'} exportada${visibles.length === 1 ? '' : 's'} ✓`);
  }

  function quitarPersona(clave) {
    const persona = asistentes.find(a => a.clave === clave);
    if (!persona) return;
    ActionSheet.open({
      title: `¿Quitar a ${persona.nombre || 'esta persona'} de la lista?`,
      subtitle: 'Deja de contar como asistente de este evento. No se puede deshacer.',
      groups: [
        [{ label: 'Quitar de la lista', icon: icon('trash', 16), destructive: true, onClick: async () => {
          try {
            const r = await api(`/api/tools/asistencia/eventos/${evento.id}/asistentes`, { method: 'DELETE', body: JSON.stringify({ clave }) });
            if (!r?.ok) throw new Error();
            toast('Persona quitada de la lista');
          } catch { toast('No se pudo quitar'); }
          await cargar();
        } }],
        [{ label: 'Cancelar', cancel: true }],
      ],
    });
  }

  function eliminarEvento() {
    ActionSheet.open({
      title: `¿Eliminar "${evento.nombre}"?`,
      subtitle: `Se borra el evento con sus ${asistentes.length} asistente${asistentes.length === 1 ? '' : 's'} y el QR deja de funcionar. No se puede deshacer.`,
      groups: [
        [{ label: 'Eliminar evento y lista', icon: icon('trash', 16), destructive: true, onClick: async () => {
          try {
            const r = await api(`/api/tools/asistencia/eventos/${evento.id}`, { method: 'DELETE' });
            if (!r) return;
            if (!r.ok) throw new Error((await leerJson(r)).message);
            toast('Evento eliminado');
            navigate('asistencia');
          } catch (err) { toast(err?.message || 'No se pudo eliminar'); }
        } }],
        [{ label: 'Conservar', cancel: true }],
      ],
    });
  }

  function cerrarProyector() {
    if (!proyector) return;
    document.removeEventListener('keydown', teclaProyector);
    window.removeEventListener('hashchange', cerrarProyector);
    proyector.remove();
    proyector = null;
  }
  function teclaProyector(event) {
    if (event.key === 'Escape') { event.preventDefault(); cerrarProyector(); }
  }
  /* Pantalla completa para el videobeam: el QR grande y el contador en vivo. */
  function abrirProyector() {
    if (proyector || !qr?.imagen) return;
    proyector = document.createElement('div');
    proyector.className = 'asis-proyector';
    proyector.setAttribute('role', 'dialog');
    proyector.setAttribute('aria-modal', 'true');
    proyector.setAttribute('aria-label', `QR de asistencia de ${evento.nombre}`);
    proyector.innerHTML = `
      <button type="button" class="asis-proyector-cerrar" aria-label="Cerrar">${icon('x', 22)}</button>
      <div class="asis-proyector-texto">
        <p class="asis-proyector-paso">Registra tu asistencia</p>
        <h2>${escapeHtml(evento.nombre)}</h2>
        <ol><li>Escanea el código con la cámara</li><li>Envía el mensaje que aparece en WhatsApp</li><li>Autoriza tus datos y escribe tu nombre</li></ol>
        <p class="asis-proyector-cuenta"><strong id="asisProyectorCuenta">${resumenAsistentes(asistentes).porQr}</strong> registrados</p>
      </div>
      <img src="${escapeHtml(qr.imagen)}" alt="Código QR de asistencia">`;
    document.body.appendChild(proyector);
    proyector.querySelector('.asis-proyector-cerrar').addEventListener('click', cerrarProyector);
    document.addEventListener('keydown', teclaProyector);
    window.addEventListener('hashchange', cerrarProyector);
    proyector.querySelector('.asis-proyector-cerrar').focus({ preventScroll: true });
  }

  setPullToRefresh(() => cargar());
  await cargar();
  // Mientras el registro está abierto la lista crece sola: se consulta cada
  // pocos segundos, sin repintar si nada cambió.
  screenInterval(() => {
    if (!raiz.isConnected || document.hidden || evento?.estado !== 'abierto') return;
    void cargar({ silencioso: true });
  }, 6000);
}

/* ───────────────────────── Anotar a una persona ───────────────────────── */

function abrirAnotarPersona(evento, alGuardar) {
  const dialogo = abrirDialogo({
    titulo: 'Anotar asistente',
    ayuda: 'Para quien estuvo en el evento y no pudo escanear el QR.',
    cuerpo: `
      <form id="perForm" novalidate>
        <div class="field"><label for="perNombre">Nombre completo</label><input type="text" id="perNombre" maxlength="120" required></div>
        <div class="field"><label for="perCelular">Celular (opcional)</label><input type="tel" id="perCelular" autocomplete="off" placeholder="3001234567"><div class="field-help">10 dígitos, o con indicativo si no es de Colombia.</div></div>
        <div class="field"><label for="perCorreo">Correo (opcional)</label><input type="email" id="perCorreo" maxlength="254" autocomplete="off"></div>
        <div class="field"><label for="perDocumento">Identificación (opcional)</label><input type="text" id="perDocumento" maxlength="20" autocomplete="off"></div>
        <div class="field"><label for="perPrograma">Programa (opcional)</label><input type="text" id="perPrograma" maxlength="120"></div>
        <label class="asis-check"><input type="checkbox" id="perConsentimiento"> <span>Autorizó que la UTB la contacte y el tratamiento de sus datos (Ley 1581)</span></label>
        <div class="password-dialog-message" id="perMensaje" role="alert" aria-live="polite"></div>
        <div class="password-dialog-actions"><button type="button" class="btn btn-ghost" data-cerrar>Cancelar</button><button type="submit" class="btn btn-primary" id="perGuardar">Anotar</button></div>
      </form>`,
  });
  const form = dialogo.el.querySelector('#perForm');
  const mensaje = dialogo.el.querySelector('#perMensaje');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const valor = id => form.querySelector(id).value.trim();
    if (valor('#perNombre').length < 3) { mensaje.textContent = 'Escribe el nombre completo.'; form.querySelector('#perNombre').focus(); return; }
    const boton = form.querySelector('#perGuardar');
    boton.disabled = true;
    mensaje.textContent = '';
    try {
      const r = await api(`/api/tools/asistencia/eventos/${evento.id}/asistentes`, {
        method: 'POST',
        body: JSON.stringify({
          nombre: valor('#perNombre'), whatsapp: valor('#perCelular'), correo: valor('#perCorreo'),
          documento: valor('#perDocumento'), programa: valor('#perPrograma'),
          consentimiento: form.querySelector('#perConsentimiento').checked,
        }),
      });
      if (!r || !dialogo.abierto()) return;
      const data = await leerJson(r);
      if (!r.ok) { mensaje.textContent = data.message || 'No se pudo anotar.'; boton.disabled = false; return; }
      haptic([10, 20, 10]);
      toast(data.nuevo ? 'Asistente anotado ✓' : 'Ya estaba en la lista: se completaron sus datos');
      dialogo.cerrar();
      alGuardar?.();
    } catch {
      if (dialogo.abierto()) { mensaje.textContent = 'No se pudo anotar. Revisa tu conexión.'; boton.disabled = false; }
    }
  });
}

/* ───────────────────────── Importar Excel o CSV ───────────────────────── */

function leerComoBase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(',')[1] ?? '');
    lector.onerror = () => reject(new Error('No se pudo leer el archivo'));
    lector.readAsDataURL(archivo);
  });
}

function abrirImportacion(evento, alImportar) {
  const dialogo = abrirDialogo({
    titulo: 'Importar lista',
    ayuda: 'Un archivo de Excel (.xlsx) o CSV con una fila de encabezados. Si ya tomaste la asistencia en otro sistema, exporta su reporte y súbelo aquí.',
    ancho: true,
    cuerpo: `
      <div class="field">
        <label for="impArchivo">Archivo</label>
        <input type="file" id="impArchivo" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
        <div class="field-help">Máximo 3 MB y 5.000 personas. Se reconocen columnas como Nombre, Celular, Correo, Identificación y Programa.</div>
      </div>
      <div id="impPrevia"></div>
      <div class="password-dialog-message" id="impMensaje" role="alert" aria-live="polite"></div>
      <div class="password-dialog-actions"><button type="button" class="btn btn-ghost" data-cerrar>Cancelar</button><button type="button" class="btn btn-primary" id="impConfirmar" disabled>Importar</button></div>`,
  });
  const el = dialogo.el;
  const mensaje = el.querySelector('#impMensaje');
  const previa = el.querySelector('#impPrevia');
  const confirmar = el.querySelector('#impConfirmar');
  let archivo = null;      // { base64, nombre }
  let mapeo = null;
  let secuencia = 0;

  async function pedir(confirmado) {
    const seq = ++secuencia;
    mensaje.textContent = '';
    confirmar.disabled = true;
    try {
      const r = await api(`/api/tools/asistencia/eventos/${evento.id}/importar`, {
        method: 'POST',
        body: JSON.stringify({
          archivo: archivo.base64, nombreArchivo: archivo.nombre, mapeo, confirmar: confirmado,
          consentimiento: el.querySelector('#impConsentimiento')?.checked === true,
        }),
      });
      if (!r || !dialogo.abierto() || seq !== secuencia) return null;
      const data = await leerJson(r);
      if (!r.ok) { mensaje.textContent = data.message || 'No se pudo leer el archivo.'; return null; }
      return data;
    } catch {
      if (dialogo.abierto() && seq === secuencia) mensaje.textContent = 'No se pudo enviar el archivo. Revisa tu conexión.';
      return null;
    }
  }

  function pintarPrevia(data) {
    mapeo = data.mapeo;
    const opciones = (campo) => `<option value="">— No usar —</option>${data.columnas.map((columna, i) => `<option value="${i}"${data.mapeo[campo] === i ? ' selected' : ''}>${escapeHtml(columna)}</option>`).join('')}`;
    const avisos = [
      data.omitidas ? `${data.omitidas} fila${data.omitidas === 1 ? '' : 's'} sin nombre ni contacto se omite${data.omitidas === 1 ? '' : 'n'}` : '',
      data.celularesInvalidos ? `${data.celularesInvalidos} celular${data.celularesInvalidos === 1 ? ' no es válido' : 'es no son válidos'} y queda${data.celularesInvalidos === 1 ? '' : 'n'} en blanco` : '',
      data.sinWhatsapp ? `${data.sinWhatsapp} persona${data.sinWhatsapp === 1 ? '' : 's'} sin celular: no se le${data.sinWhatsapp === 1 ? '' : 's'} podrá escribir por WhatsApp` : '',
    ].filter(Boolean);
    previa.innerHTML = `
      <div class="alert alert-info" role="status"><strong>${data.validas} persona${data.validas === 1 ? '' : 's'}</strong> lista${data.validas === 1 ? '' : 's'} para importar de ${data.totalFilas} fila${data.totalFilas === 1 ? '' : 's'}.${avisos.length ? `<ul class="asis-avisos">${avisos.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>` : ''}</div>
      <fieldset class="asis-mapeo">
        <legend>¿Qué columna es cada dato?</legend>
        ${CAMPOS_IMPORTACION.map(([campo, etiqueta]) => `<div class="field"><label for="imp_${campo}">${etiqueta}</label><select id="imp_${campo}" data-campo="${campo}">${opciones(campo)}</select></div>`).join('')}
      </fieldset>
      ${data.muestra?.length ? `
        <div class="asis-tabla-wrap asis-muestra">
          <table><caption>Así quedarían las primeras ${data.muestra.length}</caption>
            <thead><tr><th scope="col">Nombre</th><th scope="col">Celular</th><th scope="col">Correo</th><th scope="col">Identificación</th><th scope="col">Programa</th></tr></thead>
            <tbody>${data.muestra.map(a => `<tr><td>${escapeHtml(a.nombre || '—')}</td><td>${a.whatsapp ? escapeHtml(formatTelefono(a.whatsapp)) : '—'}</td><td>${escapeHtml(a.correo || '—')}</td><td>${escapeHtml(a.documento || '—')}</td><td>${escapeHtml(a.programa || '—')}</td></tr>`).join('')}</tbody>
          </table>
        </div>` : ''}
      <label class="asis-check"><input type="checkbox" id="impConsentimiento"> <span>Estas personas autorizaron que la UTB las contacte (Ley 1581). Sin esto quedan en la lista, pero no se les envían plantillas.</span></label>`;
    previa.querySelectorAll('select[data-campo]').forEach(select => select.addEventListener('change', async () => {
      const nuevo = {};
      previa.querySelectorAll('select[data-campo]').forEach(s => { nuevo[s.dataset.campo] = s.value === '' ? null : Number(s.value); });
      mapeo = nuevo;
      const marcado = el.querySelector('#impConsentimiento')?.checked === true;
      const otra = await pedir(false);
      if (otra) { pintarPrevia(otra); el.querySelector('#impConsentimiento').checked = marcado; }
    }));
    confirmar.disabled = data.validas === 0;
    confirmar.textContent = data.validas ? `Importar ${data.validas} persona${data.validas === 1 ? '' : 's'}` : 'Importar';
  }

  el.querySelector('#impArchivo').addEventListener('change', async (event) => {
    const elegido = event.target.files?.[0];
    previa.innerHTML = '';
    archivo = null;
    mapeo = null;
    confirmar.disabled = true;
    confirmar.textContent = 'Importar';
    mensaje.textContent = '';
    if (!elegido) return;
    if (elegido.size > MAX_ARCHIVO_BYTES) { mensaje.textContent = 'El archivo supera 3 MB. Deja solo la hoja con la lista o guárdalo como CSV.'; return; }
    previa.innerHTML = '<div class="asis-leyendo"><span class="spinner"></span> Leyendo el archivo…</div>';
    try {
      archivo = { base64: await leerComoBase64(elegido), nombre: elegido.name };
    } catch {
      previa.innerHTML = '';
      mensaje.textContent = 'No se pudo leer el archivo.';
      return;
    }
    const data = await pedir(false);
    if (!dialogo.abierto()) return;
    if (data) pintarPrevia(data);
    else previa.innerHTML = '';
  });

  confirmar.addEventListener('click', async () => {
    if (!archivo) return;
    confirmar.textContent = 'Importando…';
    const data = await pedir(true);
    if (!dialogo.abierto()) return;
    if (!data) { confirmar.disabled = false; confirmar.textContent = 'Reintentar'; return; }
    haptic([10, 20, 10]);
    const partes = [`${data.nuevos} nuevo${data.nuevos === 1 ? '' : 's'}`];
    if (data.actualizados) partes.push(`${data.actualizados} ya estaba${data.actualizados === 1 ? '' : 'n'}`);
    if (data.sinCupo) partes.push(`${data.sinCupo} sin cupo`);
    toast(`Lista importada: ${partes.join(', ')}`, 3500);
    dialogo.cerrar();
    alImportar?.();
  });
}

export { renderAsistencia };
