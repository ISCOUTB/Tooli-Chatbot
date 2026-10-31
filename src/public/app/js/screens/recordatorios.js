import { api } from '../core/api.js';
import { $, emoji, escapeHtml, haptic, toast } from '../core/dom.js';
import { colorTextoLegible } from '../core/format.js';
import { icon } from '../core/icons.js';
import { parametrosRuta } from '../core/router.js';
import { estadoVentanaRecordatorio } from '../core/reminder-window.js';
import { sesion } from '../core/session.js';
import { setPullToRefresh } from '../core/screen.js';
import { buildSegmented } from '../ui/controls.js';
import { openPhonePreview } from '../ui/phone-preview.js';
import { ActionSheet } from '../ui/sheet.js';

/* ============= RECORDATORIOS PROGRAMADOS =============
   Mensajes de WhatsApp con fecha y hora, disparados solos por el worker
   de src/services/reminderService.ts. El disparo automático a partir de
   datos académicos (tareas, notas) todavía no es posible — la pantalla lo
   dice explícitamente en vez de simularlo. */
const REM_ESTADOS = {
  programado: { label: 'Programado', icon: '⏰', color: '#0284c7' },
  procesando: { label: 'En proceso', icon: '⌛', color: '#a16207' },
  enviado:    { label: 'Enviado',    icon: '✅', color: '#16a34a' },
  fallido:    { label: 'Falló',      icon: '⚠️', color: '#dc2626' },
  cancelado:  { label: 'Cancelado',  icon: '✖️', color: '#64748b' },
};

/** "en 3 días", "en 2 h", "hace 5 min" — legible de un vistazo. */
function tiempoRelativoFuturo(ts) {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60000);
  const hor = Math.round(abs / 3600000);
  const dia = Math.round(abs / 86400000);
  const txt = min < 60 ? `${min} min` : hor < 24 ? `${hor} h` : `${dia} día${dia === 1 ? '' : 's'}`;
  return diff >= 0 ? `en ${txt}` : `hace ${txt}`;
}

/* Cuando se llega a Recordatorios desde una conversación, el teléfono ya viene
   puesto: copiarlo a mano desde el hilo era el paso que hacía que nadie usara
   esta función. */
let remPrefill = null;

/** Otras pantallas (bandeja, asesores) dejan aquí el destinatario antes de
 *  navegar a Recordatorios, para no obligar a copiar el número a mano. */
function setRemPrefill(datos) {
  remPrefill = datos;
}
let remFiltro = 'programado';
let remLista = [];
let remLoadSeq = 0;

