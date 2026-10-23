import { api } from '../core/api.js';
import { $, escapeHtml, loadScript } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { setPullToRefresh } from '../core/screen.js';
import { sesion } from '../core/session.js';
import { buildSegmented } from '../ui/controls.js';

/* ============= MÉTRICAS ============= */
const EVENT_META = {
  menu_shown:               { label: 'Menú mostrado',        icon: '📲', color: '#64748b' },
  ai_request:                { label: 'Preguntas a la IA',    icon: '🤖', color: '#7c3aed' },
  ai_disabled_escalation:    { label: 'Escaladas (IA apagada)', icon: '🙋', color: '#f59e0b' },
  turno_consultado:          { label: 'Turnos consultados',   icon: '📋', color: '#0284c7' },
  recibo_descargado:         { label: 'Recibos descargados',  icon: '🧾', color: '#0ea5e9' },
  prospecto_iniciado:        { label: 'Prospectos iniciados', icon: '🎓', color: '#38bdf8' },
  prospecto_completado:      { label: 'Prospectos completados', icon: '🎓', color: '#22c55e' },
  registro_iniciado:         { label: 'Registros BD iniciados', icon: '📝', color: '#eab308' },
  registro_completado:       { label: 'Registros BD completados', icon: '📝', color: '#a855f7' },
  agent_handoff:             { label: 'Casos escalados a asesor', icon: '🙋', color: '#ec4899' },
  programas_especializaciones: { label: 'Especializaciones consultadas', icon: '🎓', color: '#38bdf8' },
  programas_maestrias:      { label: 'Maestrías consultadas', icon: '🎓', color: '#a855f7' },
  programas_doctorados:     { label: 'Doctorados consultados', icon: '🎓', color: '#ec4899' },
  menu_pregrado_shown:       { label: 'Menú de pregrado',      icon: '🏫', color: '#0284c7' },
  pregrado_explorar_iniciado: { label: 'Exploró carreras', icon: '🧭', color: '#0284c7' },
  pregrado_explorar_area:     { label: 'Eligió área de pregrado', icon: '🎓', color: '#0284c7' },
  pregrado_explorar_carrera:  { label: 'Eligió carrera de pregrado', icon: '📚', color: '#0284c7' },
  admisiones_guia_pregrado:   { label: 'Guía admisión Pregrado', icon: '📝', color: '#0284c7' },
  admisiones_guia_posgrado:   { label: 'Guía admisión Posgrado', icon: '📝', color: '#7c3aed' },
  prospecto_pregrado_iniciado:   { label: 'Prospectos pregrado iniciados',   icon: '🏫', color: '#38bdf8' },
  prospecto_pregrado_completado: { label: 'Prospectos pregrado completados', icon: '🏫', color: '#22c55e' },
  registro_pregrado_iniciado:    { label: 'Registros pregrado iniciados',    icon: '📝', color: '#eab308' },
  registro_pregrado_completado:  { label: 'Registros pregrado completados',  icon: '📝', color: '#16a34a' },
  // Hub "Mi vida académica": qué plataforma busca realmente la gente
  academico_menu_shown:      { label: 'Abrió Mi vida académica', icon: '🎒', color: '#6366f1' },
  academico_notas:           { label: 'Buscó sus notas',        icon: '📊', color: '#6366f1' },
  academico_horario:         { label: 'Buscó su horario',       icon: '🗓️', color: '#6366f1' },
  academico_savio:           { label: 'Fue a Savio (cursos)',   icon: '📚', color: '#6366f1' },
  savio_cursos_consultados:   { label: 'Consultó cursos Savio', icon: '📚', color: '#6366f1' },
  savio_cuenta_no_encontrada: { label: 'Cuenta Savio sin coincidencia', icon: '🔐', color: '#eab308' },
  savio_error:                { label: 'Consulta Savio fallida', icon: '⚠️', color: '#ef4444' },
  academico_calendario:      { label: 'Calendario académico',   icon: '📅', color: '#8b5cf6' },
  academico_recibo:          { label: 'Recibos (Iceberg)',      icon: '🧾', color: '#0ea5e9' },
  academico_correo:          { label: 'Correo institucional',   icon: '✉️', color: '#8b5cf6' },
  academico_becas:           { label: 'Becas y apoyo financiero', icon: '🎁', color: '#eab308' },
  academico_derechos:        { label: 'Costos y derechos',      icon: '💳', color: '#f97316' },
};
function eventMeta(key) {
  return EVENT_META[key] ?? { label: key.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()), icon: '📊', color: '#64748b' };
}

let metricsCharts = [];
function destroyMetricsCharts() { metricsCharts.forEach(c => c.destroy()); metricsCharts = []; }

