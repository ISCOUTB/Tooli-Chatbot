import { api } from '../core/api.js';
import {
  AREAS, DIAS_LARGOS, ESTADOS_CITA, ORDEN_DIAS, agruparPorDia, citasPorTramo, disponibilidadDesdeForm, errorDeForm, etiquetaDia,
  etiquetaDiaLarga, fechaDeIso, formDesdeDisponibilidad, horaCorta, hoyBogota, isoBogota, lineaDelDia, lunesDe, parseFestivos,
  porMarcar, sumarDias,
} from '../core/agenda.js';
import { $, $$, escapeHtml, haptic, toast } from '../core/dom.js';
import { colorTextoLegible } from '../core/format.js';
import { icon } from '../core/icons.js';
import { setPullToRefresh } from '../core/screen.js';
import { sesion } from '../core/session.js';
import { buildSegmented } from '../ui/controls.js';
import { ActionSheet } from '../ui/sheet.js';

/* ============= AGENDA DE ASESORES =============
   Citas que la gente agenda por WhatsApp o por llamada, vistas por día o por
   semana, con la disponibilidad de cada asesor. Todo en hora de Bogotá.
   API: /api/tools/agenda/* (src/routes/tools/agendaRouter.ts). */

const estado = {
  vista: 'dia',            // 'dia' | 'semana'
  fecha: hoyBogota(),
  asesor: 'todos',         // 'todos' | username
  asesores: [],
  citas: [],
  franjas: [],
  cargaSeq: 0,
};

