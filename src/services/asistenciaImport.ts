/**
 * Lectura de una lista de asistencia desde un archivo (.xlsx o .csv).
 *
 * Puro a propósito (igual que `broadcastValidation.ts`): no toca Redis ni la
 * red, así que se prueba con archivos armados en memoria
 * (ver asistenciaImport.test.ts).
 *
 * El .xlsx se lee sin dependencias: es un ZIP con XML adentro y Node trae
 * `zlib`. Solo se entiende lo que una lista de personas necesita —texto y
 * números de la primera hoja—; fórmulas, fechas y estilos se ignoran.
 *
 * QUÉ NO ES: no adivina datos. Una columna que no se reconoce queda sin
 * asignar y el panel deja corregir el mapeo antes de importar.
 */
import { inflateRawSync } from 'node:zlib';

export class ImportacionInvalidaError extends Error {}

/** Tope de personas por archivo: una lista de evento, no una base de datos. */
export const MAX_FILAS_IMPORTACION = 5000;
/** Un .xlsx de 3 MB no debería abrirse a más que esto; lo demás es una bomba ZIP. */
const MAX_BYTES_DESCOMPRIMIDOS = 25 * 1024 * 1024;
const MAX_COLUMNAS = 60;

// ── ZIP ─────────────────────────────────────────────────────────────────────

interface EntradaZip {
  metodo: number;
  comprimido: number;
  descomprimido: number;
  offsetLocal: number;
}

function leerDirectorioZip(buf: Buffer): Map<string, EntradaZip> {
  // El "fin del directorio central" está al final, antes de un comentario opcional.
  const minimo = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minimo; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ImportacionInvalidaError('El archivo no es un Excel (.xlsx) válido');
  const total = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  if (pos === 0xffffffff || total === 0xffff) {
    throw new ImportacionInvalidaError('El Excel es demasiado grande para importarlo');
  }
  const entradas = new Map<string, EntradaZip>();
  for (let i = 0; i < total; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== 0x02014b50) {
      throw new ImportacionInvalidaError('El Excel está dañado (directorio ilegible)');
    }
    const largoNombre = buf.readUInt16LE(pos + 28);
    const largoExtra = buf.readUInt16LE(pos + 30);
    const largoComentario = buf.readUInt16LE(pos + 32);
    const nombre = buf.toString('utf8', pos + 46, pos + 46 + largoNombre);
    entradas.set(nombre, {
      metodo: buf.readUInt16LE(pos + 10),
      comprimido: buf.readUInt32LE(pos + 20),
      descomprimido: buf.readUInt32LE(pos + 24),
      offsetLocal: buf.readUInt32LE(pos + 42),
    });
    pos += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}

function leerEntradaZip(buf: Buffer, entrada: EntradaZip, presupuesto: { restante: number }): string {
  const p = entrada.offsetLocal;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== 0x04034b50) {
    throw new ImportacionInvalidaError('El Excel está dañado (entrada ilegible)');
  }
  const inicio = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const fin = inicio + entrada.comprimido;
  if (fin > buf.length) throw new ImportacionInvalidaError('El Excel está dañado (entrada incompleta)');
  const datos = buf.subarray(inicio, fin);
  let salida: Buffer;
  if (entrada.metodo === 0) {
    salida = datos;
  } else if (entrada.metodo === 8) {
    try {
      // El tamaño declarado puede mentir: el límite real lo impone zlib.
      salida = inflateRawSync(datos, { maxOutputLength: presupuesto.restante });
    } catch {
      throw new ImportacionInvalidaError('El Excel no se pudo descomprimir o es demasiado grande');
    }
  } else {
    throw new ImportacionInvalidaError('El Excel usa una compresión que no se admite');
  }
  presupuesto.restante -= salida.length;
  if (presupuesto.restante < 0) throw new ImportacionInvalidaError('El Excel es demasiado grande para importarlo');
  return salida.toString('utf8');
}

