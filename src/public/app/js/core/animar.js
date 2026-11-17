/* Animaciones del panel que necesitan JavaScript: cifras que cuentan, entradas
   escalonadas solo la primera vez y resaltado de lo que acaba de llegar.

   Todas se apagan para quien pide menos movimiento en su sistema. Las que son
   solo CSS viven en styles.css (sección «Animaciones»), y la regla global de
   `prefers-reduced-motion` de ese archivo también las apaga. Los colores son
   los de marca ya definidos: el turquesa de Tooli y el azul UTB. */

function movimientoReducido() {
  try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; } catch { return false; }
}

/** El número que muestra un texto como "1.234" o "203"; null si no es una cifra. */
function leerCifra(texto) {
  const limpio = String(texto ?? '').trim().replace(/\./g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(limpio)) return null;
  return Number(limpio);
}

function formatoCifra(n) {
  return Math.round(n).toLocaleString('es-CO');
}

/**
 * Cuenta de `desde` a `hasta` en el elemento. Si el texto no es una cifra
 * (por ejemplo "—") lo deja como está.
 */
function contarHasta(el, hasta, desde = 0, duracion = 700) {
  if (!el || !Number.isFinite(hasta)) return;
  if (movimientoReducido() || desde === hasta) { el.textContent = formatoCifra(hasta); return; }
  // Arranca ya en el valor inicial: si no, se vería la cifra final un instante.
  el.textContent = formatoCifra(desde);
  const t0 = performance.now();
  const paso = (ahora) => {
    if (!el.isConnected) return;
    const p = Math.min(1, (ahora - t0) / duracion);
    const suave = 1 - Math.pow(1 - p, 3);
    el.textContent = formatoCifra(desde + (hasta - desde) * suave);
    if (p < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}

/** Hace contar desde cero todas las cifras que encuentre con `selector`. */
function contarCifras(raiz, selector) {
  raiz?.querySelectorAll(selector).forEach((el) => {
    const valor = leerCifra(el.textContent);
    if (valor !== null) contarHasta(el, valor, 0);
  });
}

/**
 * Las tarjetas de un contenedor entran escalonadas. Se usa solo en la primera
 * carga de una pantalla: si se repinta sola, no vuelve a animar.
 */
function entradaEscalonada(contenedor) {
  if (!contenedor || movimientoReducido()) return;
  contenedor.classList.remove('entrada-escalonada');
  void contenedor.offsetWidth;   // reinicia la animación si ya estaba
  contenedor.classList.add('entrada-escalonada');
  setTimeout(() => contenedor.classList.remove('entrada-escalonada'), 1100);
}

/** Destaca un elemento que acaba de aparecer (una persona nueva en la lista). */
function resaltar(el) {
  if (!el || movimientoReducido()) return;
  el.classList.remove('recien-llegado');
  void el.offsetWidth;
  el.classList.add('recien-llegado');
  setTimeout(() => el.classList.remove('recien-llegado'), 1800);
}

/** Un pequeño salto para avisar que una cifra cambió. */
function rebotar(el) {
  if (!el || movimientoReducido()) return;
  el.classList.remove('rebote');
  void el.offsetWidth;
  el.classList.add('rebote');
  setTimeout(() => el.classList.remove('rebote'), 600);
}

export { movimientoReducido, leerCifra, formatoCifra, contarHasta, contarCifras, entradaEscalonada, resaltar, rebotar };
