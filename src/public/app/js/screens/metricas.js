import { api } from '../core/api.js';
import { $, emoji, escapeHtml, loadScript } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { setPullToRefresh } from '../core/screen.js';
import { sesion } from '../core/session.js';
import { buildSegmented } from '../ui/controls.js';
import { conectarReintento, htmlError, marcarCargando } from '../ui/estado.js';

/* ============= MÉTRICAS ============= */
const SERIES_AZUL = ['#003087', '#2f6fd6', '#8fb3ec', '#64748b'];
const EVENT_META = {
  menu_shown:               { label: 'Menú mostrado',        icon: '📲', color: '#2f6fd6' },
  ai_request:                { label: 'Preguntas a la IA',    icon: '🤖', color: '#2f6fd6' },
  ai_resolved:               { label: 'Respuestas de la IA',  icon: '🤖', color: '#2f6fd6' },
  ai_failed:                 { label: 'La IA falló',          icon: '⚠️', color: '#c5221f' },
  ai_used_tool:              { label: 'La IA consultó un programa', icon: '🔎', color: '#2f6fd6' },
  conv_inicio:               { label: 'Conversaciones nuevas', icon: '💬', color: '#2f6fd6' },
  reco_inicio:               { label: 'Pidió ayuda para elegir', icon: '🧭', color: '#2f6fd6' },
  reco_relacion_egresado_utb:   { label: 'Egresado UTB',      icon: '🎓', color: '#2f6fd6' },
  reco_relacion_estudiante_utb: { label: 'Estudiante UTB',    icon: '📚', color: '#2f6fd6' },
  reco_relacion_externo:     { label: 'De otra universidad',  icon: '🏫', color: '#2f6fd6' },
  reco_pregrado_utb:         { label: 'Carrera UTB reconocida', icon: '✅', color: '#2f6fd6' },
  reco_externo_coincide:     { label: 'Carrera externa reconocida', icon: '✅', color: '#2f6fd6' },
  reco_externo_sin_coincidencia: { label: 'Carrera no reconocida', icon: '❓', color: '#b45309' },
  reco_resultados:           { label: 'Vio recomendaciones',  icon: '🎯', color: '#2f6fd6' },
  reco_mas_opciones:         { label: 'Pidió más opciones',   icon: '➕', color: '#2f6fd6' },
  reco_ficha:                { label: 'Abrió la ficha de un programa', icon: '📄', color: '#2f6fd6' },
  reco_ia:                   { label: 'Preguntó desde las recomendaciones', icon: '🤖', color: '#2f6fd6' },
  reco_asesor:               { label: 'Pidió asesor',         icon: '🙋', color: '#2f6fd6' },
  reco_consentimiento_no:    { label: 'No autorizó al asesor', icon: '🔒', color: '#64748b' },
  reco_lead_completado:      { label: 'Dejó nombre y correo para el asesor', icon: '📇', color: '#2f6fd6' },
  info_acepta:               { label: 'Aceptó recibir información', icon: '📬', color: '#2f6fd6' },
  info_rechaza:              { label: 'No quiso recibir información', icon: '📭', color: '#64748b' },
  info_baja:                 { label: 'Escribió BAJA',        icon: '🚫', color: '#64748b' },
  incidencia:                { label: 'Errores para revisar', icon: '⚠️', color: '#c5221f' },
  rate_limited:              { label: 'Mensajes muy seguidos (frenados)', icon: '⏱️', color: '#64748b' },
  ai_disabled_escalation:    { label: 'Escaladas (IA apagada)', icon: '🙋', color: '#b45309' },
  turno_consultado:          { label: 'Turnos consultados',   icon: '📋', color: '#2f6fd6' },
  recibo_descargado:         { label: 'Recibos descargados',  icon: '🧾', color: '#2f6fd6' },
  prospecto_iniciado:        { label: 'Prospectos iniciados', icon: '🎓', color: '#2f6fd6' },
  prospecto_completado:      { label: 'Prospectos completados', icon: '🎓', color: '#2f6fd6' },
  registro_iniciado:         { label: 'Registros BD iniciados', icon: '📝', color: '#2f6fd6' },
  registro_completado:       { label: 'Registros BD completados', icon: '📝', color: '#2f6fd6' },
  agent_handoff:             { label: 'Casos escalados a asesor', icon: '🙋', color: '#2f6fd6' },
  programas_especializaciones: { label: 'Especializaciones consultadas', icon: '🎓', color: '#2f6fd6' },
  programas_maestrias:      { label: 'Maestrías consultadas', icon: '🎓', color: '#2f6fd6' },
  programas_doctorados:     { label: 'Doctorados consultados', icon: '🎓', color: '#2f6fd6' },
  menu_pregrado_shown:       { label: 'Menú de pregrado',      icon: '🏫', color: '#2f6fd6' },
  pregrado_explorar_iniciado: { label: 'Exploró carreras', icon: '🧭', color: '#2f6fd6' },
  pregrado_explorar_area:     { label: 'Eligió área de pregrado', icon: '🎓', color: '#2f6fd6' },
  pregrado_explorar_carrera:  { label: 'Eligió carrera de pregrado', icon: '📚', color: '#2f6fd6' },
  admisiones_guia_pregrado:   { label: 'Guía admisión Pregrado', icon: '📝', color: '#2f6fd6' },
  admisiones_guia_posgrado:   { label: 'Guía admisión Posgrado', icon: '📝', color: '#2f6fd6' },
  prospecto_pregrado_iniciado:   { label: 'Prospectos pregrado iniciados',   icon: '🏫', color: '#2f6fd6' },
  prospecto_pregrado_completado: { label: 'Prospectos pregrado completados', icon: '🏫', color: '#2f6fd6' },
  registro_pregrado_iniciado:    { label: 'Registros pregrado iniciados',    icon: '📝', color: '#2f6fd6' },
  registro_pregrado_completado:  { label: 'Registros pregrado completados',  icon: '📝', color: '#2f6fd6' },
  // Hub "Mi vida académica": qué plataforma busca realmente la gente
  academico_menu_shown:      { label: 'Abrió Mi vida académica', icon: '🎒', color: '#2f6fd6' },
  academico_notas:           { label: 'Buscó sus notas',        icon: '📊', color: '#2f6fd6' },
  academico_horario:         { label: 'Buscó su horario',       icon: '🗓️', color: '#2f6fd6' },
  academico_savio:           { label: 'Fue a Savio (cursos)',   icon: '📚', color: '#2f6fd6' },
  savio_cursos_consultados:   { label: 'Consultó cursos Savio', icon: '📚', color: '#2f6fd6' },
  savio_cuenta_no_encontrada: { label: 'Cuenta Savio sin coincidencia', icon: '🔐', color: '#b45309' },
  savio_error:                { label: 'Consulta Savio fallida', icon: '⚠️', color: '#c5221f' },
  academico_calendario:      { label: 'Calendario académico',   icon: '📅', color: '#2f6fd6' },
  academico_recibo:          { label: 'Recibos (Iceberg)',      icon: '🧾', color: '#2f6fd6' },
  academico_correo:          { label: 'Correo institucional',   icon: '✉️', color: '#2f6fd6' },
  academico_becas:           { label: 'Becas y apoyo financiero', icon: '🎁', color: '#2f6fd6' },
  academico_derechos:        { label: 'Costos y derechos',      icon: '💳', color: '#2f6fd6' },
  // Flujo conversacional de posgrados
  datos_acepta:              { label: 'Autorizó sus datos',     icon: '🔒', color: '#2f6fd6' },
  datos_rechaza:             { label: 'No autorizó sus datos',  icon: '🔒', color: '#64748b' },
  conv_sugerencia:           { label: 'Tocó una pregunta sugerida', icon: '💬', color: '#2f6fd6' },
  ai_reutilizada:            { label: 'Respuestas reutilizadas (sin gastar IA)', icon: '🔁', color: '#0f9d58' },
  ia_corregida:              { label: 'Programa o enlace de la IA corregido', icon: '🛠️', color: '#b45309' },
  conv_regreso:              { label: 'Volvió y retomó',        icon: '👋', color: '#2f6fd6' },
  conv_seguimiento:          { label: 'Seguimientos enviados',  icon: '⏰', color: '#2f6fd6' },
  conv_asesor_sugerido:      { label: 'La IA ofreció asesor',   icon: '🙋', color: '#2f6fd6' },
  reco_util_si:              { label: 'Le sirvió la recomendación', icon: '👍', color: '#2f6fd6' },
  reco_util_no:              { label: 'No le sirvió la recomendación', icon: '👎', color: '#b45309' },
  no_reconocido:             { label: 'No entendió una respuesta', icon: '❓', color: '#b45309' },
  audio_transcrito:          { label: 'Audios entendidos',      icon: '🎤', color: '#2f6fd6' },
  audio_fallido:             { label: 'Audios sin entender',    icon: '🎤', color: '#c5221f' },
};
const PASO_NO_RECONOCIDO = {
  carrera: 'Carrera', relacion: 'Relación con la UTB', pregrado_grupo: 'Escuela del pregrado', pregrado: 'Pregrado',
  nivel: 'Nivel', resultados: 'Recomendaciones', ficha_elegir: 'Elegir programa', ficha: 'Ficha del programa',
  ia_sin_dato: 'La IA no tenía el dato', confusion: 'No entendió al bot', queja: 'Queja', imagen: 'Imagen', adjunto: 'Adjunto',
};
const TIPO_INCIDENCIA = {
  ia: 'La IA no respondió', audio: 'Audio sin transcribir', asesor: 'No se conectó con el asesor', crm: 'No se guardó en el CRM',
  flyer: 'Flyer sin enviar', mensaje: 'Mensaje sin procesar', seguimiento: 'Seguimiento sin enviar', datos: 'Perfil o autorización sin guardar',
};