// ── XML del libro ───────────────────────────────────────────────────────────

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodificarXml(s: string): string {
  return s
    .replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (todo, cuerpo: string) => {
      if (cuerpo[0] !== '#') return ENTIDADES[cuerpo] ?? todo;
      const codigo = cuerpo[1] === 'x' ? parseInt(cuerpo.slice(2), 16) : parseInt(cuerpo.slice(1), 10);
      return Number.isFinite(codigo) && codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : '';
    })
    // Excel escribe los caracteres de control como _x000D_.
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_todo, hex: string) => {
      const codigo = parseInt(hex, 16);
      return codigo === 9 || codigo === 10 || codigo === 13 ? ' ' : '';
    });
}

/** Junta el texto de todos los <t> de un fragmento (texto enriquecido incluido). */
function textoDe(fragmento: string): string {
  const sinFonetica = fragmento.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
  let texto = '';
  for (const m of sinFonetica.matchAll(/<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g)) {
    texto += decodificarXml(m[1] ?? '');
  }
  return texto;
}

function leerCadenasCompartidas(xml: string): string[] {
  const cadenas: string[] = [];
  for (const m of xml.matchAll(/<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g)) {
    cadenas.push(textoDe(m[1] ?? ''));
  }
  return cadenas;
}

function atributo(etiqueta: string, nombre: string): string | null {
  const m = new RegExp(`(?:^|\\s)${nombre}\\s*=\\s*"([^"]*)"`).exec(etiqueta);
  return m ? decodificarXml(m[1]) : null;
}

/** Ruta de la primera hoja según el orden del libro; `sheet1.xml` si no se puede resolver. */
function rutaPrimeraHoja(entradas: Map<string, EntradaZip>, leer: (ruta: string) => string | null): string {
  const libro = leer('xl/workbook.xml');
  const rels = leer('xl/_rels/workbook.xml.rels');
  const hoja = libro ? /<(?:\w+:)?sheet\b([^>]*)>/.exec(libro) : null;
  // El prefijo del espacio de nombres casi siempre es `r:`, pero no es obligatorio.
  const rid = hoja ? /(?:^|\s)(?:\w+:)?id\s*=\s*"([^"]*)"/.exec(hoja[1])?.[1] ?? null : null;
  if (rid && rels) {
    for (const m of rels.matchAll(/<Relationship\b([^>]*)>/g)) {
      if (atributo(m[1], 'Id') !== rid) continue;
      const destino = atributo(m[1], 'Target') ?? '';
      const ruta = destino.startsWith('/') ? destino.slice(1) : `xl/${destino}`;
      if (entradas.has(ruta)) return ruta;
    }
  }
  if (entradas.has('xl/worksheets/sheet1.xml')) return 'xl/worksheets/sheet1.xml';
  const primera = [...entradas.keys()].filter(n => /^xl\/worksheets\/[^/]+\.xml$/.test(n)).sort()[0];
  if (!primera) throw new ImportacionInvalidaError('El Excel no tiene hojas');
  return primera;
}

