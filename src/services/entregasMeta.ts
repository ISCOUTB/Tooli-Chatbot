/**
 * Confirmaciones de envío de Meta (los `statuses` del webhook). WhatsApp entrega
 * las imágenes más lento que el texto: si un mensaje sale apenas la API acepta
 * un flyer, le llega a la persona antes que el flyer. Quien necesite el orden
 * espera aquí a que Meta confirme que sus mensajes salieron.
 *
 * Vive en memoria: el webhook y los flujos corren en el mismo proceso. Si una
 * confirmación no llega, la espera vence sola y el bot sigue.
 */
const ESTADOS_DE_SALIDA = new Set(['sent', 'delivered', 'read', 'failed']);
const MAX_ADELANTADOS = 500;

const esperando = new Map<string, () => void>();
/** Confirmaciones que llegaron antes de que alguien las esperara. */
const adelantados = new Set<string>();

export function avisarEstado(idMensaje: string, estado: string): void {
  if (!idMensaje || !ESTADOS_DE_SALIDA.has(estado)) return;
  const resolver = esperando.get(idMensaje);
  if (resolver) {
    esperando.delete(idMensaje);
    resolver();
    return;
  }
  adelantados.add(idMensaje);
  // Llegan estados de todos los mensajes del bot: se guardan solo los más recientes.
  while (adelantados.size > MAX_ADELANTADOS) adelantados.delete(adelantados.values().next().value as string);
}

/** true si Meta confirmó todos antes de `maxMs`; false si venció la espera. */
export async function esperarSalida(ids: readonly string[], maxMs = 6_000): Promise<boolean> {
  const pendientes = ids.filter((id) => id && !adelantados.delete(id));
  if (!pendientes.length) return true;
  let reloj: NodeJS.Timeout | undefined;
  const todos = Promise.all(pendientes.map((id) => new Promise<void>((r) => esperando.set(id, r)))).then(() => true);
  const vence = new Promise<boolean>((r) => { reloj = setTimeout(() => r(false), maxMs); });
  try {
    return await Promise.race([todos, vence]);
  } finally {
    if (reloj) clearTimeout(reloj);
    for (const id of pendientes) esperando.delete(id);
  }
}
