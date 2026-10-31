import { $, emoji, escapeHtml, haptic } from '../core/dom.js';

function attachTooltip(el, text) {
  if (!text) return;
  el.classList.add('tt-anchor');
  const bubble = document.createElement('span');
  bubble.className = 'tt-bubble';
  bubble.textContent = text;
  el.appendChild(bubble);
  const show = () => el.classList.add('tt-visible');
  const hide = () => el.classList.remove('tt-visible');
  el.addEventListener('mouseenter', show);
  el.addEventListener('mouseleave', hide);
  el.addEventListener('touchstart', (e) => { e.stopPropagation(); show(); setTimeout(hide, 1800); }, { passive: true });
}

/* Control segmentado estilo iOS (reemplaza <select> simples) */
function buildSegmented(options, activeValue, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'segmented';
  wrap.setAttribute('role', 'group');
  const thumb = document.createElement('div');
  thumb.className = 'segmented-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  wrap.appendChild(thumb);
  const buttons = options.map(opt => {
    const btn = document.createElement('button');
    btn.type = 'button';
    if (opt.icon) btn.innerHTML = `${emoji(opt.icon)} ${escapeHtml(opt.label)}`;
    else btn.textContent = opt.label;
    btn.dataset.value = opt.value;
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) return;
      haptic(10);
      setActive(opt.value);
      onChange(opt.value);
    });
    wrap.appendChild(btn);
    return btn;
  });
  function setActive(value) {
    buttons.forEach(b => {
      const active = b.dataset.value === value;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    const activeBtn = buttons.find(b => b.dataset.value === value);
    if (activeBtn) { thumb.style.left = `${activeBtn.offsetLeft}px`; thumb.style.width = `${activeBtn.offsetWidth}px`; }
    // Si el control se desliza de lado, la opción activa siempre queda a la vista.
    if (activeBtn && wrap.scrollWidth > wrap.clientWidth) {
      const desdeIzq = activeBtn.offsetLeft - 36;
      const hastaDer = activeBtn.offsetLeft + activeBtn.offsetWidth + 36 - wrap.clientWidth;
      if (wrap.scrollLeft > desdeIzq) wrap.scrollLeft = Math.max(0, desdeIzq);
      else if (wrap.scrollLeft < hastaDer) wrap.scrollLeft = hastaDer;
    }
  }
  // Con más opciones de las que caben, un degradado en el borde avisa que hay
  // más: antes quedaban cortadas sin ninguna pista ("Event…", "Maes…").
  function marcarDesborde() {
    const restante = wrap.scrollWidth - wrap.clientWidth - wrap.scrollLeft;
    wrap.classList.toggle('mas-antes', wrap.scrollLeft > 1);
    wrap.classList.toggle('mas-despues', restante > 1);
  }
  wrap.addEventListener('scroll', marcarDesborde, { passive: true });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(marcarDesborde).observe(wrap);
  // El estado accesible debe existir al insertar el control; solo la posición
  // del thumb necesita esperar a que el elemento tenga medidas en el DOM.
  setActive(activeValue);
  requestAnimationFrame(() => setActive(activeValue));
  return wrap;
}

/* Contador animado (ease-out cúbico) para los números de las stat cards */
function countUp(el, to, duration = 650) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = to;
    return;
  }
  const from = 0;
  const t0 = performance.now();
  function frame(now) {
    const p = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(frame);
    else el.textContent = to;
  }
  requestAnimationFrame(frame);
}

/* Anillo de progreso circular (espera de descarga de recibo) */
const RING_C = 150.8;
function buildProgressRing(id) {
  return `<div class="progress-ring" id="${id}">
    <svg width="56" height="56" viewBox="0 0 56 56">
      <circle class="track" cx="28" cy="28" r="24"></circle>
      <circle class="fill" id="${id}-fill" cx="28" cy="28" r="24" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}"></circle>
    </svg>
    <span class="pct" id="${id}-pct">0%</span>
  </div>`;
}
function setProgress(id, pct) {
  const fill = document.getElementById(`${id}-fill`);
  const label = document.getElementById(`${id}-pct`);
  if (!fill) return;
  fill.style.strokeDashoffset = String(RING_C - (RING_C * pct / 100));
  if (label) label.textContent = `${Math.round(pct)}%`;
}

/* Check de éxito animado (el trazo del SVG se "dibuja" solo) */
function successCheckSvg() {
  return `<svg class="success-check" viewBox="0 0 66 66" xmlns="http://www.w3.org/2000/svg">
    <circle cx="33" cy="33" r="28"></circle>
    <path d="M19 34l10 10 18-19"></path>
  </svg>`;
}

export { attachTooltip, buildSegmented, countUp, buildProgressRing, setProgress, successCheckSvg, RING_C };
