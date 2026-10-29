import { api } from '../core/api.js';
import { AUDIT_LABELS, dateLabelToday } from '../core/audit.js';
import { CRM_ESTADOS } from '../core/crm.js';
import { $, $$, escapeHtml } from '../core/dom.js';
import { relativeTime } from '../core/format.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/router.js';
import { setPullToRefresh } from '../core/screen.js';
import { sesion } from '../core/session.js';
import { countUp } from '../ui/controls.js';

async function renderHome(main) {
  const isAdmin = sesion.user.role === 'admin';
  let homeFichas = null;   // se comparte entre "Requiere atención" y el embudo
  setPullToRefresh(() => renderHome(main));
  main.innerHTML = `
    <div class="page-header">
      <div>
        <div class="subtitle" style="margin-bottom: 2px;">${dateLabelToday()}</div>
        <h1>Hola, ${sesion.user.fullName.split(' ')[0]} 👋</h1>
        <div class="subtitle">${isAdmin ? 'Este es el estado general del equipo hoy.' : 'Esto es lo que tienes disponible hoy.'}</div>
      </div>
    </div>

    <div class="stats-grid stagger-in" id="stats" style="margin-bottom: 16px;">
      <div class="stat-card"><div class="label">Mensajes hoy</div><div class="value skeleton" data-stat="msgs">&nbsp;</div></div>
      <div class="stat-card"><div class="label">Preguntas IA</div><div class="value skeleton" data-stat="ai">&nbsp;</div></div>
      <div class="stat-card"><div class="label">Prospectos</div><div class="value skeleton" data-stat="prospectos">&nbsp;</div></div>
      <div class="stat-card"><div class="label">Casos a asesor</div><div class="value skeleton" data-stat="handoffs">&nbsp;</div></div>
    </div>

    <div class="home-grid stagger-in" style="display: grid; grid-template-columns: 3fr 2fr; gap: 14px; margin-bottom: 14px;">
      <div class="widget-card">
        <div class="widget-card-head"><h3>Requiere atención</h3></div>
        <div id="attentionList">${Array.from({ length: 3 }).map(() => `<div class="skeleton skeleton-line" style="height:13px;margin:10px 8px;"></div>`).join('')}</div>
      </div>
      <div class="widget-card">
        <div class="widget-card-head"><h3>Accesos rápidos</h3></div>
        <div id="quickAccess"></div>
      </div>
    </div>

    <div class="widget-card stagger-in" id="funnelWidget" style="margin-bottom:14px;">
      <div class="widget-card-head">
        <h3>Embudo de prospectos</h3>
        <button type="button" class="widget-link" id="seeAllCrm">Ver el CRM ${icon('chevronRight', 13)}</button>
      </div>
      <div id="funnelBody">${Array.from({ length: 3 }).map(() => `<div class="skeleton skeleton-line" style="height:12px;margin:9px 6px;"></div>`).join('')}</div>
    </div>

    <div class="widget-card stagger-in" id="roleWidget">
      <div class="widget-card-head"><h3>${isAdmin ? 'Actividad de asesores' : 'Tu actividad reciente'}</h3>${isAdmin ? `<button type="button" class="widget-link" id="seeAllActivity">Ver todo ${icon('chevronRight', 13)}</button>` : ''}</div>
      <div id="roleWidgetBody">${Array.from({ length: 4 }).map(() => `<div class="skeleton skeleton-line" style="height:12px;margin:8px 6px;"></div>`).join('')}</div>
    </div>
  `;
  const attention = main.querySelector('#attentionList');
  const funnel = main.querySelector('#funnelBody');
  const role = main.querySelector('#roleWidgetBody');
  const stats = main.querySelector('#stats');

  const QUICK_ITEMS = [
    { icon: 'phone', label: 'Atención', sub: 'Conversaciones que el bot pasó a un asesor', go: () => navigate('atencion') },
    { icon: 'message', label: 'Conversaciones', sub: 'Todo lo que la gente habló con el bot', go: () => navigate('conversaciones') },
    { icon: 'clipboard', label: 'Consultar turno', sub: 'Turno de matrícula por código', go: () => navigate('turno') },
    { icon: 'receipt', label: 'Descargar recibo', sub: 'PDF desde Iceberg', go: () => navigate('recibo') },
    { icon: 'users', label: 'CRM · Prospectos', sub: 'Búsqueda y filtros', go: () => navigate('registros') },
    { icon: 'cap', label: 'Posgrados', sub: 'Gráficas y embudo', go: () => navigate('posgrados') },
    { icon: 'clock', label: 'Recordatorios', sub: 'Mensajes programados por WhatsApp', go: () => navigate('recordatorios') },
    { icon: 'chart', label: 'Métricas', sub: 'Actividad de los últimos días', go: () => navigate('metricas') },
    { icon: 'message', label: `Abrir Chatwoot${sesion.caps.chatwootSso ? ' · SSO' : ''}`, sub: 'La plataforma de atención anterior', go: () => openChatwootExternal() },
    { icon: 'chart', label: 'Abrir Grafana', sub: 'Métricas técnicas en vivo', go: () => window.open(sesion.urls.grafana, '_blank', 'noopener') },
  ];
  $('#quickAccess').innerHTML = QUICK_ITEMS.map((item, i) => `
    <button type="button" class="quick-row" data-qi="${i}">
      <span class="quick-icon">${icon(item.icon, 17)}</span>
      <span class="quick-body"><div class="quick-title">${item.label}</div><div class="quick-sub">${item.sub}</div></span>
      <span class="quick-chevron">${icon('chevronRight', 15)}</span>
    </button>
  `).join('');
  $$('#quickAccess .quick-row').forEach((b, i) => b.addEventListener('click', () => QUICK_ITEMS[i].go()));

  async function openChatwootExternal() {
    try {
      const r = await api('/api/auth/chatwoot-sso');
      const { url } = await r.json();
      window.open(url, '_blank', 'noopener');
    } catch {
      window.open(sesion.urls.chatwoot, '_blank', 'noopener');
    }
  }

  $('#seeAllActivity')?.addEventListener('click', () => navigate('actividad'));
  $('#seeAllCrm')?.addEventListener('click', () => navigate('registros'));

  // ── "Requiere atención": combina datos reales de bot-users, Chatwoot y salud ──
  (async () => {
    const rows = [];
    try {
      const [botUsersRes, chatwootRes, healthRes, fichasRes, remRes] = await Promise.allSettled([
        api('/api/tools/bot-users').then(r => r.json()),
        api('/api/tools/chatwoot/summary').then(r => r.json()),
        fetch('/health/deep', { credentials: 'same-origin' }).then(r => r.json()),
        api('/api/tools/crm/fichas').then(r => r.json()),
        api('/api/tools/recordatorios').then(r => r.json()),
      ]);
      if (!attention.isConnected) return;

      // Recordatorios que no salieron: nadie se entera si no se avisa acá.
      if (remRes.status === 'fulfilled') {
        const fallidos = (remRes.value.reminders ?? []).filter(x => x.estado === 'fallido');
        if (fallidos.length) {
          rows.push({ tone: 'danger', html: `<strong>${fallidos.length}</strong> recordatorio${fallidos.length !== 1 ? 's' : ''} no se pudo enviar`, go: 'recordatorios' });
        }
      }

      // Prospectos interesados que nadie tomó — el caso que más se pierde.
      if (fichasRes.status === 'fulfilled') {
        const fichas = Object.values(fichasRes.value.fichas ?? {});
        homeFichas = fichas;
        const huerfanos = fichas.filter(f => !f.asignadoA && (f.estado === 'interesado' || f.estado === 'contactado'));
        if (huerfanos.length) {
          rows.push({ tone: 'warning', html: `<strong>${huerfanos.length}</strong> prospecto${huerfanos.length !== 1 ? 's' : ''} en seguimiento sin asesor asignado`, go: 'registros' });
        }
      }
      if (chatwootRes.status === 'fulfilled') {
        const cw = chatwootRes.value;
        if (cw.unassigned > 0) rows.push({ tone: 'danger', html: `<strong>${cw.unassigned}</strong> ${cw.unassigned === 1 ? 'conversación' : 'conversaciones'} con asesor sin asignar`, go: 'atencion' });
        if (cw.pending > 0) rows.push({ tone: 'warning', html: `<strong>${cw.pending}</strong> ${cw.pending === 1 ? 'conversación pendiente' : 'conversaciones pendientes'} de responder`, go: 'atencion' });
      }
      if (healthRes.status === 'fulfilled') {
        const bad = Object.entries(healthRes.value.checks ?? {}).filter(([, c]) => c.status === 'down' || c.status === 'degraded');
        bad.forEach(([name, c]) => rows.push({ tone: c.status === 'down' ? 'danger' : 'warning', html: `Servicio <strong>${name.replace(/_/g, ' ')}</strong> ${c.status === 'down' ? 'caído' : 'degradado'}`, go: 'health' }));
      }
      if (botUsersRes.status === 'fulfilled' && botUsersRes.value.phones?.length) {
        // No hay endpoint de conteo de baneados; se omite salvo que ya se vea en la bandeja.
      }
    } catch { /* noop */ }

    if (!attention.isConnected) return;
    if (!rows.length) {
      attention.innerHTML = `<div class="widget-empty">${icon('check', 16)} Todo al día — nada requiere atención ahora mismo.</div>`;
      return;
    }
    attention.innerHTML = rows.slice(0, 6).map(r => `
      <button type="button" class="attention-row" data-go="${r.go}" style="width:100%;background:none;border:none;text-align:left;cursor:pointer;font-family:inherit;">
        <span class="attention-dot ${r.tone}"></span>
        <span class="attention-text">${r.html}</span>
        <span class="quick-chevron">${icon('chevronRight', 14)}</span>
      </button>
    `).join('');
    $$('[data-go]', attention).forEach(b => b.addEventListener('click', () => navigate(b.dataset.go)));
  })();

  // ── Embudo del equipo: cuántos prospectos hay en cada etapa (dato real de
  //    las fichas del CRM, no una estimación) ──
  (async () => {
    const cont = funnel;
    if (!cont) return;
    let fichas = homeFichas;
    if (!fichas) {
      try { fichas = Object.values((await (await api('/api/tools/crm/fichas')).json()).fichas ?? {}); }
      catch { if (cont.isConnected) cont.innerHTML = `<div class="widget-empty">No se pudo cargar el embudo.</div>`; return; }
    }
    if (!cont.isConnected) return;
    if (!fichas.length) {
      cont.innerHTML = `<div class="widget-empty">${icon('tag', 16)} Nadie ha movido prospectos todavía. Abre una ficha en el CRM y marca en qué punto va.</div>`;
      return;
    }
    const counts = fichas.reduce((acc, f) => { acc[f.estado] = (acc[f.estado] ?? 0) + 1; return acc; }, {});
    const total = fichas.length;
    cont.innerHTML = CRM_ESTADOS.filter(e => counts[e.value]).map(e => `
      <div class="funnel-row" data-estado="${e.value}">
        <div class="funnel-label">${e.icon} ${e.label}</div>
        <div class="funnel-track"><div class="funnel-fill" style="width:${Math.round(counts[e.value] / total * 100)}%;background:${e.color};"></div></div>
        <div class="funnel-value">${counts[e.value]}</div>
      </div>
    `).join('');
    $$('.funnel-row', cont).forEach(r => r.addEventListener('click', () => navigate('registros')));
  })();

  // ── Widget de rol: admin ve actividad del equipo, asesor ve la suya ──
  (async () => {
    const body = role;
    try {
      if (isAdmin) {
        const r = await api('/api/tools/audit/summary?days=7');
        const { summary } = await r.json();
        if (!body.isConnected) return;
        const rows = Object.entries(summary).map(([username, counts]) => ({
          username, total: Object.values(counts).reduce((a, b) => a + b, 0),
        })).sort((a, b) => b.total - a.total);
        if (!rows.length) { body.innerHTML = `<div class="widget-empty">${icon('check', 16)} Aún no hay actividad registrada esta semana.</div>`; return; }
        const max = Math.max(...rows.map(r => r.total), 1);
        body.innerHTML = rows.slice(0, 6).map(r => `
          <div class="advisor-bar-row">
            <div class="advisor-bar-name">${escapeHtml(r.username)}</div>
            <div class="advisor-bar-track"><div class="advisor-bar-fill" style="width:${Math.round(r.total / max * 100)}%"></div></div>
            <div class="advisor-bar-value">${r.total}</div>
          </div>
        `).join('');
      } else {
        const r = await api('/api/tools/audit/me');
        const { entries } = await r.json();
        if (!body.isConnected) return;
        if (!entries.length) { body.innerHTML = `<div class="widget-empty">${icon('check', 16)} Aún no has hecho acciones en el panel hoy.</div>`; return; }
        body.innerHTML = entries.slice(0, 6).map(e => {
          const meta = AUDIT_LABELS[e.action] ?? { label: e.action, icon: '•' };
          return `<div class="activity-row"><span class="activity-dot"></span><span class="activity-text">${meta.icon} ${meta.label}${e.detail ? ` — ${escapeHtml(e.detail)}` : ''}</span><span class="activity-time">${relativeTime(e.ts)}</span></div>`;
        }).join('');
      }
    } catch {
      if (body.isConnected) body.innerHTML = '<div class="alert alert-error" style="margin:4px;">No se pudo cargar la actividad.</div>';
    }
  })();

  try {
    const r = await api('/api/tools/metrics/today');
    const { metrics: m } = await r.json();
    if (!stats.isConnected) return;
    const num = (k) => parseInt(m[k] ?? '0') || 0;
    const totalMsgs = num('menu_shown') + num('ai_request') + num('turno_consultado') + num('recibo_descargado');
    const setStat = (k, v) => { const el = stats.querySelector(`[data-stat="${k}"]`); el.classList.remove('skeleton'); el.classList.add('count-up'); el.textContent = '0'; countUp(el, v); };
    setStat('msgs', totalMsgs);
    setStat('ai', num('ai_request'));
    setStat('prospectos', num('prospecto_completado'));
    setStat('handoffs', num('agent_handoff'));
  } catch {
    if (stats.isConnected) $$('.stat-card .value', stats).forEach(el => { el.classList.remove('skeleton'); el.textContent = '—'; });
  }
}

export { renderHome };
