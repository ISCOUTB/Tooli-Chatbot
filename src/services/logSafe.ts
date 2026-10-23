/**
 * Enmascarado de datos personales para los logs.
 *
 * POR QUÉ:
 *   Los webhooks registraban cada mensaje entrante con el número completo y el
 *   texto completo — es decir, la conversación privada de un estudiante queda
 *   en texto plano en los logs del servidor, que se rotan, se copian y muchas
 *   veces se mandan a un servicio externo. Para depurar alcanza con saber
 *   *cuál* conversación es y *cuánto* mide el mensaje.
 *
 *   El patrón de enmascarado ya existía suelto en `src/flows/recordatorios.ts`;
 *   acá queda en un solo lugar para que todos los puntos de log usen el mismo.
 */

/** Límite de vista previa en `describeText`: evita volcar el mensaje al log por accidente. */
const MAX_PREVIEW = 80;

/** Largo máximo del mensaje dentro de `describeError`. */
const MAX_ERROR_MSG = 160;

/**
 * `573001234567` → `****4567`. Suficiente para identificar la conversación.
 * Los identificadores de cuatro dígitos o menos se ocultan por completo.
 */
export function maskPhone(phone: string | undefined | null): string {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `****${digits.slice(-4)}`;
}

/** `T00012345` → `T0****345`. Conserva el prefijo, que es lo que sirve para depurar. */
export function maskCode(code: string | undefined | null): string {
  const c = String(code ?? '').trim();
  if (c.length <= 4) return '****';
  return `${c.slice(0, 2)}****${c.slice(-3)}`;
}

/**
 * No se loguea el contenido del mensaje: solo su longitud y las primeras
 * palabras cuando hace falta reconstruir un flujo. Por defecto, ni eso.
 */
export function describeText(text: unknown, preview = 0): string {
  if (typeof text !== 'string') {
    if (text === undefined || text === null) return '0 chars';
    return `non-string ${typeof text}`;
  }
  const puntos = Array.from(text);
  const length = puntos.length;
  if (preview <= 0) return `${length} chars`;
  const limit = Math.min(preview, MAX_PREVIEW);
  const corte = puntos.slice(0, limit).join('').replace(/\s+/g, ' ');
  return `${length} chars: "${corte}${length > limit ? '…' : ''}"`;
}

/** Oculta el buzón y conserva el dominio para distinguir correo institucional. */
export function maskEmail(email: string | undefined | null): string {
  if (typeof email !== 'string') return '****';
  const parts = email.trim().split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return '****';
  return `***@${parts[1]}`;
}

/** Describe un ID externo sin dejar un valor reutilizable en el log. */
export function describeId(id: string | number | undefined | null): string {
  const value = typeof id === 'string' ? id.trim() : String(id ?? '').trim();
  if (!value) return 'noid';
  if (value.length <= 8) return `**** (${value.length} chars)`;
  return `${value.slice(0, 4)}… (${value.length} chars)`;
}

/**
 * Resume un error sin serializar payloads, headers, tokens ni configuración
 * de Axios. También redacta PII que haya quedado dentro de `message`.
 */
export function describeError(err: unknown): string {
  if (err === null || err === undefined) return 'unknown error';
  if (typeof err === 'string') return redactErrorMessage(err).slice(0, MAX_ERROR_MSG) || 'unknown error';
  if (typeof err !== 'object') return `non-object ${typeof err}`;

  const error = err as Record<string, unknown>;
  const name = typeof error.name === 'string' && error.name ? error.name : 'Error';
  const code = typeof error.code === 'string' || typeof error.code === 'number'
    ? ` code=${error.code}`
    : '';
  let status = '';
  if (error.response && typeof error.response === 'object') {
    const responseStatus = (error.response as Record<string, unknown>).status;
    if (typeof responseStatus === 'number') status = ` status=${responseStatus}`;
  } else if (typeof error.status === 'number') {
    status = ` status=${error.status}`;
  }
  const rawMessage = typeof error.message === 'string' ? error.message : '';
  const message = redactErrorMessage(rawMessage).slice(0, MAX_ERROR_MSG);
  return `[${name}${code}${status}]${message ? ` ${message}` : ''}`;
}

/** Para fallos de proveedores: solo el estado HTTP, nunca message ni payload. */
export function describeExternalError(err: unknown): string {
  if (!err || typeof err !== 'object') return 'external error';
  const value = err as Record<string, unknown>;
  const response = value.response;
  const responseStatus = response && typeof response === 'object'
    ? (response as Record<string, unknown>).status
    : undefined;
  const status = typeof responseStatus === 'number' ? responseStatus : value.status;
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? `external status=${status}`
    : 'external error';
}

function redactErrorMessage(message: string): string {
  return message
    .replace(/\s+/g, ' ')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, match => maskEmail(match))
    .replace(/\d{7,}/g, match => maskPhone(match));
}
