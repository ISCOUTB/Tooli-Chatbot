import { api } from '../core/api.js';
import { emoji, escapeHtml, loadScript } from '../core/dom.js';
import { colorTextoLegible } from '../core/format.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/router.js';
import { setPullToRefresh } from '../core/screen.js';
import { sesion } from '../core/session.js';
import { buildSegmented } from '../ui/controls.js';
import { conectarReintento, htmlError, marcarCargando } from '../ui/estado.js';

/* ============= INFORMES DE ATENCIÓN (admin) ============= */
function formatoDuracion(minutos) {
  if (minutos === null || minutos === undefined || !Number.isFinite(Number(minutos)) || Number(minutos) < 0) return '—';
  const total = Math.round(Number(minutos));
  if (total < 60) return `${total} min`;
  const dias = Math.floor(total / 1440);
  const horas = Math.floor((total % 1440) / 60);
  const resto = total % 60;
  if (dias) return `${dias} d${horas ? ` ${horas} h` : ''}`;
  return `${horas} h${resto ? ` ${resto} min` : ''}`;
}

function formatoSatisfaccion(valor) {
  if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) return '—';
  return `${Number(valor).toFixed(1).replace('.', ',')}/5`;
}

function formatoPorcentaje(conteo, total) {
  const cantidad = Number(conteo);
  const base = Number(total);
  if (!Number.isFinite(cantidad) || !Number.isFinite(base) || base <= 0) return '0%';
  return `${Math.round(cantidad / base * 100)}%`;
}

function valorConTitulo(valor, formatter = String) {
  const sinDatos = valor === null || valor === undefined;
  return `<div class="value"${sinDatos ? ' title="Sin datos suficientes"' : ''}>${escapeHtml(sinDatos ? '—' : formatter(valor))}</div>`;
}

let informeChart = null;

