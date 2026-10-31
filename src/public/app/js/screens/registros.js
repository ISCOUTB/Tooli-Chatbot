import { api } from '../core/api.js';
import { MAX_DESTINATARIOS_CAMPANA, RELACIONES_CAMPANA, parseListaCampana } from '../core/campana.js';
import { CRM_ESTADOS, PROGRAMA_COLORS, PROGRAMA_LABELS, areaOf, crmCategoria, crmEstadoMeta, fichaHtml, flowCategory, wireFicha } from '../core/crm.js';
import { $, $$, copyToClipboard, escapeHtml, haptic, toast } from '../core/dom.js';
import { avatarTone, descargarCsv, fechaParaCsv, formatTelefono, friendlyDate, initialsFor } from '../core/format.js';
import { icon } from '../core/icons.js';
import { parametrosRuta } from '../core/router.js';
import { setPullToRefresh } from '../core/screen.js';
import { sesion } from '../core/session.js';
import { abrirConversacion } from './conversaciones.js';
import { buildSegmented } from '../ui/controls.js';
import { previewPhoneFor } from '../ui/phone-preview.js';
import { openProfileSheet } from '../ui/profile.js';
import { contextSheet } from '../ui/sheet.js';
import { conectarReintento, htmlAvisoParcial, htmlError, marcarCargando } from '../ui/estado.js';

/* ============= LÓGICA PURA DEL CRM (probada en registros.test.js) =============
   Filas del endpoint real `/api/tools/registros-posgrado` (ver
   src/services/registroService.ts): [fecha, nombre, email, whatsapp,
   programa, área]. La columna de área se agregó después: las filas viejas la
   traen vacía y `areaOf` las trata como Posgrado. */
const CRM_CSV_CABECERA = ['Fecha de registro', 'Nombre', 'Correo', 'WhatsApp', 'Programa de interés', 'Área', 'Etapa', 'Asesor', 'Etiquetas', 'Notas'];

/** ¿La fila pasa los filtros activos? No muta nada: solo decide. */
function crmPasaFiltros(row, filtros) {
  const { segmento = 'todos', etapa = 'todas', soloMios = false, sinAsignar = false, usuario = null, q = '', fichas = {} } = filtros ?? {};
  if (segmento !== 'todos' && crmCategoria(row) !== segmento) return false;
  if (etapa !== 'todas' && (fichas[row[3]]?.estado ?? 'nuevo') !== etapa) return false;
  if (soloMios && fichas[row[3]]?.asignadoA !== usuario) return false;
  if (sinAsignar && fichas[row[3]]?.asignadoA) return false;
  const query = (q ?? '').trim().toLowerCase();
  if (!query) return true;
  return [row[1], row[2], row[4]].some(v => (v ?? '').toLowerCase().includes(query));
}

/** Filtra sin mutar: devuelve [{ row, idx }] para conservar el índice real
   (la selección múltiple y el contextSheet trabajan sobre `crmRows[idx]`). */
function filtrarCrmRows(rows, filtros) {
  return (rows ?? []).map((row, idx) => ({ row, idx })).filter(({ row }) => crmPasaFiltros(row, filtros));
}

function telefonoBroadcastCrm(row) {
  const texto = String(row?.[3] ?? '').trim();
  const numero = texto.replace(/\D/g, '');
  return /^\+?[\d\s().-]+$/.test(texto) && /^[1-9]\d{9,14}$/.test(numero) ? numero : '';
}

function resumirSeleccionBroadcastCrm(rows, indices) {
  const numeros = new Set();
  let sinWhatsapp = 0;
  let repetidos = 0;
  for (const idx of indices) {
    const numero = telefonoBroadcastCrm(rows[idx]);
    if (!numero) sinWhatsapp++;
    else if (numeros.has(numero)) repetidos++;
    else numeros.add(numero);
  }
  return { numeros: [...numeros], sinWhatsapp, repetidos };
}

/** Conteos por segmento sobre las filas ya cargadas — nada inventado. */
function resumirSegmentos(rows) {
  const resumen = { total: 0, pregrado: 0, posgrado: 0 };
  for (const row of rows ?? []) {
    resumen.total += 1;
    if (areaOf(row) === 'Pregrado') resumen.pregrado += 1;
    else resumen.posgrado += 1;
  }
  return resumen;
}

/** Texto del resumen visible: totales por segmento + cuántos se están viendo. */
function textoResumenSegmentos(resumen, visibles) {
  const base = `${resumen.total} prospecto${resumen.total === 1 ? '' : 's'} · ${resumen.pregrado} Pregrado · ${resumen.posgrado} Posgrado`;
  if (visibles !== resumen.total) return `${base} · viendo ${visibles}`;
  return base;
}

/** Filas de datos para el CSV a partir de filas ya filtradas. */
function filasCrmParaCsv(pares, fichas) {
  return (pares ?? []).map(({ row }) => {
    const f = fichas?.[row[3]];
    return [
      fechaParaCsv(row[0]), row[1], row[2], row[3], row[4], areaOf(row),
      crmEstadoMeta(f?.estado ?? 'nuevo').label,
      f?.asignadoA ?? '',
      (f?.etiquetas ?? []).join(', '),
      f?.notas?.length ?? 0,
    ];
  });
}

/* Hace accesible el segmentado de buildSegmented (core, no modificable):
   radiogroup con etiqueta + radios con aria-checked sincronizado. */
function hacerSegmentadoAccesible(wrap, etiqueta) {
  if (!wrap) return;
  wrap.setAttribute('role', 'radiogroup');
  wrap.setAttribute('aria-label', etiqueta);
  const botones = Array.from(wrap.querySelectorAll('button[data-value]'));
  const sincronizar = () => botones.forEach(b => {
    b.setAttribute('role', 'radio');
    const activo = b.classList.contains('active');
    b.setAttribute('aria-checked', activo ? 'true' : 'false');
    b.tabIndex = activo ? 0 : -1;
  });
  sincronizar();
  requestAnimationFrame(sincronizar);
  botones.forEach(b => b.addEventListener('click', () => requestAnimationFrame(sincronizar)));
  wrap.addEventListener('keydown', (event) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return;
    const actual = botones.indexOf(document.activeElement);
    if (actual < 0) return;
    event.preventDefault();
    const avance = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const siguiente = botones[(actual + avance + botones.length) % botones.length];
    siguiente.click();
    siguiente.focus();
  });
}

