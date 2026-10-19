import { api } from '../core/api.js';
import { $, escapeHtml, haptic, toast } from '../core/dom.js';
import { icon } from '../core/icons.js';
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

async function renderRecordatorios(main) {
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
        <h3 class="rem-form-title">${icon('plus', 16)} Programar uno nuevo</h3>
        <label class="rem-label" for="remTel">WhatsApp del destinatario</label>
        <input type="tel" id="remTel" class="rem-input" placeholder="573001234567" inputmode="numeric" required>
        <div class="rem-help">Con indicativo de país, sin + ni espacios.</div>
        <div class="rem-ventana" id="remVentana" hidden></div>

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

  /* Aviso de la ventana de 24h de Meta: si la persona no ha escrito hace más de
     un día, un mensaje de texto libre será rechazado al momento del envío. No se
     bloquea —puede volver a escribir antes de la hora programada— pero el asesor
     tiene que saberlo antes de programar algo que quizá no salga. */
  const avisoVentana = async () => {
    const tel = $('#remTel').value.replace(/\D/g, '');
    const aviso = $('#remVentana');
    if (!aviso) return;
    if (tel.length < 10) { aviso.hidden = true; return; }
    try {
      const r = await api('/api/tools/bot-users/batch', { method: 'POST', body: JSON.stringify({ phones: [tel] }) });
      if (!r?.ok) throw new Error('No se pudo consultar la conversación');
      const info = (await r.json()).users?.[0];
      if ($('#remTel').value.replace(/\D/g, '') !== tel) return;
      const ultimoEntrante = info?.recentMessages?.find(m => m.direction === 'in');
      if (!ultimoEntrante) {
        aviso.innerHTML = `${icon('clock', 13)} Esta persona no ha escrito nunca al bot. WhatsApp solo permite texto libre dentro de las 24 h siguientes a un mensaje suyo.`;
        aviso.hidden = false;
        return;
      }
      const horas = Math.floor((Date.now() - ultimoEntrante.ts) / 3_600_000);
      if (horas >= 23) {
        aviso.innerHTML = `${icon('clock', 13)} Escribió hace ${horas} h. Si no vuelve a escribir antes de la hora programada, Meta rechazará el mensaje por la ventana de 24 h.`;
        aviso.hidden = false;
      } else {
        aviso.hidden = true;
      }
    } catch { if ($('#remTel').value.replace(/\D/g, '') === tel) aviso.hidden = true; }
  };
  $('#remTel').addEventListener('change', avisoVentana);
  $('#remTel').addEventListener('blur', avisoVentana);
  if ($('#remTel').value) avisoVentana();

  $('#remForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#remSubmit');
    const fb = $('#remFeedback');
    const telefono = $('#remTel').value.replace(/\D/g, '');
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
      if (!r) return;
      const data = await r.json();
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
      fb.innerHTML = `<span class="rem-error">${icon('x', 13)} Sin conexión con el servidor.</span>`;
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
  try {
    const r = await api('/api/tools/recordatorios');
    if (!r?.ok) throw new Error('No se pudieron cargar los recordatorios');
    const { reminders } = await r.json();
    if (!Array.isArray(reminders)) throw new Error('Respuesta inválida');
    remLista = reminders;
  } catch {
    const content = $('#remContent');
    if (content) content.innerHTML = '<div class="alert alert-error" role="alert">No se pudieron cargar los recordatorios. <button type="button" class="btn btn-secondary" id="retryRem">Reintentar</button></div>';
    $('#retryRem')?.addEventListener('click', cargarRecordatorios);
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
          <span class="badge" style="background:${meta.color}1f;color:${meta.color};">${meta.icon} ${meta.label}</span>
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
