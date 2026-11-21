import { api } from '../core/api.js';
import { $, emoji, escapeHtml, loadScript } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/router.js';
import { setPullToRefresh } from '../core/screen.js';
import { sesion } from '../core/session.js';
import { buildSegmented } from '../ui/controls.js';
import { conectarReintento, htmlError, marcarCargando } from '../ui/estado.js';

/* ============= LÓGICA PURA DE POSGRADOS (probada en posgrados.test.js) ======
   Serie del endpoint real `/api/tools/metrics/range` (contadores en Redis,
   ver src/services/metrics.ts): objeto fecha → { evento: "conteo" }. Las
   claves que faltan cuentan como 0: el mock local no emite las de posgrado. */
function resumirPosgrado(series) {
  const s = series ?? {};
  const dateKeys = Object.keys(s).sort();
  const numv = (obj, k) => parseInt(obj?.[k] ?? '0') || 0;
  const sumAll = (ev) => dateKeys.reduce((a, d) => a + numv(s[d], ev), 0);
  const pct = (a, b) => (b > 0 ? Math.round(a / b * 100) : null);
  const conversaciones = sumAll('conv_inicio');
  const autorizaron = sumAll('datos_acepta');
  const noAutorizaron = sumAll('datos_rechaza');
  const pidieronAyuda = sumAll('reco_inicio');
  const vieronReco = sumAll('reco_resultados');
  const fichas = sumAll('reco_ficha');
  const pidieronAsesor = sumAll('reco_asesor');
  const leads = sumAll('reco_lead_completado');
  const utilSi = sumAll('reco_util_si');
  const utilNo = sumAll('reco_util_no');
  return {
    dateKeys, conversaciones, autorizaron, noAutorizaron, pidieronAyuda, vieronReco, fichas, pidieronAsesor, leads, utilSi, utilNo,
    pctAutorizo: pct(autorizaron, autorizaron + noAutorizaron),
    pctUtil: pct(utilSi, utilSi + utilNo),
    // Del primer mensaje al asesor: cuántos llegan a cada paso.
    pasos: [
      ['Conversaciones', conversaciones], ['Autorizaron datos', autorizaron], ['Pidieron ayuda para elegir', pidieronAyuda],
      ['Vieron recomendaciones', vieronReco], ['Abrieron una ficha', fichas], ['Pidieron asesor', pidieronAsesor],
      ['Dejaron sus datos al asesor', leads],
    ],
  };
}

/* ============= POSGRADOS ============= */
let pgCharts = [];

function destroyPgCharts() {
  pgCharts.forEach(c => c.destroy());
  pgCharts = [];
}

