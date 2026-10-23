export const VENTANA_TEXTO_LIBRE_MS = 24 * 60 * 60 * 1000;

/** Devuelve el último mensaje entrante verificable del historial local. */
export function ultimoEntranteVerificable(
  messages: Array<{ ts: number; direction: 'in' | 'out' }>,
  now: number,
): number | null {
  const timestamps = messages
    .filter(message => message.direction === 'in' && Number.isFinite(message.ts) && message.ts <= now)
    .map(message => message.ts);
  return timestamps.length ? Math.max(...timestamps) : null;
}

export function ventanaTextoLibreAbierta(lastInboundTs: number | null, now: number): boolean {
  return lastInboundTs !== null && now - lastInboundTs < VENTANA_TEXTO_LIBRE_MS;
}
