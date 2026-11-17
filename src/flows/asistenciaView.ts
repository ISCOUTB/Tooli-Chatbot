/**
 * Vista del registro de asistencia por QR: textos y lectura de respuestas,
 * sin mensajería ni Redis, para probarlos directo con `node:test`.
 * Los pasos están en `asistencia.ts`.
 */
import { normalize } from './validation';

const LARGO_CODIGO = 6;

/** Mensaje que el QR deja escrito en WhatsApp; la persona solo toca enviar. */
export function textoQr(codigo: string): string {
  return `Registrar mi asistencia: ${codigo}`;
}

export function enlaceWhatsApp(numeroBot: string, codigo: string): string {
  return `https://wa.me/${numeroBot}?text=${encodeURIComponent(textoQr(codigo))}`;
}

/**
 * Código de asistencia si el mensaje es el del QR, o null.
 *
 * Solo dispara con "asistencia" seguido del separador y de seis caracteres que
 * mezclan letras y números. "Quiero información sobre asistencia médica" o
 * "asistencia semana" no son un código y siguen al flujo normal.
 */
export function parseCodigoAsistencia(texto: string): string | null {
  const n = normalize(String(texto ?? ''));
  if (n.length > 80) return null;
  const m = /\basistencia\s*[:#-]\s*([a-z0-9]+)\s*$/.exec(n);
  if (!m || m[1].length !== LARGO_CODIGO) return null;
  if (!/\d/.test(m[1]) || !/[a-z]/.test(m[1])) return null;
  return m[1].toUpperCase();
}

export function pedirConsentimiento(nombreEvento: string): string {
  return (
    `Vas a registrar tu asistencia a *${nombreEvento}*.\n\n` +
    '🔒 ¿Autorizas el tratamiento de tus datos personales conforme a la *Ley 1581 de 2012* ' +
    'y que la UTB te contacte por este medio?'
  );
}

export const CONSENTIMIENTO_NEGADO =
  'Entendido, no registré tu asistencia ni guardé tus datos 👍\n\n' +
  'Si cambias de opinión, vuelve a escanear el código del evento.';

export const PEDIR_NOMBRE = '✍️ ¿Cuál es tu *nombre completo*?';

export const NOMBRE_INVALIDO = 'Escribe tu nombre completo (mínimo 3 letras) ✍️';

export function pedirCorreo(nombre: string): string {
  return `Gracias, ${primerNombre(nombre)} 🙌\n\n📧 ¿Cuál es tu *correo*?\n\n_Escribe *omitir* si prefieres no darlo._`;
}

export const CORREO_INVALIDO = 'Ese correo no parece válido. Escríbelo de nuevo o responde *omitir*.';

export const EVENTO_NO_DISPONIBLE =
  'Ese código de asistencia no está activo: puede que el evento ya haya cerrado el registro. ' +
  'Pídele al organizador el código vigente 🙏';

export const NO_SE_PUDO_REGISTRAR =
  'No pude registrar tu asistencia desde este número. Acércate al organizador del evento para que te anote 🙏';

export function yaRegistrado(nombreEvento: string): string {
  return `✅ Ya estabas en la lista de *${nombreEvento}*. No tienes que hacer nada más.`;
}

export function confirmacion(nombre: string, nombreEvento: string): string {
  const saludo = nombre ? `¡Listo, ${primerNombre(nombre)}!` : '¡Listo!';
  return (
    `✅ ${saludo} Tu asistencia a *${nombreEvento}* quedó registrada.\n\n` +
    '_Escribe *menu* cuando quieras conocer los programas de la UTB._'
  );
}

export function primerNombre(nombre: string): string {
  return String(nombre ?? '').trim().split(/\s+/)[0] ?? '';
}

/** Nombre escrito por la persona, o null si no sirve como nombre. */
export function parseNombre(texto: string): string | null {
  const nombre = String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const letras = nombre.replace(/[^\p{L}]/gu, '');
  return letras.length >= 3 && !/\d{4,}/.test(nombre) ? nombre : null;
}

export function quiereOmitir(texto: string): boolean {
  return ['omitir', 'no', 'no tengo', 'saltar', 'ninguno', 'paso'].includes(normalize(String(texto ?? '')));
}