async function renderPosgrados(main) {
  destroyPgCharts();
  main.innerHTML = `
    <div class="page-header">
      <div><h1>${icon('funnel', 26)} Embudo de posgrados</h1><div class="subtitle">Del primer mensaje al asesor: cuántas personas avanzan en cada paso del flujo conversacional</div></div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <a class="btn btn-secondary" href="${escapeHtml(sesion.urls.chatwoot)}/app/accounts/1/label/posgrado-prospecto" target="_blank" rel="noopener">${emoji('💬')} Ver prospectos</a>
        <div id="pgRangeWrap"></div>
      </div>
    </div>
    <div id="pgContent">
      <div class="stats-grid" style="margin-bottom:20px;">
        ${Array.from({ length: 5 }).map(() => `<div class="stat-card"><div class="skeleton skeleton-line" style="width:70px;height:11px;margin-bottom:8px;"></div><div class="skeleton skeleton-line" style="width:50px;height:26px;"></div></div>`).join('')}
      </div>
      <div class="card"><div class="skeleton" style="height:220px;border-radius:12px;"></div></div>
    </div>
  `;
  let pgDays = '7';
  let pgLoadId = 0;
  $('#pgRangeWrap').appendChild(buildSegmented(
    [{ value: '7', label: '7 días' }, { value: '14', label: '14 días' }, { value: '30', label: '30 días' }],
    pgDays,
    (value) => { pgDays = value; loadPg(); },
  ));

  function pgSkeleton() {
    return `
      <div class="stats-grid" style="margin-bottom:20px;">
        ${Array.from({ length: 5 }).map(() => `<div class="stat-card"><div class="skeleton skeleton-line" style="width:70px;height:11px;margin-bottom:8px;"></div><div class="skeleton skeleton-line" style="width:50px;height:26px;"></div></div>`).join('')}
      </div>
      <div class="card"><div class="skeleton" style="height:220px;border-radius:12px;"></div></div>
    `;
  }

  setPullToRefresh(() => loadPg());
  async function loadPg() {
    const content = $('#pgContent');
    if (!content) return;
    const loadId = ++pgLoadId;
    destroyPgCharts();
    content.innerHTML = pgSkeleton();
    marcarCargando(content, true);
    const days = pgDays;
    try {
      const r = await api(`/api/tools/metrics/range?days=${days}`);
      if (!r || !content.isConnected || loadId !== pgLoadId) return;
      if (!r.ok) throw new Error('metricas_no_disponibles');
      const { days: series } = await r.json();
      if (!content.isConnected || loadId !== pgLoadId) return;
      const r0 = resumirPosgrado(series ?? {});
      const { dateKeys, conversaciones, autorizaron, vieronReco, pidieronAsesor, leads, utilSi, utilNo, pctAutorizo, pctUtil, pasos } = r0;
      const numv = (obj, k) => parseInt(obj?.[k] ?? '0') || 0;
      const daily  = (ev) => dateKeys.map(d => numv(series[d], ev));
      const fmtDay = d => d.slice(5);
      const hayUtil = utilSi + utilNo > 0;
      const textoAutorizo = pctAutorizo === null ? '' : ` (${pctAutorizo}%)`;
      const textoUtil = pctUtil === null ? 'Todavía nadie calificó las recomendaciones.' : `Al ${pctUtil}% le sirvió la recomendación (${utilSi + utilNo} respuestas).`;

      content.innerHTML = `
        <div class="card op-contexto" style="margin-bottom:16px;">
          <div class="op-contexto-texto">En estos ${escapeHtml(String(days))} días: ${escapeHtml(conversaciones)} conversaciones nuevas, ${escapeHtml(autorizaron)} autorizaron sus datos${escapeHtml(textoAutorizo)}, ${escapeHtml(vieronReco)} vieron recomendaciones y ${escapeHtml(pidieronAsesor)} pidieron un asesor. ${escapeHtml(textoUtil)} El detalle por persona está en el CRM.</div>
          <div class="op-contexto-acciones">
            <button type="button" class="btn btn-secondary" id="pgVerCrm">Ver CRM</button>
            <button type="button" class="btn btn-secondary" id="pgVerEvento">Ver evento</button>
          </div>
        </div>
        <div class="stats-grid" style="margin-bottom:20px;">
          <div class="stat-card"><div class="label">Conversaciones nuevas</div><div class="value">${escapeHtml(conversaciones)}</div></div>
          <div class="stat-card"><div class="label">Autorizaron sus datos</div><div class="value">${escapeHtml(autorizaron)}</div>
            <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(pctAutorizo === null ? 'sin respuestas' : `${pctAutorizo}% de quienes respondieron`)}</div></div>
          <div class="stat-card"><div class="label">Vieron recomendaciones</div><div class="value">${escapeHtml(vieronReco)}</div></div>
          <div class="stat-card"><div class="label">Pidieron asesor</div><div class="value">${escapeHtml(pidieronAsesor)}</div>
            <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(leads)} dejaron nombre y correo</div></div>
          <div class="stat-card"><div class="label">Le sirvió la recomendación</div><div class="value">${escapeHtml(pctUtil === null ? '—' : `${pctUtil}%`)}</div>
            <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(utilSi)} 👍 · ${escapeHtml(utilNo)} 👎</div></div>
        </div>

        <div class="card" style="margin-bottom:16px;">
          <h2 class="card-title">Actividad diaria — posgrados</h2>
          <div id="pgChartDailyWrap" style="position:relative;height:240px;"><canvas id="pgChartDaily"></canvas></div>
        </div>

        <div class="posgrados-split" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
          <div class="card">
            <h2 class="card-title">Embudo: del primer mensaje al asesor</h2>
            <div id="pgChartFunnelWrap" style="position:relative;height:260px;"><canvas id="pgChartFunnel"></canvas></div>
          </div>
          <div class="card">
            <h2 class="card-title">¿Le sirvió la recomendación?</h2>
            <div id="pgChartProgramasWrap" style="position:relative;height:260px;">${hayUtil ? '<canvas id="pgChartProgramas"></canvas>' : '<div class="widget-empty" style="height:100%;display:grid;place-items:center;text-align:center;">Todavía nadie calificó las recomendaciones en este rango.</div>'}</div>
          </div>
        </div>
      `;

      $('#pgVerCrm')?.addEventListener('click', () => navigate('registros'));
      $('#pgVerEvento')?.addEventListener('click', () => navigate('evento-posgrado'));

      const ticks = { color: '#94a3b8' };
      const grid  = { color: '#e2e8f0' };
      const base  = {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#64748b' } } },
        scales: { x: { ticks, grid }, y: { ticks, grid, beginAtZero: true } },
      };

      const cargarGraficas = async () => {
        const wraps = [content.querySelector('#pgChartDailyWrap'), content.querySelector('#pgChartFunnelWrap'), ...(hayUtil ? [content.querySelector('#pgChartProgramasWrap')] : [])].filter(Boolean);
        destroyPgCharts();
        content.querySelector('#pgChartDailyWrap').innerHTML = '<canvas id="pgChartDaily"></canvas>';
        content.querySelector('#pgChartFunnelWrap').innerHTML = '<canvas id="pgChartFunnel"></canvas>';
        if (hayUtil) content.querySelector('#pgChartProgramasWrap').innerHTML = '<canvas id="pgChartProgramas"></canvas>';
        wraps.forEach(wrap => marcarCargando(wrap, true));
        try {
          await loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js');
          if (!content.isConnected || loadId !== pgLoadId) return;
          pgCharts.push(new Chart(document.getElementById('pgChartDaily'), {
            type: 'line',
            data: {
              labels: dateKeys.map(fmtDay),
              datasets: [
                { label: 'Conversaciones', data: daily('conv_inicio'), borderColor: '#8fb3ec', backgroundColor: '#8fb3ec22', tension: 0.3, fill: true },
                { label: 'Vieron recomendaciones', data: daily('reco_resultados'), borderColor: '#2f6fd6', backgroundColor: '#2f6fd622', tension: 0.3, fill: true },
                { label: 'Pidieron asesor', data: daily('reco_asesor'), borderColor: '#003087', backgroundColor: '#00308722', tension: 0.3, fill: true },
              ],
            },
            options: base,
          }));

          if (hayUtil) pgCharts.push(new Chart(document.getElementById('pgChartProgramas'), {
            type: 'doughnut',
            data: {
              labels: ['👍 Le sirvió', '👎 No mucho'],
              datasets: [{ data: [utilSi, utilNo], backgroundColor: ['#2f6fd6', '#b45309'] }],
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#64748b' } } } },
          }));

          pgCharts.push(new Chart(document.getElementById('pgChartFunnel'), {
            type: 'bar',
            data: {
              labels: pasos.map(([nombre]) => nombre),
              datasets: [{ data: pasos.map(([, valor]) => valor), backgroundColor: ['#c7d8f5', '#a9c3ee', '#8fb3ec', '#5f93e2', '#2f6fd6', '#1a4fb4', '#003087'] }],
            },
            options: { ...base, indexAxis: 'y', plugins: { legend: { display: false } } },
          }));
        } catch (err) {
          console.error(err);
          destroyPgCharts();
          if (!content.isConnected || loadId !== pgLoadId) return;
          wraps.forEach((wrap) => {
            wrap.innerHTML = `<div class="estado-grafica">${htmlError('No se pudo cargar la gráfica.')}</div>`;
            conectarReintento(wrap, cargarGraficas);
          });
        } finally {
          wraps.forEach(wrap => marcarCargando(wrap, false));
          if (loadId === pgLoadId) marcarCargando(content, false);
        }
      };
      await cargarGraficas();

    } catch (err) {
      if (!content.isConnected || loadId !== pgLoadId) return;
      console.error(err);
      content.innerHTML = htmlError('No se pudieron cargar las métricas de posgrados. Intenta de nuevo; si sigue fallando, avisa a un administrador.');
      conectarReintento(content, loadPg);
      marcarCargando(content, false);
    }
  }

  loadPg();
}

export { renderPosgrados, resumirPosgrado };