async function renderInformes(main) {
  if (sesion.user.role !== 'admin') { navigate('home'); return; }
  if (informeChart) { informeChart.destroy(); informeChart = null; }

  main.innerHTML = `
    <div class="page-header">
      <div><h1>${icon('report', 26)} Informes de atención</h1><div class="subtitle">Volumen, tiempos de respuesta y satisfacción del equipo</div></div>
      <div id="infRangeWrap"></div>
    </div>
    <div id="infContent">
      <div class="stats-grid informe-stats stagger-in">
        ${Array.from({ length: 6 }).map(() => '<div class="stat-card"><div class="skeleton skeleton-line" style="width:90px;height:11px;margin-bottom:8px;"></div><div class="skeleton skeleton-line" style="width:64px;height:26px;"></div></div>').join('')}
      </div>
      <div class="card"><div class="skeleton" style="height:220px;border-radius:12px;"></div></div>
    </div>`;

  const content = main.querySelector('#infContent');
  const rangeWrap = main.querySelector('#infRangeWrap');
  let dias = '7';
  let loadSeq = 0;
  rangeWrap.appendChild(buildSegmented(
    [{ value: '7', label: '7 días' }, { value: '30', label: '30 días' }, { value: '90', label: '90 días' }],
    dias,
    value => { dias = value; cargar(); },
  ));

  setPullToRefresh(() => cargar());
  async function cargar() {
    const seq = ++loadSeq;
    if (informeChart) { informeChart.destroy(); informeChart = null; }
    marcarCargando(content, true);
    try {
      const response = await api(`/api/tools/atencion/informes?dias=${dias}`);
      const data = await response?.json().catch(() => ({}));
      if (!response?.ok) throw new Error(data?.message || 'informe_no_disponible');
      if (!content.isConnected || seq !== loadSeq) return;

      const totales = data.totales ?? {};
      const asesores = [...(data.porAsesor ?? [])].sort((a, b) => Number(b.resueltas ?? 0) - Number(a.resueltas ?? 0));
      const distribucion = totales.csatDistribucion ?? {};
      const sinActividad = Number(totales.recibidas ?? 0) === 0 && Number(totales.respondidas ?? 0) === 0 && Number(totales.resueltas ?? 0) === 0;
      const duracion = valor => valorConTitulo(valor, formatoDuracion);
      const satisfaccion = valor => valorConTitulo(valor, formatoSatisfaccion);

      content.innerHTML = `
        <div class="stats-grid informe-stats stagger-in">
          <div class="stat-card"><div class="label">Recibidas</div>${valorConTitulo(totales.recibidas)}</div>
          <div class="stat-card"><div class="label">Respondidas</div>${valorConTitulo(totales.respondidas)}</div>
          <div class="stat-card"><div class="label">Sin responder</div>${valorConTitulo(totales.sinResponder)}</div>
          <div class="stat-card"><div class="label">Primera respuesta</div>${duracion(totales.primeraRespuestaMedianaMin)}<div class="informe-card-ayuda">mediana</div></div>
          <div class="stat-card"><div class="label">Resolución</div>${duracion(totales.resolucionMedianaMin)}<div class="informe-card-ayuda">mediana</div></div>
          <div class="stat-card"><div class="label">Satisfacción</div>${satisfaccion(totales.csatPromedio)}<div class="informe-card-ayuda">${escapeHtml(totales.csatRespuestas ?? 0)} respuestas</div></div>
        </div>
        ${sinActividad ? `
          <div class="card informe-vacio" role="status">${emoji('📊')}<strong>Sin datos en este período</strong><span>No se recibieron conversaciones. Prueba con un rango más amplio.</span></div>
        ` : `
          <section class="card informe-bloque" aria-labelledby="infGraficaTitulo">
            <h2 class="card-title" id="infGraficaTitulo">Conversaciones por día</h2>
            <div id="infChartWrap" class="informe-chart"><canvas id="infChartCanvas"></canvas></div>
          </section>
          <section class="widget-card informe-bloque" aria-labelledby="infAsesoresTitulo">
            <div class="widget-card-head"><h2 id="infAsesoresTitulo">Resultados por asesor</h2></div>
            <div class="informe-tabla-wrap">
              <table>
                <caption>Atención por asesor durante los últimos ${escapeHtml(data.periodo?.dias ?? dias)} días</caption>
                <thead><tr><th scope="col">Asesor</th><th scope="col">Respondidas</th><th scope="col">Resueltas</th><th scope="col">Primera respuesta</th><th scope="col">Resolución</th><th scope="col">Satisfacción</th></tr></thead>
                <tbody>${asesores.map(asesor => `<tr>
                  <td><strong>${escapeHtml(asesor.username === null ? 'Hecho en Chatwoot' : (asesor.nombre || asesor.username || 'Sin nombre'))}</strong></td>
                  <td>${escapeHtml(asesor.respondidas ?? 0)}</td><td>${escapeHtml(asesor.resueltas ?? 0)}</td>
                  <td${asesor.primeraRespuestaMedianaMin == null ? ' title="Sin datos suficientes"' : ''}>${escapeHtml(formatoDuracion(asesor.primeraRespuestaMedianaMin))}</td>
                  <td${asesor.resolucionMedianaMin == null ? ' title="Sin datos suficientes"' : ''}>${escapeHtml(formatoDuracion(asesor.resolucionMedianaMin))}</td>
                  <td${asesor.csatPromedio == null ? ' title="Sin datos suficientes"' : ''}>${escapeHtml(formatoSatisfaccion(asesor.csatPromedio))}<span class="informe-respuestas">${escapeHtml(asesor.csatRespuestas ?? 0)} resp.</span></td>
                </tr>`).join('')}</tbody>
              </table>
            </div>
          </section>
          <section class="card informe-bloque" aria-labelledby="infCsatTitulo">
            <h2 class="card-title" id="infCsatTitulo">Distribución de la satisfacción</h2>
            <div class="informe-distribucion">${[5, 4, 3, 2, 1].map(puntuacion => {
              const cantidad = Number(distribucion[puntuacion] ?? 0);
              const porcentaje = formatoPorcentaje(cantidad, totales.csatRespuestas);
              const color = puntuacion >= 4 ? '#15803d' : puntuacion === 3 ? '#a16207' : '#b91c1c';
              return `<div class="informe-distribucion-fila">
                <div class="informe-distribucion-texto"><span style="color:${colorTextoLegible(color)}">${escapeHtml(puntuacion)} de 5</span><span>${escapeHtml(cantidad)} · ${escapeHtml(porcentaje)}</span></div>
                <div class="informe-barra" role="img" aria-label="${escapeHtml(puntuacion)} de 5: ${escapeHtml(cantidad)} respuestas, ${escapeHtml(porcentaje)}"><span style="width:${escapeHtml(porcentaje)};background:${color}"></span></div>
              </div>`;
            }).join('')}</div>
          </section>
        `}
        ${(data.notas ?? []).length ? `<section class="informe-notas" aria-labelledby="infNotasTitulo"><h2 id="infNotasTitulo">Notas del informe</h2><ul>${data.notas.map(nota => `<li>${escapeHtml(nota)}</li>`).join('')}</ul></section>` : ''}`;

      if (sinActividad) { marcarCargando(content, false); return; }
      const cargarGrafica = async () => {
        const wrap = content.querySelector('#infChartWrap');
        if (!wrap) return;
        if (informeChart) { informeChart.destroy(); informeChart = null; }
        wrap.innerHTML = '<canvas id="infChartCanvas"></canvas>';
        marcarCargando(wrap, true);
        try {
          await loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js');
          if (!content.isConnected || seq !== loadSeq) return;
          const porDia = Array.isArray(data.porDia) ? data.porDia : [];
          informeChart = new Chart(content.querySelector('#infChartCanvas'), {
            type: 'bar',
            data: {
              labels: porDia.map(item => String(item.fecha ?? '').slice(5)),
              datasets: [
                { label: 'Recibidas', data: porDia.map(item => Number(item.recibidas ?? 0)), backgroundColor: '#0369a1', borderRadius: 4 },
                { label: 'Resueltas', data: porDia.map(item => Number(item.resueltas ?? 0)), backgroundColor: '#15803d', borderRadius: 4 },
              ],
            },
            options: {
              responsive: true, maintainAspectRatio: false,
              plugins: { legend: { labels: { color: '#596273' } } },
              scales: {
                x: { ticks: { color: '#596273', maxTicksLimit: Number(dias) > 30 ? 12 : 15 }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { color: '#596273', precision: 0 }, grid: { color: '#e2e8f0' } },
              },
            },
          });
        } catch (error) {
          console.error(error);
          if (!wrap.isConnected || seq !== loadSeq) return;
          wrap.innerHTML = `<div class="estado-grafica">${htmlError('No se pudo cargar la gráfica.')}</div>`;
          conectarReintento(wrap, cargarGrafica);
        } finally {
          marcarCargando(wrap, false);
          if (seq === loadSeq) marcarCargando(content, false);
        }
      };
      await cargarGrafica();
    } catch (error) {
      console.error(error);
      if (content.isConnected && seq === loadSeq) {
        content.innerHTML = htmlError('No se pudo cargar el informe de atención. Intenta de nuevo; si sigue fallando, avisa a un administrador.');
        conectarReintento(content, cargar);
        marcarCargando(content, false);
      }
    }
  }
  cargar();
}

export { formatoDuracion, formatoPorcentaje, formatoSatisfaccion, renderInformes };
