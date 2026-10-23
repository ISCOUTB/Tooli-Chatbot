/**
 * Reglas de validación de un broadcast por templates de Meta.
 *
 * Puro a propósito (igual que `reminderValidation.ts`): `broadcastService.ts`
 * importa axios/config y estas reglas se prueban sin red
 * (ver broadcastValidation.test.ts).
 *
 * QUÉ NO ES:
 *   Esto no promete texto libre fuera de la ventana de 24 h de Meta. El único
 *   envío permitido es un template APROBADO (ver `listApprovedTemplates`); si el
 *   template requiere parámetros {{1}}, Meta responde error por destinatario y
 *   eso se reporta en `fallidos` sin tumbar el resto.
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
    const texto = String(entrada ?? '').trim();
    const numero = normalizarTelefonoBroadcast(entrada);
    const formatoPermitido = /^\+?[\d\s().-]+$/.test(texto);
    if (!formatoPermitido || !/^[1-9]\d{9,14}$/.test(numero)) {
      invalidos.push({ numero, error: 'telefono inválido (usa E.164 de 10–15 dígitos)' });
      continue;
    }
    if (vistos.has(numero)) { duplicadosOmitidos++; continue; }
    vistos.add(numero);
    validos.push(numero);
  }

  return { validos, invalidos, solicitados: raw.length, duplicadosOmitidos };
}
