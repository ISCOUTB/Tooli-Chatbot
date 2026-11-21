/** Cuántos mensajes del historial (preguntas y respuestas) recibe la IA. */
export const MAX_HISTORIAL = 10;

/**
 * Las últimas preguntas con sus respuestas, y siempre la primera pregunta con su
 * respuesta: así la IA puede contestar "¿qué te pregunté al principio?" sin
 * recibir toda la conversación.
 */
export function recortarHistorial<T>(historial: readonly T[], maximo = MAX_HISTORIAL): T[] {
  if (historial.length <= maximo) return [...historial];
  return [...historial.slice(0, 2), ...historial.slice(historial.length - (maximo - 2))];
}
