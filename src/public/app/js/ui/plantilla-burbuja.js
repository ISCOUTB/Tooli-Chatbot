import { escapeHtml } from '../core/dom.js';
import { formatWhatsApp } from '../core/format.js';
import { icon } from '../core/icons.js';
import { llenarTexto, partesPlantilla } from '../core/plantillas.js';

/* Cómo se ve una plantilla en el WhatsApp de la persona. La usan la pantalla
   Plantillas y la ventana de enviar plantilla del chat de Atención. */

/** El cuerpo con formato de WhatsApp y las variables resaltadas. */
function cuerpoHtml(texto) {
  return formatWhatsApp(escapeHtml(texto)).replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, '<span class="plt-variable">{{$1}}</span>');
}

/** `valores`: { 'cuerpo:1': 'Ana', … } para mostrar el mensaje como le llega a alguien. */
function burbujaHtml(plantilla, valores = null) {
  const original = partesPlantilla(plantilla);
  const p = { ...original, encabezado: llenarTexto(original.encabezado, valores, 'encabezado'), cuerpo: llenarTexto(original.cuerpo, valores, 'cuerpo') };
  return `
    <div class="plt-burbuja">
      ${p.encabezadoMedia === 'IMAGE' && p.encabezadoEjemplo
        ? `<img class="plt-media-img" src="${escapeHtml(p.encabezadoEjemplo)}" alt="Imagen que acompaña la plantilla" loading="lazy" referrerpolicy="no-referrer">`
        : p.encabezadoMedia ? `<div class="plt-media">${icon('paperclip', 16)} ${p.encabezadoMedia === 'VIDEO' ? 'Video' : p.encabezadoMedia === 'DOCUMENT' ? 'Documento' : 'Archivo'}</div>` : ''}
      ${p.encabezado ? `<div class="plt-encabezado">${cuerpoHtml(p.encabezado)}</div>` : ''}
      <div class="plt-cuerpo">${p.cuerpo ? cuerpoHtml(p.cuerpo) : '<em>Sin texto</em>'}</div>
      ${p.pie ? `<div class="plt-pie">${escapeHtml(p.pie)}</div>` : ''}
    </div>
    ${p.botones.length ? `<div class="plt-botones">${p.botones.map(b => `<span>${b.tipo === 'URL' ? icon('external', 13) : b.tipo === 'PHONE_NUMBER' ? icon('phone', 13) : ''} ${escapeHtml(b.texto)}</span>`).join('')}</div>` : ''}`;
}

export { burbujaHtml, cuerpoHtml };