async function renderRecordatorios(main) {
  const estadoInicial = parametrosRuta().get('estado');
  remFiltro = ['programado', 'enviado', 'fallido', 'todos'].includes(estadoInicial) ? estadoInicial : 'programado';
  // Por defecto, la próxima hora en punto: lo más común es "mándalo mañana a las 8".
  const sugerida = new Date(Date.now() + 60 * 60 * 1000);
  sugerida.setMinutes(0, 0, 0);
  const valorLocal = new Date(sugerida.getTime() - sugerida.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  main.innerHTML = `
    <div class="page-header">
      <div><h1>${icon('clock', 26)} Recordatorios</h1><div class="subtitle">Mensajes de WhatsApp programados — se envían solos a la hora que elijas</div></div>
      <button class="btn btn-secondary" id="refreshRem"><span class="refresh-icon">${icon('refresh', 16)}</span> Actualizar</button>
    </div>

    <div class="rem-layout">
      <form class="card rem-form" id="remForm">
        <h2 class="rem-form-title">${icon('plus', 16)} Programar uno nuevo</h2>
        <label class="rem-label" for="remTel">WhatsApp del destinatario</label>
        <input type="tel" id="remTel" class="rem-input" placeholder="573001234567" autocomplete="tel" required>
        <div class="rem-help">Incluye indicativo de país; se aceptan +, espacios y guiones.</div>
        <div class="rem-ventana" id="remVentana" role="status" aria-live="polite" hidden></div>

        <label class="rem-label" for="remMsg">Mensaje</label>
        <textarea id="remMsg" class="rem-input" rows="4" maxlength="4096" required
          placeholder="Ej: Hola 👋 Te recordamos que mañana vence el plazo de inscripción."></textarea>
        <div class="rem-help"><span id="remCount">0</span>/4096 · Se envía tal cual, con el formato de WhatsApp (*negrita*, _cursiva_).</div>

        <label class="rem-label" for="remFecha">Fecha y hora de envío</label>
        <input type="datetime-local" id="remFecha" class="rem-input" value="${valorLocal}" required>
        <div class="rem-help">Hora de tu dispositivo. Mínimo 30 segundos en el futuro.</div>

        <div class="rem-acciones">
          <button type="button" class="btn btn-secondary" id="remPreview">${icon('phone', 15)} Ver en el teléfono</button>
          <button type="submit" class="btn btn-primary" id="remSubmit">${icon('bell', 16)} Programar</button>
        </div>
        <div class="rem-feedback" id="remFeedback"></div>

        <div class="rem-nota-honesta">
          ${icon('note', 14)}
          <span>Los recordatorios automáticos por tareas o notas del estudiante todavía no son posibles:
          el bot no tiene conexión con el sistema académico. Lo que sí funciona es esto — programar el
          mensaje que quieras, para cuando quieras.</span>
        </div>
      </form>

      <div class="rem-lista-col">
        <div id="remFiltroWrap" class="rem-filtro"></div>
        <div id="remContent">
          ${Array.from({ length: 3 }).map(() => `
            <div class="card" style="margin-bottom:10px;">
              <div class="skeleton skeleton-line" style="width:40%;height:13px;margin-bottom:10px;"></div>
              <div class="skeleton skeleton-line" style="width:85%;height:11px;"></div>
            </div>`).join('')}
        </div>
      </div>
    </div>
  `;

  const msg = $('#remMsg');
  const remForm = main.querySelector('#remForm');
  const remTel = main.querySelector('#remTel');
  const remVentana = main.querySelector('#remVentana');
  msg.addEventListener('input', () => { $('#remCount').textContent = msg.value.length; });

  if (remPrefill) {
    $('#remTel').value = remPrefill.telefono;
    if (remPrefill.nombre) {
      msg.value = `Hola ${String(remPrefill.nombre).trim().split(/\s+/)[0]} 👋 `;
      msg.dispatchEvent(new Event('input'));
    }
    $('#remFeedback').innerHTML = `<span class="rem-ok">${icon('check', 13)} Destinatario tomado de la conversación${remPrefill.nombre ? ` con ${escapeHtml(remPrefill.nombre)}` : ''}</span>`;
    msg.focus();
    msg.setSelectionRange(msg.value.length, msg.value.length);
    remPrefill = null;   // solo aplica a la primera visita
  }

  // Ver el borrador dentro del marco de iPhone, tal como le va a llegar:
  // reusa el mismo componente que la bandeja, no una maqueta aparte.
  $('#remPreview').addEventListener('click', () => {
    const texto = msg.value.trim();
    if (!texto) { toast('Escribe el mensaje primero'); haptic([20, 30, 20]); return; }
    const cuando = $('#remFecha').value ? new Date($('#remFecha').value).getTime() : Date.now();
    const tel = $('#remTel').value.replace(/\D/g, '') || '573000000000';
    openPhonePreview(tel, 'Tooli · UTB', [[{ ts: cuando, direction: 'out', text: texto }]]);
  });

  /* El aviso usa la hora PROGRAMADA. Al cambiarla se recalcula con el mismo
     historial, y nunca se oculta un fallo de consulta como si hubiera ventana. */
  let consulta = { telefono: '', estado: 'pendiente', ultimoEntranteTs: null };
  let consultaSeq = 0;
  let consultaTimer;
  const pintarAvisoVentana = () => {
    if (!remTel.isConnected) return;
    if (!sesion.caps.metaWindow) { remVentana.hidden = true; return; }
    const telefono = remTel.value.replace(/\D/g, '');
    if (consulta.telefono !== telefono || consulta.estado === 'pendiente') {
      remVentana.hidden = true;
      return;
    }
    let aviso = '';
    if (consulta.estado === 'error') {
      aviso = 'No se pudo verificar la ventana de WhatsApp. Revisa la conversación antes de programar.';
    } else {
      const scheduledAt = new Date(main.querySelector('#remFecha').value).getTime();
      const estado = estadoVentanaRecordatorio(consulta.ultimoEntranteTs, scheduledAt);
      if (estado === 'sin-historial') aviso = 'No hay un mensaje entrante reciente registrado. Si la persona no escribe antes del envío, Meta puede rechazar el texto libre.';
      if (estado === 'fuera') aviso = 'La hora programada queda fuera de las 24 h desde el último mensaje entrante. Si la persona no vuelve a escribir, Meta rechazará el texto libre.';
    }
    remVentana.innerHTML = aviso ? `${icon('clock', 13)} ${aviso}` : '';
    remVentana.hidden = !aviso;
  };
  const avisoVentana = async () => {
    if (!remTel.isConnected) return;
    if (!sesion.caps.metaWindow) { remVentana.hidden = true; return; }
    const telefono = remTel.value.replace(/\D/g, '');
    const texto = remTel.value.trim();
    if (!/^\+?[\d\s().-]+$/.test(texto) || !/^[1-9]\d{9,14}$/.test(telefono)) {
      remVentana.hidden = true;
      return;
    }
    if (consulta.telefono === telefono && consulta.estado === 'ok') {
      pintarAvisoVentana();
      return;
    }
    const seq = ++consultaSeq;
    consulta = { telefono, estado: 'pendiente', ultimoEntranteTs: null };
    remVentana.hidden = true;
    try {
      const r = await api('/api/tools/bot-users/batch', { method: 'POST', body: JSON.stringify({ phones: [telefono] }) });
      if (!r?.ok) throw new Error('No se pudo consultar la conversación');
      const info = (await r.json()).users?.[0];
      if (!remTel.isConnected || seq !== consultaSeq || remTel.value.replace(/\D/g, '') !== telefono) return;
      const entradas = (info?.recentMessages ?? []).filter(m => m.direction === 'in' && Number.isFinite(m.ts) && m.ts <= Date.now());
      consulta = { telefono, estado: 'ok', ultimoEntranteTs: entradas.length ? Math.max(...entradas.map(m => m.ts)) : null };
    } catch {
      if (!remTel.isConnected || seq !== consultaSeq || remTel.value.replace(/\D/g, '') !== telefono) return;
      consulta = { telefono, estado: 'error', ultimoEntranteTs: null };
    }
    pintarAvisoVentana();
  };
  remTel.addEventListener('input', () => {
    ++consultaSeq;
    clearTimeout(consultaTimer);
    remVentana.hidden = true;
    consultaTimer = setTimeout(avisoVentana, 350);
  });
  remTel.addEventListener('change', () => { clearTimeout(consultaTimer); void avisoVentana(); });
  remTel.addEventListener('blur', () => { clearTimeout(consultaTimer); void avisoVentana(); });
  main.querySelector('#remFecha').addEventListener('input', pintarAvisoVentana);
  main.querySelector('#remFecha').addEventListener('change', pintarAvisoVentana);
  if (remTel.value) void avisoVentana();

  remForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#remSubmit');
    const fb = $('#remFeedback');
    const telefono = remTel.value.trim();
    const mensaje = msg.value.trim();
    const fechaLocal = $('#remFecha').value;

    const scheduledAt = new Date(fechaLocal).getTime();
    if (!Number.isFinite(scheduledAt)) { fb.textContent = 'Elige una fecha y hora válidas.'; return; }
    if (scheduledAt < Date.now() + 30_000) { fb.textContent = 'Elige una hora al menos 30 segundos en el futuro.'; return; }
    btn.disabled = true;
    btn.classList.add('is-loading');
    fb.innerHTML = '';

    try {
      const r = await api('/api/tools/recordatorios', {
        method: 'POST',
        body: JSON.stringify({ telefono, mensaje, scheduledAt: new Date(scheduledAt).toISOString() }),
      });
      if (!remForm.isConnected || !r) return;
      const data = await r.json();
      if (!remForm.isConnected) return;
      if (!r.ok) {
        fb.innerHTML = `<span class="rem-error">${icon('x', 13)} ${escapeHtml(data.message ?? 'No se pudo programar')}</span>`;
        haptic([20, 30, 20]);
        return;
      }
      haptic([10, 20, 10]);
      toast('Recordatorio programado ✓');
      msg.value = '';
      $('#remCount').textContent = '0';
      fb.innerHTML = `<span class="rem-ok">${icon('check', 13)} Se enviará ${tiempoRelativoFuturo(scheduledAt)}</span>`;
      remFiltro = 'programado';
      await cargarRecordatorios();
    } catch {
      if (remForm.isConnected) fb.innerHTML = `<span class="rem-error">${icon('x', 13)} Sin conexión con el servidor.</span>`;
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-loading');
    }
  });

  $('#refreshRem').addEventListener('click', () => {
    $('#refreshRem').querySelector('.refresh-icon')?.classList.add('spin-once');
    cargarRecordatorios();
  });

  setPullToRefresh(() => cargarRecordatorios());
  await cargarRecordatorios();
}

