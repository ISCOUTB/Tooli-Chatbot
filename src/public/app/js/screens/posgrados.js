import { api } from '../core/api.js';
import { $, escapeHtml, loadScript } from '../core/dom.js';
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
  const prospectos = sumAll('prospecto_completado');
  const prospInicio = sumAll('prospecto_iniciado');
  const registros = sumAll('registro_completado');
  const regInicio = sumAll('registro_iniciado');
  const especs = sumAll('programas_especializaciones');
  const maestrias = sumAll('programas_maestrias');
  const doctorados = sumAll('programas_doctorados');
  return {
    dateKeys,
    prospectos, prospInicio, registros, regInicio, especs, maestrias, doctorados,
    conv: prospInicio > 0 ? Math.round(prospectos / prospInicio * 100) : null,
    regConv: regInicio > 0 ? Math.round(registros / regInicio * 100) : null,
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
      <div><h1>${icon('funnel', 26)} Embudo de posgrados</h1><div class="subtitle">Métricas de prospectos, registros y programas consultados</div></div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <a class="btn btn-secondary" href="${escapeHtml(sesion.urls.chatwoot)}/app/accounts/1/label/posgrado-prospecto" target="_blank" rel="noopener">💬 Ver prospectos</a>
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
      const { dateKeys, prospectos, prospInicio, registros, regInicio, especs, maestrias, doctorados, conv, regConv } = resumirPosgrado(series ?? {});
      const numv = (obj, k) => parseInt(obj?.[k] ?? '0') || 0;
      const daily  = (ev) => dateKeys.map(d => numv(series[d], ev));
      const fmtDay = d => d.slice(5);
      const convTexto = conv === null ? 'conversión sin datos de inicio' : `${conv}% conversión`;
      const regConvTexto = regConv === null ? 'conversión sin datos de inicio' : `${regConv}% conversión`;
      const hayProgramas = especs + maestrias + doctorados > 0;

      content.innerHTML = `
        <div class="card op-contexto" style="margin-bottom:16px;">
          <div class="op-contexto-texto">En estos ${escapeHtml(String(days))} días: ${escapeHtml(prospectos)} prospecto${prospectos === 1 ? '' : 's'} completado${prospectos === 1 ? '' : 's'} (${escapeHtml(convTexto)}) y ${escapeHtml(registros)} registro${registros === 1 ? '' : 's'} completado${registros === 1 ? '' : 's'} (${escapeHtml(regConvTexto)}). El detalle por persona está en el CRM y en el evento.</div>
          <div class="op-contexto-acciones">
            <button type="button" class="btn btn-secondary" id="pgVerCrm">Ver CRM</button>
            <button type="button" class="btn btn-secondary" id="pgVerEvento">Ver evento</button>
          </div>
        </div>
        <div class="stats-grid" style="margin-bottom:20px;">
          <div class="stat-card">
            <div class="label">Prospectos</div>
            <div class="value">${escapeHtml(prospectos)}</div>
            <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(convTexto)} · ${escapeHtml(prospInicio)} iniciados</div>
          </div>
          <div class="stat-card">
            <div class="label">Registros BD</div>
            <div class="value">${escapeHtml(registros)}</div>
            <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(regConvTexto)} · ${escapeHtml(regInicio)} iniciados</div>
          </div>
          <div class="stat-card">
            <div class="label">Especializaciones</div>
            <div class="value">${escapeHtml(especs)}</div>
          </div>
          <div class="stat-card">
            <div class="label">Maestrías</div>
            <div class="value">${escapeHtml(maestrias)}</div>
          </div>
          <div class="stat-card">
            <div class="label">Doctorados</div>
            <div class="value">${escapeHtml(doctorados)}</div>
          </div>
        </div>

        <div class="card" style="margin-bottom:16px;">
          <h3 style="font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px;">Actividad diaria — posgrados</h3>
          <div id="pgChartDailyWrap" style="position:relative;height:240px;"><canvas id="pgChartDaily"></canvas></div>
        </div>

        <div class="posgrados-split" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
          <div class="card">
            <h3 style="font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px;">Programas consultados</h3>
            <div id="pgChartProgramasWrap" style="position:relative;height:200px;">${hayProgramas ? '<canvas id="pgChartProgramas"></canvas>' : '<div class="widget-empty" style="height:100%;display:grid;place-items:center;text-align:center;">Sin consultas de programas en este rango.</div>'}</div>
          </div>
          <div class="card">
            <h3 style="font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px;">Embudo prospectos</h3>
            <div id="pgChartFunnelWrap" style="position:relative;height:200px;"><canvas id="pgChartFunnel"></canvas></div>
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
        const wraps = [content.querySelector('#pgChartDailyWrap'), content.querySelector('#pgChartFunnelWrap'), ...(hayProgramas ? [content.querySelector('#pgChartProgramasWrap')] : [])].filter(Boolean);
        destroyPgCharts();
        content.querySelector('#pgChartDailyWrap').innerHTML = '<canvas id="pgChartDaily"></canvas>';
        content.querySelector('#pgChartFunnelWrap').innerHTML = '<canvas id="pgChartFunnel"></canvas>';
        if (hayProgramas) content.querySelector('#pgChartProgramasWrap').innerHTML = '<canvas id="pgChartProgramas"></canvas>';
        wraps.forEach(wrap => marcarCargando(wrap, true));
        try {
          await loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js');
          if (!content.isConnected || loadId !== pgLoadId) return;
          pgCharts.push(new Chart(document.getElementById('pgChartDaily'), {
        type: 'line',
        data: {
          labels: dateKeys.map(fmtDay),
          datasets: [
            { label: 'Prosp. iniciados',  data: daily('prospecto_iniciado'),   borderColor: '#38bdf8', backgroundColor: '#38bdf833', tension: 0.3, fill: true },
            { label: 'Prosp. completados',data: daily('prospecto_completado'), borderColor: '#22c55e', backgroundColor: '#22c55e33', tension: 0.3, fill: true },
            { label: 'Registros BD',      data: daily('registro_completado'),  borderColor: '#a855f7', backgroundColor: '#a855f733', tension: 0.3, fill: true },
          ],
        },
        options: base,
          }));

          if (hayProgramas) pgCharts.push(new Chart(document.getElementById('pgChartProgramas'), {
        type: 'doughnut',
        data: {
          labels: ['Especializaciones', 'Maestrías', 'Doctorados'],
          datasets: [{ data: [especs, maestrias, doctorados], backgroundColor: ['#38bdf8', '#a855f7', '#ec4899'] }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#64748b' } } } },
          }));

          pgCharts.push(new Chart(document.getElementById('pgChartFunnel'), {
        type: 'bar',
        data: {
          labels: ['Prosp. iniciados', 'Prosp. completados', 'Reg. iniciados', 'Reg. completados'],
          datasets: [{
            data: [prospInicio, prospectos, regInicio, registros],
            backgroundColor: ['#38bdf8', '#22c55e', '#eab308', '#a855f7'],
          }],
        },
        options: { ...base, plugins: { legend: { display: false } } },
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