function exportarCrmCsv() {
  const q = ($('#crmSearch')?.value ?? '').trim().toLowerCase();
  const pares = filtrarCrmRows(crmRows, {
    segmento: crmFilter, etapa: crmEtapa, soloMios: crmSoloMios, sinAsignar: crmSinAsignar,
    usuario: sesion.user?.username, q, fichas: crmFichas,
  });
  const filas = pares.map(({ row }) => row);

  if (!filas.length) { toast('No hay nada que exportar con estos filtros'); haptic([20, 30, 20]); return; }

  const datos = filasCrmParaCsv(pares, crmFichas);

  descargarCsv(`prospectos-${new Date().toISOString().slice(0, 10)}.csv`, CRM_CSV_CABECERA, datos);
  toast(`${filas.length} prospecto${filas.length === 1 ? '' : 's'} exportado${filas.length === 1 ? '' : 's'}`);
}

/** Mismo patrón para los prospectos del evento de posgrados. */


let crmRows = [];
let crmFilter = 'todos';
let crmFichas = {};
let crmEtapa = 'todas';
let crmSoloMios = false;
let crmSinAsignar = false;

async function renderRegistros(main) {
  const params = parametrosRuta();
  const etapaInicial = params.get('etapa');
  crmEtapa = CRM_ESTADOS.some(item => item.value === etapaInicial) ? etapaInicial : 'todas';
  crmSoloMios = params.get('mios') === '1';
  crmSinAsignar = params.get('sinAsignar') === '1';
  let selectMode = false;
  let selected = new Set();
  const canBroadcast = sesion.user?.role === 'admin';

  main.innerHTML = `
    <div class="page-header">
      <div><h1>${icon('users', 26)} CRM</h1><div class="subtitle">Pregrado y posgrado — quienes completaron el registro de interés vía WhatsApp</div></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        ${canBroadcast ? `<button class="btn btn-secondary" id="toggleSelectMode">${icon('check', 14)} Seleccionar varios</button>` : ''}
        ${canBroadcast ? `<button class="btn btn-secondary" id="openCampana">${icon('send', 14)} <span>Campaña<span class="hide-sm"> por pregrado</span></span></button>` : ''}
        <button class="btn btn-secondary" id="exportCsv">${icon('external', 14)} <span>Exportar<span class="hide-sm"> CSV</span></span></button>
        <button class="btn btn-secondary" id="refreshReg"><span class="refresh-icon">${icon('refresh', 16)}</span> Actualizar</button>
      </div>
    </div>
    <div class="crm-toolbar">
      <input type="text" id="crmSearch" placeholder="Buscar por nombre, email o programa…" aria-label="Buscar por nombre, email o programa">
      <div id="crmFilterWrap"></div>
    </div>
    <div class="crm-etapa-fila" id="crmEtapaFila">
      <span class="crm-etapa-label">Etapa del embudo:</span>
      <div id="crmEtapaWrap"></div>
      <button type="button" class="crm-mios ${crmSoloMios ? 'active' : ''}" id="crmMios" aria-pressed="${crmSoloMios}">${icon('user', 13)} Solo los míos</button>
      <button type="button" class="crm-mios crm-sin-asignar ${crmSinAsignar ? 'active' : ''}" id="crmSinAsignar" aria-pressed="${crmSinAsignar}">${icon('x', 13)} Sin asignar</button>
    </div>
    <p id="crmSegResumen" class="seg-resumen" aria-live="polite"></p>
    <div id="crmAvisoSeguimiento"></div>
    <div id="broadcastBar" class="broadcast-bar hidden">
      <div class="broadcast-bar-left">
        <span class="broadcast-count" id="broadcastCount">0 seleccionados</span>
        <span class="broadcast-hint" id="broadcastHint" style="display:none;"></span>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost" id="broadcastAll"><span>Todos<span class="hide-sm"> los visibles</span></span></button>
        <button class="btn btn-ghost" id="broadcastClear">Limpiar</button>
        <button class="btn btn-primary" id="broadcastSendBtn" disabled>${icon('send', 14)} <span>Enviar<span class="hide-sm"> plantilla</span> a 0</span></button>
      </div>
    </div>
    <div id="regContent">
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

  $('#crmSearch').addEventListener('input', renderCrmGrid);
  $('#toggleSelectMode')?.addEventListener('click', () => {
    haptic(10);
    selectMode = !selectMode;
    if (!selectMode) selected.clear();
    updateSelectToggle();
    renderCrmGrid();
  });
  $('#exportCsv').addEventListener('click', () => exportarCrmCsv());
  $('#openCampana')?.addEventListener('click', () => openCampanaSheet());
  $('#crmMios').addEventListener('click', (e) => {
    haptic(10);
    crmSoloMios = !crmSoloMios;
    if (crmSoloMios) {
      crmSinAsignar = false;
      $('#crmSinAsignar').classList.remove('active');
      $('#crmSinAsignar').setAttribute('aria-pressed', 'false');
    }
    const btn = e.currentTarget;
    btn.classList.toggle('active', crmSoloMios);
    btn.setAttribute('aria-pressed', String(crmSoloMios));
    renderCrmGrid();
  });
  $('#crmSinAsignar').addEventListener('click', (e) => {
    haptic(10);
    crmSinAsignar = !crmSinAsignar;
    if (crmSinAsignar) {
      crmSoloMios = false;
      $('#crmMios').classList.remove('active');
      $('#crmMios').setAttribute('aria-pressed', 'false');
    }
    e.currentTarget.classList.toggle('active', crmSinAsignar);
    e.currentTarget.setAttribute('aria-pressed', String(crmSinAsignar));
    renderCrmGrid();
  });
  $('#broadcastAll').addEventListener('click', () => {
    haptic(12);
    // "Todos los visibles" = los que pasaron los filtros y la búsqueda actuales,
    // no toda la base: seleccionar sin querer a 300 personas para un envío
    // masivo es justo el error que hay que hacer difícil de cometer.
    $$('#regContent .crm-card[data-row]').forEach(c => selected.add(Number(c.dataset.row)));
    updateBroadcastBar();
    renderCrmGrid();
    toast(`${selected.size} seleccionados`);
  });
  $('#broadcastClear').addEventListener('click', () => {
    haptic(10);
    selected.clear();
    updateBroadcastBar();
    renderCrmGrid();
  });
  $('#broadcastSendBtn').addEventListener('click', () => {
    const nums = selectedTelefonos();
    if (!nums.length) { toast('Selecciona al menos un prospecto con WhatsApp'); return; }
    if (nums.length > 200) { toast('Máximo 200 destinatarios por envío'); return; }
    openBroadcastSheet(nums, null, main.querySelector('#broadcastSendBtn'));
  });

  function updateSelectToggle() {
    const btn = $('#toggleSelectMode');
    if (!btn) return;
    btn.classList.toggle('btn-primary', selectMode);
    btn.classList.toggle('btn-secondary', !selectMode);
    btn.innerHTML = selectMode ? `${icon('x', 14)} Cancelar selección` : `${icon('check', 14)} Seleccionar varios`;
    const bar = $('#broadcastBar');
    if (bar) bar.classList.toggle('hidden', !selectMode);
    updateBroadcastBar();
  }

  function selectedTelefonos() {
    return resumirSeleccionBroadcastCrm(crmRows, selected).numeros;
  }

  function updateBroadcastBar() {
    const { numeros: nums, sinWhatsapp, repetidos } = resumirSeleccionBroadcastCrm(crmRows, selected);
    const countEl = $('#broadcastCount');
    const btn = $('#broadcastSendBtn');
    if (countEl) countEl.textContent = `${selected.size} seleccionado${selected.size === 1 ? '' : 's'}`;
    const hintEl = $('#broadcastHint');
    if (hintEl) {
      const avisos = [];
      if (sinWhatsapp) avisos.push(`${sinWhatsapp} sin WhatsApp válido`);
      if (repetidos) avisos.push(`${repetidos} número${repetidos === 1 ? '' : 's'} repetido${repetidos === 1 ? '' : 's'}`);
      hintEl.textContent = avisos.join(' · ');
      hintEl.style.display = avisos.length ? '' : 'none';
    }
    if (btn) {
      btn.disabled = nums.length === 0;
      btn.innerHTML = `${icon('send', 14)} <span>Enviar<span class="hide-sm"> plantilla</span> a ${nums.length}</span>`;
    }
  }

  function toggleSelect(idx) {
    haptic(10);
    if (selected.has(idx)) selected.delete(idx);
    else selected.add(idx);
    updateBroadcastBar();
    const card = document.querySelector(`.crm-card[data-row="${idx}"]`);
    if (card) {
      const isOn = selected.has(idx);
      card.classList.toggle('crm-card-selected', isOn);
      const box = card.querySelector('.crm-check');
      if (box) { box.classList.toggle('checked', isOn); box.innerHTML = isOn ? icon('check', 14) : ''; }
    }
  }

  /* Campaña por pregrado: el admin pega la lista de la UTB (teléfono, nombre,
     pregrado), elige a quiénes corresponde y sigue a la hoja de plantillas. */
  function openCampanaSheet() {
    const opener = main.querySelector('#openCampana');
    const overlay = document.createElement('div');
    overlay.className = 'sheet-backdrop';
    overlay.style.alignItems = 'center';
    overlay.style.zIndex = '500';
    overlay.innerHTML = `
      <div class="action-sheet" role="dialog" aria-modal="true" aria-label="Campaña por pregrado" style="max-width:520px;">
        <div class="sheet-group" style="padding:16px;text-align:left;">
          <div class="sheet-title" style="text-align:left;margin-bottom:4px;">Campaña por pregrado</div>
          <div class="field-help" style="margin-bottom:10px;">Pega la lista con tres columnas: <strong>teléfono, nombre y pregrado</strong>, una persona por línea. Puedes copiarla directo de Excel. Los celulares de 10 dígitos se toman como de Colombia (+57).</div>
          <label class="field-label" for="cmpLista" style="display:block;font-size:12.5px;font-weight:600;margin-bottom:4px;">Lista</label>
          <textarea id="cmpLista" rows="7" placeholder="3001112233&#9;Laura Gómez&#9;Ingeniería Industrial" style="width:100%;font-family:inherit;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:10px;resize:vertical;"></textarea>
          <div style="font-size:12.5px;font-weight:600;margin:10px 0 6px;">¿A quiénes va?</div>
          <div id="cmpRelacionWrap"></div>
          <div id="cmpResumen" aria-live="polite" style="font-size:12.5px;color:var(--text-muted);margin:8px 0 12px;">Pega la lista para ver el resumen.</div>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn btn-secondary" id="cmpCancel" style="flex:1;">Cancelar</button>
            <button type="button" class="btn btn-primary" id="cmpNext" style="flex:1;" disabled>Elegir plantilla</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.classList.add('open'); overlay.querySelector('#cmpLista')?.focus({ preventScroll: true }); });
    let closed = false;
    const close = (devolverFoco = true) => {
      if (closed) return;
      closed = true;
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('keydown', onKey);
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 260);
      if (devolverFoco && opener?.isConnected) opener.focus({ preventScroll: true });
    };
    const onHash = () => close();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      const controls = Array.from(overlay.querySelectorAll('textarea, input, button')).filter(el => !el.disabled && el.getClientRects().length);
      if (!controls.length) return;
      if (e.shiftKey && (document.activeElement === controls[0] || !overlay.contains(document.activeElement))) { e.preventDefault(); controls.at(-1).focus(); }
      else if (!e.shiftKey && (document.activeElement === controls.at(-1) || !overlay.contains(document.activeElement))) { e.preventDefault(); controls[0].focus(); }
    };
    window.addEventListener('hashchange', onHash);
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#cmpCancel').addEventListener('click', () => close());

    const listaEl = overlay.querySelector('#cmpLista');
    const resumenEl = overlay.querySelector('#cmpResumen');
    const nextBtn = overlay.querySelector('#cmpNext');
    let lectura = parseListaCampana('');
    let relacion = RELACIONES_CAMPANA[0].id;
    const relacionWrap = overlay.querySelector('#cmpRelacionWrap');
    relacionWrap.appendChild(buildSegmented(
      RELACIONES_CAMPANA.map(r => ({ value: r.id, label: r.label })),
      relacion, (v) => { relacion = v; },
    ));
    hacerSegmentadoAccesible(relacionWrap.querySelector('.segmented'), 'A quiénes va la campaña');

    const pintarResumen = () => {
      lectura = parseListaCampana(listaEl.value);
      const { destinatarios, errores, duplicados, sinPregrado, excedeMaximo } = lectura;
      const partes = [`<strong>${destinatarios.length}</strong> persona${destinatarios.length === 1 ? '' : 's'} lista${destinatarios.length === 1 ? '' : 's'}`];
      if (duplicados) partes.push(`${duplicados} repetida${duplicados === 1 ? '' : 's'}`);
      if (sinPregrado) partes.push(`${sinPregrado} sin pregrado (el bot se lo preguntará)`);
      let html = partes.join(' · ');
      if (errores.length) {
        html += `<div style="color:var(--danger);margin-top:4px;">${errores.length} línea${errores.length === 1 ? '' : 's'} sin usar: ${errores.slice(0, 5).map(e => `${e.linea} (${escapeHtml(e.motivo)})`).join(', ')}${errores.length > 5 ? '…' : ''}</div>`;
      }
      if (excedeMaximo) html += `<div style="color:var(--danger);margin-top:4px;">Máximo ${MAX_DESTINATARIOS_CAMPANA} personas por envío; divide la lista.</div>`;
      resumenEl.innerHTML = listaEl.value.trim() ? html : 'Pega la lista para ver el resumen.';
      nextBtn.disabled = !destinatarios.length || excedeMaximo;
    };
    listaEl.addEventListener('input', pintarResumen);

    nextBtn.addEventListener('click', () => {
      if (nextBtn.disabled) return;
      const { destinatarios } = lectura;
      close(false);
      openBroadcastSheet(destinatarios.map(d => d.telefono), { destinatarios, relacion }, opener);
    });
  }

  /* `campana` = { destinatarios, relacion } para la campaña por pregrado; null para prospectos seleccionados. */
  async function openBroadcastSheet(telefonos, campana = null, opener = null) {
    const total = campana ? campana.destinatarios.length : telefonos.length;
    const relacionLabel = campana ? (RELACIONES_CAMPANA.find(r => r.id === campana.relacion)?.label ?? '') : '';
    const overlay = document.createElement('div');
    overlay.className = 'sheet-backdrop';
    overlay.style.alignItems = 'center';
    overlay.style.zIndex = '500';
    overlay.innerHTML = `
      <div class="action-sheet" role="dialog" aria-modal="true" aria-label="Enviar plantilla por WhatsApp" style="max-width:480px;">
        <div class="sheet-group" style="padding:16px;text-align:left;">
          <div class="sheet-title" style="text-align:left;margin-bottom:4px;">${campana ? 'Enviar campaña por WhatsApp' : 'Enviar plantilla por WhatsApp'}</div>
          ${campana ? `
          <div class="sheet-subtitle" style="text-align:left;margin-bottom:4px;">${total} persona${total !== 1 ? 's' : ''} · ${escapeHtml(relacionLabel)} · Solo templates aprobados por Meta</div>
          <div class="field-help" style="margin-bottom:12px;">La plantilla puede usar <strong>{{1}}</strong> = nombre y <strong>{{2}}</strong> = pregrado en el cuerpo, con los botones “Ver mis opciones” y “No me interesa”. Al que toca “Ver mis opciones” el bot le recomienda posgrados para su pregrado; a quien se dio de baja no se le envía.</div>` : `
          <div class="sheet-subtitle" style="text-align:left;margin-bottom:4px;">${total} destinatario${total !== 1 ? 's' : ''} · Solo templates aprobados por Meta (sin variables {{1}})</div>
          <div class="field-help" style="margin-bottom:12px;">Solo se permiten templates sin placeholders; los que usan variables se envían desde “Campaña por pregrado”. El servidor comprueba el template antes de crear el envío.</div>`}
          <div class="field-help" style="margin-bottom:12px;">El mismo template al mismo conjunto de destinatarios se acepta una sola vez por 24 horas. Un reintento muestra el trabajo original.</div>
          <div id="bcTemplates"><div class="skeleton skeleton-line" style="height:14px;margin:8px 0;"></div><div class="skeleton skeleton-line" style="height:14px;margin:8px 0;"></div><div class="skeleton skeleton-line" style="height:14px;margin:8px 0;"></div></div>
          <div id="bcSelectedInfo" style="font-size:12px;color:var(--text-muted);margin:8px 0 10px;"></div>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn btn-secondary" id="bcCancel" style="flex:1;">Cancelar</button>
            <button type="button" class="btn btn-primary" id="bcConfirm" style="flex:1;" disabled>📨 Enviar</button>
          </div>
          <div id="bcAlert" style="margin-top:10px;"></div>
          <div id="bcResult" style="margin-top:10px;"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.classList.add('open'); overlay.querySelector('#bcCancel')?.focus({ preventScroll: true }); });
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
      const controls = Array.from(overlay.querySelectorAll('button')).filter(el => !el.disabled && el.getClientRects().length);
      if (!controls.length) return;
      if (e.shiftKey && (document.activeElement === controls[0] || !overlay.contains(document.activeElement))) { e.preventDefault(); controls.at(-1).focus(); }
      else if (!e.shiftKey && (document.activeElement === controls.at(-1) || !overlay.contains(document.activeElement))) { e.preventDefault(); controls[0].focus(); }
    };
    window.addEventListener('hashchange', close);
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#bcCancel').addEventListener('click', close);

    let chosen = null;
    let templates = [];
    const listEl = overlay.querySelector('#bcTemplates');
    const infoEl = overlay.querySelector('#bcSelectedInfo');
    const confirmBtn = overlay.querySelector('#bcConfirm');
    const alertEl = overlay.querySelector('#bcAlert');
    const resultEl = overlay.querySelector('#bcResult');
    const lastJobKey = 'tooli.broadcast.lastJob';
    let trackedJobId = null;
    let buttonCloses = false;

    function renderJob(job) {
      const enviados = Array.isArray(job.enviados) ? job.enviados : [];
      const fallidos = Array.isArray(job.fallidos) ? job.fallidos : [];
      const total = job.solicitados ?? telefonos.length;
      const terminado = job.estado === 'completado';
      const procesados = enviados.length + fallidos.length + (job.duplicadosOmitidos ?? 0);
      resultEl.innerHTML = `
        <div class="alert ${terminado ? (fallidos.length === 0 ? 'alert-success' : enviados.length === 0 ? 'alert-error' : 'alert-info') : 'alert-info'}" style="margin:0 0 10px;">
          <div style="font-weight:700;margin-bottom:4px;">${terminado ? `${enviados.length}/${total} enviados correctamente` : `En proceso: ${procesados}/${total} revisados`}</div>
          <div style="font-size:12.5px;">Plantilla: <strong>${escapeHtml(job.templateName)}</strong> (${escapeHtml(job.language)})</div>
          ${terminado ? '' : '<div style="font-size:12px;margin-top:5px;">Puedes cerrar esta ventana; el envío continuará y podrás consultar el resultado al volver.</div>'}
        </div>
        ${fallidos.length ? `<div style="max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:10px;padding:8px;background:#fff;"><div style="font-size:12px;font-weight:600;margin-bottom:6px;">Fallidos o sin confirmar (${fallidos.length}):</div>${fallidos.map(f => `<div style="display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12.5px;"><span style="font-weight:600;">+${escapeHtml(f.numero)}</span><span style="color:var(--danger);flex:1;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(f.error)}</span></div>`).join('')}</div>` : ''}
        ${enviados.length ? `<div style="margin-top:8px;font-size:12px;color:var(--text-muted);">Enviados: ${enviados.map(n => '+' + escapeHtml(n.slice(-4))).join(', ')}</div>` : ''}
      `;
      if (terminado) {
        confirmBtn.textContent = 'Cerrar';
        confirmBtn.disabled = false;
        buttonCloses = true;
      } else {
        confirmBtn.textContent = 'En proceso…';
        confirmBtn.disabled = true;
      }
      return terminado;
    }

    async function pollJob(id) {
      if (!overlay.isConnected || trackedJobId !== id) return;
      try {
        const res = await api(`/api/tools/broadcast/jobs/${encodeURIComponent(id)}`);
        if (!overlay.isConnected || trackedJobId !== id || !res) return;
        if (res.status === 404) {
          try { localStorage.removeItem(lastJobKey); } catch { /* almacenamiento local opcional */ }
          trackedJobId = null;
          resultEl.innerHTML = '';
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { job } = await res.json();
        if (!overlay.isConnected || trackedJobId !== id) return;
        alertEl.innerHTML = '';
        if (renderJob(job)) return;
      } catch {
        if (!overlay.isConnected || trackedJobId !== id) return;
        alertEl.innerHTML = '<div class="alert alert-error" style="margin:0;">No se pudo actualizar el progreso. El envío sigue en la cola; se intentará consultar de nuevo.</div>';
      }
      setTimeout(() => pollJob(id), 2500);
    }

    function renderTemplates() {
      if (!overlay.isConnected) return;
      if (!templates.length) {
        listEl.innerHTML = `<div class="widget-empty" style="padding:14px 0;">No hay templates aprobados disponibles — crealos en el Business Manager de Meta y aparecerán aquí. Sin credenciales WABA en este entorno la lista viene vacía.</div>`;
        confirmBtn.disabled = true;
        return;
      }
      listEl.innerHTML = templates.map((t, i) => `
        <button type="button" class="quick-row bc-template-row" data-idx="${i}" style="border:1px solid ${chosen && chosen.name === t.name && chosen.language === t.language ? 'var(--utb-blue)' : 'var(--border)'};background:${chosen && chosen.name === t.name && chosen.language === t.language ? 'rgba(0,48,135,0.06)' : 'transparent'};">
          <span class="quick-icon" style="background:${chosen && chosen.name === t.name && chosen.language === t.language ? 'var(--utb-blue)' : 'rgba(0,48,135,0.08)'};color:${chosen && chosen.name === t.name && chosen.language === t.language ? 'white' : 'var(--utb-blue)'};">${chosen && chosen.name === t.name && chosen.language === t.language ? '✓' : '📄'}</span>
          <span class="quick-body"><div class="quick-title">${escapeHtml(t.name)}</div><div class="quick-sub">${escapeHtml(t.language)} · ${escapeHtml(t.category)}${t.components && t.components.length ? ` · ${t.components.length} componentes` : ''}</div></span>
          <span class="quick-chevron">${icon('chevronRight', 14)}</span>
        </button>
      `).join('');
      if (chosen) infoEl.textContent = `Seleccionado: ${chosen.name} (${chosen.language})`;
      else infoEl.textContent = 'Toca un template para seleccionarlo';
      confirmBtn.disabled = !chosen;
      confirmBtn.textContent = chosen ? `📨 Enviar "${chosen.name}" a ${total}` : '📨 Enviar';
      listEl.querySelectorAll('.bc-template-row').forEach(btn => btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        chosen = templates[idx];
        trackedJobId = null;
        buttonCloses = false;
        resultEl.innerHTML = '';
        alertEl.innerHTML = '';
        haptic(10);
        renderTemplates();
      }));
    }

    try {
      const r = await api('/api/tools/broadcast/templates');
      if (!overlay.isConnected || !r) return;
      if (!r.ok) throw new Error('No se pudieron cargar los templates');
      const data = await r.json();
      if (!overlay.isConnected) return;
      templates = data.templates ?? [];
      renderTemplates();
    } catch (err) {
      if (overlay.isConnected) listEl.innerHTML = `<div class="alert alert-error" style="margin:0;">No se pudieron cargar los templates: ${escapeHtml(err.message || String(err))}</div>`;
    }
    try {
      const lastJob = localStorage.getItem(lastJobKey);
      if (lastJob) { trackedJobId = lastJob; void pollJob(lastJob); }
    } catch { /* almacenamiento local opcional */ }

    confirmBtn.addEventListener('click', async () => {
      if (buttonCloses) { close(); return; }
      if (!chosen) return;
      confirmBtn.disabled = true; confirmBtn.textContent = 'Programando…';
      alertEl.innerHTML = '';
      resultEl.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;"><span class="spinner"></span> Creando trabajo de envío…</div>`;
      try {
        const res = await api('/api/tools/broadcast/send', {
          method: 'POST',
          body: JSON.stringify(campana
            ? { templateName: chosen.name, language: chosen.language, destinatarios: campana.destinatarios, relacion: campana.relacion }
            : { templateName: chosen.name, language: chosen.language, telefonos }),
        });
        if (!overlay.isConnected || !res) return;
        const body = await res.json().catch(() => ({}));
        if (!overlay.isConnected) return;
        if (!res.ok) {
          const msg = body.message || body.error || `HTTP ${res.status}`;
          alertEl.innerHTML = `<div class="alert alert-error" style="margin:0;">${escapeHtml(msg)}${res.status === 403 ? ' — Solo administradores pueden enviar broadcasts.' : ''}</div>`;
          resultEl.innerHTML = '';
          confirmBtn.disabled = false; confirmBtn.textContent = `📨 Enviar "${chosen.name}" a ${total}`;
          haptic([20,30,20]);
          return;
        }
        const job = body.job;
        if (!job?.id) throw new Error('El servidor no devolvió el trabajo de envío');
        trackedJobId = job.id;
        try { localStorage.setItem(lastJobKey, job.id); } catch { /* almacenamiento local opcional */ }
        haptic([10,20,10]);
        toast(job.estado === 'completado' ? 'Revisa el resultado del envío' : 'Envío programado; puedes cerrar esta ventana');
        if (!renderJob(job)) void pollJob(job.id);
      } catch (err) {
        if (!overlay.isConnected) return;
        alertEl.innerHTML = `<div class="alert alert-error" style="margin:0;">No se pudo confirmar el trabajo: ${escapeHtml(err.message || String(err))}. Si reintentas la misma selección, el servidor devolverá el trabajo existente durante 24 horas.</div>`;
        resultEl.innerHTML = '';
        confirmBtn.disabled = false; confirmBtn.textContent = `📨 Enviar "${chosen.name}" a ${total}`;
        haptic([20,30,20]);
      }
    });
  }

  setPullToRefresh(() => loadReg());
  const regContent = main.querySelector('#regContent');
  const avisoSeguimiento = main.querySelector('#crmAvisoSeguimiento');
  const motivoSeguimiento = 'No está disponible porque no se pudo cargar el seguimiento.';
  let seguimientoDisponible = false;
  let loadSeq = 0;

  function pintarFiltroEtapas() {
    const wrap = $('#crmEtapaWrap');
    const etiqueta = $('#crmEtapaFila')?.querySelector('.crm-etapa-label');
    const botonMios = $('#crmMios');
    const botonSinAsignar = $('#crmSinAsignar');
    [botonMios, botonSinAsignar].forEach((boton) => {
      if (!boton) return;
      boton.disabled = !seguimientoDisponible;
      if (seguimientoDisponible) boton.removeAttribute('title');
      else boton.title = motivoSeguimiento;
    });
    if (!seguimientoDisponible) {
      crmEtapa = 'todas';
      crmSoloMios = false;
      crmSinAsignar = false;
      botonMios?.classList.remove('active');
      botonSinAsignar?.classList.remove('active');
      botonMios?.setAttribute('aria-pressed', 'false');
      botonSinAsignar?.setAttribute('aria-pressed', 'false');
      if (wrap) {
        wrap.style.display = '';
        wrap.innerHTML = `<div class="segmented"><button type="button" disabled title="${escapeHtml(motivoSeguimiento)}">Todas</button></div>`;
      }
      if (etiqueta) { etiqueta.style.display = ''; etiqueta.title = motivoSeguimiento; }
      return;
    }

    if (etiqueta) etiqueta.removeAttribute('title');
    // Segundo filtro: etapa del embudo. Solo aparece si alguien ya movió
    // fichas; si no, sería un control que no filtra nada.
    const etapaCounts = crmRows.reduce((acc, row) => {
      const est = crmFichas[row[3]]?.estado ?? 'nuevo';
      acc[est] = (acc[est] ?? 0) + 1;
      return acc;
    }, {});
    const hayEtapas = Object.keys(etapaCounts).some(k => k !== 'nuevo');
    if (wrap) wrap.style.display = hayEtapas ? '' : 'none';
    if (etiqueta) etiqueta.style.display = hayEtapas ? '' : 'none';
    if (!hayEtapas || !wrap) return;
    wrap.innerHTML = '';
    wrap.appendChild(buildSegmented(
      [
        { value: 'todas', label: 'Todas' },
        ...CRM_ESTADOS.filter(e => etapaCounts[e.value]).map(e => ({ value: e.value, label: `${e.icon} ${e.label} (${etapaCounts[e.value]})` })),
      ],
      etapaCounts[crmEtapa] ? crmEtapa : 'todas',
      (v) => { crmEtapa = v; renderCrmGrid(); },
    ));
    hacerSegmentadoAccesible($('#crmEtapaWrap .segmented'), 'Filtrar prospectos por etapa del embudo');
  }

  function mostrarAvisoSeguimiento() {
    if (!avisoSeguimiento) return;
    avisoSeguimiento.innerHTML = seguimientoDisponible ? '' : htmlAvisoParcial('No se pudo cargar el seguimiento (etapa, responsable y notas). Lo que ves no incluye esos datos.');
    if (!seguimientoDisponible) conectarReintento(avisoSeguimiento, cargarSoloSeguimiento);
  }

  async function cargarSoloSeguimiento() {
    if (!avisoSeguimiento?.isConnected) return;
    marcarCargando(avisoSeguimiento, true);
    try {
      const respuesta = await api('/api/tools/crm/fichas');
      if (!respuesta?.ok) throw new Error('seguimiento_no_disponible');
      const datos = await respuesta.json();
      if (!avisoSeguimiento.isConnected) return;
      crmFichas = datos.fichas ?? {};
      seguimientoDisponible = true;
      mostrarAvisoSeguimiento();
      pintarFiltroEtapas();
      renderCrmGrid();
    } catch {
      seguimientoDisponible = false;
      mostrarAvisoSeguimiento();
      pintarFiltroEtapas();
    } finally {
      marcarCargando(avisoSeguimiento, false);
    }
  }

  async function loadReg() {
    if (!regContent?.isConnected) return;
    const seq = ++loadSeq;
    marcarCargando(regContent, true);
    main.querySelector('#refreshReg')?.querySelector('.refresh-icon')?.classList.add('spin-once');
    try {
      // Las fichas se traen en una sola llamada junto con los registros: una
      // por tarjeta sería un N+1 contra el backend al pintar la grilla.
      const [r, fichasRes] = await Promise.all([
        api('/api/tools/registros-posgrado'),
        api('/api/tools/crm/fichas').then(async (respuesta) => respuesta?.ok ? respuesta.json() : null).catch(() => null),
      ]);
      if (!regContent.isConnected || seq !== loadSeq || !r) return;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { rows } = await r.json();
      if (!regContent.isConnected || seq !== loadSeq) return;
      // La selección usa índices de la respuesta actual. Una actualización
      // puede reordenar el Sheet; conservar esos índices enviaría la plantilla
      // a prospectos distintos de los que eligió el asesor.
      if (selected.size) {
        selected.clear();
        updateBroadcastBar();
        toast('La lista cambió; vuelve a seleccionar los destinatarios');
      }
      seguimientoDisponible = Boolean(fichasRes);
      crmFichas = fichasRes?.fichas ?? {};
      crmRows = rows ?? [];
      mostrarAvisoSeguimiento();
      pintarFiltroEtapas();
      const resumenCarga = resumirSegmentos(crmRows);
      const pintarResumen = (visibles) => {
        const el = $('#crmSegResumen');
        if (el) el.textContent = textoResumenSegmentos(resumenCarga, visibles);
      };
      if (!crmRows.length) {
        regContent.innerHTML = `<div class="card"><p style="color:var(--text-muted);text-align:center;padding:24px 0;">No hay registros de Pregrado ni Posgrado aún. Cuando un prospecto complete el formulario del bot, aparecerá aquí.</p></div>`;
        $('#crmFilterWrap').innerHTML = '';
        pintarResumen(0);
        marcarCargando(regContent, false);
        return;
      }
      const counts = crmRows.reduce((acc, row) => { const c = crmCategoria(row); acc[c] = (acc[c] ?? 0) + 1; return acc; }, {});
      $('#crmFilterWrap').innerHTML = '';
      $('#crmFilterWrap').appendChild(buildSegmented(
        [
          { value: 'todos', label: `Todos (${crmRows.length})` },
          ...Object.keys(PROGRAMA_LABELS).filter(k => counts[k]).map(k => ({ value: k, label: `${PROGRAMA_LABELS[k]} (${counts[k]})` })),
        ],
        crmFilter, (v) => { crmFilter = v; renderCrmGrid(); },
      ));
      hacerSegmentadoAccesible($('#crmFilterWrap .segmented'), 'Filtrar prospectos por segmento Pregrado o Posgrado');
      pintarResumen(crmRows.length);

      renderCrmGrid();
      marcarCargando(regContent, false);
    } catch (err) {
      console.error(err);
      if (regContent.isConnected && seq === loadSeq) {
        avisoSeguimiento.innerHTML = '';
        regContent.innerHTML = htmlError('No se pudieron cargar los registros. Intenta de nuevo; si sigue fallando, avisa a un administrador.');
        conectarReintento(regContent, loadReg);
        marcarCargando(regContent, false);
      }
    }
  }

  function renderCrmGrid() {
    const q = ($('#crmSearch')?.value ?? '').trim().toLowerCase();
    const pares = filtrarCrmRows(crmRows, {
        segmento: crmFilter, etapa: crmEtapa, soloMios: crmSoloMios, sinAsignar: crmSinAsignar,
      usuario: sesion.user?.username, q, fichas: crmFichas,
    });
    const resumen = resumirSegmentos(crmRows);
    const resumenEl = $('#crmSegResumen');
    if (resumenEl) resumenEl.textContent = textoResumenSegmentos(resumen, pares.length);
    const filtered = pares;
    if (!filtered.length) {
      // Un "sin resultados" mudo obliga a adivinar cuál de los tres filtros
      // activos lo dejó vacío: se dice cuál y se ofrece quitarlo.
      const motivos = [];
      if (crmSoloMios) motivos.push('asignados a ti');
      if (crmSinAsignar) motivos.push('sin asesor asignado');
      if (crmEtapa !== 'todas') motivos.push(`en etapa "${crmEstadoMeta(crmEtapa).label}"`);
      if (crmFilter !== 'todos') motivos.push(`de ${PROGRAMA_LABELS[crmFilter] ?? crmFilter}`);
      if (q) motivos.push(`que coincidan con "${q}"`);
      $('#regContent').innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">${icon('search', 42)}</div>
          <div class="empty-state-title">Ningún prospecto coincide</div>
          <div class="empty-state-sub">No hay prospectos ${motivos.join(', ')}.</div>
          <button type="button" class="btn btn-secondary" id="crmLimpiarFiltros" style="margin-top:12px;">Quitar los filtros</button>
        </div>`;
      $('#crmLimpiarFiltros')?.addEventListener('click', () => {
        crmSoloMios = false;
        crmSinAsignar = false;
        crmEtapa = 'todas';
        crmFilter = 'todos';
        if ($('#crmSearch')) $('#crmSearch').value = '';
        $('#crmMios')?.classList.remove('active');
        $('#crmMios')?.setAttribute('aria-pressed', 'false');
        $('#crmSinAsignar')?.classList.remove('active');
        $('#crmSinAsignar')?.setAttribute('aria-pressed', 'false');
        haptic(10);
        loadReg();
      });
      return;
    }
    $('#regContent').innerHTML = `
      <div class="crm-grid stagger-in">
        ${filtered.map(({ row, idx }) => {
          const cat = crmCategoria(row);
          const nombre = row[1] || 'Sin nombre';
          const hasPhone = Boolean(telefonoBroadcastCrm(row));
          const isSelected = selected.has(idx);
          return `
          <div class="crm-card ${selectMode ? 'select-mode' : ''} ${isSelected ? 'crm-card-selected' : ''}" data-longpress data-row="${idx}" ${selectMode ? '' : `tabindex="0" role="button" aria-label="Ver perfil de ${escapeHtml(nombre)}"`} style="position:relative;">
            ${selectMode ? `<button type="button" class="crm-check ${isSelected ? 'checked' : ''}" data-check="${idx}" aria-label="Seleccionar">${isSelected ? icon('check', 12) : ''}</button>` : ''}
            ${selectMode && !hasPhone ? `<span class="badge" style="position:absolute;top:10px;right:10px;background:#fee2e2;color:#dc2626;font-size:10px;">Sin WhatsApp</span>` : ''}
            <div class="advisor-card-top" style="${selectMode ? 'margin-top:6px;' : ''}">
              <div class="avatar" style="background:${avatarTone(nombre)};width:44px;height:44px;font-size:14px;">${initialsFor(row[3] || nombre, nombre)}</div>
              <span class="badge" style="background:${areaOf(row) === 'Pregrado' ? '#0284c722' : '#7c3aed22'};color:${areaOf(row) === 'Pregrado' ? '#0284c7' : '#7c3aed'};">${areaOf(row)}</span>
            </div>
            <div class="crm-card-name">${escapeHtml(nombre)}</div>
            ${(() => {
              const f = crmFichas[row[3]];
              if (!f) return '';
              const em = crmEstadoMeta(f.estado);
              return `<div class="crm-card-ficha">
                <span class="badge" style="background:${em.color}1f;color:${em.color};">${em.icon} ${em.label}</span>
                ${f.asignadoA ? `<span class="crm-card-asignado" title="Asesor responsable">${icon('user', 11)}${escapeHtml(f.asignadoA)}</span>` : ''}
                ${f.notas?.length ? `<span class="crm-card-notas" title="${f.notas.length} nota(s) del equipo">${icon('note', 11)}${f.notas.length}</span>` : ''}
              </div>`;
            })()}
            ${row[4] ? `<span class="badge" style="background:${PROGRAMA_COLORS[cat]}22;color:${PROGRAMA_COLORS[cat]};margin-bottom:8px;">${escapeHtml(row[4])}</span>` : ''}
            <div class="crm-card-row">✉️ ${escapeHtml(row[2] || '—')}</div>
            <div class="crm-card-row">📱 ${escapeHtml(formatTelefono(row[3]) || '—')}</div>
            <div class="crm-card-date">${escapeHtml(friendlyDate(row[0]))}</div>
          </div>
        `; }).join('')}
      </div>
    `;
    $$('.crm-card[data-longpress]').forEach(card => {
      const idx = Number(card.dataset.row);
      const row = crmRows[idx];
      if (selectMode) {
        card.addEventListener('click', (e) => {
          // Si toca el checkbox o cualquier parte de la tarjeta, togglear selección
          if (e.target.closest('.crm-check')) return;
          toggleSelect(idx);
        });
        const checkBtn = card.querySelector('.crm-check');
        if (checkBtn) checkBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleSelect(idx); });
        // En modo selección no abrir contextSheet/long-press para no confundir
        return;
      }
      card.addEventListener('click', () => openStudentProfile(row));
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStudentProfile(row); } });
      contextSheet(card, {
        title: row[1] || 'Prospecto',
        subtitle: row[2] || undefined,
        actions: [
          { label: 'Ver perfil', icon: '👤', onClick: () => openStudentProfile(row) },
          ...(row[3] ? [{ label: 'Vista previa en teléfono', icon: '📲', onClick: () => previewPhoneFor(row[3]) }] : []),
          { label: 'Copiar email', icon: '📧', onClick: () => copyToClipboard(row[2] ?? '', 'Email copiado') },
          { label: 'Copiar WhatsApp', icon: '📱', onClick: () => copyToClipboard(row[3] ?? '', 'Número copiado') },
          ...(row[3] ? [{ label: 'Ver conversación', icon: '💬', onClick: () => abrirConversacion(row[3]) }] : []),
          { label: 'Ver en Chatwoot', icon: '↗️', onClick: () => window.open(`${sesion.urls.chatwoot}/app/accounts/1/label/${areaOf(row) === 'Pregrado' ? 'pregrado-prospecto' : 'posgrado-prospecto'}`, '_blank', 'noopener') },
        ],
      });
    });
  }

  /* Perfil del estudiante: combina lo que ya sabemos del registro (CRM) con
     lo que el bot tiene guardado de su conversación (categoría de flujo,
     último mensaje) — todo dato real, nada inventado tipo Savia. */
  async function openStudentProfile(row) {
    const [fecha, nombre, email, phone, programa] = row;
    const area = areaOf(row);
    const cat = crmCategoria(row);
    let flowInfo = null;
    if (phone) {
      try {
        const r = await api(`/api/tools/bot-users/${phone}`);
        const info = await r.json();
        flowInfo = { step: flowCategory(info.session?.step), last: info.recentMessages?.[0] ?? null, banned: info.banned };
      } catch { /* sin datos de conversación disponibles */ }
    }
    if (!regContent.isConnected) return;
    let ficha = null;
    let fichaDisponible = false;
    if (phone) {
      try {
        const respuesta = await api(`/api/tools/crm/${phone}`);
        if (!respuesta?.ok) throw new Error('ficha_no_disponible');
        ficha = (await respuesta.json()).ficha;
        fichaDisponible = true;
      }
      catch { /* la ficha es opcional: si falla, el perfil se abre igual */ }
    }
    if (!regContent.isConnected) return;
    openProfileSheet({
      avatarBg: avatarTone(nombre || phone), avatarText: initialsFor(phone || nombre, nombre),
      title: nombre || 'Prospecto', subtitle: email || (phone ? formatTelefono(phone) : undefined),
      badges: [
        { label: area, color: area === 'Pregrado' ? '#0284c7' : '#7c3aed' },
        ...(programa ? [{ label: programa, color: PROGRAMA_COLORS[cat] }] : []),
        // La categoría del flujo solo suma si no repite el área ("Posgrado" dos veces).
        ...(flowInfo?.step && flowInfo.step.label !== area ? [{ label: flowInfo.step.label, color: flowInfo.step.color }] : []),
        ...(flowInfo?.banned ? [{ label: 'Baneado', color: '#dc2626' }] : []),
      ],
      rows: [
        ...(email ? [{ icon: '📧', label: 'Email', value: email }] : []),
        ...(phone ? [{ icon: '📱', label: 'WhatsApp', value: formatTelefono(phone) }] : []),
        ...(programa ? [{ icon: '🎓', label: area === 'Pregrado' ? 'Carrera de interés' : 'Programa de interés', value: programa }] : []),
        { icon: '🗓️', label: 'Registrado', value: friendlyDate(fecha) },
        ...(flowInfo?.last ? [{ icon: '💬', label: 'Último mensaje', value: flowInfo.last.text }] : []),
      ],
      extraHtml: phone && fichaDisponible ? fichaHtml(ficha) : '',
      onMount: phone && fichaDisponible ? (sheet) => wireFicha(sheet, phone, ficha, () => loadReg()) : undefined,
      actions: [
        ...(phone ? [{ label: 'Vista previa en teléfono', icon: '📲', onClick: () => previewPhoneFor(phone), closeAfter: false }] : []),
        ...(phone ? [{ label: 'Ver conversación', icon: '💬', onClick: () => abrirConversacion(phone) }] : []),
        { label: 'Ver en Chatwoot', icon: '↗️', onClick: () => window.open(`${sesion.urls.chatwoot}/app/accounts/1/label/${area === 'Pregrado' ? 'pregrado-prospecto' : 'posgrado-prospecto'}`, '_blank', 'noopener') },
      ],
    });
  }

  $('#refreshReg').addEventListener('click', loadReg);
  loadReg();
}

export { renderRegistros, CRM_CSV_CABECERA, crmPasaFiltros, filtrarCrmRows, telefonoBroadcastCrm, resumirSeleccionBroadcastCrm, resumirSegmentos, textoResumenSegmentos, filasCrmParaCsv };