async function pedir(ruta, opts) {
  const r = await api(`/api/tools/agenda${ruta}`, opts);
  if (!r) return { ok: false, status: 401, data: {} };
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

const esAdmin = () => sesion.user?.role === 'admin';
const yo = () => sesion.user?.username?.toLowerCase();
const nombreAsesor = (u) => estado.asesores.find(a => a.username.toLowerCase() === String(u).toLowerCase())?.nombre ?? u;
const asesoresEditables = () => estado.asesores.filter(a => a.puedeEditar);

function insignia(texto, color) {
  return `<span class="badge" style="background:${color}1f;color:${colorTextoLegible(color)};">${escapeHtml(texto)}</span>`;
}

/* ───────────────────────────── Pantalla ───────────────────────────── */

async function renderAgenda(main) {
  estado.fecha = hoyBogota();
  estado.vista = 'dia';
  main.innerHTML = `
    <div class="page-header">
      <div><h1>${icon('calendar', 26)} Agenda</h1><div class="subtitle">Citas con asesores, por WhatsApp o llamada · hora de Bogotá</div></div>
      <div class="ag-acciones">
        <button type="button" class="btn btn-secondary" id="agRefrescar" aria-label="Actualizar"><span class="refresh-icon">${icon('refresh', 16)}</span></button>
        <button type="button" class="btn btn-secondary" id="agDisponibilidad">${icon('clock', 16)} Mi disponibilidad</button>
        ${esAdmin() ? `<button type="button" class="btn btn-secondary" id="agAjustes">Ajustes</button>` : ''}
        <button type="button" class="btn btn-primary" id="agNueva">${icon('plus', 16)} Nueva cita</button>
      </div>
    </div>
    <div class="ag-barra">
      <div id="agVistaWrap"></div>
      <div class="ag-nav">
        <button type="button" class="btn btn-ghost ag-nav-btn" id="agAnterior" aria-label="Anterior">${icon('chevronLeft', 18)}</button>
        <button type="button" class="btn btn-secondary ag-hoy" id="agHoy">Hoy</button>
        <button type="button" class="btn btn-ghost ag-nav-btn" id="agSiguiente" aria-label="Siguiente">${icon('chevronRight', 18)}</button>
        <strong class="ag-rango" id="agRango" aria-live="polite"></strong>
      </div>
      <label class="ag-filtro"><span class="sr-only">Asesor</span><select id="agAsesor" class="rem-input" aria-label="Asesor"></select></label>
    </div>
    <div id="agAviso"></div>
    <div id="agContenido">${Array.from({ length: 3 }).map(() => `<div class="card" style="margin-bottom:10px;"><div class="skeleton skeleton-line" style="width:40%;height:13px;margin-bottom:10px;"></div><div class="skeleton skeleton-line" style="width:80%;height:11px;"></div></div>`).join('')}</div>`;

  $('#agVistaWrap').appendChild(buildSegmented(
    [{ value: 'dia', label: 'Día' }, { value: 'semana', label: 'Semana' }], estado.vista,
    (v) => { estado.vista = v; cargar(); },
  ));
  const mover = (n) => { estado.fecha = sumarDias(estado.fecha, estado.vista === 'dia' ? n : 7 * n); cargar(); };
  $('#agAnterior').addEventListener('click', () => mover(-1));
  $('#agSiguiente').addEventListener('click', () => mover(1));
  $('#agHoy').addEventListener('click', () => { estado.fecha = hoyBogota(); cargar(); });
  $('#agAsesor').addEventListener('change', (e) => { estado.asesor = e.target.value; cargar(); });
  $('#agRefrescar').addEventListener('click', () => { $('#agRefrescar .refresh-icon')?.classList.add('spin-once'); cargar(); });
  $('#agNueva').addEventListener('click', () => abrirDialogoCita({ modo: 'crear' }));
  $('#agDisponibilidad').addEventListener('click', () => abrirDisponibilidad());
  $('#agAjustes')?.addEventListener('click', () => abrirAjustes());
  setPullToRefresh(() => cargar());

  const r = await pedir('/asesores');
  if (!$('#agContenido')) return;
  if (!r.ok) { $('#agContenido').innerHTML = alertaError('No se pudo abrir la agenda.', 'agReintentar'); $('#agReintentar')?.addEventListener('click', () => renderAgenda(main)); return; }
  estado.asesores = r.data.asesores ?? [];
  // Quien atiende ve primero su propia agenda; el administrador, la de todos.
  const mio = estado.asesores.find(a => a.esYo && a.activo);
  estado.asesor = mio && !esAdmin() ? mio.username : 'todos';
  const opciones = estado.asesores.filter(a => a.activo || a.esYo);
  $('#agAsesor').innerHTML = `<option value="todos">Todos los asesores</option>${opciones.map(a => `<option value="${escapeHtml(a.username)}">${escapeHtml(a.nombre)}${a.esYo ? ' (yo)' : ''}</option>`).join('')}`;
  $('#agAsesor').value = estado.asesor;
  await cargar();
}

function alertaError(texto, idBoton) {
  return `<div class="alert alert-error" role="alert">${escapeHtml(texto)} <button type="button" class="btn btn-secondary" id="${idBoton}">Reintentar</button></div>`;
}

function diasVisibles() {
  if (estado.vista === 'dia') return [estado.fecha];
  const lunes = lunesDe(estado.fecha);
  return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
}

async function cargar() {
  const cont = $('#agContenido');
  if (!cont) return;
  const seq = ++estado.cargaSeq;
  const dias = diasVisibles();
  const rango = $('#agRango');
  if (rango) rango.textContent = estado.vista === 'dia' ? etiquetaDiaLarga(dias[0]) : `${etiquetaDia(dias[0])} – ${etiquetaDia(dias[6])}`;
  const filtro = estado.asesor !== 'todos' ? `&asesor=${encodeURIComponent(estado.asesor)}` : '';
  try {
    const [rc, rf] = await Promise.all([
      pedir(`/citas?desde=${dias[0]}&dias=${dias.length}${filtro}`),
      // Los huecos libres solo se muestran en la vista de día de un asesor concreto.
      estado.vista === 'dia' && estado.asesor !== 'todos' ? pedir(`/franjas?asesor=${encodeURIComponent(estado.asesor)}&desde=${dias[0]}&dias=1`) : Promise.resolve({ ok: true, data: { franjas: [] } }),
    ]);
    if (seq !== estado.cargaSeq || !cont.isConnected) return;
    if (!rc.ok) throw new Error(rc.data?.message || 'No se pudieron cargar las citas');
    estado.citas = rc.data.citas ?? [];
    estado.franjas = rf.ok ? (rf.data.franjas ?? []) : [];
  } catch (err) {
    if (seq !== estado.cargaSeq || !cont.isConnected) return;
    cont.innerHTML = alertaError(err.message || 'No se pudieron cargar las citas.', 'agReintentarCarga');
    $('#agReintentarCarga')?.addEventListener('click', cargar);
    return;
  }
  pintar();
}

/* ───────────────────────────── Pintado ───────────────────────────── */

function filaCita(c, { conAsesor }) {
  const meta = ESTADOS_CITA[c.estado] ?? ESTADOS_CITA.confirmada;
  const persona = c.nombre ? escapeHtml(c.nombre) : escapeHtml(c.telefonoMasc);
  return `
    <button type="button" class="ag-cita ag-${escapeHtml(c.estado)}" data-cita="${escapeHtml(c.id)}">
      <span class="ag-hora">${escapeHtml(horaCorta(c.inicio))}<small>${escapeHtml(horaCorta(c.fin))}</small></span>
      <span class="ag-cuerpo">
        <strong>${persona}</strong>
        <small>${icon('user', 11)} ${escapeHtml(AREAS[c.area] ?? c.area)}${conAsesor ? ` · ${escapeHtml(nombreAsesor(c.asesor))}` : ''} · ${escapeHtml(nombreCanal(c.canal))}</small>
      </span>
      ${insignia(meta.label, meta.color)}
    </button>`;
}

function filaLibre(f) {
  return `
    <button type="button" class="ag-libre" data-libre="${escapeHtml(f.inicio)}" data-asesor="${escapeHtml(f.asesor)}" data-fin="${escapeHtml(f.fin)}">
      <span class="ag-hora">${escapeHtml(horaCorta(f.inicio))}<small>${escapeHtml(horaCorta(f.fin))}</small></span>
      <span class="ag-cuerpo"><em>Libre</em></span>
      <span class="ag-mas">${icon('plus', 14)}</span>
    </button>`;
}

function pintar() {
  const cont = $('#agContenido');
  if (!cont) return;
  const conAsesor = estado.asesor === 'todos';
  const grupos = agruparPorDia(estado.citas);
  const dias = diasVisibles();
  const hoy = hoyBogota();

  const pendientes = porMarcar(estado.citas);
  $('#agAviso').innerHTML = pendientes.length
    ? `<div class="alert alert-warning" role="status">${pendientes.length === 1 ? 'Hay 1 cita que ya pasó y todavía no está marcada como atendida o sin asistencia.' : `Hay ${pendientes.length} citas que ya pasaron y todavía no están marcadas como atendidas o sin asistencia.`}</div>`
    : '';

  if (estado.vista === 'dia') {
    const delDia = grupos[dias[0]] ?? [];
    const futuras = estado.franjas.filter(f => fechaDeIso(f.inicio) === dias[0]);
    const linea = lineaDelDia(delDia, futuras);
    cont.innerHTML = linea.length
      ? `<div class="card ag-lista stagger-in">${linea.map(i => i.tipo === 'cita' ? filaCita(i.cita, { conAsesor }) : filaLibre(i.franja)).join('')}</div>`
      : `<div class="empty-state"><div class="empty-state-icon">${icon('calendar', 42)}</div><div class="empty-state-title">Sin citas este día</div><div class="empty-state-sub">${estado.asesor === 'todos' ? 'Elige un asesor para ver también sus horarios libres.' : 'Este asesor no tiene horarios libres este día. Revisa su disponibilidad.'}</div></div>`;
  } else {
    cont.innerHTML = `<div class="ag-semana stagger-in">${dias.map(d => {
      const lista = grupos[d] ?? [];
      return `<section class="card ag-dia${d === hoy ? ' ag-hoy-col' : ''}">
        <h3>${escapeHtml(etiquetaDia(d))}${lista.length ? ` <span class="ag-cuenta">${lista.length}</span>` : ''}</h3>
        ${lista.length ? lista.map(c => filaCita(c, { conAsesor })).join('') : '<p class="ag-vacio">Sin citas</p>'}
      </section>`;
    }).join('')}</div>`;
  }

  cont.querySelectorAll('[data-cita]').forEach(b => b.addEventListener('click', () => {
    const c = estado.citas.find(x => x.id === b.dataset.cita);
    if (c) abrirCita(c);
  }));
  cont.querySelectorAll('[data-libre]').forEach(b => b.addEventListener('click', () => {
    abrirDialogoCita({ modo: 'crear', asesor: b.dataset.asesor, inicio: b.dataset.libre });
  }));
}

/* ───────────────────────────── Una cita ───────────────────────────── */

const CANALES = { whatsapp: 'WhatsApp', voz: 'Llamada', panel: 'Panel' };
const nombreCanal = (c) => CANALES[c] ?? String(c ?? '—');

function detalleCita(c) {
  const meta = ESTADOS_CITA[c.estado] ?? ESTADOS_CITA.confirmada;
  const filas = [
    ['phone', 'WhatsApp', c.telefono ? `+${c.telefono}` : c.telefonoMasc],
    ['user', 'Persona', c.nombre ?? '—'],
    ['users', 'Asesor', nombreAsesor(c.asesor)],
    ['tag', 'Área', AREAS[c.area] ?? c.area],
    ['send', 'Origen', nombreCanal(c.canal)],
    c.motivo ? ['note', 'Motivo', c.motivo] : null,
  ].filter(Boolean);
  const el = document.createElement('div');
  el.className = 'ag-detalle';
  el.innerHTML = `
    <div class="ag-detalle-cabecera">
      <div><strong>${escapeHtml(c.nombre || c.telefonoMasc)}</strong><span>${escapeHtml(etiquetaDiaLarga(fechaDeIso(c.inicio)))} · ${escapeHtml(horaCorta(c.inicio))} – ${escapeHtml(horaCorta(c.fin))}</span></div>
      ${insignia(meta.label, meta.color)}
    </div>
    <dl class="perfil-datos">${filas.map(([i, k, v]) => `<div>${icon(i, 16)}<dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl>
    ${c.recordatoriosPendientes?.length ? `<p class="field-help">${icon('bell', 12)} Sin recordatorio automático: WhatsApp exige una plantilla aprobada fuera de las 24 horas.</p>` : ''}`;
  return el;
}

function abrirCita(c) {
  const empezo = Date.parse(c.inicio) <= Date.now();
  const grupo = [];
  if (c.puedeEditar && c.estado === 'confirmada') {
    grupo.push({ label: 'Mover a otro horario', icon: icon('clock', 17), onClick: () => abrirDialogoCita({ modo: 'mover', cita: c }) });
  }
  if (c.puedeEditar && empezo && c.estado !== 'cancelada') {
    if (c.estado !== 'atendida') grupo.push({ label: 'Marcar como atendida', icon: icon('check', 17), onClick: () => cambiarEstado(c, 'atendida') });
    if (c.estado !== 'no_asistio') grupo.push({ label: 'Marcar como no asistió', icon: icon('ban', 17), onClick: () => cambiarEstado(c, 'no_asistio') });
  }
  const groups = [];
  if (grupo.length) groups.push(grupo);
  if (c.puedeEditar && c.estado === 'confirmada') {
    groups.push([{ label: 'Cancelar cita', icon: icon('trash', 17), destructive: true, onClick: () => confirmarCancelacion(c) }]);
  }
  groups.push([{ label: 'Cerrar', cancel: true }]);
  ActionSheet.open({ title: c.nombre || c.telefonoMasc, clase: 'perfil-sheet', contenido: detalleCita(c), groups });
}

function confirmarCancelacion(c) {
  ActionSheet.open({
    title: '¿Cancelar esta cita?',
    subtitle: 'La hora queda libre y se le avisa a la persona por WhatsApp si es posible.',
    groups: [
      [{ label: 'Cancelar cita', icon: icon('trash', 17), destructive: true, onClick: async () => {
        haptic([20, 30, 20]);
        const r = await pedir(`/citas/${encodeURIComponent(c.id)}/cancelar`, { method: 'POST' });
        if (!r.ok) { toast(r.data.message || 'No se pudo cancelar la cita'); return; }
        avisarResultado('Cita cancelada', r.data.aviso);
        cargar();
      } }],
      [{ label: 'Mantener la cita', cancel: true }],
    ],
  });
}

async function cambiarEstado(c, nuevo) {
  const r = await pedir(`/citas/${encodeURIComponent(c.id)}/estado`, { method: 'POST', body: JSON.stringify({ estado: nuevo }) });
  if (!r.ok) { toast(r.data.message || 'No se pudo actualizar la cita'); return; }
  haptic([10, 20, 10]);
  toast(nuevo === 'atendida' ? 'Marcada como atendida' : 'Marcada como no asistió');
  cargar();
}

/** Dice si a la persona se le pudo avisar; si no, lo explica para que el asesor la contacte. */
function avisarResultado(base, aviso) {
  if (!aviso) { toast(base); return; }
  if (aviso.enviado) { toast(`${base} · se avisó por WhatsApp`); return; }
  toast(`${base}. No se pudo avisar por WhatsApp: ${aviso.motivo ?? 'sin ventana de 24 h'}`, 6000);
}

/* ───────────────────────────── Modales ───────────────────────────── */

function abrirModal({ titulo, ayuda, cuerpo, etiquetaGuardar = 'Guardar', ancho = '' }) {
  const focoPrevio = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'password-dialog-backdrop';
  overlay.innerHTML = `
    <div class="password-dialog ag-modal ${ancho}" role="dialog" aria-modal="true" aria-labelledby="agModalTitulo">
      <button type="button" class="password-dialog-close" aria-label="Cerrar">${icon('x', 18)}</button>
      <h2 id="agModalTitulo">${escapeHtml(titulo)}</h2>
      ${ayuda ? `<p class="password-dialog-help">${escapeHtml(ayuda)}</p>` : ''}
      <form novalidate>
        <div class="ag-modal-cuerpo">${cuerpo}</div>
        <div class="password-dialog-message" role="alert" aria-live="polite"></div>
        <div class="password-dialog-actions">
          <button type="button" class="btn btn-ghost" data-ag-cancelar>Cancelar</button>
          <button type="submit" class="btn btn-primary" data-ag-guardar>${escapeHtml(etiquetaGuardar)}</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  const form = overlay.querySelector('form');
  const mensaje = overlay.querySelector('.password-dialog-message');
  const guardar = overlay.querySelector('[data-ag-guardar]');
  let cerrado = false;
  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (focoPrevio?.isConnected) focoPrevio.focus({ preventScroll: true });
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); cerrar(); } };
  document.addEventListener('keydown', onKey);
  overlay.querySelector('.password-dialog-close').addEventListener('click', cerrar);
  overlay.querySelector('[data-ag-cancelar]').addEventListener('click', cerrar);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
  requestAnimationFrame(() => overlay.classList.add('open'));
  return {
    overlay, form, cerrar,
    error: (t) => { mensaje.classList.remove('success'); mensaje.textContent = t; },
    ocupado: (v) => { guardar.disabled = v; guardar.classList.toggle('is-loading', v); },
  };
}

