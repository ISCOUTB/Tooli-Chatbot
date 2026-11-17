/* Reglas de la pantalla Asistencia y de los destinatarios de Plantillas, sin
   DOM: cuentas, filtros y a quién se le puede escribir. Se prueban con
   node:test (ver asistencia.test.js). */

const SECTORES = {
  posgrado: { label: 'Posgrado', color: '#003087' },
  pregrado: { label: 'Pregrado', color: '#0f766e' },
  otro: { label: 'Otro', color: '#475163' },
};

const ORIGENES = { qr: 'QR', importado: 'Lista importada', manual: 'A mano' };

/** Tope de destinatarios por envío que impone el servidor. */
const MAX_POR_ENVIO = 200;

function esCelular(valor) {
  return /^[1-9]\d{9,14}$/.test(String(valor ?? ''));
}

function resumenAsistentes(lista) {
  const personas = Array.isArray(lista) ? lista : [];
  return {
    total: personas.length,
    conWhatsapp: personas.filter(a => a.whatsapp).length,
    porQr: personas.filter(a => a.origen === 'qr').length,
    autorizaron: personas.filter(a => a.consentimiento).length,
    contactables: telefonosContactables(personas).length,
  };
}

/**
 * A quién se le puede enviar una plantilla: autorizó el contacto y tiene un
 * número al que Meta entrega. Quien escribe sin mostrar su teléfono queda
 * fuera, porque el envío masivo solo acepta números.
 */
function telefonosContactables(lista) {
  const vistos = new Set();
  for (const a of Array.isArray(lista) ? lista : []) {
    if (a?.consentimiento && esCelular(a.whatsapp)) vistos.add(a.whatsapp);
  }
  return [...vistos];
}

function sinTildes(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function filtrarAsistentes(lista, busqueda) {
  const q = sinTildes(busqueda).trim();
  if (!q) return lista;
  const digitos = q.replace(/\D/g, '');
  return lista.filter(a =>
    sinTildes(`${a.nombre} ${a.correo} ${a.programa} ${a.documento}`).includes(q)
    || (digitos.length >= 3 && String(a.whatsapp ?? '').includes(digitos)));
}

/** "20 nov 2026" a partir de AAAA-MM-DD, sin correrse un día por la zona horaria. */
function fechaEvento(fecha) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fecha ?? ''));
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Cambia solo cuando cambia la lista: evita repintar la tabla en cada consulta. */
function firmaLista(lista) {
  return (Array.isArray(lista) ? lista : [])
    .map(a => `${a.clave}|${a.nombre}|${a.correo}|${a.documento}|${a.programa}|${a.origen}|${a.consentimiento ? 1 : 0}`)
    .join('\n');
}

/**
 * Números escritos o pegados, uno por línea o separados por comas. Igual que
 * el servidor: diez dígitos que empiezan por 3 son un celular colombiano.
 */
function parseNumerosPegados(texto) {
  const validos = [];
  const vistos = new Set();
  let invalidos = 0;
  let repetidos = 0;
  for (const parte of String(texto ?? '').split(/[\n,;]+/)) {
    const crudo = parte.trim();
    if (!crudo) continue;
    let digitos = /^\+?[\d\s().-]+$/.test(crudo) ? crudo.replace(/\D/g, '') : '';
    if (digitos.length === 10 && digitos[0] === '3') digitos = `57${digitos}`;
    if (!esCelular(digitos)) { invalidos++; continue; }
    if (vistos.has(digitos)) { repetidos++; continue; }
    vistos.add(digitos);
    validos.push(digitos);
  }
  return { validos, invalidos, repetidos };
}

/** Parte una lista en envíos del tamaño que admite el servidor. */
function enLotes(lista, tamano = MAX_POR_ENVIO) {
  const lotes = [];
  for (let i = 0; i < lista.length; i += tamano) lotes.push(lista.slice(i, i + tamano));
  return lotes;
}

function nombreArchivoCsv(nombreEvento) {
  const base = sinTildes(nombreEvento).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  return `asistencia-${base || 'evento'}.csv`;
}

export {
  SECTORES, ORIGENES, MAX_POR_ENVIO, resumenAsistentes, telefonosContactables, filtrarAsistentes,
  fechaEvento, firmaLista, parseNumerosPegados, enLotes, nombreArchivoCsv,
};
