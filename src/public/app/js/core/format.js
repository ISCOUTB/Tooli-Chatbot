import { $, haptic } from './dom.js';

// Las iniciales son texto pequeño blanco: todos los tonos deben conservar
// contraste AA, incluso en los avatares compactos de la bandeja.
const AVATAR_TONES = ['#0369a1', '#6d28d9', '#047857', '#b45309', '#be185d', '#0f766e'];

function rgbDesdeHex(hex) {
  const valor = String(hex).trim().replace(/^#/, '');
  if (!/^[\da-f]{6}$/i.test(valor)) return null;
  return [0, 2, 4].map(i => parseInt(valor.slice(i, i + 2), 16));
}

function luminancia(rgb) {
  const canales = rgb.map(c => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * canales[0] + 0.7152 * canales[1] + 0.0722 * canales[2];
}

function contraste(a, b) {
  const [clara, oscura] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (clara + 0.05) / (oscura + 0.05);
}

/* Conserva el matiz de una etiqueta, pero oscurece su texto hasta que pase AA
   tanto sobre blanco como sobre los fondos pálidos usados por los badges. */
function colorTextoLegible(hex) {
  const base = rgbDesdeHex(hex);
  if (!base) return '#1f2937';
  const blanco = [255, 255, 255];
  const fondos = [0x1f, 0x22].map(alpha => base.map(c => Math.round(c * alpha / 255 + 255 * (1 - alpha / 255))));
  let factor = 1;
  let candidato = base;
  while ([blanco, ...fondos].some(fondo => contraste(candidato, fondo) < 4.5) && factor > 0) {
    factor -= 0.01;
    candidato = base.map(c => Math.max(0, Math.round(c * factor)));
  }
  return `#${candidato.map(c => c.toString(16).padStart(2, '0')).join('')}`;
}
function avatarTone(seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}
function initialsFor(phone, nombre) {
  if (nombre) return nombre.trim().split(/\s+/).slice(0, 2).map(s => s[0]).join('').toUpperCase();
  return String(phone).slice(-2);
}
function relativeTime(ts) {
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h`;
  const days = Math.round(hr / 24);
  if (days < 7) return `${days} d`;
  return new Date(ts).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}
function friendlyDate(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}


/* Teléfono legible: 573001234567 → +57 300 123 4567. Lo que no es un celular
   colombiano se muestra con + y sin agrupar, para no inventarle un formato. */
function formatTelefono(phone) {
  const digitos = String(phone ?? '').replace(/\D/g, '');
  if (!digitos) return '';
  const co = digitos.match(/^57(3\d{2})(\d{3})(\d{4})$/);
  return co ? `+57 ${co[1]} ${co[2]} ${co[3]}` : `+${digitos}`;
}

/* Marcado de WhatsApp para la vista previa: *negrita*, _cursiva_, ~tachado~ y
   ```monoespaciado```. Se aplica SIEMPRE sobre texto ya escapado — nunca sobre
   texto crudo — así el formato no abre una vía de inyección de HTML. */
function formatWhatsApp(textoEscapado) {
  return textoEscapado
    .replace(/```([\s\S]+?)```/g, '<code>$1</code>')
    .replace(/(^|\s)\*(\S[^*]*?)\*(?=$|\s|[.,!?])/g, '$1<strong>$2</strong>')
    .replace(/(^|\s)_(\S[^_]*?)_(?=$|\s|[.,!?])/g, '$1<em>$2</em>')
    .replace(/(^|\s)~(\S[^~]*?)~(?=$|\s|[.,!?])/g, '$1<s>$2</s>')
    .replace(/\n/g, '<br>');
}

/* Exportar el CRM a CSV — lo que un coordinador necesita para cruzar datos en
   Excel o pasarle la lista a alguien que no entra al panel. Exporta lo que se
   está viendo (filtros y búsqueda aplicados), no toda la base, para que el
   archivo coincida con lo que la persona tiene en pantalla. */
function csvEscape(v) {
  const t = String(v ?? '');
  return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** Arma el CSV y lo descarga. Separador ";" y BOM: es lo que espera Excel en
    configuración regional de Colombia. */
function descargarCsv(nombreArchivo, cabecera, filas) {
  const lineas = [cabecera.join(';'), ...filas.map(f => f.map(csvEscape).join(';'))];
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  haptic([10, 20, 10]);
}

/** Fecha legible para Excel: el ISO crudo con T y Z no ordena bien en español. */
function fechaParaCsv(raw) {
  // Una celda sin fecha tiene que salir vacía en el CSV. Sin esta guarda,
  // new Date(null) es el epoch y la exportación mostraba "1969-12-31 19:00"
  // en las filas viejas del Sheet que no traen fecha.
  if (raw === null || raw === undefined || raw === '') return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export { AVATAR_TONES, avatarTone, colorTextoLegible, initialsFor, relativeTime, friendlyDate, formatTelefono, formatWhatsApp, csvEscape, descargarCsv, fechaParaCsv };