/* Solo los eventos del flujo conversacional de posgrados: los del menú anterior
   (turnos, notas, recibos, Mi vida académica…) ya no aparecen aquí. */
const EVENTOS_FLUJO = [
  'conv_inicio', 'datos_acepta', 'datos_rechaza', 'ai_request', 'ai_resolved', 'ai_failed', 'ai_used_tool', 'ai_reutilizada', 'ia_corregida', 'conv_sugerencia',
  'audio_transcrito', 'audio_fallido', 'reco_inicio', 'reco_relacion_egresado_utb', 'reco_relacion_estudiante_utb',
  'reco_relacion_externo', 'reco_pregrado_utb', 'reco_externo_coincide', 'reco_externo_sin_coincidencia', 'reco_resultados',
  'reco_mas_opciones', 'reco_ficha', 'reco_ia', 'reco_util_si', 'reco_util_no', 'conv_asesor_sugerido', 'reco_asesor',
  'reco_consentimiento_no', 'reco_lead_completado', 'agent_handoff', 'info_acepta', 'info_rechaza', 'info_baja',
  'conv_seguimiento', 'conv_regreso', 'no_reconocido', 'incidencia', 'rate_limited',
];

/** Conteo de un evento por su detalle ("no_reconocido:paso:carrera") en todos los días del rango. */
function contarPorDetalle(days, evento, clave) {
  const prefijo = `${evento}:${clave}:`;
  const out = {};
  for (const day of Object.values(days ?? {})) {
    for (const [k, v] of Object.entries(day ?? {})) {
      if (k.startsWith(prefijo)) out[k.slice(prefijo.length)] = (out[k.slice(prefijo.length)] ?? 0) + (parseInt(v) || 0);
    }
  }
  return Object.entries(out).sort((a, b) => b[1] - a[1]);
}