/** Opciones de horario libre de un asesor para los próximos 14 días. */
async function cargarFranjas(asesor) {
  const r = await pedir(`/franjas?asesor=${encodeURIComponent(asesor)}&desde=${hoyBogota()}&dias=14`);
  return r.ok ? (r.data.franjas ?? []) : [];
}

function etiquetaFranja(f) {
  return `${etiquetaDia(fechaDeIso(f.inicio))} · ${horaCorta(f.inicio)}`;
}

/** Crear una cita o mover una existente: el mismo selector de horario. */
function abrirDialogoCita({ modo, cita, asesor, inicio }) {
  const mover = modo === 'mover';
  const editables = asesoresEditables();
  if (!editables.length) { toast('No tienes una agenda propia para crear citas.'); return; }
  const asesorInicial = (mover ? cita.asesor : asesor) ?? editables.find(a => a.esYo)?.username ?? editables[0].username;
  const areasDe = (u) => estado.asesores.find(a => a.username === u)?.areas ?? [];
  const cuerpo = `
    ${mover ? '' : `
    <div class="field"><label for="agTel">WhatsApp de la persona</label><input class="rem-input" type="tel" id="agTel" placeholder="573001234567" autocomplete="off" required></div>
    <div class="field"><label for="agNombre">Nombre (opcional)</label><input class="rem-input" type="text" id="agNombre" maxlength="120"></div>`}
    <div class="field"><label for="agAsesorSel">Asesor</label>
      <select class="rem-input" id="agAsesorSel">${editables.map(a => `<option value="${escapeHtml(a.username)}"${a.username === asesorInicial ? ' selected' : ''}>${escapeHtml(a.nombre)}</option>`).join('')}</select></div>
    ${mover ? '' : `<div class="field"><div id="agAreaLabel" class="rem-label">Área</div><div id="agAreaWrap" role="group" aria-labelledby="agAreaLabel"></div></div>`}
    <div class="field"><label for="agFranja">Horario</label>
      <select class="rem-input" id="agFranja"><option>Cargando horarios…</option></select>
      <div class="field-help" id="agFranjaAyuda"></div></div>
    <div class="ag-otra hidden" id="agOtra">
      <div class="ag-fila"><label>Fecha<input class="rem-input" type="date" id="agOtraFecha" value="${escapeHtml(hoyBogota())}"></label>
      <label>Hora<input class="rem-input" type="time" id="agOtraHora" value="09:00"></label>
      <label>Duración (min)<input class="rem-input" type="number" id="agOtraDur" min="10" max="240" step="5" value="30"></label></div>
      <p class="field-help">Fuera de la disponibilidad del asesor. Igual no puede chocar con otra cita.</p>
    </div>
    ${mover ? '' : `<div class="field"><label for="agMotivo">Motivo (opcional)</label><textarea class="rem-input" id="agMotivo" rows="2" maxlength="300"></textarea></div>`}`;
  const m = abrirModal({
    titulo: mover ? 'Mover cita' : 'Nueva cita',
    ayuda: mover ? `${cita.nombre || cita.telefonoMasc}: elige el nuevo horario.` : 'La persona recibe la confirmación por WhatsApp.',
    cuerpo, etiquetaGuardar: mover ? 'Mover' : 'Agendar',
  });
  const selAsesor = m.overlay.querySelector('#agAsesorSel');
  const selFranja = m.overlay.querySelector('#agFranja');
  const otra = m.overlay.querySelector('#agOtra');
  let area = mover ? cita.area : (areasDe(asesorInicial)[0] ?? 'posgrados');
  const OTRA = '__otra__';

  if (!mover) {
    m.overlay.querySelector('#agAreaWrap').appendChild(buildSegmented(
      Object.entries(AREAS).map(([value, label]) => ({ value, label })), area, (v) => { area = v; },
    ));
  }

  async function llenarFranjas(usuario, preseleccion) {
    selFranja.innerHTML = '<option>Cargando horarios…</option>';
    const franjas = await cargarFranjas(usuario);
    if (!m.overlay.isConnected) return;
    selFranja.innerHTML = franjas.map(f => `<option value="${escapeHtml(f.inicio)}|${escapeHtml(f.fin)}">${escapeHtml(etiquetaFranja(f))}</option>`).join('')
      + `<option value="${OTRA}">Otra hora…</option>`;
    m.overlay.querySelector('#agFranjaAyuda').textContent = franjas.length ? '' : 'Este asesor no tiene horarios libres en 14 días; usa "Otra hora".';
    const buscada = preseleccion && franjas.find(f => f.inicio === preseleccion);
    selFranja.value = buscada ? `${buscada.inicio}|${buscada.fin}` : (franjas.length ? selFranja.options[0].value : OTRA);
    otra.classList.toggle('hidden', selFranja.value !== OTRA);
  }
  selAsesor.addEventListener('change', () => llenarFranjas(selAsesor.value));
  selFranja.addEventListener('change', () => otra.classList.toggle('hidden', selFranja.value !== OTRA));
  llenarFranjas(asesorInicial, inicio);

  m.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    m.error('');
    let inicioIso; let finIso; let forzar = false;
    if (selFranja.value === OTRA) {
      const fecha = m.overlay.querySelector('#agOtraFecha').value;
      const hora = m.overlay.querySelector('#agOtraHora').value;
      const dur = Number(m.overlay.querySelector('#agOtraDur').value);
      if (!fecha || !hora || !(dur >= 10)) { m.error('Completa la fecha, la hora y la duración.'); return; }
      inicioIso = isoBogota(fecha, hora);
      finIso = new Date(Date.parse(inicioIso) + dur * 60_000).toISOString();
      forzar = true;
    } else if (selFranja.value.includes('|')) {
      [inicioIso, finIso] = selFranja.value.split('|');
    } else { m.error('Elige un horario.'); return; }

    m.ocupado(true);
    try {
      const r = mover
        ? await pedir(`/citas/${encodeURIComponent(cita.id)}/mover`, { method: 'POST', body: JSON.stringify({ inicio: inicioIso, fin: finIso, asesor: selAsesor.value, forzar }) })
        : await pedir('/citas', { method: 'POST', body: JSON.stringify({
          telefono: m.overlay.querySelector('#agTel').value.trim(), nombre: m.overlay.querySelector('#agNombre').value.trim() || undefined,
          area, asesor: selAsesor.value, inicio: inicioIso, fin: finIso, forzar,
          motivo: m.overlay.querySelector('#agMotivo').value.trim() || undefined,
        }) });
      if (!r.ok) { m.error(r.data.message || 'No se pudo guardar la cita.'); haptic([20, 30, 20]); return; }
      haptic([10, 20, 10]);
      m.cerrar();
      avisarResultado(mover ? 'Cita movida' : 'Cita agendada', r.data.aviso);
      estado.fecha = fechaDeIso(r.data.cita.inicio);
      cargar();
    } catch {
      m.error('Sin conexión con el servidor.');
    } finally {
      m.ocupado(false);
    }
  });
}

