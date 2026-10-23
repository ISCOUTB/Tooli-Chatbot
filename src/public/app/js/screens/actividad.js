import { api } from '../core/api.js';
import { AUDIT_AREAS, AUDIT_LABELS, areaForAction } from '../core/audit.js';
import { $, escapeHtml, loadScript } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/router.js';
import { setPullToRefresh } from '../core/screen.js';
import { sesion } from '../core/session.js';
import { buildSegmented } from '../ui/controls.js';

/* ============= ACTIVIDAD DE ASESORES (admin) ============= */
let actChart = null;
const MEDALS = ['🥇', '🥈', '🥉'];

async function renderActividad(main) {
  if (sesion.user.role !== 'admin') { navigate('home'); return; }

  main.innerHTML = `
    <div class="page-header">
      <div><h1>📈 Rendimiento de asesores</h1><div class="subtitle">Actividad real registrada en el panel — últimos días</div></div>
      <div id="actRangeWrap"></div>
    </div>
    <div id="actContent">
      <div class="stats-grid stagger-in" style="margin-bottom:16px;">
        ${Array.from({ length: 3 }).map(() => `<div class="stat-card"><div class="skeleton skeleton-line" style="width:70px;height:11px;margin-bottom:8px;"></div><div class="skeleton skeleton-line" style="width:110px;height:22px;"></div></div>`).join('')}
      </div>
      <div class="card" style="margin-bottom:16px;"><div class="skeleton" style="height:200px;border-radius:12px;"></div></div>
      <div class="widget-card">${Array.from({ length: 5 }).map(() => `<div class="skeleton skeleton-line" style="height:14px;margin:10px 6px;"></div>`).join('')}</div>
    </div>
  `;
  const content = main.querySelector('#actContent');
  let loadSeq = 0;

  let actDays = '7';
  $('#actRangeWrap').appendChild(buildSegmented(
    [{ value: '1', label: 'Hoy' }, { value: '7', label: '7 días' }, { value: '30', label: '30 días' }],
    actDays, (v) => { actDays = v; load(); },
  ));

  setPullToRefresh(() => load());
  async function load() {
    const seq = ++loadSeq;
    if (actChart) { actChart.destroy(); actChart = null; }
    try {
      const [summaryRes, usersRes] = await Promise.all([
        api(`/api/tools/audit/summary?days=${actDays}`).then(r => r.json()),
        api('/api/auth/users').then(r => r.json()).catch(() => ({ users: [] })),
      ]);
      if (!content.isConnected || seq !== loadSeq) return;
      const fullNameOf = Object.fromEntries((usersRes.users ?? []).map(u => [u.username, u.fullName]));
      const advisors = Object.entries(summaryRes.summary ?? {})
        .map(([username, counts]) => ({ username, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }))
        .sort((a, b) => b.total - a.total);

      if (!advisors.length) {
        content.innerHTML = `
          <div class="card" style="text-align:center;padding:44px 20px;">
            <div style="font-size:32px;margin-bottom:8px;">📊</div>
            <div style="font-weight:700;font-size:15px;margin-bottom:4px;">Sin actividad aún</div>
            <div style="font-size:13px;color:var(--text-muted);">No hay acciones registradas en este rango. Probá con otro período.</div>
          </div>`;
        return;
      }

      const actionKeys = Array.from(new Set(advisors.flatMap(a => Object.keys(a.counts))));
      const maxTotal = Math.max(1, ...advisors.map(a => a.total));

      const areaTotals = {};
      for (const a of advisors) {
        for (const [action, n] of Object.entries(a.counts)) {
          const area = areaForAction(action);
          areaTotals[area] = (areaTotals[area] ?? 0) + n;
        }
      }
      const grandTotal = Math.max(1, Object.values(areaTotals).reduce((a, b) => a + b, 0));
      const areaRows = Object.entries(AUDIT_AREAS)
        .map(([key, meta]) => ({ key, ...meta, count: areaTotals[key] ?? 0 }))
        .filter(a => a.count > 0)
        .sort((a, b) => b.count - a.count);

      content.innerHTML = `
        <div class="stats-grid stagger-in" style="margin-bottom:16px;">
          ${advisors.slice(0, 3).map((a, i) => `
            <div class="stat-card">
              <div class="label">${MEDALS[i]} ${escapeHtml(fullNameOf[a.username] ?? a.username)}</div>
              <div class="value">${a.total}</div>
              <div style="font-size:12px;color:var(--text-muted);">acciones registradas</div>
            </div>
          `).join('')}
        </div>

        <div class="card" style="margin-bottom:16px;">
          <h3 style="font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px;">Carga de trabajo por área</h3>
          ${areaRows.map(a => {
            const pct = Math.round(a.count / grandTotal * 100);
            return `
              <div style="margin-bottom:12px;">
                <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
                  <span style="font-weight:600;color:var(--text-main);">${a.label}</span>
                  <span style="color:var(--text-muted);">${a.count} · ${pct}%</span>
                </div>
                <div class="event-bar-track"><div class="event-bar-fill" style="width:${pct}%;background:${a.color};"></div></div>
              </div>
            `;
          }).join('')}
        </div>

        <div class="card" style="margin-bottom:16px;">
          <h3 style="font-size:13px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px;">Total de acciones por asesor</h3>
          <div style="position:relative;height:${Math.max(140, advisors.length * 42)}px;"><canvas id="actChartCanvas"></canvas></div>
        </div>

        <div class="widget-card">
          <div class="widget-card-head"><h3>Detalle por tipo de acción</h3></div>
          <div style="overflow-x:auto;">
            <table>
              <thead><tr><th>Asesor</th>${actionKeys.map(k => {
                const fb = k === 'recordatorio_enviado' ? { label: 'Recordatorio enviado', icon: '⏰' } : null;
                return `<th style="text-align:center;">${AUDIT_LABELS[k]?.icon ?? fb?.icon ?? ''} ${escapeHtml(AUDIT_LABELS[k]?.label ?? fb?.label ?? k)}</th>`;
              }).join('')}<th style="text-align:right;">Total</th></tr></thead>
              <tbody class="stagger-in">
                ${advisors.map(a => `<tr><td><strong>${escapeHtml(fullNameOf[a.username] ?? a.username)}</strong></td>${actionKeys.map(k => `<td style="text-align:center;">${a.counts[k] ?? '—'}</td>`).join('')}<td style="text-align:right;font-weight:700;color:var(--utb-blue);">${a.total}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
          ${actionKeys.length > 3 ? `<div style="font-size:11px;color:var(--text-muted);text-align:center;padding-top:8px;opacity:.8;">← Deslizá para ver todas las columnas →</div>` : ''}
        </div>
      `;

      await loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js');
      if (!content.isConnected || seq !== loadSeq) return;
      actChart = new Chart(content.querySelector('#actChartCanvas'), {
        type: 'bar',
        data: {
          labels: advisors.map(a => fullNameOf[a.username] ?? a.username),
          datasets: [{ data: advisors.map(a => a.total), backgroundColor: '#003087', borderRadius: 6, maxBarThickness: 26 }],
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, max: maxTotal + Math.ceil(maxTotal * 0.15), ticks: { color: '#94a3b8' }, grid: { color: '#e2e8f0' } },
            y: { ticks: { color: '#64748b' }, grid: { display: false } },
          },
        },
      });
    } catch (err) {
      console.error(err);
      if (content.isConnected && seq === loadSeq) content.innerHTML = '<div class="alert alert-error">No se pudo cargar la actividad.</div>';
    }
  }
  load();
}

export { renderActividad };