/** Totales del rango, solo de los eventos del flujo nuevo. */
function totalesDelFlujo(days) {
  const totals = {};
  for (const day of Object.values(days ?? {})) {
    for (const [k, v] of Object.entries(day ?? {})) {
      if (k.includes(':') || !EVENTOS_FLUJO.includes(k)) continue;
      totals[k] = (totals[k] ?? 0) + (parseInt(v) || 0);
    }
  }
  return totals;
}

/** Cada respuesta reutilizada ahorra una llamada a la IA (unos 4.000 tokens con el catálogo). */
const TOKENS_POR_LLAMADA = 4000;
function textoReutilizadas(reutilizadas, preguntas) {
  if (!reutilizadas) return 'Lo que más le preguntan a la IA en los últimos 30 días. Las respuestas a las preguntas que abren una conversación se guardan y se reutilizan.';
  const pct = preguntas > 0 ? ` (${Math.round(reutilizadas / preguntas * 100)}% de las preguntas)` : '';
  return `En este rango ${reutilizadas} respuestas salieron guardadas, sin llamar a la IA${pct}: unos ${(reutilizadas * TOKENS_POR_LLAMADA).toLocaleString('es-CO')} tokens ahorrados.`;
}

const fechaCorta = (iso) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
const chips = (pares, nombres) => pares.map(([k, v]) => `<span style="display:inline-block;border:1px solid var(--border, #e2e8f0);border-radius:12px;padding:2px 10px;margin:0 6px 6px 0;font-size:13px;">${escapeHtml(nombres[k] ?? k)} · <b>${escapeHtml(v)}</b></span>`).join('');
function eventMeta(key) {
  return EVENT_META[key] ?? { label: key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()), icon: '📊', color: '#2f6fd6' };
}