async function cargarRecordatorios() {
  const content = $('#remContent');
  if (!content) return;
  const seq = ++remLoadSeq;
  try {
    const r = await api('/api/tools/recordatorios');
    if (!r?.ok) throw new Error('No se pudieron cargar los recordatorios');
    const { reminders } = await r.json();
    if (!content.isConnected || seq !== remLoadSeq) return;
    if (!Array.isArray(reminders)) throw new Error('Respuesta inválida');
    remLista = reminders;
  } catch {
    if (content.isConnected && seq === remLoadSeq) {
      content.innerHTML = '<div class="alert alert-error" role="alert">No se pudieron cargar los recordatorios. <button type="button" class="btn btn-secondary" id="retryRem">Reintentar</button></div>';
      content.querySelector('#retryRem')?.addEventListener('click', cargarRecordatorios);
    }
    return;
  }

  const counts = remLista.reduce((acc, x) => { acc[x.estado] = (acc[x.estado] ?? 0) + 1; return acc; }, {});
  const wrap = $('#remFiltroWrap');
  if (wrap) {
    wrap.innerHTML = '';
    wrap.appendChild(buildSegmented(
      [
        { value: 'todos', label: `Todos (${remLista.length})` },
        ...Object.entries(REM_ESTADOS).filter(([k]) => counts[k]).map(([k, v]) => ({ value: k, label: `${v.label} (${counts[k]})` })),
      ],
      counts[remFiltro] ? remFiltro : 'todos',
      (v) => { remFiltro = v; pintarRecordatorios(); },
    ));
  }
  if (!counts[remFiltro]) remFiltro = 'todos';
  pintarRecordatorios();
}

