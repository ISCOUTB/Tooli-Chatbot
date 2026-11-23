/**
 * Cómo se DICE (no cómo se escribe): cifras, fechas, horas y montos en palabras,
 * al estilo colombiano, para que el sintetizador de la llamada no lea mal
 * "$8.363.000" ni "15/12/2026". Todo son funciones puras.
 */

const UNIDADES = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez',
  'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis',
  'veintisiete', 'veintiocho', 'veintinueve',
];
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const CENTENAS = [
  '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos',
];

function apocopar(palabra: string, apocope: boolean): string {
  if (!apocope) return palabra;
  if (palabra === 'uno') return 'un';
  if (palabra === 'veintiuno') return 'veintiún';
  return palabra;
}

/** 0..999. `apocope`: "uno" -> "un" cuando va antes de un sustantivo ("veintiún mil"). */
function menorQueMil(n: number, apocope: boolean): string {
  if (n === 0) return '';
  if (n === 100) return 'cien';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c > 0) partes.push(CENTENAS[c]);
  if (resto > 0) {
    if (resto < 30) {
      partes.push(apocopar(UNIDADES[resto], apocope));
    } else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u === 0 ? DECENAS[d] : `${DECENAS[d]} y ${apocopar(UNIDADES[u], apocope)}`);
    }
  }
  return partes.join(' ');
}

/** Entero 0..999.999.999.999 en palabras. Fuera de rango devuelve los dígitos. */
export function numeroEnPalabras(valor: number, apocope = false): string {
  const n = Math.trunc(Math.abs(valor));
  if (!Number.isFinite(valor) || n > 999_999_999_999) return String(Math.trunc(valor));
  if (n === 0) return 'cero';
  const millones = Math.floor(n / 1_000_000);
  const bajo = n % 1_000_000;
  const partes: string[] = [];
  if (millones > 0) {
    partes.push(millones === 1 ? 'un millón' : `${numeroEnPalabras(millones, true)} millones`);
  }
  if (bajo > 0) {
    const m = Math.floor(bajo / 1000);
    const r = bajo % 1000;
    if (m > 0) partes.push(m === 1 ? 'mil' : `${menorQueMil(m, true)} mil`);
    if (r > 0) partes.push(menorQueMil(r, apocope));
  }
  return partes.join(' ');
}

/** 8363000 -> "ocho millones trescientos sesenta y tres mil pesos". */
export function montoEnPalabras(pesos: number): string {
  const n = Math.round(pesos);
  if (!Number.isFinite(n) || n < 0) return 'un valor que no pude leer bien';
  if (n === 1) return 'un peso';
  const redondoEnMillones = n >= 1_000_000 && n % 1_000_000 === 0;
  return `${numeroEnPalabras(n, true)}${redondoEnMillones ? ' de' : ''} pesos`;
}

/** 4.5 -> "cuatro punto cinco"; 3.25 -> "tres punto dos cinco"; 5 -> "cinco". */
export function notaEnPalabras(nota: number | string): string {
  const n = typeof nota === 'number' ? nota : Number(String(nota).replace(',', '.'));
  if (!Number.isFinite(n)) return 'sin nota';
  const texto = String(Math.round(n * 100) / 100);
  const [entera, decimales] = texto.split('.');
  const base = numeroEnPalabras(Number(entera));
  if (!decimales) return base;
  return `${base} punto ${decimales.split('').map((d) => UNIDADES[Number(d)]).join(' ')}`;
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export interface FechaSimple { dia: number; mes: number; anio: number }

function validar(f: FechaSimple): FechaSimple | null {
  if (f.mes < 1 || f.mes > 12 || f.dia < 1 || f.dia > 31) return null;
  return f;
}

/** Acepta dd/mm/aaaa, d/m/aa, aaaa-mm-dd y ISO 8601. */
export function leerFecha(texto: string): FechaSimple | null {
  const t = String(texto ?? '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return validar({ anio: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) });
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const a = Number(m[3]);
    return validar({ dia: Number(m[1]), mes: Number(m[2]), anio: a < 100 ? 2000 + a : a });
  }
  return null;
}

/** "el quince de diciembre" (con año solo si no es el actual). */
export function fechaEnPalabras(texto: string, ahora: Date = new Date()): string {
  const f = leerFecha(texto);
  if (!f) return String(texto ?? '').trim() || 'una fecha que no pude leer';
  const dia = f.dia === 1 ? 'primero' : numeroEnPalabras(f.dia);
  const anio = f.anio !== ahora.getFullYear() ? ` de ${numeroEnPalabras(f.anio)}` : '';
  return `el ${dia} de ${MESES[f.mes - 1]}${anio}`;
}

/** "el lunes quince de diciembre" a partir de una fecha ISO, en hora de Colombia (UTC-5, sin horario de verano). */
export function fechaConDiaEnPalabras(iso: string, ahora: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fechaEnPalabras(iso, ahora);
  const co = new Date(d.getTime() - 5 * 3600_000);
  const dia = co.getUTCDate() === 1 ? 'primero' : numeroEnPalabras(co.getUTCDate());
  const anio = co.getUTCFullYear() !== ahora.getFullYear() ? ` de ${numeroEnPalabras(co.getUTCFullYear())}` : '';
  return `el ${DIAS[co.getUTCDay()]} ${dia} de ${MESES[co.getUTCMonth()]}${anio}`;
}

/** "14:30" -> "las dos y media de la tarde". */
export function horaEnPalabras(texto: string): string {
  const m = String(texto ?? '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return String(texto ?? '').trim() || 'una hora que no pude leer';
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return String(texto).trim();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const articulo = h12 === 1 ? 'la' : 'las';
  let momento: string;
  if (h === 0) momento = 'de la noche';
  else if (h < 12) momento = 'de la mañana';
  else if (h === 12) momento = 'del día';
  else if (h < 19) momento = 'de la tarde';
  else momento = 'de la noche';
  let minutos = '';
  if (min === 30) minutos = ' y media';
  else if (min === 15) minutos = ' y cuarto';
  else if (min > 0) minutos = ` y ${numeroEnPalabras(min)}`;
  return `${articulo} ${h12 === 1 ? 'una' : numeroEnPalabras(h12)}${minutos} ${momento}`;
}

/** Quita lo que el sintetizador leería mal (markdown, enlaces, emojis, saltos). */
export function limpiarParaVoz(texto: string): string {
  return String(texto ?? '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[*_~`#>|\\[\]{}$]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[‍️]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Une frases con "y" al final: "a, b y c". */
export function unirConY(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

/** Comprobación usada por las pruebas: sin emojis, sin markdown, sin enlaces ni saltos de línea. */
export function esTextoVozLimpio(texto: string): boolean {
  return texto.trim().length > 0
    && !/\p{Extended_Pictographic}/u.test(texto)
    && !/[*_~`#>|\\[\]{}$]/.test(texto)
    && !/https?:\/\//i.test(texto)
    && !/\n/.test(texto);
}