function indiceColumna(referencia: string | null, porDefecto: number): number {
  const letras = /^([A-Z]+)/i.exec(referencia ?? '')?.[1];
  if (!letras) return porDefecto;
  let n = 0;
  for (const c of letras.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel guarda un celular como número; `3.001234567E9` debe volver a ser `3001234567`. */
function numeroComoTexto(v: string): string {
  const texto = v.trim();
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(texto)) return texto;
  const n = Number(texto);
  if (!Number.isFinite(n)) return texto;
  return Number.isInteger(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? n.toFixed(0) : String(n);
}

function leerHoja(xml: string, compartidas: string[]): string[][] {
  const filas: string[][] = [];
  for (const fila of xml.matchAll(/<(?:\w+:)?row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)) {
    if (filas.length > MAX_FILAS_IMPORTACION) {
      throw new ImportacionInvalidaError(`El archivo supera las ${MAX_FILAS_IMPORTACION} filas admitidas`);
    }
    const celdas: string[] = [];
    let siguiente = 0;
    for (const c of (fila[1] ?? '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const col = indiceColumna(atributo(c[1], 'r'), siguiente);
      siguiente = col + 1;
      if (col >= MAX_COLUMNAS) continue;
      const tipo = atributo(c[1], 't');
      const cuerpo = c[2] ?? '';
      const crudo = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(cuerpo)?.[1] ?? '';
      let valor: string;
      if (tipo === 's') valor = compartidas[Number(crudo)] ?? '';
      else if (tipo === 'inlineStr') valor = textoDe(cuerpo);
      else if (tipo === 'str') valor = decodificarXml(crudo);
      else if (tipo === 'b') valor = crudo.trim() === '1' ? 'Sí' : 'No';
      else if (tipo === 'e') valor = '';
      else valor = numeroComoTexto(decodificarXml(crudo));
      while (celdas.length < col) celdas.push('');
      celdas[col] = valor.replace(/\s+/g, ' ').trim();
    }
    filas.push(celdas);
  }
  return filas;
}

export function leerXlsx(buf: Buffer): string[][] {
  const entradas = leerDirectorioZip(buf);
  const presupuesto = { restante: MAX_BYTES_DESCOMPRIMIDOS };
  const leer = (ruta: string): string | null => {
    const entrada = entradas.get(ruta);
    return entrada ? leerEntradaZip(buf, entrada, presupuesto) : null;
  };
  const rutaHoja = rutaPrimeraHoja(entradas, leer);
  const compartidas = leerCadenasCompartidas(leer('xl/sharedStrings.xml') ?? '');
  const hoja = leer(rutaHoja);
  if (hoja === null) throw new ImportacionInvalidaError('El Excel no tiene hojas');
  return leerHoja(hoja, compartidas);
}

// ── CSV ─────────────────────────────────────────────────────────────────────

function detectarSeparador(primeraLinea: string): string {
  const cuenta = { ',': 0, ';': 0, '\t': 0 } as Record<string, number>;
  let entreComillas = false;
  for (const c of primeraLinea) {
    if (c === '"') entreComillas = !entreComillas;
    else if (!entreComillas && c in cuenta) cuenta[c]++;
  }
  // Excel en español exporta con punto y coma; en empate gana la coma.
  let mejor = ',';
  for (const sep of [';', '\t']) if (cuenta[sep] > cuenta[mejor]) mejor = sep;
  return mejor;
}

export function leerCsv(buf: Buffer): string[][] {
  let texto = buf.toString('utf8');
  // Un CSV guardado desde Excel en Windows suele venir en Latin-1: las tildes
  // llegan como bytes sueltos, que en UTF-8 se vuelven el carácter de reemplazo.
  if (texto.includes('�')) texto = buf.toString('latin1');
  texto = texto.replace(/^﻿/, '');
  const sep = detectarSeparador(texto.split(/\r?\n/, 1)[0] ?? '');
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let entreComillas = false;
  const cerrarCampo = () => { fila.push(campo.replace(/\s+/g, ' ').trim()); campo = ''; };
  const cerrarFila = () => {
    cerrarCampo();
    filas.push(fila.slice(0, MAX_COLUMNAS));
    fila = [];
    if (filas.length > MAX_FILAS_IMPORTACION + 1) {
      throw new ImportacionInvalidaError(`El archivo supera las ${MAX_FILAS_IMPORTACION} filas admitidas`);
    }
  };
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') entreComillas = false;
      else campo += c;
    } else if (c === '"' && campo === '') entreComillas = true;
    else if (c === sep) cerrarCampo();
    else if (c === '\n') cerrarFila();
    else if (c !== '\r') campo += c;
  }
  if (campo !== '' || fila.length) cerrarFila();
  return filas;
}

// ── Archivo → tabla ─────────────────────────────────────────────────────────

export interface TablaArchivo {
  columnas: string[];
  filas: string[][];
}

/** Lee el archivo y separa la fila de encabezados del resto. */
export function leerTablaArchivo(buf: Buffer, nombreArchivo = ''): TablaArchivo {
  if (!buf.length) throw new ImportacionInvalidaError('El archivo está vacío');
  const esZip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
  const esXlsViejo = buf.length > 8 && buf.readUInt32BE(0) === 0xd0cf11e0;
  if (esXlsViejo) {
    throw new ImportacionInvalidaError('El formato .xls antiguo no se admite: guarda el archivo como .xlsx o .csv');
  }
  if (!esZip && !/\.(csv|txt|tsv)$/i.test(nombreArchivo) && buf.subarray(0, 2000).includes(0)) {
    throw new ImportacionInvalidaError('Formato no admitido: sube un archivo .xlsx o .csv');
  }
  const crudas = (esZip ? leerXlsx(buf) : leerCsv(buf)).filter(f => f.some(c => c !== ''));
  if (crudas.length < 2) {
    throw new ImportacionInvalidaError('El archivo necesita una fila de encabezados y al menos una persona');
  }
  if (crudas.length - 1 > MAX_FILAS_IMPORTACION) {
    throw new ImportacionInvalidaError(`El archivo supera las ${MAX_FILAS_IMPORTACION} filas admitidas`);
  }
  // Un reporte exportado suele traer un título encima de la tabla: los
  // encabezados son la primera fila, entre las diez primeras, que se reconoce.
  let cabecera = 0;
  let mejorPuntaje = 0;
  for (let i = 0; i < Math.min(10, crudas.length - 1); i++) {
    const puntaje = Object.values(detectarColumnas(crudas[i])).filter(v => v !== null).length;
    if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; cabecera = i; }
    if (puntaje >= 2) break;
  }
  const filas = crudas.slice(cabecera + 1);
  const ancho = Math.min(MAX_COLUMNAS, Math.max(...crudas.slice(cabecera).map(f => f.length)));
  const columnas = Array.from({ length: ancho }, (_x, i) => (crudas[cabecera][i] ?? '').slice(0, 80) || `Columna ${i + 1}`);
  return { columnas, filas };
}