function pintarRecordatorios() {
  const cont = $('#remContent');
  if (!cont) return;
  const lista = remFiltro === 'todos' ? remLista : remLista.filter(x => x.estado === remFiltro);

  if (!lista.length) {
    cont.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${icon('clock', 42)}</div>
        <div class="empty-state-title">${remLista.length ? 'Nada en este estado' : 'Aún no hay recordatorios'}</div>
        <div class="empty-state-sub">${remLista.length
          ? 'Prueba con otro filtro.'
          : 'Programa el primero con el formulario de al lado: se enviará solo a la hora que elijas.'}</div>
      </div>`;
    return;
  }

  cont.innerHTML = `<div class="stagger-in">${lista.map(rem => {
    const meta = REM_ESTADOS[rem.estado] ?? REM_ESTADOS.programado;
    return `
      <div class="card rem-card" data-rem="${escapeHtml(rem.id)}">
        <div class="rem-card-top">
          <span class="badge" style="background:${meta.color}1f;color:${colorTextoLegible(meta.color)};">${emoji(meta.icon)} ${meta.label}</span>
          <span class="rem-card-cuando" title="${escapeHtml(new Date(rem.scheduledAt).toLocaleString('es-CO'))}">
            ${icon('clock', 12)} ${tiempoRelativoFuturo(rem.scheduledAt)}
          </span>
          ${rem.estado === 'programado' ? `<button type="button" class="btn btn-secondary crm-mini-btn rem-cancel" data-cancel="${escapeHtml(rem.id)}">Cancelar</button>` : ''}
        </div>
        <div class="rem-card-msg">${escapeHtml(rem.mensaje)}</div>
        <div class="rem-card-meta">
          <span>${icon('phone', 11)} +${escapeHtml(rem.telefono)}</span>
          <span>${icon('user', 11)} ${escapeHtml(rem.createdBy ?? '—')}</span>
          <span>${new Date(rem.scheduledAt).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}</span>
        </div>
        ${rem.error ? `<div class="rem-card-error">${icon('x', 12)} ${escapeHtml(rem.error)}</div>` : ''}
      </div>`;
  }).join('')}</div>`;

  cont.querySelectorAll('[data-cancel]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.cancel;
      ActionSheet.open({
        title: '¿Cancelar este recordatorio?',
        subtitle: 'No se enviará. Esta acción no se puede deshacer.',
        groups: [
          [{ label: 'Cancelar recordatorio', icon: icon('trash', 16), destructive: true, onClick: async () => {
            haptic([20, 30, 20]);
            try {
              const r = await api(`/api/tools/recordatorios/${id}`, { method: 'DELETE' });
              if (!r.ok) throw new Error();
              toast('Recordatorio cancelado');
              await cargarRecordatorios();
            } catch { toast('No se pudo cancelar'); }
          } }],
          [{ label: 'Dejarlo programado', cancel: true }],
        ],
      });
    });
  });
}

export { renderRecordatorios, setRemPrefill };