/* ───────────────────────── Mi disponibilidad ───────────────────────── */

async function abrirDisponibilidad() {
  const editables = asesoresEditables();
  if (!editables.length) { toast('Tu usuario no tiene agenda propia.'); return; }
  let usuario = editables.find(a => a.esYo)?.username ?? editables[0].username;
  const m = abrirModal({
    titulo: 'Disponibilidad', ancho: 'ag-modal-ancho', etiquetaGuardar: 'Guardar disponibilidad',
    ayuda: 'Los días y horas en que atiendes citas. La agenda nunca se sale del horario del equipo.',
    cuerpo: `
      ${editables.length > 1 ? `<div class="field"><label for="agDispAsesor">Asesor</label><select class="rem-input" id="agDispAsesor">${editables.map(a => `<option value="${escapeHtml(a.username)}"${a.username === usuario ? ' selected' : ''}>${escapeHtml(a.nombre)}</option>`).join('')}</select></div>` : ''}
      <div id="agDispForm"><div class="skeleton skeleton-line" style="width:60%;height:13px;"></div></div>`,
  });
  let form = null;
  const raiz = m.overlay.querySelector('#agDispForm');

  async function cargarForm() {
    raiz.innerHTML = '<div class="skeleton skeleton-line" style="width:60%;height:13px;"></div>';
    const r = await pedir(`/disponibilidad/${encodeURIComponent(usuario)}`);
    if (!m.overlay.isConnected) return;
    if (!r.ok) { raiz.innerHTML = alertaError(r.data.message || 'No se pudo cargar la disponibilidad.', 'agDispReintentar'); raiz.querySelector('#agDispReintentar').addEventListener('click', cargarForm); return; }
    form = formDesdeDisponibilidad(r.data.disponibilidad);
    pintarForm();
  }

  function pintarForm() {
    raiz.innerHTML = `
      <div class="ag-bloque ag-activo">
        <label class="ai-toggle ag-switch"><span class="ai-toggle-label"><span>Recibir citas</span></span>
          <span class="switch"><input type="checkbox" id="agActivo" ${form.activo ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></span></label>
      </div>
      <div class="field"><div class="rem-label">Áreas que atiendes</div>
        <div class="ag-chips" role="group" aria-label="Áreas">${Object.entries(AREAS).map(([v, l]) => `<button type="button" class="atn-dia${form.areas.includes(v) ? ' activo' : ''}" data-area="${v}" aria-pressed="${form.areas.includes(v)}">${escapeHtml(l)}</button>`).join('')}</div></div>
      <div class="ag-fila">
        <label>Duración de cada cita (min)<input class="rem-input" type="number" id="agDur" min="10" max="180" step="5" value="${escapeHtml(form.duracionMin)}"></label>
        <label>Pausa entre citas (min)<input class="rem-input" type="number" id="agPausa" min="0" max="60" step="5" value="${escapeHtml(form.pausaMin)}"></label>
      </div>
      <h3 class="ag-sub">Horario de la semana</h3>
      ${ORDEN_DIAS.map(d => `
        <div class="ag-dia-fila" data-dia="${d}">
          <strong>${escapeHtml(DIAS_LARGOS[d][0].toUpperCase() + DIAS_LARGOS[d].slice(1))}</strong>
          <div class="ag-tramos">
            ${form.dias[d].map((t, i) => `<div class="ag-tramo"><input class="rem-input" type="time" value="${escapeHtml(t.desde)}" data-t="${i}" data-c="desde" aria-label="Desde"><span>a</span><input class="rem-input" type="time" value="${escapeHtml(t.hasta)}" data-t="${i}" data-c="hasta" aria-label="Hasta"><small>${citasPorTramo(t, Number(form.duracionMin), Number(form.pausaMin) || 0)} citas</small><button type="button" class="btn btn-ghost" data-quitar-tramo="${i}" aria-label="Quitar tramo">${icon('x', 14)}</button></div>`).join('') || '<span class="ag-vacio">No atiende</span>'}
            <button type="button" class="btn btn-ghost crm-mini-btn" data-agregar-tramo>+ tramo</button>
          </div>
        </div>`).join('')}
      <h3 class="ag-sub">Días libres y vacaciones</h3>
      <div id="agExcepciones">
        ${form.excepciones.map((e, i) => `
          <div class="ag-excepcion" data-ex="${i}">
            <input class="rem-input" type="date" value="${escapeHtml(e.desde)}" data-c="desde" aria-label="Desde el día">
            <input class="rem-input" type="date" value="${escapeHtml(e.hasta || e.desde)}" data-c="hasta" aria-label="Hasta el día">
            <input class="rem-input" type="time" value="${escapeHtml(e.horaDesde ?? '')}" data-c="horaDesde" aria-label="Desde la hora (opcional)">
            <input class="rem-input" type="time" value="${escapeHtml(e.horaHasta ?? '')}" data-c="horaHasta" aria-label="Hasta la hora (opcional)">
            <input class="rem-input" type="text" maxlength="120" placeholder="Motivo" value="${escapeHtml(e.motivo ?? '')}" data-c="motivo" aria-label="Motivo">
            <button type="button" class="btn btn-ghost" data-quitar-ex="${i}" aria-label="Quitar excepción">${icon('x', 14)}</button>
          </div>`).join('') || '<span class="ag-vacio">Sin días libres programados</span>'}
      </div>
      <button type="button" class="btn btn-ghost crm-mini-btn" id="agAgregarEx">+ Día libre o vacaciones</button>
      <p class="field-help">Sin horas, la excepción bloquea los días completos. Con horas, solo ese rango en cada día.</p>`;

    raiz.querySelector('#agActivo').addEventListener('change', (e) => { form.activo = e.target.checked; });
    raiz.querySelectorAll('[data-area]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.area;
      form.areas = form.areas.includes(a) ? form.areas.filter(x => x !== a) : [...form.areas, a];
      b.classList.toggle('activo', form.areas.includes(a));
      b.setAttribute('aria-pressed', String(form.areas.includes(a)));
    }));
    raiz.querySelector('#agDur').addEventListener('input', (e) => { form.duracionMin = e.target.value; });
    raiz.querySelector('#agDur').addEventListener('change', pintarForm);
    raiz.querySelector('#agPausa').addEventListener('input', (e) => { form.pausaMin = e.target.value; });
    raiz.querySelector('#agPausa').addEventListener('change', pintarForm);
    raiz.querySelectorAll('.ag-dia-fila').forEach(fila => {
      const d = Number(fila.dataset.dia);
      fila.querySelectorAll('input[data-t]').forEach(inp => inp.addEventListener('change', () => {
        form.dias[d][Number(inp.dataset.t)][inp.dataset.c] = inp.value;
        pintarForm();
      }));
      fila.querySelectorAll('[data-quitar-tramo]').forEach(b => b.addEventListener('click', () => {
        form.dias[d].splice(Number(b.dataset.quitarTramo), 1);
        pintarForm();
      }));
      fila.querySelector('[data-agregar-tramo]').addEventListener('click', () => {
        const ultimo = form.dias[d][form.dias[d].length - 1];
        form.dias[d].push(ultimo ? { desde: ultimo.hasta < '17:00' ? '14:00' : '17:00', hasta: ultimo.hasta < '17:00' ? '17:00' : '18:00' } : { desde: '09:00', hasta: '12:00' });
        pintarForm();
      });
    });
    raiz.querySelectorAll('.ag-excepcion').forEach(fila => {
      const i = Number(fila.dataset.ex);
      fila.querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => { form.excepciones[i][inp.dataset.c] = inp.value; }));
      fila.querySelector('[data-quitar-ex]').addEventListener('click', () => { form.excepciones.splice(i, 1); pintarForm(); });
    });
    raiz.querySelector('#agAgregarEx').addEventListener('click', () => {
      const hoy = hoyBogota();
      form.excepciones.push({ desde: hoy, hasta: hoy, motivo: '' });
      pintarForm();
    });
  }

  m.overlay.querySelector('#agDispAsesor')?.addEventListener('change', (e) => { usuario = e.target.value; cargarForm(); });
  m.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    m.error('');
    if (!form) return;
    const problema = errorDeForm(form);
    if (problema) { m.error(problema); return; }
    m.ocupado(true);
    try {
      const r = await pedir(`/disponibilidad/${encodeURIComponent(usuario)}`, { method: 'PUT', body: JSON.stringify(disponibilidadDesdeForm(form)) });
      if (!r.ok) { m.error(r.data.message || 'No se pudo guardar.'); return; }
      haptic([10, 20, 10]);
      toast('Disponibilidad guardada');
      m.cerrar();
      const lista = await pedir('/asesores');
      if (lista.ok) estado.asesores = lista.data.asesores ?? estado.asesores;
      cargar();
    } catch {
      m.error('Sin conexión con el servidor.');
    } finally {
      m.ocupado(false);
    }
  });
  cargarForm();
}

