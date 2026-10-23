import { api } from '../core/api.js';
import { AUDIT_LABELS } from '../core/audit.js';
import { crmEstadoMeta } from '../core/crm.js';
import { $, $$, copyToClipboard, escapeHtml, haptic, toast } from '../core/dom.js';
import { avatarTone, initialsFor } from '../core/format.js';
import { icon } from '../core/icons.js';
import { newPasswordError } from '../core/password.js';
import { navigate } from '../core/router.js';
import { setPullToRefresh } from '../core/screen.js';
import { sesion } from '../core/session.js';
import { buildSegmented } from '../ui/controls.js';
import { openProfileSheet } from '../ui/profile.js';
import { ActionSheet, contextSheet } from '../ui/sheet.js';

const AREA_LABELS = { all: 'Todas', admisiones: 'Admisiones', ti: 'TI', posgrados: 'Posgrados' };
function areaLabel(area) { return AREA_LABELS[area] ?? (area ? area[0].toUpperCase() + area.slice(1) : 'Todas'); }

/* ============= USUARIOS (admin) ============= */
async function renderUsuarios(main) {
  if (sesion.user.role !== 'admin') { navigate('home'); return; }

  main.innerHTML = `
    <div class="page-header">
      <div><h1>👥 Gestión de usuarios</h1><div class="subtitle">Administra los asesores con acceso al sistema</div></div>
      <button class="btn btn-primary" id="newUserBtn">+ Nuevo usuario</button>
    </div>

    <div id="newUserPanel" class="hidden tool-panel" style="margin-bottom: 24px;">
      <h2>Crear nuevo usuario</h2>
      <form id="newUserForm">
        <div class="field"><label for="nUsername">Usuario</label><input type="text" id="nUsername" autocomplete="off" required></div>
        <div class="field"><label for="nFullName">Nombre completo</label><input type="text" id="nFullName" required></div>
        <div class="field"><label for="nEmail">Email (opcional)</label><input type="email" id="nEmail"></div>
        <div class="field"><label for="nPassword">Contraseña inicial</label><input type="password" id="nPassword" autocomplete="new-password" minlength="12" maxlength="72" aria-describedby="nPasswordHelp" required><div class="field-help" id="nPasswordHelp">Entre 12 caracteres y 72 bytes. Los acentos y emojis ocupan más de un byte.</div></div>
        <div class="field"><div id="nRoleLabel">Rol</div><div id="nRoleWrap" role="group" aria-labelledby="nRoleLabel"></div></div>
        <div class="field"><div id="nAreaLabel">Área</div><div id="nAreaWrap" role="group" aria-labelledby="nAreaLabel"></div></div>
        <div id="newUserAlert" role="alert" aria-live="polite"></div>
        <div style="display: flex; gap: 8px;">
          <button type="submit" class="btn btn-primary" id="createUserBtn">Crear usuario</button>
          <button type="button" class="btn btn-ghost" id="cancelNewUser">Cancelar</button>
        </div>
      </form>
    </div>

    <div id="usersTable"></div>
  `;

  setPullToRefresh(() => loadUsers());
  let loadSeq = 0;
  async function loadUsers() {
    const table = main.querySelector('#usersTable');
    if (!table) return;
    const seq = ++loadSeq;
    table.innerHTML = `<div class="crm-grid stagger-in">${Array.from({ length: 4 }).map(() => `
      <div class="crm-card advisor-card">
        <div class="skeleton" style="width:56px;height:56px;border-radius:50%;margin-bottom:12px;"></div>
        <div class="skeleton skeleton-line" style="width:70%;height:14px;margin-bottom:8px;"></div>
        <div class="skeleton skeleton-line" style="width:90%;height:11px;"></div>
      </div>
    `).join('')}</div>`;

    let users, auditSummary, fichasMap;
    try {
      [users, auditSummary, fichasMap] = await Promise.all([
        api('/api/auth/users').then(async r => {
          if (!r?.ok) throw new Error('No se pudieron cargar los usuarios');
          const data = await r.json();
          if (!Array.isArray(data.users)) throw new Error('Respuesta inválida');
          return data.users;
        }),
        api('/api/tools/audit/summary?days=7').then(r => r?.ok ? r.json() : {}).then(d => d.summary ?? {}).catch(() => ({})),
        api('/api/tools/crm/fichas').then(r => r?.ok ? r.json() : {}).then(d => d.fichas ?? {}).catch(() => ({})),
      ]);
    } catch {
      if (seq === loadSeq && main.querySelector('#usersTable')) {
        $('#usersTable').innerHTML = '<div class="alert alert-error" role="alert">No se pudieron cargar los asesores. <button type="button" class="btn btn-secondary" id="retryUsers">Reintentar</button></div>';
        $('#retryUsers').addEventListener('click', loadUsers);
      }
      return;
    }
    if (seq !== loadSeq || !main.querySelector('#usersTable')) return;

    // Cartera de cada asesor: cuántos prospectos tiene asignados y en qué etapa.
    // Es el dato que un jefe pregunta primero y que la auditoría sola no responde
    // (la auditoría cuenta acciones, no personas a cargo).
    const cartera = {};
    Object.values(fichasMap).forEach((f) => {
      if (!f.asignadoA) return;
      const c = (cartera[f.asignadoA] ??= { total: 0, porEstado: {} });
      c.total++;
      c.porEstado[f.estado] = (c.porEstado[f.estado] ?? 0) + 1;
    });

    const deleteUser = (username) => {
      ActionSheet.open({
        title: `¿Eliminar "${username}"?`,
        subtitle: 'Esta acción no se puede deshacer. El usuario perderá acceso al panel.',
        groups: [
          [{ label: 'Eliminar usuario', icon: icon('trash', 16), destructive: true, onClick: async () => {
            haptic([20, 30, 20]);
            try {
              const r = await api(`/api/auth/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
              if (!r?.ok) throw new Error();
              toast('Usuario eliminado');
              haptic(15);
              loadUsers();
            } catch { toast('No se pudo eliminar'); haptic([20, 30, 20]); }
          } }],
          [{ label: 'Cancelar', cancel: true }],
        ],
      });
    };

    const openAdvisorProfile = (u) => {
      const counts = auditSummary[u.username] ?? {};
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const actionKeys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
      openProfileSheet({
        avatarBg: avatarTone(u.username), avatarText: initialsFor(u.username, u.fullName),
        title: u.fullName, subtitle: `@${u.username}`,
        badges: [
          { label: u.role === 'admin' ? 'Administrador' : 'Asesor', color: u.role === 'admin' ? '#7c3aed' : '#0284c7' },
          { label: u.area && u.area !== 'all' ? areaLabel(u.area) : 'Todas las áreas', color: '#64748b' },
        ],
        stats: [
          { value: total, label: 'Acciones · 7 días' },
          { value: cartera[u.username]?.total ?? 0, label: 'Prospectos a cargo' },
          { value: cartera[u.username]?.porEstado?.inscrito ?? 0, label: 'Inscritos' },
        ],
        rows: [
          ...(u.email ? [{ icon: '📧', label: 'Email', value: u.email }] : []),
          ...actionKeys.map(k => {
            const fallback = k === 'recordatorio_enviado' ? { label: 'Recordatorio enviado', icon: '⏰' } : null;
            return { icon: AUDIT_LABELS[k]?.icon ?? fallback?.icon ?? '📊', label: AUDIT_LABELS[k]?.label ?? fallback?.label ?? k, value: counts[k] };
          }),
          ...(actionKeys.length === 0 ? [{ icon: '💤', label: 'Actividad', value: 'Sin acciones en los últimos 7 días' }] : []),
          ...Object.entries(cartera[u.username]?.porEstado ?? {}).map(([estado, n]) => {
            const em = crmEstadoMeta(estado);
            return { icon: em.icon, label: `Prospectos en "${em.label}"`, value: n };
          }),
        ],
        actions: [
          { label: 'Copiar usuario', icon: '🔗', onClick: () => copyToClipboard(u.username, 'Usuario copiado'), closeAfter: false },
          ...(u.username !== sesion.user.username ? [{ label: 'Eliminar usuario', icon: '🗑️', destructive: true, onClick: () => deleteUser(u.username) }] : []),
        ],
      });
    };

    if (users.length === 0) {
      $('#usersTable').innerHTML = `
        <div class="empty-state">
          <span class="empty-state-icon">👥</span>
          <div class="empty-state-title">No hay usuarios</div>
          <div class="empty-state-sub">Aún no se ha creado ningún asesor. Usa el botón "Nuevo usuario" para agregar el primero.</div>
        </div>`;
    } else {
      $('#usersTable').innerHTML = `
        <div class="crm-grid stagger-in">
          ${users.map(u => {
            const counts = auditSummary[u.username] ?? {};
            const total = Object.values(counts).reduce((a, b) => a + b, 0);
            return `
            <div class="crm-card advisor-card" data-longpress data-username="${escapeHtml(u.username)}" tabindex="0" role="button" aria-label="Ver perfil de ${escapeHtml(u.fullName)}">
              <div class="advisor-card-top">
                <div class="avatar" style="background:${avatarTone(u.username)};width:52px;height:52px;font-size:17px;">${escapeHtml(initialsFor(u.username, u.fullName))}</div>
                <span class="badge ${u.role === 'admin' ? 'admin' : 'asesor'}">${u.role === 'admin' ? 'Admin' : 'Asesor'}</span>
              </div>
              <div class="crm-card-name">${escapeHtml(u.fullName)}</div>
              <div class="crm-card-row">@${escapeHtml(u.username)}</div>
              ${u.email ? `<div class="crm-card-row">✉️ ${escapeHtml(u.email)}</div>` : ''}
              <div class="advisor-stat-strip">
                <div class="advisor-stat"><div class="advisor-stat-value">${total}</div><div class="advisor-stat-label">acciones · 7d</div></div>
                <div class="advisor-stat"><div class="advisor-stat-value">${cartera[u.username]?.total ?? 0}</div><div class="advisor-stat-label">a cargo</div></div>
                <div class="advisor-stat"><div class="advisor-stat-value">${escapeHtml(areaLabel(u.area))}</div><div class="advisor-stat-label">área</div></div>
              </div>
            </div>
          `; }).join('')}
        </div>
      `;
    }
    $$('.advisor-card[data-longpress]').forEach(card => {
      const username = card.dataset.username;
      const u = users.find(x => x.username === username);
      card.addEventListener('click', () => openAdvisorProfile(u));
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAdvisorProfile(u); } });
      const actions = [
        { label: 'Ver perfil', icon: '👤', onClick: () => openAdvisorProfile(u) },
        { label: 'Copiar usuario', icon: '🔗', onClick: () => copyToClipboard(username, 'Usuario copiado') },
      ];
      if (u.email) actions.push({ label: 'Copiar email', icon: '📧', onClick: () => copyToClipboard(u.email, 'Email copiado') });
      if (username !== sesion.user.username) actions.push({ label: 'Eliminar usuario', icon: '🗑️', destructive: true, onClick: () => deleteUser(username) });
      contextSheet(card, { title: u.fullName, subtitle: username, actions });
    });
  }

  let nRoleVal = 'asesor';
  let nAreaVal = 'all';
  const nRoleSeg = buildSegmented(
    [{ value: 'asesor', label: 'Asesor' }, { value: 'admin', label: 'Admin' }],
    nRoleVal, v => { nRoleVal = v; },
  );
  const nAreaSeg = buildSegmented(
    [{ value: 'all', label: 'Todas' }, { value: 'ti', label: 'TI' }, { value: 'admisiones', label: 'Admisiones' }],
    nAreaVal, v => { nAreaVal = v; },
  );
  $('#nRoleWrap').appendChild(nRoleSeg);
  $('#nAreaWrap').appendChild(nAreaSeg);
  function fixSegThumb(seg) {
    const active = seg.querySelector('button.active');
    const thumb = seg.querySelector('.segmented-thumb');
    if (active && thumb) { thumb.style.left = `${active.offsetLeft}px`; thumb.style.width = `${active.offsetWidth}px`; }
  }
  $('#newUserBtn').addEventListener('click', () => {
    $('#newUserPanel').classList.remove('hidden');
    requestAnimationFrame(() => { fixSegThumb(nRoleSeg); fixSegThumb(nAreaSeg); });
  });
  $('#cancelNewUser').addEventListener('click', () => $('#newUserPanel').classList.add('hidden'));
  $('#nPassword').addEventListener('input', () => $('#nPassword').removeAttribute('aria-invalid'));

  $('#newUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const passwordInput = $('#nPassword');
    const policyError = newPasswordError(passwordInput.value);
    if (policyError) {
      passwordInput.setAttribute('aria-invalid', 'true');
      $('#newUserAlert').textContent = policyError;
      passwordInput.focus();
      return;
    }
    const submit = $('#createUserBtn');
    submit.disabled = true;
    $('#newUserAlert').textContent = '';
    try {
      const r = await api('/api/auth/users', {
        method: 'POST',
        body: JSON.stringify({
          username: $('#nUsername').value.trim(),
          fullName: $('#nFullName').value.trim(),
          email: $('#nEmail').value.trim() || undefined,
          password: $('#nPassword').value,
          role: nRoleVal,
          area: nAreaVal,
        }),
      });
      if (!main.querySelector('#newUserPanel')) return;
      if (!r?.ok) {
        const err = await r?.json().catch(() => ({}));
        $('#newUserAlert').textContent = err?.error || 'No se pudo crear el usuario';
        return;
      }
      $('#newUserPanel').classList.add('hidden');
      $('#newUserForm').reset();
      loadUsers();
    } catch {
      if (main.querySelector('#newUserAlert')) $('#newUserAlert').textContent = 'Sin conexión con el servidor. Intenta de nuevo.';
    } finally {
      submit.disabled = false;
    }
  });

  loadUsers();
}

export { renderUsuarios };
