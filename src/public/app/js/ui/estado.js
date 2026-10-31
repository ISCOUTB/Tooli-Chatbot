/* Estados de carga y error compartidos por las pantallas del panel (fase 3,
   "datos confiables"): un error siempre dice qué pasó en lenguaje del asesor y
   ofrece "Reintentar"; un dato que falta se avisa como parcial, nunca se
   reemplaza por un cero o un "Nuevo" que parezcan reales. Inicio usa el mismo
   criterio con sus propios estilos (.ini-error). */

import { escapeHtml } from '../core/dom.js';

function htmlError(mensaje, { reintentar = true } = {}) {
  return `<div class="alert alert-error estado-mensaje" role="alert"><span>${escapeHtml(mensaje)}</span>${reintentar ? '<button type="button" class="btn btn-secondary" data-reintentar>Reintentar</button>' : ''}</div>`;
}

function htmlAvisoParcial(mensaje) {
  return `<div class="alert alert-warning estado-mensaje" role="status"><span>${escapeHtml(mensaje)}</span><button type="button" class="btn btn-secondary" data-reintentar>Reintentar</button></div>`;
}

function conectarReintento(contenedor, fn) {
  contenedor?.querySelectorAll('[data-reintentar]').forEach((boton) => boton.addEventListener('click', fn));
}

function marcarCargando(elemento, cargando) {
  if (!elemento) return;
  if (cargando) elemento.setAttribute('aria-busy', 'true');
  else elemento.removeAttribute('aria-busy');
}

export { conectarReintento, htmlAvisoParcial, htmlError, marcarCargando };
