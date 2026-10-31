const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function haptic(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* La vibración es opcional. */ }
}

function toast(msg, ms = 2200) {
  const stack = $('#toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 260);
  }, ms);
}

async function copyToClipboard(text, label = 'Copiado') {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    toast(`${label} ✓`);
    haptic(15);
  } catch {
    toast('No se pudo copiar');
  }
}

/* Tooltip flotante ("ventana de texto") — hover en desktop, tap en touch */

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* Los emojis que acompañan texto son decorativos: siguen visibles sin
   duplicar o entorpecer el nombre que anuncia el lector de pantalla. */
function emoji(caracter) {
  return `<span aria-hidden="true">${escapeHtml(caracter)}</span>`;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existente = document.querySelector(`script[src="${src}"]`);
    if (existente) {
      if (existente.dataset.tooliCargado === 'true') { resolve(); return; }
      existente.addEventListener('load', () => { existente.dataset.tooliCargado = 'true'; resolve(); }, { once: true });
      existente.addEventListener('error', () => { existente.remove(); reject(new Error('script_no_disponible')); }, { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => { s.dataset.tooliCargado = 'true'; resolve(); };
    s.onerror = () => { s.remove(); reject(new Error('script_no_disponible')); };
    document.head.appendChild(s);
  });
}

export { $, $$, haptic, toast, copyToClipboard, emoji, escapeHtml, loadScript };
