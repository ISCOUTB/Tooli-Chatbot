/**
 * Qué se puede enseñar de una encuesta de NutriA por una puerta pública.
 *
 * Vive aparte del router a propósito, por dos razones:
 *
 *  1. Es una decisión de privacidad, no de transporte, y así se lee sola.
 *  2. `routes/tools/nutria.ts` arrastra el cliente de Redis y el de Google
 *     Sheets nada más importarlo, así que una prueba que lo importe abre
 *     conexiones y **no termina nunca**. Desde aquí la regla se prueba en
 *     medio segundo.
 */

import { maskPhone } from './logSafe';

/**
 * Índice de la columna del WhatsApp en las filas de la encuesta.
 *
 * Las filas llegan como arreglos posicionales (`A2:W`) y el orden lo fija
 * `guardarEncuestaNutria`: `[fecha, whatsapp, edad, …]`. Es la columna B.
 */
export const COLUMNA_WHATSAPP = 1;

/**
 * Una fila de encuesta con el teléfono reducido a `****1234`.
 *
 * Se **enmascara en su sitio, no se quita**: la landing indexa las columnas
 * por posición, así que eliminar una desplazaría todas las demás y rompería
 * el panel entero en silencio.
 */
export function filaSinTelefono(fila: string[]): string[] {
  if (fila.length <= COLUMNA_WHATSAPP) return fila;
  const copia = [...fila];
  copia[COLUMNA_WHATSAPP] = maskPhone(copia[COLUMNA_WHATSAPP]);
  return copia;
}
