import { api } from '../core/api.js';
import { $, $$, copyToClipboard, escapeHtml, haptic, toast } from '../core/dom.js';
import { avatarTone, descargarCsv, fechaParaCsv, formatTelefono, friendlyDate, initialsFor } from '../core/format.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/router.js';
import { setPullToRefresh } from '../core/screen.js';
import { buildSegmented } from '../ui/controls.js';
import { previewPhoneFor } from '../ui/phone-preview.js';
import { openProfileSheet } from '../ui/profile.js';
import { contextSheet } from '../ui/sheet.js';
import { conectarReintento, htmlError, marcarCargando } from '../ui/estado.js';

/* ============= LÓGICA PURA DEL EVENTO (probada en evento.test.js) =============
   Filas del endpoint real `/api/tools/registros-evento-posgrado` (ver
   src/services/posgradosEventoSheets.ts, rango A2:H): [fecha, whatsapp,
   nombre, correo, interésFinanciación, programa, autorizaContacto,
   seguimiento]. La columna H la escribe el equipo desde el panel. */
function estadoEventoDe(row) {
  const raw = String(row?.[7] ?? '').trim();
  if (!raw) return 'pendiente';
  const normalized = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const known = {
    beca: 'Interesado en beca',
    'interesado en beca': 'Interesado en beca',
    contactado: 'Contactado',
    interesado: 'Interesado',
    inscrito: 'Inscrito',
    'invitado a proximo evento': 'Invitado a próximo evento',
    'no interesado': 'No interesado',
    'confirmo asistencia': 'Confirmó asistencia',
    pendiente: 'pendiente',
  };
  return known[normalized] ?? raw;
}

function autorizaContacto(row) { return (row[6] || '').toLowerCase().startsWith('s'); }

function eventoPasaFiltros(row, filtros) {
  const { estadoFiltro = 'todos', becaVista = 'todos', q = '' } = filtros ?? {};
  const estado = estadoEventoDe(row);
  if (becaVista === 'beca' && estado !== 'Interesado en beca') return false;
  if (estadoFiltro !== 'todos' && estado !== estadoFiltro) return false;
  const query = (q ?? '').trim().toLowerCase();
  if (!query) return true;
  return [row[2], row[3], row[5]].some(v => (v ?? '').toLowerCase().includes(query));
}

function filtrarEventoRows(rows, filtros) {
  return (rows ?? []).map((row, idx) => ({ row, idx })).filter(({ row }) => eventoPasaFiltros(row, filtros));
}

/** Conteos operativos sobre las filas ya cargadas — nada inventado. */
function resumirEvento(rows) {
  const resumen = { total: 0, porEstado: {}, autorizaron: 0, noAutorizaron: 0, candidatosBeca: 0 };
  for (const row of rows ?? []) {
    resumen.total += 1;
    const estado = estadoEventoDe(row);
    resumen.porEstado[estado] = (resumen.porEstado[estado] ?? 0) + 1;
    if (autorizaContacto(row)) resumen.autorizaron += 1;
    else resumen.noAutorizaron += 1;
    if (estado === 'Interesado en beca') resumen.candidatosBeca += 1;
  }
  return resumen;
}

function textoResumenEvento(resumen, visibles) {
  const base = `${resumen.total} registro${resumen.total === 1 ? '' : 's'} · ${resumen.autorizaron} autorizó contacto · ${resumen.candidatosBeca} candidato${resumen.candidatosBeca === 1 ? '' : 's'} a beca`;
  if (visibles !== resumen.total) return `${base} · viendo ${visibles}`;
  return base;
}

/** Reglas del modal de invitación (largo 10–1000). Puras para poder probarlas. */
function validarInvitacion(texto) {
  const t = (texto ?? '').trim();
  if (t.length < 10) return 'El mensaje es muy corto.';
  if (t.length > 1000) return 'Máximo 1000 caracteres.';
  return null;
}

