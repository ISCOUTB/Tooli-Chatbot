import { escapeHtml } from './dom.js';
import { formatWhatsApp } from './format.js';

/* ============= SIMULADOR DE WHATSAPP: lógica pura =============
   Cómo se pinta cada mensaje del bot (texto, botones, lista, imagen,
   documento, nota de prueba), qué se ve en la burbuja de quien prueba y
   cuándo bajar solo. Sin DOM, para poder probarlo con node:test. */

/** La API manda solo números 57 0000 + 6 dígitos: «+57 0000 12 34 56». */
function telefonoSimuladoBonito(tel) {
  const d = String(tel ?? '').replace(/\D/g, '');
  if (!/^570000\d{6}$/.test(d)) return String(tel ?? '');
  return `+57 0000 ${d.slice(6, 8)} ${d.slice(8, 10)} ${d.slice(10)}`;
}

function horaCorta(ts) {
  const fecha = new Date(Number(ts) || Date.now());
  return fecha.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
}

function tamanoLegible(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** Texto del bot con el formato de WhatsApp (*negrita*, _cursiva_…), siempre escapado antes. */
const conFormato = (texto) => formatWhatsApp(escapeHtml(texto ?? ''));

/* Pasos del flujo con un nombre que entiende quien prueba. Lo que no está aquí se muestra tal cual. */
const PASOS = {
  menu: 'Inicio',
  menu_clasico: 'Otras gestiones',
  menu_posgrado: 'Menú de posgrados',
  menu_pregrado: 'Menú de pregrado',
  reco_pregrado_grupo: 'Recomendación · área del pregrado',
  reco_pregrado: 'Recomendación · pregrado',
  reco_pregrado_externo: 'Recomendación · carrera de otra universidad',
  reco_confirmar: 'Recomendación · confirmar carrera',
  reco_nivel: 'Recomendación · nivel',
  reco_resultados: 'Recomendación · resultados',
  reco_ficha: 'Recomendación · ficha del programa',
  reco_ficha_elegir: 'Recomendación · elegir ficha',
  reco_consentimiento: 'Autorización de datos',
  reco_nombre: 'Asesor · nombre',
  reco_correo: 'Asesor · correo',
  reco_contacto: 'Asesor · chat, llamada o correo',
  reco_contacto_repetir: 'Asesor · ¿igual que la vez pasada?',
  reco_llamada_numero: 'Asesor · número para llamar',
  reco_llamada_franja: 'Asesor · franja de la llamada',
  chatting_with_ai: 'Conversación con la IA',
  with_agent: 'Con un asesor (Chatwoot simulado)',
  encuesta_atencion: 'Encuesta de atención',
  semestre_menu: 'Mi semestre',
  verif_email: 'Verificación · correo',
  verif_codigo: 'Verificación · código',
};
function etiquetaPaso(paso) {
  if (!paso) return 'Sin conversación';
  return PASOS[paso] ?? paso;
}

/**
 * Lo que se ve en la burbuja de quien prueba. Al tocar un botón o una fila, a
 * WhatsApp le llega el id de la opción (eso se envía), pero en el teléfono se ve
 * su título.
 */
function burbujaDeOpcion(opcion) {
  return { enviar: String(opcion.id), mostrar: String(opcion.texto ?? opcion.titulo ?? opcion.id) };
}

/** ¿Estaba cerca del final? Si subió a leer, no se le baja de golpe. */
function estabaAbajo({ scrollTop, clientHeight, scrollHeight }, margen = 96) {
  return scrollHeight - (scrollTop + clientHeight) <= margen;
}

const ICONO_SERVICIO = {
  'Google Sheets': '📄', HubSpot: '🧲', Chatwoot: '🎧', 'CRM del panel': '🗂️', Correo: '✉️', Seguimiento: '⏰',
  Incidencias: '⚠️', 'No reconocido': '❓', Agenda: '📅', WhatsApp: '🚫', Verificación: '🔐',
  'Portal de notas': '🎓', 'Código estudiantil': '🎓', 'Informes de atención': '📊',
};

/** HTML de un mensaje del bot (sin la fila ni la hora: eso lo pone la pantalla). */
function contenidoMensaje(m) {
  switch (m.tipo) {
    case 'texto':
      return `<div class="wsim-texto">${conFormato(m.texto)}</div>`;
    case 'botones':
      return `${m.titulo ? `<div class="wsim-titulo">${conFormato(m.titulo)}</div>` : ''}
        <div class="wsim-texto">${conFormato(m.texto)}</div>
        ${m.pie ? `<div class="wsim-pie">${escapeHtml(m.pie)}</div>` : ''}`;
    case 'lista':
      return `${m.titulo ? `<div class="wsim-titulo">${conFormato(m.titulo)}</div>` : ''}
        <div class="wsim-texto">${conFormato(m.texto)}</div>
        ${m.pie ? `<div class="wsim-pie">${escapeHtml(m.pie)}</div>` : ''}`;
    case 'imagen':
      return `${m.src
        ? `<img class="wsim-imagen" src="${escapeHtml(m.src)}" alt="${escapeHtml(m.pie || 'Imagen que mandó el bot')}" loading="lazy">`
        : `<div class="wsim-adjunto"><span class="wsim-adjunto-icono" aria-hidden="true">🖼️</span><span><strong>Imagen</strong><small>${escapeHtml(m.detalle || '')}</small></span></div>`}
        ${m.pie ? `<div class="wsim-texto wsim-pie-imagen">${conFormato(m.pie)}</div>` : ''}`;
    case 'documento':
      return `<div class="wsim-adjunto wsim-documento">
          <span class="wsim-adjunto-icono wsim-pdf" aria-hidden="true">${/pdf/i.test(m.mimetype) ? 'PDF' : 'DOC'}</span>
          <span><strong>${escapeHtml(m.nombre)}</strong><small>${escapeHtml(tamanoLegible(m.bytes))} · ${escapeHtml(m.mimetype)}</small></span>
        </div>
        ${m.pie ? `<div class="wsim-texto">${conFormato(m.pie)}</div>` : ''}`;
    case 'media':
      return `<div class="wsim-adjunto">
          <span class="wsim-adjunto-icono" aria-hidden="true">📎</span>
          <span><strong>${escapeHtml(m.nombre || m.clase)}</strong><small class="wsim-url">${escapeHtml(m.url)}</small></span>
        </div>
        ${m.pie ? `<div class="wsim-texto">${conFormato(m.pie)}</div>` : ''}`;
    default:
      return `<div class="wsim-texto">${escapeHtml(JSON.stringify(m))}</div>`;
  }
}

/** Nota de la zona de pruebas: qué NO se hizo fuera (Sheets, Chatwoot…). */
function contenidoNota(m) {
  const icono = ICONO_SERVICIO[m.servicio] ?? '🧪';
  const texto = String(m.texto ?? '');
  const corto = texto.length > 110 || texto.includes('\n');
  const resumen = corto ? `${texto.split('\n')[0].slice(0, 100)}…` : texto;
  return corto
    ? `<details class="wsim-nota-detalle"><summary><span aria-hidden="true">${icono}</span> <strong>${escapeHtml(m.servicio)}</strong><span class="wsim-nota-resumen"> · ${escapeHtml(resumen)}</span></summary><div class="wsim-nota-completa">${conFormato(texto)}</div></details>`
    : `<span aria-hidden="true">${icono}</span> <strong>${escapeHtml(m.servicio)}</strong> · ${escapeHtml(texto)}`;
}

/** Opciones que se pueden tocar en un mensaje (para los botones y la lista). */
function opcionesDe(m) {
  if (m.tipo === 'botones') return (m.botones ?? []).map(b => ({ id: b.id, texto: b.texto }));
  if (m.tipo === 'lista') return (m.secciones ?? []).flatMap(s => s.filas.map(f => ({ id: f.id, texto: f.titulo })));
  return [];
}

export {
  telefonoSimuladoBonito, horaCorta, tamanoLegible, etiquetaPaso, burbujaDeOpcion, estabaAbajo,
  contenidoMensaje, contenidoNota, opcionesDe,
};
