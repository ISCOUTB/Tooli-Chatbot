import { $, $$, haptic } from '../core/dom.js';
import { icon } from '../core/icons.js';

const ActionSheet = {
  _escHandler: null,
  open({ title, subtitle, groups }) {
    this.close();
    haptic(12);
    const backdrop = document.createElement('div');
    backdrop.className = 'sheet-backdrop';
    backdrop.id = 'activeSheet';

    const sheet = document.createElement('div');
    sheet.className = 'action-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    if (title) sheet.setAttribute('aria-label', String(title).replace(/<[^>]*>/g, ''));
    // Se recuerda quién tenía el foco para devolvérselo al cerrar: si no, el
    // teclado queda "perdido" al principio de la página tras cada sheet.
    this._focoPrevio = document.activeElement;

    let html = '<div class="sheet-grabber"></div>';
    if (title) {
      html += `<div class="sheet-header"><div class="sheet-title">${title}</div>${subtitle ? `<div class="sheet-subtitle">${subtitle}</div>` : ''}</div>`;
    }
    const flat = [];
    groups.forEach(group => {
      html += '<div class="sheet-group">' + group.map(a => {
        flat.push(a);
        const cls = [a.destructive ? 'destructive' : '', a.cancel ? 'cancel' : ''].filter(Boolean).join(' ');
        return `<button type="button" class="sheet-action ${cls}">${a.icon ? `<span class="sheet-icon">${a.icon}</span>` : ''}${a.label}</button>`;
      }).join('') + '</div>';
    });
    sheet.innerHTML = html;
    backdrop.appendChild(sheet);
    document.body.appendChild(backdrop);

    $$('.sheet-action', sheet).forEach((btn, i) => btn.addEventListener('click', () => {
      this.close();
      flat[i].onClick && flat[i].onClick();
    }));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) this.close(); });

    // Arrastre para cerrar solo desde el grabber/cabecera: antes cualquier toque
    // sobre el sheet iniciaba el arrastre y peleaba con el scroll del contenido
    // (Esc.4). El CSS deja `touch-action: pan-y` en el sheet y `none` en el grabber.
    let startY = null;
    sheet.addEventListener('touchstart', e => {
      startY = e.target.closest('.sheet-grabber, .sheet-header') ? e.touches[0].clientY : null;
    }, { passive: true });
    sheet.addEventListener('touchmove', e => {
      if (startY == null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 0) sheet.style.transform = `translateY(${dy}px)`;
    }, { passive: true });
    sheet.addEventListener('touchend', e => {
      if (startY == null) return;
      const dy = e.changedTouches[0].clientY - startY;
      sheet.style.transform = '';
      startY = null;
      if (dy > 80) this.close();
    });

    // Escape cierra y Tab queda atrapado dentro del diálogo: sin trampa, el
    // foco se escapa a la página de atrás mientras el sheet sigue abierto.
    this._escHandler = (e) => {
      if (e.key === 'Escape') { this.close(); return; }
      if (e.key !== 'Tab') return;
      const botones = $$('.sheet-action', sheet);
      if (!botones.length) return;
      const primero = botones[0];
      const ultimo = botones[botones.length - 1];
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
    };
    document.addEventListener('keydown', this._escHandler);
    requestAnimationFrame(() => backdrop.classList.add('open'));
    // El foco va con temporizador y no con otro requestAnimationFrame: rAF no
    // corre cuando la pestaña está en segundo plano, y entonces el sheet se
    // quedaría sin foco de teclado al volver a ella.
    setTimeout(() => sheet.querySelector('.sheet-action:not(.cancel)')?.focus({ preventScroll: true }), 60);
  },
  close() {
    const el = document.getElementById('activeSheet');
    if (this._escHandler) { document.removeEventListener('keydown', this._escHandler); this._escHandler = null; }
    if (this._focoPrevio?.isConnected) { this._focoPrevio.focus({ preventScroll: true }); }
    this._focoPrevio = null;
    if (!el) return;
    el.classList.remove('open');
    setTimeout(() => el.remove(), 260);
  },
};

function contextSheet(el, { title, subtitle, actions }) {
  attachLongPress(el, () => {
    ActionSheet.open({
      title, subtitle,
      groups: [actions, [{ label: 'Cancelar', cancel: true }]],
    });
  });
}

function attachLongPress(el, handler, opts = {}) {
  const delay = opts.delay ?? 460;
  let timer = null, moved = false, startX = 0, startY = 0, active = false, lastFire = 0;
  el.classList.add('longpressable');
  const clear = () => {
    clearTimeout(timer); timer = null;
    if (active) { el.classList.remove('longpress-active'); active = false; }
  };
  // Antirrebote: el timer y el contextmenu táctil pueden dispararse por el
  // mismo gesto; sin esto el sheet se cierra y reabre (parpadeo) (Esc.4).
  const fire = () => {
    const now = Date.now();
    if (now - lastFire < 800) return;
    lastFire = now;
    handler();
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.isPrimary === false) return;
    moved = false; startX = e.clientX; startY = e.clientY;
    timer = setTimeout(() => {
      if (moved) return;
      active = true;
      el.classList.add('longpress-active');
      const swallowClick = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); };
      el.addEventListener('click', swallowClick, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', swallowClick, { capture: true }), 700);
      fire();
    }, delay);
  });
  el.addEventListener('pointermove', (e) => {
    if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) { moved = true; clear(); }
  });
  el.addEventListener('pointerup', clear);
  el.addEventListener('pointerleave', clear);
  el.addEventListener('pointercancel', clear);
  // Escape cancela el long-press pendiente sin abrir el sheet.
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') clear(); });
  // Clic derecho / tecla Menú en escritorio: el long-press no existe con mouse
  // y antes este menú era inalcanzable sin pantalla táctil (Esc.4).
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    clear();
    fire();
  });
}

export { ActionSheet, contextSheet, attachLongPress };