function exportarEventoCsv() {
  const q = ($('#eventoSearch')?.value ?? '').trim().toLowerCase();
  const pares = filtrarEventoRows(eventoRows, { estadoFiltro: eventoFilter, becaVista, q });
  const filas = pares.map(({ row }) => row);

  if (!filas.length) { toast('No hay nada que exportar con estos filtros'); haptic([20, 30, 20]); return; }

  const cabecera = ['Fecha', 'WhatsApp', 'Nombre', 'Correo', 'Interés en financiación', 'Programa', 'Autoriza contacto', 'Seguimiento'];
  const datos = filas.map((row) => [
    fechaParaCsv(row[0]), row[1], row[2], row[3], row[4], row[5], row[6], row[7] || 'Sin contactar',
  ]);

  descargarCsv(`evento-posgrados-${new Date().toISOString().slice(0, 10)}.csv`, cabecera, datos);
  toast(`${filas.length} registro${filas.length === 1 ? '' : 's'} exportado${filas.length === 1 ? '' : 's'}`);
}

/* ============= EVENTO POSGRADOS (meetup) ============= */
/* Registros de la campaña "Retos del Management Digital" — vienen de un
   Google Sheet aparte del CRM normal (ver src/flows/posgrados-evento).
   Columnas: 0 fecha, 1 whatsapp, 2 nombre, 3 correo, 4 interésFinanciación,
   5 programa, 6 autorizaContacto, 7 seguimiento (agregada para el panel). */
const SEGUIMIENTO_ESTADOS = [
  { value: 'Contactado', icon: '📞', color: '#0284c7' },
  { value: 'Interesado', icon: '⭐', color: '#7c3aed' },
  { value: 'Inscrito', icon: '🎓', color: '#16a34a' },
  { value: 'Invitado a próximo evento', icon: '📅', color: '#d97706' },
  { value: 'No interesado', icon: '✖️', color: '#64748b' },
  { value: 'Confirmó asistencia', icon: '✅', color: '#16a34a' },
  { value: 'Interesado en beca', icon: '💰', color: '#eab308' },
];
function seguimientoMeta(valor) {
  return SEGUIMIENTO_ESTADOS.find(s => s.value === valor) ?? { value: valor || 'Sin contactar', icon: '⏳', color: '#94a3b8' };
}

let eventoRows = [];
let eventoFilter = 'todos';
let becaVista = 'todos'; // 'todos' | 'beca' — filtro rápido de candidatos a beca