// ── Reconocer columnas ──────────────────────────────────────────────────────

export const CAMPOS_ASISTENTE = ['nombre', 'apellido', 'whatsapp', 'correo', 'documento', 'programa'] as const;
export type CampoAsistente = typeof CAMPOS_ASISTENTE[number];
export type MapeoColumnas = Record<CampoAsistente, number | null>;

function normalizarEncabezado(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Encabezados que identifican el campo sin ambigüedad, de más a menos específico. */
const EXACTOS: Record<CampoAsistente, readonly string[]> = {
  nombre: ['nombre completo', 'nombres y apellidos', 'nombre y apellido', 'nombre y apellidos', 'nombre', 'nombres', 'asistente', 'participante', 'estudiante', 'name', 'full name'],
  apellido: ['apellidos', 'apellido', 'last name'],
  whatsapp: ['whatsapp', 'celular', 'numero de celular', 'telefono celular', 'telefono movil', 'telefono', 'numero de telefono', 'movil', 'cel', 'phone'],
  correo: ['correo electronico', 'correo', 'email', 'e mail', 'mail', 'correo institucional', 'correo personal'],
  documento: ['numero de documento', 'numero de identificacion', 'identificacion', 'documento', 'documento de identidad', 'cedula', 'no documento', 'cc'],
  programa: ['programa', 'programa academico', 'programa de interes', 'carrera'],
};

/** Palabras que bastan si el encabezado las contiene. El orden resuelve
 * "Nombre del programa" (programa) frente a "Nombre" (nombre). */
const CONTIENE: readonly [CampoAsistente, readonly string[]][] = [
  ['correo', ['correo', 'email', 'e mail']],
  ['whatsapp', ['whatsapp', 'celular', 'telefono', 'movil']],
  ['documento', ['identificacion', 'documento', 'cedula']],
  ['programa', ['programa', 'carrera']],
  ['apellido', ['apellido']],
  ['nombre', ['nombre']],
];

export function detectarColumnas(columnas: string[]): MapeoColumnas {
  const mapeo: MapeoColumnas = { nombre: null, apellido: null, whatsapp: null, correo: null, documento: null, programa: null };
  const normalizadas = columnas.map(normalizarEncabezado);
  const usadas = new Set<number>();
  for (const campo of CAMPOS_ASISTENTE) {
    for (const candidato of EXACTOS[campo]) {
      const i = normalizadas.findIndex((n, idx) => n === candidato && !usadas.has(idx));
      if (i >= 0) { mapeo[campo] = i; usadas.add(i); break; }
    }
  }
  for (const [campo, palabras] of CONTIENE) {
    if (mapeo[campo] !== null) continue;
    const i = normalizadas.findIndex((n, idx) => {
      // "Tipo de documento" trae CC/TI, no el número.
      if (usadas.has(idx) || n.startsWith('tipo')) return false;
      const partes = ` ${n} `;
      return palabras.some(p => partes.includes(` ${p} `));
    });
    if (i >= 0) { mapeo[campo] = i; usadas.add(i); }
  }
  return mapeo;
}

/** Mapeo corregido por el asesor: solo índices de columnas que existen. */
export function validarMapeo(raw: unknown, totalColumnas: number): MapeoColumnas | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entrada = raw as Record<string, unknown>;
  const mapeo: MapeoColumnas = { nombre: null, apellido: null, whatsapp: null, correo: null, documento: null, programa: null };
  for (const campo of CAMPOS_ASISTENTE) {
    const v = entrada[campo];
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n >= totalColumnas) {
      throw new ImportacionInvalidaError(`La columna elegida para "${campo}" no existe en el archivo`);
    }
    mapeo[campo] = n;
  }
  return mapeo;
}

