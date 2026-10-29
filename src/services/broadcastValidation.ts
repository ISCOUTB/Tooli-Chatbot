/**
 * Reglas de validación de un broadcast por templates de Meta.
 *
 * Puro a propósito (igual que `reminderValidation.ts`): `broadcastService.ts`
 * importa axios/config y estas reglas se prueban sin red
 * (ver broadcastValidation.test.ts).
 *
 * QUÉ NO ES:
 *   Esto no promete texto libre fuera de la ventana de 24 h de Meta. El único
 *   envío permitido es un template APROBADO (ver `listApprovedTemplates`). Si
 *   el template usa variables {{1}}, {{2}}… en el cuerpo, cada destinatario
 *   tiene que traer sus valores (`clasificarDestinatariosConDatos`); al que le
 *   falten se reporta en `fallidos` sin tumbar el resto.
 */

export class BroadcastValidationError extends Error {}

/** Tope de destinatarios por envío (igual que el límite de la ruta). */
export const MAX_BROADCAST_RECIPIENTS = 200;

/**
 * Meta crea los templates en minúsculas con dígitos y guiones bajos
 * (máx. 512 chars). Se exige ese formato para no mandar a la API un nombre
 * con espacios, llaves o saltos que solo puede terminar en error de Meta.
 */
const TEMPLATE_NAME = /^[a-z0-9_]{1,512}$/;

/** Idioma de template Meta: `es`, `es_CO`, `es-CO`, `pt_BR`… */
const LANGUAGE = /^[a-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/;

export function validarTemplateName(raw: unknown): string {
  const name = String(raw ?? '').trim();
  if (!TEMPLATE_NAME.test(name)) {
    throw new BroadcastValidationError(
      'templateName inválido (solo minúsculas, dígitos y guion bajo, máx. 512)',
    );
  }
  return name;
}

/** Normaliza `es-CO` → `es_CO` (forma que espera Meta) y valida el formato. */
export function validarLanguage(raw: unknown): string {
  const lang = String(raw ?? '').trim().replace('-', '_');
  if (!LANGUAGE.test(lang)) {
    throw new BroadcastValidationError(
      'language inválido (usa formato Meta, ej. es_CO)',
    );
  }
  return lang;
}

/** Quita todo lo que no sea dígito; conserva el indicativo de país si viene. */
export function normalizarTelefonoBroadcast(raw: unknown): string {
  return String(raw ?? '').replace(/\D/g, '');
}

/** Número E.164 utilizable (solo dígitos) o null si la entrada no lo es. */
function telefonoValido(entrada: unknown): { numero: string; valido: boolean } {
  const texto = String(entrada ?? '').trim();
  const numero = normalizarTelefonoBroadcast(entrada);
  const formatoPermitido = /^\+?[\d\s().-]+$/.test(texto);
  return { numero, valido: formatoPermitido && /^[1-9]\d{9,14}$/.test(numero) };
}

const ERROR_TELEFONO = 'telefono inválido (usa E.164 de 10–15 dígitos)';

/**
 * Cuántas variables `{{n}}` usa la plantilla. Solo se admiten en el cuerpo:
 * las del encabezado o de botones con URL necesitan otro tipo de parámetro,
 * y las variables con nombre (`{{nombre}}`) todavía no se soportan.
 */
export function contarVariablesCuerpo(components: unknown[]): number {
  let maximo = 0;
  for (const c of components) {
    if (!c || typeof c !== 'object') continue;
    const comp = c as Record<string, unknown>;
    const texto = JSON.stringify({ ...comp, example: undefined });
    if (!texto.includes('{{')) continue;
    if (String(comp.type ?? '').toUpperCase() !== 'BODY') {
      throw new BroadcastValidationError(
        'La plantilla tiene variables en el encabezado o en los botones; por ahora solo se admiten en el cuerpo',
      );
    }
    const numeradas = [...texto.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
    if (!numeradas.length || /\{\{(?!\d+\}\})/.test(texto)) {
      throw new BroadcastValidationError('La plantilla usa variables con nombre; por ahora solo se admiten {{1}}, {{2}}…');
    }
    maximo = Math.max(maximo, ...numeradas);
  }
  return maximo;
}

/** Largo máximo de una variable de plantilla (nombre, pregrado). */
export const MAX_LARGO_VARIABLE = 60;

/** Meta rechaza variables con saltos de línea, tabulaciones o 4+ espacios seguidos. */
export function limpiarVariable(raw: unknown): string {
  return String(raw ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, MAX_LARGO_VARIABLE);
}

const CLAVE_CONTEXTO = /^[a-zA-Z_]{1,30}$/;

/** Contexto opaco por destinatario: pocas claves simples y valores cortos, o null. */
function limpiarContexto(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const limpio: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 10)) {
    if (!CLAVE_CONTEXTO.test(k) || typeof v !== 'string') continue;
    limpio[k] = v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100);
  }
  return Object.keys(limpio).length ? limpio : null;
}

