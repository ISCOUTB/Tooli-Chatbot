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

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

export { $, $$, haptic, toast, copyToClipboard, escapeHtml, loadScript };