// ── Filas → personas ────────────────────────────────────────────────────────

export interface DatosAsistente {
  nombre: string;
  whatsapp: string;
  correo: string;
  documento: string;
  programa: string;
}

/**
 * Celular a dígitos con indicativo. Un número de 10 dígitos que empieza por 3
 * es un celular colombiano sin el 57; cualquier otro debe traer su indicativo.
 * Devuelve '' si no es un número utilizable.
 */
export function normalizarCelular(raw: string): string {
  const texto = String(raw ?? '').trim();
  if (!texto || !/^\+?[\d\s().-]+$/.test(texto)) return '';
  let digitos = texto.replace(/\D/g, '');
  if (digitos.length === 10 && digitos[0] === '3') digitos = `57${digitos}`;
  return /^[1-9]\d{9,14}$/.test(digitos) ? digitos : '';
}

export function normalizarCorreo(raw: string): string {
  const correo = String(raw ?? '').trim().toLowerCase();
  return correo.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) ? correo : '';
}

export function limpiarTexto(raw: unknown, largo: number): string {
  return String(raw ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, largo);
}

export function normalizarDocumento(raw: string): string {
  return String(raw ?? '').replace(/[^0-9a-zA-Z]/g, '').slice(0, 20);
}

export interface ImportacionPreparada {
  columnas: string[];
  mapeo: MapeoColumnas;
  asistentes: DatosAsistente[];
  /** Filas con datos en el archivo, sin contar encabezados. */
  totalFilas: number;
  /** Filas sin nombre ni forma de contacto: no identifican a nadie. */
  omitidas: number;
  sinWhatsapp: number;
  /** Traían algo en la columna de celular que no es un número utilizable. */
  celularesInvalidos: number;
}

export function prepararImportacion(tabla: TablaArchivo, mapeoManual: MapeoColumnas | null = null): ImportacionPreparada {
  const mapeo = mapeoManual ?? detectarColumnas(tabla.columnas);
  if (mapeo.nombre === null && mapeo.whatsapp === null && mapeo.correo === null && mapeo.documento === null) {
    throw new ImportacionInvalidaError(
      'No se reconoció ninguna columna de nombre, celular, correo o identificación. Indica a qué corresponde cada columna.',
    );
  }
  const celda = (fila: string[], campo: CampoAsistente): string => {
    const i = mapeo[campo];
    return i === null ? '' : fila[i] ?? '';
  };
  const asistentes: DatosAsistente[] = [];
  let omitidas = 0;
  let sinWhatsapp = 0;
  let celularesInvalidos = 0;
  for (const fila of tabla.filas) {
    const celularCrudo = celda(fila, 'whatsapp');
    const persona: DatosAsistente = {
      nombre: limpiarTexto(`${celda(fila, 'nombre')} ${celda(fila, 'apellido')}`, 120),
      whatsapp: normalizarCelular(celularCrudo),
      correo: normalizarCorreo(celda(fila, 'correo')),
      documento: normalizarDocumento(celda(fila, 'documento')),
      programa: limpiarTexto(celda(fila, 'programa'), 120),
    };
    if (celularCrudo.trim() && !persona.whatsapp) celularesInvalidos++;
    if (!persona.nombre && !persona.whatsapp && !persona.correo && !persona.documento) { omitidas++; continue; }
    if (!persona.whatsapp) sinWhatsapp++;
    asistentes.push(persona);
  }
  return { columnas: tabla.columnas, mapeo, asistentes, totalFilas: tabla.filas.length, omitidas, sinWhatsapp, celularesInvalidos };
}