async function renderMetricas(main) {
  destroyMetricsCharts();
  main.innerHTML = `
    <div class="page-header">
      <div><h1>📊 Métricas del bot</h1><div class="subtitle">Actividad general de Tooli — no solo posgrados</div></div>
      <div id="metRangeWrap"></div>
    </div>
    <div id="metricsContent">
      <div class="stats-grid stagger-in" style="margin-bottom:16px;">
        ${Array.from({ length: 4 }).map(() => `<div class="stat-card"><div class="skeleton skeleton-line" style="width:70px;height:11px;margin-bottom:8px;"></div><div class="skeleton skeleton-line" style="width:50px;height:26px;"></div></div>`).join('')}
      </div>
      <div class="card" style="margin-bottom:16px;"><div class="skeleton" style="height:220px;border-radius:12px;"></div></div>
      <div class="widget-card"><div class="widget-card-head"><h3>Eventos por tipo</h3></div>
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
    try {
      const r = await api(`/api/tools/metrics/range?days=${metDays}`);
      if (!content.isConnected || seq !== loadSeq || !r) return;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const { days } = await r.json();
      if (!content.isConnected || seq !== loadSeq) return;
      const dateKeys = Object.keys(days).sort();
      const numv = (obj, k) => parseInt(obj?.[k] ?? '0') || 0;

      const totals = {};
      for (const day of Object.values(days)) {
        for (const [k, v] of Object.entries(day)) {
          if (k.includes(':')) continue;
          totals[k] = (totals[k] ?? 0) + (parseInt(v) || 0);
        }
      }
      const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
      const maxVal = Math.max(1, ...rows.map(([, v]) => v));

      const totalMsgs = numv({ ...totals }, 'menu_shown') + (totals.ai_request ?? 0) + (totals.turno_consultado ?? 0) + (totals.recibo_descargado ?? 0);

      content.innerHTML = `
        <div class="stats-grid stagger-in" style="margin-bottom:16px;">
          <div class="stat-card"><div class="label">Mensajes totales</div><div class="value">${totalMsgs}</div></div>
          <div class="stat-card"><div class="label">Preguntas IA</div><div class="value">${totals.ai_request ?? 0}</div></div>
          <div class="stat-card"><div class="label">Prospectos</div><div class="value">${totals.prospecto_completado ?? 0}</div></div>
          <div class="stat-card"><div class="label">Casos a asesor</div><div class="value">${totals.agent_handoff ?? 0}</div></div>
        </div>

        <div class="card" style="margin-bottom:16px;">
          <h3 style="font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px;">Tendencia diaria</h3>
          <div style="position:relative;height:240px;"><canvas id="metChartDaily"></canvas></div>
        </div>

        <div class="widget-card">
          <div class="widget-card-head"><h3>Eventos por tipo</h3></div>
          <div class="event-bars">
            ${rows.length === 0 ? `<p style="color:var(--text-muted);text-align:center;padding:24px 0;">Sin actividad registrada en este rango.</p>` : rows.map(([k, v]) => {
              const meta = eventMeta(k);
              const pct = Math.max(4, Math.round(v / maxVal * 100));
              return `
                <div class="event-bar-row">
                  <span class="event-bar-icon">${meta.icon}</span>
                  <div class="event-bar-body">
                    <div class="event-bar-top"><span class="event-bar-label">${escapeHtml(meta.label)}</span><span class="event-bar-value">${v}</span></div>
                    <div class="event-bar-track"><div class="event-bar-fill" style="width:${pct}%;background:${meta.color};"></div></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <p style="margin-top:16px;font-size:13px;color:var(--text-muted);">
          Para métricas técnicas (latencia, errores, uso de recursos), abre <a href="${sesion.urls.grafana}" target="_blank">Grafana</a>.
        </p>
      `;

      await loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js');
      if (!content.isConnected || seq !== loadSeq) return;
      const topKeys = rows.slice(0, 4).map(([k]) => k);
      const ticks = { color: '#94a3b8' };
      const grid = { color: '#e2e8f0' };
      metricsCharts.push(new Chart(content.querySelector('#metChartDaily'), {
        type: 'line',
        data: {
          labels: dateKeys.map(d => d.slice(5)),
          datasets: topKeys.map(k => ({
            label: eventMeta(k).label,
            data: dateKeys.map(d => numv(days[d], k)),
            borderColor: eventMeta(k).color, backgroundColor: eventMeta(k).color + '33',
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
      if (content.isConnected && seq === loadSeq) content.innerHTML = '<div class="alert alert-error">No se pudieron cargar las métricas.</div>';
    }
  }

  loadMetrics();
}

/* El área en mayúsculas ("ADMISIONES") no cabe en la tarjeta y se cortaba. */

export { renderMetricas };
