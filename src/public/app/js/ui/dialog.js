import { icon } from '../core/icons.js';
import { escapeHtml } from '../core/dom.js';

/* Diálogo modal para formularios: foco atrapado, Escape y clic fuera cierran,
   y al cerrar el foco vuelve a quien lo abrió. Reusa el estilo del cambio de
   contraseña para que todos los formularios del panel se vean igual. */
function abrirDialogo({ titulo, ayuda = '', cuerpo = '', ancho = false, alCerrar = null }) {
  const focoPrevio = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'password-dialog-backdrop';
  const idTitulo = `dlg${Math.random().toString(36).slice(2, 9)}`;
  overlay.innerHTML = `
    <div class="password-dialog${ancho ? ' dialogo-ancho' : ''}" role="dialog" aria-modal="true" aria-labelledby="${idTitulo}">
      <button type="button" class="password-dialog-close" data-cerrar aria-label="Cerrar">${icon('x', 18)}</button>
      <h2 id="${idTitulo}">${escapeHtml(titulo)}</h2>
      ${ayuda ? `<p class="password-dialog-help">${escapeHtml(ayuda)}</p>` : ''}
      <div class="dialogo-cuerpo">${cuerpo}</div>
    </div>`;
  document.body.appendChild(overlay);
  const dialogo = overlay.querySelector('.password-dialog');
  let cerrado = false;
  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    document.removeEventListener('keydown', alTeclear);
    window.removeEventListener('hashchange', cerrar);
    overlay.remove();
    if (focoPrevio?.isConnected) focoPrevio.focus({ preventScroll: true });
    alCerrar?.();
  };
  const alTeclear = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); cerrar(); return; }
    if (event.key !== 'Tab') return;
    const focos = Array.from(dialogo.querySelectorAll('button, input, select, textarea, a[href]'))
      .filter(el => !el.disabled && el.getClientRects().length);
    if (!focos.length) return;
    const primero = focos[0];
    const ultimo = focos[focos.length - 1];
    const fuera = !dialogo.contains(document.activeElement);
    if (event.shiftKey && (document.activeElement === primero || fuera)) { event.preventDefault(); ultimo.focus(); }
    else if (!event.shiftKey && (document.activeElement === ultimo || fuera)) { event.preventDefault(); primero.focus(); }
  };
  document.addEventListener('keydown', alTeclear);
  window.addEventListener('hashchange', cerrar);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay || event.target.closest('[data-cerrar]')) cerrar();
  });
  requestAnimationFrame(() => overlay.classList.add('open'));
  setTimeout(() => {
    const inicial = dialogo.querySelector('[autofocus], input:not([type="hidden"]):not([type="file"]), select, textarea');
    (inicial ?? dialogo.querySelector('.password-dialog-close'))?.focus({ preventScroll: true });
  }, 60);
  return { el: dialogo, cerrar, abierto: () => !cerrado };
}

export { abrirDialogo };
