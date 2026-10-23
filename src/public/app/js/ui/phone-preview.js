import { api } from '../core/api.js';
import { $, escapeHtml, haptic, toast } from '../core/dom.js';
import { avatarTone, formatWhatsApp, initialsFor } from '../core/format.js';
import { icon } from '../core/icons.js';

/* ============= VISTA PREVIA EN TELÉFONO ============= */
/* Muestra la conversación dentro de un frame de iPhone con la
   apariencia real de WhatsApp, para que el asesor vea exactamente
   lo que ve el estudiante — no una recreación aproximada del hilo. */
function openPhonePreview(phone, nombre, groups) {
  haptic(15);
  const prevFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'phone-preview-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Vista previa de la conversación con ${nombre ?? `+${phone}`}`);
  const now = new Date();
  const clock = now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });

  overlay.innerHTML = `
    <button type="button" class="phone-preview-close" aria-label="Cerrar">${icon('x', 20)}</button>
    <div class="phone-frame">
      <div class="phone-notch"></div>
      <div class="phone-screen">
        <div class="wa-statusbar"><span>${clock}</span><span class="wa-statusbar-icons">📶 📳 🔋</span></div>
        <div class="wa-header">
          <span class="wa-back">${icon('chevronLeft', 20)}</span>
          <div class="avatar" style="background:${avatarTone(phone)};width:34px;height:34px;font-size:13px;">${initialsFor(phone, nombre)}</div>
          <div class="wa-header-name">
            <div>${nombre ? escapeHtml(nombre) : `+${phone}`}</div>
            <div class="wa-header-sub">en línea</div>
          </div>
          <span class="wa-header-icons">📹 📞 ⋮</span>
        </div>
        <div class="wa-messages">
          ${groups.length === 0 ? '<div class="wa-empty">No hay mensajes registrados.</div>' : groups.map(g => g.map((m, i) => `
            <div class="wa-bubble-row ${m.direction === 'out' ? 'me' : 'them'}">
              <div class="wa-bubble ${m.direction === 'out' ? 'me' : 'them'}">
                ${formatWhatsApp(escapeHtml(m.text))}
                <span class="wa-bubble-meta">${new Date(m.ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}${m.direction === 'out' ? ' <span class="wa-ticks">✓✓</span>' : ''}</span>
              </div>
            </div>
          `).join('')).join('')}
        </div>
        <div class="wa-composer">
          <span class="wa-composer-input">Escribe un mensaje</span>
          <span class="wa-composer-mic">🎤</span>
        </div>
        <div class="phone-home-indicator"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  const wrap = overlay.querySelector('.wa-messages');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;

  // El overlay vive en <body>, fuera de #main: navegar sin cerrarlo lo
  // dejaría flotando sobre otra pantalla con sus listeners vivos (Esc.8).
  let cerrada = false;
  let focusTimer = null;
  const close = () => {
    if (cerrada) return;
    cerrada = true;
    if (focusTimer) clearTimeout(focusTimer);
    haptic(10);
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 280);
    document.removeEventListener('keydown', onKey);
    if (typeof window !== 'undefined') window.removeEventListener('hashchange', close);
    // Devolver el foco a quien abrió la vista previa (Esc.1/4).
    if (prevFocus?.isConnected) prevFocus.focus({ preventScroll: true });
  };
  const closeBtn = overlay.querySelector('.phone-preview-close');
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    // Es el único control interactivo del diálogo: Tab no debe escapar hacia
    // la pantalla que permanece detrás del overlay.
    if (e.key === 'Tab') { e.preventDefault(); closeBtn.focus(); }
  };
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  if (typeof window !== 'undefined') window.addEventListener('hashchange', close);
  // Foco inicial al abrir: el botón de cierre es el primer objetivo de
  // teclado dentro del diálogo (Esc.4).
  focusTimer = setTimeout(() => closeBtn.focus({ preventScroll: true }), 60);
}


function groupMessages(msgs) {
  const GROUP_MS = 3 * 60 * 1000;
  const groups = [];
  msgs.forEach((m, i) => {
    const prev = msgs[i - 1];
    const sameGroup = prev && prev.direction === m.direction && (m.ts - prev.ts) < GROUP_MS;
    if (sameGroup) groups[groups.length - 1].push(m); else groups.push([m]);
  });
  return groups;
}

async function previewPhoneFor(phone) {
  try {
    const r = await api(`/api/tools/bot-users/${phone}`);
    const info = await r.json();
    const nombre = info.session?.data?.nombre;
    const msgs = [...info.recentMessages].reverse();
    openPhonePreview(phone, nombre, groupMessages(msgs));
  } catch {
    toast('No se pudo cargar la conversación');
  }
}

export { openPhonePreview, groupMessages, previewPhoneFor };
