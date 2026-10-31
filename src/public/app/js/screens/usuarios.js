import { api } from '../core/api.js';
import { AUDIT_LABELS } from '../core/audit.js';
import { crmEstadoMeta } from '../core/crm.js';
import { $, $$, copyToClipboard, emoji, escapeHtml, haptic, toast } from '../core/dom.js';
import { avatarTone, initialsFor } from '../core/format.js';
import { icon } from '../core/icons.js';
import { newPasswordError } from '../core/password.js';
import { normalizarUsuario, sugerirUsuario, validarUsuario } from '../core/usuario.js';
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
      <div><h1>${icon('shield', 26)} Asesores</h1><div class="subtitle">Administra los asesores con acceso al sistema</div></div>
      <button class="btn btn-primary" id="newUserBtn">+ Nuevo usuario</button>
    </div>

    <div id="newUserPanel" class="hidden tool-panel" style="margin-bottom: 24px;">
      <h2>Crear nuevo usuario</h2>
      <form id="newUserForm">
        <div class="field"><label for="nUsername">Usuario</label><div class="username-input"><span aria-hidden="true">@</span><input type="text" id="nUsername" autocomplete="off" maxlength="30" aria-describedby="nUsernameError" required></div><div class="field-help username-error" id="nUsernameError" role="alert"></div></div>
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
  function openEditUser(u) {
    const focoPrevio = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'profile-sheet-overlay advisor-edit-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'editAdvisorTitle');
    overlay.innerHTML = `
      <div class="profile-sheet advisor-edit-dialog">
        <button type="button" class="profile-sheet-close" aria-label="Cerrar">${icon('x', 16)}</button>
        <h2 class="advisor-edit-title" id="editAdvisorTitle">Editar asesor</h2>
        <form id="editAdvisorForm">
          <div class="field"><label for="eUsername">Usuario</label><div class="username-input"><span aria-hidden="true">@</span><input id="eUsername" type="text" maxlength="30" autocomplete="off" value="${escapeHtml(u.username)}" aria-describedby="eUsernameError eUsernameNotice" required></div><div class="field-help username-error" id="eUsernameError" role="alert"></div><div class="advisor-rename-notice hidden" id="eUsernameNotice">La persona deberá entrar con el usuario nuevo; su contraseña no cambia</div></div>
          <div class="field"><label for="eFullName">Nombre visible</label><input id="eFullName" type="text" maxlength="200" value="${escapeHtml(u.fullName)}" required></div>
          <div class="field"><label for="eEmail">Correo</label><input id="eEmail" type="email" maxlength="254" value="${escapeHtml(u.email ?? '')}"></div>
          <div class="field"><div id="eRoleLabel">Rol</div><div id="eRoleWrap" aria-labelledby="eRoleLabel"></div></div>
          <div class="field"><div id="eAreaLabel">Área</div><div id="eAreaWrap" aria-labelledby="eAreaLabel"></div></div>
          <div class="advisor-edit-error" id="editAdvisorError" role="alert" aria-live="polite"></div>
          <div class="advisor-edit-actions"><button type="button" class="btn btn-ghost" id="cancelEditAdvisor">Cancelar</button><button type="submit" class="btn btn-primary" id="saveEditAdvisor">Guardar</button></div>
        </form>
      </div>`;
    document.body.appendChild(overlay);
    const usernameInput = overlay.querySelector('#eUsername');
    const save = overlay.querySelector('#saveEditAdvisor');
    let role = u.role;
    let area = u.area ?? 'all';
    overlay.querySelector('#eRoleWrap').appendChild(buildSegmented([{ value: 'asesor', label: 'Asesor' }, { value: 'admin', label: 'Admin' }], role, value => { role = value; }));
    overlay.querySelector('#eAreaWrap').appendChild(buildSegmented([{ value: 'all', label: 'Todas' }, { value: 'ti', label: 'TI' }, { value: 'admisiones', label: 'Admisiones' }], area, value => { area = value; }));
    const validate = () => {
      const normalized = normalizarUsuario(usernameInput.value);
      const changed = normalized !== u.username;
      const error = changed ? validarUsuario(usernameInput.value) : null;
      overlay.querySelector('#eUsernameError').textContent = error ?? '';
      overlay.querySelector('#eUsernameNotice').classList.toggle('hidden', !changed);
      usernameInput.toggleAttribute('aria-invalid', Boolean(error));
      save.disabled = Boolean(error);
      return !error;
    };
    usernameInput.addEventListener('input', validate);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      overlay.classList.remove('open');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => overlay.remove(), 260);
      const fallback = [...document.querySelectorAll('.advisor-card')].find(card => card.dataset.username === u.username);
      if (focoPrevio?.isConnected) focoPrevio.focus({ preventScroll: true });
      else fallback?.focus({ preventScroll: true });
    };
    const onKey = (event) => {
      if (event.key === 'Escape') { close(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...overlay.querySelectorAll('button, input')].filter(el => !el.disabled);
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    overlay.querySelector('.profile-sheet-close').addEventListener('click', close);
    overlay.querySelector('#cancelEditAdvisor').addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
    overlay.querySelector('#editAdvisorForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!validate()) return;
      save.disabled = true;
      overlay.querySelector('#editAdvisorError').textContent = '';
      const username = normalizarUsuario(usernameInput.value);
      try {
        const response = await api(`/api/auth/users/${encodeURIComponent(u.username)}`, { method: 'PATCH', body: JSON.stringify({ username, fullName: overlay.querySelector('#eFullName').value.trim(), email: overlay.querySelector('#eEmail').value.trim(), role, area }) });
        if (!response?.ok) {
          const error = await response?.json().catch(() => ({}));
          overlay.querySelector('#editAdvisorError').textContent = error?.message || error?.error || 'No se pudo actualizar el asesor';
          return;
        }
        close();
        toast('Asesor actualizado');
        if (u.username === sesion.user.username && username !== u.username) window.location.reload();
        else loadUsers();
      } catch { overlay.querySelector('#editAdvisorError').textContent = 'Sin conexión con el servidor. Intenta de nuevo.'; }
      finally { if (save.isConnected) save.disabled = false; }
    });
    requestAnimationFrame(() => { overlay.classList.add('open'); usernameInput.focus({ preventScroll: true }); validate(); });
  }

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
          { label: 'Editar asesor', icon: '✏️', primary: true, onClick: () => openEditUser(u) },
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
              <div class="crm-card-row">@${escapeHtml(u.username)} · ${u.area && u.area !== 'all' ? escapeHtml(areaLabel(u.area)) : 'Todas las áreas'}</div>
              ${u.email ? `<div class="crm-card-row">${emoji('✉️')}<span class="sr-only">Correo: </span> ${escapeHtml(u.email)}</div>` : ''}
              <!-- El área va junto al usuario: como tercera cifra no cabía y quedaba "Admis…". -->
              <div class="advisor-stat-strip">
                <div class="advisor-stat"><div class="advisor-stat-value">${total}</div><div class="advisor-stat-label">acciones · 7d</div></div>
                <div class="advisor-stat"><div class="advisor-stat-value">${cartera[u.username]?.total ?? 0}</div><div class="advisor-stat-label">a cargo</div></div>
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
        { label: 'Editar asesor', icon: '✏️', onClick: () => openEditUser(u) },
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
  let usernameEdited = false;
  const validateNewUsername = () => {
    const input = $('#nUsername');
    const error = validarUsuario(input.value);
    $('#nUsernameError').textContent = error ?? '';
    input.toggleAttribute('aria-invalid', Boolean(error));
    $('#createUserBtn').disabled = Boolean(error);
    return !error;
  };
  $('#nUsername').addEventListener('input', () => { usernameEdited = true; validateNewUsername(); });
  $('#nFullName').addEventListener('input', () => {
    // Mientras el admin no escriba su propio usuario, se sugiere desde el nombre.
    if (!usernameEdited) $('#nUsername').value = sugerirUsuario($('#nFullName').value);
    validateNewUsername();
  });

  $('#newUserForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateNewUsername()) { $('#nUsername').focus(); return; }
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
          username: normalizarUsuario($('#nUsername').value),
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
        $('#newUserAlert').textContent = err?.message || err?.error || 'No se pudo crear el usuario';
        return;
      }
      $('#newUserPanel').classList.add('hidden');
      $('#newUserForm').reset();
      usernameEdited = false;
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
