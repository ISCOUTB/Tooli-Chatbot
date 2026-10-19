import { $, escapeHtml, haptic } from '../core/dom.js';
import { icon } from '../core/icons.js';

/* ============= PERFIL (asesor / estudiante) ============= */
/* Modal genérico de "perfil" reutilizado por Asesores y por el CRM de
   estudiantes: avatar grande, insignias, métricas y una lista de datos —
   siempre con la información real ya disponible, nunca inventada. */
function openProfileSheet({ avatarBg, avatarText, title, subtitle, badges = [], stats = [], rows = [], actions = [], extraHtml = '', onMount }) {
  haptic(15);
  const focoPrevio = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'profile-sheet-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', String(title));
  overlay.innerHTML = `
    <div class="profile-sheet">
      <button type="button" class="profile-sheet-close" aria-label="Cerrar">${icon('x', 16)}</button>
      <div class="profile-sheet-header">
        <div class="avatar" style="background:${avatarBg};width:64px;height:64px;font-size:22px;">${escapeHtml(avatarText)}</div>
        <div class="profile-sheet-title">${escapeHtml(title)}</div>
        ${subtitle ? `<div class="profile-sheet-subtitle">${escapeHtml(subtitle)}</div>` : ''}
        ${badges.length ? `<div class="profile-sheet-badges">${badges.map(b => `<span class="badge" style="background:${b.color}22;color:${b.color};">${escapeHtml(b.label)}</span>`).join('')}</div>` : ''}
      </div>
      ${stats.length ? `<div class="profile-sheet-stats">${stats.map(s => `<div class="profile-sheet-stat"><div class="value">${escapeHtml(String(s.value))}</div><div class="label">${escapeHtml(s.label)}</div></div>`).join('')}</div>` : ''}
      ${rows.length ? `<div class="profile-sheet-rows">${rows.map(r => `<div class="profile-sheet-row"><span class="profile-sheet-row-icon">${r.icon ?? ''}</span><span class="profile-sheet-row-label">${escapeHtml(r.label)}</span><span class="profile-sheet-row-value">${escapeHtml(String(r.value ?? '—'))}</span></div>`).join('')}</div>` : ''}
      ${extraHtml}
      ${actions.length ? `<div class="profile-sheet-actions">${actions.map((a, i) => `<button type="button" class="btn ${a.primary ? 'btn-primary' : 'btn-secondary'}" style="${a.destructive ? 'color:var(--danger);border-color:var(--danger);' : ''}" data-pa="${i}">${a.icon ?? ''} ${escapeHtml(a.label)}</button>`).join('')}</div>` : ''}
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  const close = () => {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 260);
    document.removeEventListener('keydown', onKey);
    if (focoPrevio?.isConnected) focoPrevio.focus({ preventScroll: true });
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    const controles = Array.from(overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter(el => !el.disabled && el.getClientRects().length);
    if (!controles.length) return;
    const primero = controles[0];
    const ultimo = controles[controles.length - 1];
    if (e.shiftKey && (document.activeElement === primero || !overlay.contains(document.activeElement))) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && (document.activeElement === ultimo || !overlay.contains(document.activeElement))) { e.preventDefault(); primero.focus(); }
  };
  overlay.querySelector('.profile-sheet-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  actions.forEach((a, i) => overlay.querySelector(`[data-pa="${i}"]`)?.addEventListener('click', () => {
    a.onClick?.();
    if (a.closeAfter !== false) close();
  }));
  onMount?.(overlay.querySelector('.profile-sheet'), { close });
  overlay.querySelector('.profile-sheet-close')?.focus({ preventScroll: true });
  return { close };
}

export { openProfileSheet };