async function renderEventoPosgrado(main) {
  main.innerHTML = `
    <div class="page-header">
      <div><h1>${icon('calendar', 26)} Evento posgrados</h1><div class="subtitle">Prospectos del meetup "Retos del Management Digital" — dales seguimiento e invítalos a lo que sigue</div></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button class="btn btn-secondary" id="verCrmDesdeEvento">Ver CRM</button>
        <button class="btn btn-secondary" id="exportEventoCsv">${icon('external', 14)} <span>Exportar<span class="hide-sm"> CSV</span></span></button>
        <button class="btn btn-secondary" id="refreshEvento"><span class="refresh-icon">${icon('refresh', 16)}</span> Actualizar</button>
      </div>
    </div>
    <div class="crm-toolbar">
      <input type="text" id="eventoSearch" placeholder="Buscar por nombre, email o programa…" aria-label="Buscar por nombre, email o programa">
      <div id="eventoFilterWrap"></div>
    </div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
      <span style="font-size:12.5px;font-weight:600;color:var(--text-muted);">Vista rápida:</span>
      <div id="becaVistaWrap"></div>
      <span style="font-size:11.5px;color:var(--text-muted);">Filtra candidatos a beca para ofrecerles financiación</span>
    </div>
    <p id="eventoResumen" class="seg-resumen" aria-live="polite"></p>
    <div id="eventoContent">
      <div class="crm-grid stagger-in">
        ${Array.from({ length: 6 }).map(() => `
          <div class="crm-card">
            <div class="skeleton" style="width:44px;height:44px;border-radius:50%;margin-bottom:12px;"></div>
            <div class="skeleton skeleton-line" style="width:70%;height:14px;margin-bottom:8px;"></div>
            <div class="skeleton skeleton-line" style="width:90%;height:11px;"></div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  $('#eventoSearch').addEventListener('input', renderEventoGrid);
  $('#exportEventoCsv').addEventListener('click', () => exportarEventoCsv());
  $('#verCrmDesdeEvento').addEventListener('click', () => navigate('registros'));

  // Vista rápida de becas — segundo segmentado reusando buildSegmented (mismo patrón iOS que el filtro de estados)
  function renderBecaVistaSegment() {
    const becaCount = eventoRows.filter(r => estadoEventoDe(r) === 'Interesado en beca').length;
    const wrap = $('#becaVistaWrap');
    if (!wrap) return;
    wrap.innerHTML = '';
    wrap.appendChild(buildSegmented(
      [
        { value: 'todos', label: `Todos (${eventoRows.length})` },
        { value: 'beca',  label: `💰 Candidatos a beca (${becaCount})` },
      ],
      becaVista, (v) => { becaVista = v; renderEventoGrid(); },
    ));
  }

  setPullToRefresh(() => loadEvento());
  const eventoContent = main.querySelector('#eventoContent');
  let loadSeq = 0;
  async function loadEvento() {
    if (!eventoContent?.isConnected) return;
    const seq = ++loadSeq;
    marcarCargando(eventoContent, true);
    main.querySelector('#refreshEvento')?.querySelector('.refresh-icon')?.classList.add('spin-once');
    try {
      const r = await api('/api/tools/registros-evento-posgrado');
      if (!eventoContent.isConnected || seq !== loadSeq || !r) return;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { rows } = await r.json();
      if (!eventoContent.isConnected || seq !== loadSeq) return;
      eventoRows = rows ?? [];
      const pintarResumenEvento = (visibles) => {
        const el = $('#eventoResumen');
        if (el) el.textContent = textoResumenEvento(resumirEvento(eventoRows), visibles);
      };
      if (!eventoRows.length) {
        eventoContent.innerHTML = `<div class="card"><p style="color:var(--text-muted);text-align:center;padding:24px 0;">Aún no hay registros de este evento. Cuando alguien complete el flujo del meetup por WhatsApp, aparecerá aquí.</p></div>`;
        $('#eventoFilterWrap').innerHTML = '';
        $('#becaVistaWrap').innerHTML = '';
        pintarResumenEvento(0);
        marcarCargando(eventoContent, false);
        return;
      }
      const counts = eventoRows.reduce((acc, row) => { const k = estadoEventoDe(row); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
      $('#eventoFilterWrap').innerHTML = '';
      $('#eventoFilterWrap').appendChild(buildSegmented(
        [
          { value: 'todos', label: `Todos (${eventoRows.length})` },
          ...(counts.pendiente ? [{ value: 'pendiente', label: `Sin contactar (${counts.pendiente})` }] : []),
          ...SEGUIMIENTO_ESTADOS.filter(s => counts[s.value]).map(s => ({ value: s.value, label: `${s.value} (${counts[s.value]})` })),
        ],
        eventoFilter, (v) => { eventoFilter = v; renderEventoGrid(); },
      ));
      renderBecaVistaSegment();
      renderEventoGrid();
      marcarCargando(eventoContent, false);
    } catch (err) {
      console.error(err);
      if (eventoContent.isConnected && seq === loadSeq) {
        eventoContent.innerHTML = htmlError('No se pudieron cargar los registros del evento. Intenta de nuevo; si sigue fallando, avisa a un administrador.');
        conectarReintento(eventoContent, loadEvento);
        marcarCargando(eventoContent, false);
      }
    }
  }

  function renderEventoGrid() {
    // Mantener el segmentado de becas sincronizado con el conteo actual
    if (eventoRows.length) renderBecaVistaSegment();
    const q = ($('#eventoSearch')?.value ?? '').trim().toLowerCase();
    const pares = filtrarEventoRows(eventoRows, { estadoFiltro: eventoFilter, becaVista, q });
    const resumenEl = $('#eventoResumen');
    if (resumenEl) resumenEl.textContent = textoResumenEvento(resumirEvento(eventoRows), pares.length);
    const filtered = pares.map(({ row, idx }) => { row.__i = idx; return row; });
    if (!filtered.length) {
      const motivos = [];
      if (becaVista === 'beca') motivos.push('candidatos a beca');
      if (eventoFilter !== 'todos') motivos.push(`en estado "${eventoFilter}"`);
      if (q) motivos.push(`que coincidan con "${q}"`);
      const detalle = motivos.length ? `No hay registros ${motivos.join(', ')}.` : 'No hay registros con esos filtros.';
      $('#eventoContent').innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">${icon('search', 42)}</div>
          <div class="empty-state-title">Sin resultados</div>
          <div class="empty-state-sub">${escapeHtml(detalle)}</div>
          <button type="button" class="btn btn-secondary" id="eventoLimpiarFiltros" style="margin-top:12px;">Quitar los filtros</button>
        </div>`;
      $('#eventoLimpiarFiltros')?.addEventListener('click', () => {
        eventoFilter = 'todos';
        becaVista = 'todos';
        if ($('#eventoSearch')) $('#eventoSearch').value = '';
        haptic(10);
        loadEvento();
      });
      return;
    }
    $('#eventoContent').innerHTML = `
      <div class="crm-grid stagger-in">
        ${filtered.map(row => {
          const nombre = row[2] || 'Sin nombre';
          const autoriza = (row[6] || '').toLowerCase().startsWith('s');
          const meta = seguimientoMeta(estadoEventoDe(row));
          return `
          <div class="crm-card" data-longpress data-row="${row.__i}" tabindex="0" role="button" aria-label="Ver perfil de ${escapeHtml(nombre)}">
            <div class="advisor-card-top">
              <div class="avatar" style="background:${avatarTone(nombre)};width:44px;height:44px;font-size:14px;">${initialsFor(row[1] || nombre, nombre)}</div>
              <span class="badge" style="background:${meta.color}22;color:${meta.color};">${meta.icon} ${escapeHtml(meta.value)}</span>
            </div>
            <div class="crm-card-name">${escapeHtml(nombre)}</div>
            ${row[5] ? `<span class="badge" style="background:#7c3aed22;color:#7c3aed;margin-bottom:8px;">${escapeHtml(row[5])}</span>` : ''}
            <div class="crm-card-row">✉️ ${escapeHtml(row[3] || '—')}</div>
            <div class="crm-card-row">📱 ${escapeHtml(formatTelefono(row[1]) || '—')}</div>
            ${!autoriza ? `<div class="crm-card-row" style="color:var(--danger);font-weight:600;">🔒 No autorizó contacto</div>` : ''}
            <div class="crm-card-date">${escapeHtml(friendlyDate(row[0]))}</div>
          </div>
        `; }).join('')}
      </div>
    `;
    $$('.crm-card[data-longpress]').forEach(card => {
      const row = eventoRows[Number(card.dataset.row)];
      card.addEventListener('click', () => openEventoProfile(row));
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEventoProfile(row); } });
      contextSheet(card, {
        title: row[2] || 'Prospecto',
        subtitle: row[3] || undefined,
        actions: [
          { label: 'Ver perfil', icon: '👤', onClick: () => openEventoProfile(row) },
          ...(row[1] ? [{ label: 'Vista previa en teléfono', icon: '📲', onClick: () => previewPhoneFor(row[1]) }] : []),
          { label: 'Copiar email', icon: '📧', onClick: () => copyToClipboard(row[3] ?? '', 'Email copiado') },
          { label: 'Copiar WhatsApp', icon: '📱', onClick: () => copyToClipboard(row[1] ?? '', 'Número copiado') },
        ],
      });
    });
  }

  async function setSeguimiento(row, estado) {
    const fila = row.__i + 2; // el Sheet arranca a leer en A2
    try {
      const res = await api(`/api/tools/registros-evento-posgrado/${fila}/seguimiento`, { method: 'POST', body: JSON.stringify({ estado }) });
      if (!eventoContent.isConnected || !res) return;
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast(err.error === 'estado_invalido' ? 'Estado no válido' : 'No se pudo actualizar el seguimiento');
        return;
      }
      row[7] = estado;
      haptic([10, 20, 10]);
      toast(`Marcado como "${estado}"`);
      renderEventoGrid();
    } catch {
      toast('No se pudo actualizar el seguimiento');
    }
  }

  // Modal para invitar a próximo evento: mensaje editable (placeholder genérico) + envío real vía WhatsApp
  function openInvitarModal(row) {
    const [ , whatsapp, nombre] = row;
    const fila = row.__i + 2;
    const primer = (nombre || '').trim().split(/\s+/)[0] || 'Hola';
    const defaultMsg =
      `¡${primer}! 👋 Soy del equipo de Posgrados UTB 🎓\n\n` +
      `Te queremos invitar a nuestro próximo evento de posgrados. Será una gran oportunidad para conocer a fondo la Especialización y la Maestría, resolver dudas y conversar con nuestros asesores.\n\n` +
      `¿Te gustaría que te enviemos los detalles y reservemos tu cupo? Responde a este mensaje y te contamos todo. ¡Te esperamos! 🙌`;

    const overlay = document.createElement('div');
    overlay.className = 'sheet-backdrop';
    overlay.style.alignItems = 'center';
    // z-index 500: este modal se abre ENCIMA del sheet de perfil (que sigue
    // abierto con closeAfter:false) — sin esto queda invisible detrás, mismo
    // patrón que .phone-preview-overlay (styles.css).
    overlay.style.zIndex = '500';
    overlay.innerHTML = `
      <div class="action-sheet" role="dialog" aria-modal="true" aria-label="Invitar a próximo evento" style="max-width:480px;">
        <div class="sheet-group" style="padding:16px;text-align:left;">
          <div class="sheet-title" style="text-align:left;margin-bottom:4px;">Invitar a próximo evento</div>
          <div class="sheet-subtitle" style="text-align:left;margin-bottom:12px;">Se enviará un WhatsApp real a +${escapeHtml(whatsapp)} vía ${whatsapp ? 'el número de Posgrados' : 'el bot'}. Puedes editar el texto antes de enviar.</div>
          <div class="field" style="margin-bottom:10px;">
            <label>Mensaje (texto plano, sin templates)</label>
            <textarea id="invitarText" rows="7" style="resize:vertical;min-height:120px;">${escapeHtml(defaultMsg)}</textarea>
            <div class="field-help">Hasta 1000 caracteres · Se marca como "Invitado a próximo evento" al enviar</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn btn-secondary" id="invitarCancel" style="flex:1;">Cancelar</button>
            <button type="button" class="btn btn-primary" id="invitarSend" style="flex:1;">📨 Enviar invitación</button>
          </div>
          <div id="invitarAlert" style="margin-top:10px;"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const opener = main.querySelector(`.crm-card[data-row="${row.__i}"]`);
    requestAnimationFrame(() => { overlay.classList.add('open'); overlay.querySelector('#invitarText')?.focus({ preventScroll: true }); });
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      window.removeEventListener('hashchange', close);
      document.removeEventListener('keydown', onKey);
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 260);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      const controls = Array.from(overlay.querySelectorAll('button, textarea')).filter(el => !el.disabled && el.getClientRects().length);
      if (!controls.length) return;
      if (e.shiftKey && (document.activeElement === controls[0] || !overlay.contains(document.activeElement))) { e.preventDefault(); controls.at(-1).focus(); }
      else if (!e.shiftKey && (document.activeElement === controls.at(-1) || !overlay.contains(document.activeElement))) { e.preventDefault(); controls[0].focus(); }
    };
    window.addEventListener('hashchange', close);
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#invitarCancel').addEventListener('click', close);
    overlay.querySelector('#invitarSend').addEventListener('click', async () => {
      const texto = overlay.querySelector('#invitarText').value.trim();
      const alertEl = overlay.querySelector('#invitarAlert');
      const errorInvitacion = validarInvitacion(texto);
      if (errorInvitacion) { alertEl.innerHTML = `<div class="alert alert-error" style="margin:0;">${escapeHtml(errorInvitacion)}</div>`; return; }
      const btn = overlay.querySelector('#invitarSend');
      btn.disabled = true; btn.textContent = 'Enviando…';
      try {
        const res = await api(`/api/tools/registros-evento-posgrado/${fila}/invitar`, {
          method: 'POST', body: JSON.stringify({ mensaje: texto, whatsapp }),
        });
        if (!eventoContent.isConnected) { close(); return; }
        if (!overlay.isConnected || !res) return;
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alertEl.innerHTML = `<div class="alert alert-error" style="margin:0;">${escapeHtml(err.message || err.error || 'No se pudo enviar')}</div>`;
          btn.disabled = false; btn.textContent = '📨 Enviar invitación';
          haptic([20, 30, 20]);
          return;
        }
        row[7] = 'Invitado a próximo evento';
        haptic([15, 40, 15]);
        toast('Invitación enviada ✓');
        close();
        renderEventoGrid();
      } catch {
        alertEl.innerHTML = '<div class="alert alert-error" style="margin:0;">Error de conexión.</div>';
        btn.disabled = false; btn.textContent = '📨 Enviar invitación';
        haptic([20, 30, 20]);
      }
    });
  }

  function openEventoProfile(row) {
    const [fecha, whatsapp, nombre, correo, interesFin, programa, autorizaRaw, seguimiento] = row;
    const autoriza = (autorizaRaw || '').toLowerCase().startsWith('s');
    const meta = seguimientoMeta(seguimiento);
    // Nota honesta: "Interesado en beca" solo marca el interés para que el asesor lo contacte;
    // otorgar una beca real requiere proceso administrativo humano fuera del panel (no se inventa).
    openProfileSheet({
      avatarBg: avatarTone(nombre || whatsapp), avatarText: initialsFor(whatsapp || nombre, nombre),
      title: nombre || 'Prospecto', subtitle: correo || (whatsapp ? formatTelefono(whatsapp) : undefined),
      badges: [
        ...(programa ? [{ label: programa, color: '#7c3aed' }] : []),
        { label: `${meta.icon} ${meta.value}`, color: meta.color },
        ...(!autoriza ? [{ label: '🔒 No autorizó contacto', color: '#dc2626' }] : []),
      ],
      rows: [
        ...(correo ? [{ icon: '📧', label: 'Email', value: correo }] : []),
        ...(whatsapp ? [{ icon: '📱', label: 'WhatsApp', value: formatTelefono(whatsapp) }] : []),
        ...(programa ? [{ icon: '🎓', label: 'Programa de interés', value: programa }] : []),
        ...(interesFin ? [{ icon: '💰', label: 'Interés en financiación', value: interesFin }] : []),
        { icon: '🗓️', label: 'Registrado', value: friendlyDate(fecha) },
        ...(seguimiento === 'Interesado en beca' ? [{ icon: '💡', label: 'Nota', value: 'Candidato a beca — contactar para ofrecer financiación (la beca real la gestiona Admisiones)' }] : []),
      ],
      actions: autoriza ? [
        ...(whatsapp ? [{ label: 'Vista previa en teléfono', icon: '📲', onClick: () => previewPhoneFor(whatsapp), closeAfter: false }] : []),
        ...(whatsapp ? [{ label: 'Invitar a próximo evento', icon: '📨', onClick: () => openInvitarModal(row) }] : []),
        ...SEGUIMIENTO_ESTADOS.filter(s => s.value !== seguimiento).map(s => ({
          label: `Marcar: ${s.value}`, icon: s.icon, onClick: () => setSeguimiento(row, s.value),
        })),
      ] : [],
    });
  }

  $('#refreshEvento').addEventListener('click', loadEvento);
  loadEvento();
}

export { renderEventoPosgrado, exportarEventoCsv, estadoEventoDe, autorizaContacto, eventoPasaFiltros, filtrarEventoRows, resumirEvento, textoResumenEvento, validarInvitacion };