let metricsCharts = [];
function destroyMetricsCharts() { metricsCharts.forEach(c => c.destroy()); metricsCharts = []; }

async function renderMetricas(main) {
  destroyMetricsCharts();
  main.innerHTML = `
    <div class="page-header">
      <div><h1>${icon('chart', 26)} Métricas</h1><div class="subtitle">Flujo conversacional de posgrados, lo que no entendió y los errores para revisar</div></div>
      <div id="metRangeWrap"></div>
    </div>
    <div id="metricsContent">
      <div class="stats-grid stagger-in" style="margin-bottom:16px;">
        ${Array.from({ length: 4 }).map(() => `<div class="stat-card"><div class="skeleton skeleton-line" style="width:70px;height:11px;margin-bottom:8px;"></div><div class="skeleton skeleton-line" style="width:50px;height:26px;"></div></div>`).join('')}
      </div>
      <div class="card" style="margin-bottom:16px;"><div class="skeleton" style="height:220px;border-radius:12px;"></div></div>
      <div class="widget-card"><div class="widget-card-head"><h2>Eventos por tipo</h2></div>
        ${Array.from({ length: 6 }).map(() => `<div class="skeleton skeleton-line" style="height:13px;margin:14px 20px;"></div>`).join('')}
      </div>
    </div>
  `;
  const content = main.querySelector('#metricsContent');
  let loadSeq = 0;

  let metDays = '7';
  $('#metRangeWrap').appendChild(buildSegmented(
    [{ value: '7', label: '7 días' }, { value: '14', label: '14 días' }, { value: '30', label: '30 días' }],
    metDays,
    (value) => { metDays = value; loadMetrics(); },
  ));

  setPullToRefresh(() => loadMetrics());
  async function loadMetrics() {
    const seq = ++loadSeq;
    destroyMetricsCharts();
    marcarCargando(content, true);
    try {
      const [r, rNo, rInc, rFrec] = await Promise.all([
        api(`/api/tools/metrics/range?days=${metDays}`),
        api('/api/tools/metrics/no-reconocidos').catch(() => null),
        api('/api/tools/metrics/incidencias').catch(() => null),
        api('/api/tools/metrics/preguntas-frecuentes').catch(() => null),
      ]);
      if (!content.isConnected || seq !== loadSeq || !r) return;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { days } = await r.json();
      // Lo que el bot no entendió: si falla, la pantalla sigue sin esta tarjeta.
      const noReconocidos = rNo?.ok ? ((await rNo.json()).textos ?? []) : [];
      const incidencias = rInc?.ok ? ((await rInc.json()).incidencias ?? []) : [];
      const frecuentes = rFrec?.ok ? ((await rFrec.json()).preguntas ?? []) : [];
      if (!content.isConnected || seq !== loadSeq) return;
      const dateKeys = Object.keys(days).sort();
      const numv = (obj, k) => parseInt(obj?.[k] ?? '0') || 0;

      const totals = totalesDelFlujo(days);
      const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
      const maxVal = Math.max(1, ...rows.map(([, v]) => v));
      const noEntendidoPorPaso = contarPorDetalle(days, 'no_reconocido', 'paso');
      const erroresPorTipo = contarPorDetalle(days, 'incidencia', 'tipo');
      const desde = dateKeys[0] ?? '';
      const enRango = (x) => (x.fecha ?? '').slice(0, 10) >= desde;

      content.innerHTML = `
        <div class="stats-grid stagger-in" style="margin-bottom:16px;">
          <div class="stat-card"><div class="label">Conversaciones nuevas</div><div class="value">${escapeHtml(totals.conv_inicio ?? 0)}</div></div>
          <div class="stat-card"><div class="label">Autorizaron sus datos</div><div class="value">${escapeHtml(totals.datos_acepta ?? 0)}</div></div>
          <div class="stat-card"><div class="label">Preguntas a la IA</div><div class="value">${escapeHtml(totals.ai_request ?? 0)}</div></div>
          <div class="stat-card"><div class="label">Derivados a asesor</div><div class="value">${escapeHtml(totals.agent_handoff ?? 0)}</div></div>
          <div class="stat-card"><div class="label">No entendió</div><div class="value">${escapeHtml(totals.no_reconocido ?? 0)}</div></div>
          <div class="stat-card"><div class="label">Errores para revisar</div><div class="value" style="${totals.incidencia ? 'color:#c5221f;' : ''}">${escapeHtml(totals.incidencia ?? 0)}</div></div>
        </div>

        <div class="card" style="margin-bottom:16px;">
          <h2 class="card-title">Tendencia diaria</h2>
          <div id="metChartDailyWrap" style="position:relative;height:240px;"><canvas id="metChartDaily"></canvas></div>
        </div>

        <div class="widget-card">
          <div class="widget-card-head"><h2>Eventos por tipo</h2></div>
          <div class="event-bars">
            ${rows.length === 0 ? `<p style="color:var(--text-muted);text-align:center;padding:24px 0;">Sin actividad registrada en este rango.</p>` : rows.map(([k, v]) => {
              const meta = eventMeta(k);
              const pct = Math.max(4, Math.round(v / maxVal * 100));
              return `
                <div class="event-bar-row">
                  <span class="event-bar-icon">${emoji(meta.icon)}</span>
                  <div class="event-bar-body">
                    <div class="event-bar-top"><span class="event-bar-label">${escapeHtml(meta.label)}</span><span class="event-bar-value">${escapeHtml(v)}</span></div>
                    <div class="event-bar-track"><div class="event-bar-fill" style="width:${pct}%;background:${meta.color};"></div></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div class="widget-card" style="margin-top:16px;">
          <div class="widget-card-head"><h2>🔁 Preguntas más frecuentes</h2></div>
          <div style="padding:4px 20px 16px;">
            <p style="font-size:13px;color:var(--text-muted);margin:0 0 10px;">${escapeHtml(textoReutilizadas(totals.ai_reutilizada ?? 0, totals.ai_request ?? 0))}</p>
            ${frecuentes.length === 0
              ? `<p style="color:var(--text-muted);text-align:center;padding:12px 0;">Todavía no hay preguntas guardadas.</p>`
              : frecuentes.slice(0, 15).map((x) => `
                <div style="display:flex;gap:10px;align-items:baseline;padding:6px 0;border-top:1px solid var(--border, #e2e8f0);">
                  <span style="flex:1;">«${escapeHtml(x.texto)}»</span>
                  <span style="flex:none;font-size:12px;color:var(--text-muted);">${escapeHtml(x.veces)} ${x.veces === 1 ? 'vez' : 'veces'}</span>
                </div>`).join('')}
          </div>
        </div>

        <div class="widget-card" style="margin-top:16px;">
          <div class="widget-card-head"><h2>⚠️ Errores para revisar</h2></div>
          ${erroresPorTipo.length === 0 && !incidencias.some(enRango)
            ? `<p style="color:var(--text-muted);text-align:center;padding:20px 0;">Sin errores en este rango 🎉</p>`
            : `<div style="padding:4px 20px 16px;">
                <p style="font-size:13px;color:var(--text-muted);margin:0 0 10px;">Lo que falló al atender a alguien (la IA, un audio, el asesor, el CRM…). Sin teléfonos ni mensajes.</p>
                <div style="margin-bottom:6px;">${chips(erroresPorTipo, TIPO_INCIDENCIA)}</div>
                ${incidencias.filter(enRango).slice(0, 30).map((x) => `
                  <div style="display:flex;gap:10px;align-items:baseline;padding:6px 0;border-top:1px solid var(--border, #e2e8f0);">
                    <span style="flex:none;font-size:12px;color:#c5221f;min-width:150px;">${escapeHtml(TIPO_INCIDENCIA[x.tipo] ?? x.tipo)}</span>
                    <span style="flex:1;">${escapeHtml(x.detalle)}</span>
                    <span style="flex:none;font-size:12px;color:var(--text-muted);">${escapeHtml(fechaCorta(x.fecha))}</span>
                  </div>`).join('')}
              </div>`}
        </div>

        <div class="widget-card" style="margin-top:16px;">
          <div class="widget-card-head"><h2>❓ Lo que el bot no entendió</h2></div>
          ${noEntendidoPorPaso.length === 0 && !noReconocidos.some(enRango)
            ? `<p style="color:var(--text-muted);text-align:center;padding:20px 0;">Nada en este rango.</p>`
            : `<div style="padding:4px 20px 16px;">
                <p style="font-size:13px;color:var(--text-muted);margin:0 0 10px;">Lo que escribieron y el bot no reconoció, lo que la IA no supo responder, confusiones y quejas: para enseñárselo. Sin teléfonos; números largos y correos van tapados.</p>
                <div style="margin-bottom:6px;">${chips(noEntendidoPorPaso, PASO_NO_RECONOCIDO)}</div>
                ${noReconocidos.filter(enRango).slice(0, 30).map((x) => `
                  <div style="display:flex;gap:10px;align-items:baseline;padding:6px 0;border-top:1px solid var(--border, #e2e8f0);">
                    <span style="flex:none;font-size:12px;color:var(--text-muted);min-width:140px;">${escapeHtml(PASO_NO_RECONOCIDO[x.paso] ?? x.paso)}</span>
                    <span style="flex:1;">«${escapeHtml(x.texto)}»</span>
                    <span style="flex:none;font-size:12px;color:var(--text-muted);">${escapeHtml(fechaCorta(x.fecha))}</span>
                  </div>`).join('')}
              </div>`}
        </div>

        <p style="margin-top:16px;font-size:13px;color:var(--text-muted);">
          Para métricas técnicas (latencia, errores, uso de recursos), abre <a href="${escapeHtml(sesion.urls.grafana)}" target="_blank" rel="noopener">Grafana</a>.
        </p>
      `;

      const topKeys = rows.slice(0, 4).map(([k]) => k);
      const ticks = { color: '#94a3b8' };
      const grid = { color: '#e2e8f0' };
      const cargarGrafica = async () => {
        const wrap = content.querySelector('#metChartDailyWrap');
        if (!wrap) return;
        marcarCargando(wrap, true);
        destroyMetricsCharts();
        wrap.innerHTML = '<canvas id="metChartDaily"></canvas>';
        try {
          await loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js');
          if (!content.isConnected || seq !== loadSeq) return;
          metricsCharts.push(new Chart(content.querySelector('#metChartDaily'), {
            type: 'line',
            data: {
              labels: dateKeys.map(d => d.slice(5)),
              // Cada serie en un tono de la misma escala de azules para distinguirlas.
              datasets: topKeys.map((k, i) => ({
                label: eventMeta(k).label,
                data: dateKeys.map(d => numv(days[d], k)),
                borderColor: SERIES_AZUL[i % SERIES_AZUL.length], backgroundColor: SERIES_AZUL[i % SERIES_AZUL.length] + '22',
                tension: 0.3, fill: true,
              })),
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { labels: { color: '#64748b' } } },
              scales: { x: { ticks, grid }, y: { ticks, grid, beginAtZero: true } },
            },
          }));
        } catch (err) {
          console.error(err);
          if (!wrap.isConnected || seq !== loadSeq) return;
          wrap.innerHTML = `<div class="estado-grafica">${htmlError('No se pudo cargar la gráfica.')}</div>`;
          conectarReintento(wrap, cargarGrafica);
        } finally {
          marcarCargando(wrap, false);
          if (seq === loadSeq) marcarCargando(content, false);
        }
      };
      await cargarGrafica();
    } catch (err) {
      console.error(err);
      if (content.isConnected && seq === loadSeq) {
        content.innerHTML = htmlError('No se pudieron cargar las métricas. Intenta de nuevo; si sigue fallando, avisa a un administrador.');
        conectarReintento(content, loadMetrics);
        marcarCargando(content, false);
      }
    }
  }

  loadMetrics();
}

/* El área en mayúsculas ("ADMISIONES") no cabe en la tarjeta y se cortaba. */

export { renderMetricas, contarPorDetalle, totalesDelFlujo, EVENTOS_FLUJO };