/* ───────────────────────── Ajustes (administrador) ───────────────────────── */

async function abrirAjustes() {
  const r = await pedir('/config');
  if (!r.ok) { toast(r.data.message || 'No se pudo cargar la configuración'); return; }
  const c = r.data.config;
  const m = abrirModal({
    titulo: 'Ajustes de la agenda', ayuda: 'Valen para todos los asesores.', etiquetaGuardar: 'Guardar ajustes',
    cuerpo: `
      <div class="ag-fila">
        <label>No ofrecer lo que empieza en menos de (min)<input class="rem-input" type="number" id="agCfgAnt" min="0" max="10080" step="15" value="${escapeHtml(c.antelacionMin)}"></label>
        <label>Citas futuras por teléfono<input class="rem-input" type="number" id="agCfgMax" min="1" max="10" value="${escapeHtml(c.maxCitasFuturas)}"></label>
        <label>Días hacia adelante<input class="rem-input" type="number" id="agCfgVen" min="1" max="60" value="${escapeHtml(c.diasVentana)}"></label>
      </div>
      <div class="field"><label for="agCfgFest">Festivos (AAAA-MM-DD, separados por coma o salto de línea)</label>
        <textarea class="rem-input" id="agCfgFest" rows="4" placeholder="2026-12-08, 2026-12-25">${escapeHtml((c.festivos ?? []).join('\n'))}</textarea>
        <div class="field-help">Ese día nadie recibe citas, aunque su horario semanal lo permita.</div></div>`,
  });
  m.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    m.error('');
    const fest = parseFestivos($('#agCfgFest', m.overlay).value);
    if (fest.invalidos.length) { m.error(`Fecha inválida: ${fest.invalidos.slice(0, 3).join(', ')}`); return; }
    m.ocupado(true);
    try {
      const rr = await pedir('/config', { method: 'PUT', body: JSON.stringify({
        antelacionMin: Number($('#agCfgAnt', m.overlay).value), maxCitasFuturas: Number($('#agCfgMax', m.overlay).value),
        diasVentana: Number($('#agCfgVen', m.overlay).value), festivos: fest.validos,
      }) });
      if (!rr.ok) { m.error(rr.data.message || 'No se pudo guardar.'); return; }
      toast('Ajustes guardados');
      m.cerrar();
      cargar();
    } catch {
      m.error('Sin conexión con el servidor.');
    } finally {
      m.ocupado(false);
    }
  });
}

export { renderAgenda };
