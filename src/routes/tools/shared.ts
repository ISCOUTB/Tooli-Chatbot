/** Utilidades compartidas por las rutas del panel. */

import { config } from '../../config';
import { getBotUser } from '../../services/botUserService';
import { ultimoEntranteVerificable, ventanaTextoLibreAbierta } from '../../services/replyWindow';

/**
 * Deja solo los dígitos de un número. Los teléfonos llegan escritos de muchas
 * formas (con +, espacios, guiones) pero en Redis y en WhatsApp la clave es
 * siempre la cadena de dígitos.
 */
export function normalizePhone(input: string): string {
  return String(input ?? '').replace(/\D/g, '');
}

/**
 * Restricción REAL de la WhatsApp Business Platform: fuera de las 24 h desde el
 * último mensaje de la persona, Meta solo acepta plantillas aprobadas. Devuelve
 * el motivo para mostrarle al asesor, o null si se puede escribir texto libre.
 */
export async function motivoVentanaCerrada(phone: string): Promise<string | null> {
  if (config.messagingAdapter !== 'meta') return null;
  const info = await getBotUser(phone);
  const now = Date.now();
  const ultimoEntranteTs = ultimoEntranteVerificable(info.recentMessages, now);
  if (ventanaTextoLibreAbierta(ultimoEntranteTs, now)) return null;
  const detalle = ultimoEntranteTs === null
    ? 'No hay un mensaje entrante reciente verificable para este contacto. '
    : `Han pasado ${Math.floor((now - ultimoEntranteTs) / (60 * 60 * 1000))} horas desde su último mensaje. `;
  return detalle +
    'WhatsApp solo permite texto libre dentro de las 24 horas siguientes; ' +
    'para retomar el contacto hay que usar una plantilla aprobada por Meta.';
}
