/**
 * Avisos en vivo de la bandeja de atención.
 *
 * El bot, el webhook de Chatwoot y las acciones del panel publican aquí cada
 * cambio en una conversación con asesor, y cada panel abierto los recibe por
 * Server-Sent Events (GET /api/tools/atencion/eventos). Así el asesor ve un
 * mensaje nuevo al instante en vez de esperar el siguiente sondeo.
 *
 * El backend corre en un solo proceso (servidor web y workers juntos, ver
 * src/index.ts), así que basta un EventEmitter. Si algún día corre en varias
 * réplicas, esto tiene que pasar a Redis pub/sub.
 */

import { EventEmitter } from 'node:events';

export type TipoEventoAtencion = 'mensaje' | 'nueva' | 'estado' | 'asignacion' | 'presencia';

interface EventoBase {
  tipo: TipoEventoAtencion;
  ts: number;
}

export interface EventoConversacion extends EventoBase {
  tipo: Exclude<TipoEventoAtencion, 'presencia'>;
  conversacionId: number;
  /** true cuando escribió la persona: es lo único que amerita un aviso. */
  entrante?: boolean;
  nombre?: string;
  /** Vista previa corta para el aviso del navegador. */
  texto?: string;
}

export interface EventoPresencia extends EventoBase {
  tipo: 'presencia';
}

export type EventoAtencion = EventoConversacion | EventoPresencia;
type EventoPublicable = Omit<EventoConversacion, 'ts'> | Omit<EventoPresencia, 'ts'>;

const bus = new EventEmitter();
// Un oyente por panel abierto: no es una fuga, es el número de asesores.
bus.setMaxListeners(0);

const MAX_VISTA_PREVIA = 120;

export function publicarAtencion(evento: EventoPublicable): void {
  if (evento.tipo !== 'presencia' && (!Number.isSafeInteger(evento.conversacionId) || evento.conversacionId <= 0)) return;
  const texto = evento.tipo === 'presencia' ? undefined : evento.texto?.replace(/\s+/g, ' ').trim();
  bus.emit('evento', {
    ...evento,
    ...(texto ? { texto: texto.length > MAX_VISTA_PREVIA ? `${texto.slice(0, MAX_VISTA_PREVIA - 1)}…` : texto } : {}),
    ts: Date.now(),
  } satisfies EventoAtencion);
}

/** Devuelve la función que cancela la suscripción. */
export function suscribirAtencion(oyente: (evento: EventoAtencion) => void): () => void {
  bus.on('evento', oyente);
  return () => { bus.off('evento', oyente); };
}

/** Formato de un evento SSE: un nombre y una línea de datos JSON. */
export function formatoSse(evento: EventoAtencion): string {
  return `event: atencion\ndata: ${JSON.stringify(evento)}\n\n`;
}