export interface DatosDestinatario {
  /** Valores para `{{1}}`, `{{2}}`… en orden; se usan los que pida la plantilla. */
  parametros: string[];
  /** Se guarda para el flujo del bot solo si Meta confirma el envío. */
  contexto: Record<string, string> | null;
}

export interface DestinatariosConDatos extends DestinatariosClasificados {
  /** Alineado con `validos`. */
  datos: DatosDestinatario[];
}

/**
 * Como `clasificarDestinatarios`, pero cada entrada puede ser un teléfono o
 * `{ telefono, parametros?, contexto? }`: las campañas personalizan la
 * plantilla por persona y dejan contexto para cuando responda.
 */
export function clasificarDestinatariosConDatos(raw: unknown): DestinatariosConDatos {
  if (!Array.isArray(raw)) {
    throw new BroadcastValidationError('telefonos debe ser un arreglo');
  }
  if (raw.length === 0) {
    throw new BroadcastValidationError('La lista de destinatarios está vacía');
  }
  if (raw.length > MAX_BROADCAST_RECIPIENTS) {
    throw new BroadcastValidationError(`Máximo ${MAX_BROADCAST_RECIPIENTS} destinatarios por envío`);
  }

  const validos: string[] = [];
  const datos: DatosDestinatario[] = [];
  const vistos = new Set<string>();
  const invalidos: { numero: string; error: string }[] = [];
  let duplicadosOmitidos = 0;

  for (const entrada of raw) {
    const objeto = entrada && typeof entrada === 'object' && !Array.isArray(entrada)
      ? (entrada as Record<string, unknown>) : null;
    const { numero, valido } = telefonoValido(objeto ? objeto.telefono : entrada);
    if (!valido) { invalidos.push({ numero, error: ERROR_TELEFONO }); continue; }
    if (vistos.has(numero)) { duplicadosOmitidos++; continue; }
    vistos.add(numero);
    validos.push(numero);
    datos.push({
      parametros: Array.isArray(objeto?.parametros) ? (objeto!.parametros as unknown[]).map(limpiarVariable) : [],
      contexto: limpiarContexto(objeto?.contexto),
    });
  }

  return { validos, datos, invalidos, solicitados: raw.length, duplicadosOmitidos };
}

export interface DestinatariosClasificados {
  /** Dígitos E.164 (10–15), sin duplicados, en orden de aparición. */
  validos: string[];
  /** Entradas que no son un número utilizable, con el motivo. */
  invalidos: { numero: string; error: string }[];
  solicitados: number;
  duplicadosOmitidos: number;
}

/**
 * Normaliza, valida y deduplica la lista SIN fallar en bloque: cada entrada
 * inválida se reporta para que el resumen parcial la incluya en `fallidos`.
 * El límite de lote sí falla en bloque (es un error del emisor, no de un número).
 */
export function clasificarDestinatarios(raw: unknown): DestinatariosClasificados {
  if (!Array.isArray(raw)) {
    throw new BroadcastValidationError('telefonos debe ser un arreglo de strings');
  }
  if (raw.length === 0) {
    throw new BroadcastValidationError('La lista de destinatarios está vacía');
  }
  if (raw.length > MAX_BROADCAST_RECIPIENTS) {
    throw new BroadcastValidationError(
      `Máximo ${MAX_BROADCAST_RECIPIENTS} destinatarios por envío`,
    );
  }

  const validos: string[] = [];
  const vistos = new Set<string>();
  const invalidos: { numero: string; error: string }[] = [];
  let duplicadosOmitidos = 0;

  for (const entrada of raw) {
    const { numero, valido } = telefonoValido(entrada);
    if (!valido) {
      invalidos.push({ numero, error: ERROR_TELEFONO });
      continue;
    }
    if (vistos.has(numero)) { duplicadosOmitidos++; continue; }
    vistos.add(numero);
    validos.push(numero);
  }

  return { validos, invalidos, solicitados: raw.length, duplicadosOmitidos };
}
