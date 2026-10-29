/**
 * Campañas del flujo de recomendación: cuando el bot contacta a la persona
 * con una plantilla de Meta (envío masivo del panel) en vez de esperar a
 * que ella escriba. Ver `docs/flujo-recomendacion-posgrados.md`.
 *
 * Convención de la plantilla: `{{1}}` = nombre, `{{2}}` = pregrado. Puede
 * usar una, las dos o ninguna; se llenan las que pida.
 *
 * Puro: prepara los destinatarios para la cola de envíos y lee la respuesta.
 */
import { normalize } from './validation';
import { getPrograma } from '../services/catalogoUtb';
import { limpiarVariable } from '../services/broadcastValidation';
import { FAMILIAS_EXTERNAS, interpretarPregrado } from './recomendacionPregrado';
import type { Relacion } from './recomendacionView';

export const RELACIONES_CAMPANA: readonly Relacion[] = ['egresado_utb', 'estudiante_utb', 'externo'];

export class CampanaInvalidaError extends Error {}

export interface DestinatarioCampana {
  telefono: string;
  parametros: string[];
  contexto: Record<string, string>;
}

/** "LAURA GÓMEZ" → "Laura Gómez"; lo demás se respeta tal cual llegó. */
export function formatearNombre(raw: unknown): string {
  const nombre = limpiarVariable(raw);
  if (nombre !== nombre.toUpperCase()) return nombre;
  return nombre.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_m, sep: string, letra: string) => sep + letra.toUpperCase());
}

/**
 * Convierte la lista de la campaña (`{ telefono, nombre, pregrado }`) en
 * destinatarios para la cola. El pregrado escrito se asocia con el mismo
 * motor del flujo; si es de la UTB y la campaña es para la UTB, la plantilla
 * lleva el nombre oficial del programa. Los teléfonos los valida la cola.
 */
export function prepararDestinatariosCampana(raw: unknown, relacionRaw: unknown): DestinatarioCampana[] {
  const relacion = RELACIONES_CAMPANA.find((r) => r === relacionRaw);
  if (!relacion) throw new CampanaInvalidaError('relacion debe ser egresado_utb, estudiante_utb o externo');
  if (!Array.isArray(raw)) throw new CampanaInvalidaError('destinatarios debe ser un arreglo');

  return raw.map((entrada) => {
    const d = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>;
    const nombre = formatearNombre(d.nombre);
    const pregradoEscrito = limpiarVariable(d.pregrado);
    const interpretado = pregradoEscrito ? interpretarPregrado(pregradoEscrito) : null;

    const contexto: Record<string, string> = { relacion, ...(nombre ? { nombre } : {}) };
    let pregradoPlantilla = pregradoEscrito;
    if (interpretado?.tipo === 'utb') {
      contexto.pregradoId = interpretado.pregradoId;
      // Para egresados y estudiantes UTB va el nombre oficial; a los de afuera, lo que estudiaron.
      if (relacion !== 'externo') pregradoPlantilla = getPrograma(interpretado.pregradoId)?.nombre ?? pregradoEscrito;
    } else if (interpretado?.tipo === 'familia') {
      contexto.familiaId = interpretado.familiaId;
    }
    return { telefono: String(d.telefono ?? ''), parametros: [nombre, pregradoPlantilla], contexto };
  });
}

// ── Respuesta de la persona ─────────────────────────────────────────────────

export type RespuestaCampana = { tipo: 'ver' | 'baja'; fuerte: boolean };

// Textos de los botones de la plantilla y frases equivalentes: valen en cualquier paso.
const VER_FUERTE = ['ver mis opciones', 'ver opciones', 'ver mis posgrados', 'quiero ver mis opciones'];
const BAJA_FUERTE = [
  'no me interesa', 'no estoy interesado', 'no estoy interesada', 'darme de baja', 'dar de baja', 'baja',
  'no quiero recibir mensajes', 'no me escriban mas', 'stop',
];
// Respuestas cortas: solo cuentan si la persona no estaba en medio de otro paso.
const VER_DEBIL = ['si', 'me interesa', 'si me interesa', 'quiero', 'claro', 'hola', 'buenas', 'informacion'];
const BAJA_DEBIL = ['no', 'no gracias', 'no por ahora'];

/**
 * Lee la respuesta a una campaña. `fuerte` = texto de un botón de la
 * plantilla o algo que no se presta a confusión; un "sí" o un "no" solo vale
 * como respuesta a la campaña si la persona no estaba respondiendo otra cosa.
 */
export function parseRespuestaCampana(texto: string): RespuestaCampana | null {
  const n = normalize(texto ?? '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  if (BAJA_FUERTE.includes(n) || n.startsWith('no me interesa')) return { tipo: 'baja', fuerte: true };
  if (VER_FUERTE.includes(n)) return { tipo: 'ver', fuerte: true };
  if (BAJA_DEBIL.includes(n)) return { tipo: 'baja', fuerte: false };
  if (VER_DEBIL.includes(n)) return { tipo: 'ver', fuerte: false };
  return null;
}

/** Perfil de recomendación guardado en el contexto, solo si sigue siendo válido. */
export function perfilDeContexto(contexto: Record<string, string>): { pregradoId: string; familiaId: string } | null {
  if (contexto.pregradoId && getPrograma(contexto.pregradoId)) return { pregradoId: contexto.pregradoId, familiaId: '' };
  if (contexto.familiaId && FAMILIAS_EXTERNAS.some((f) => f.id === contexto.familiaId)) return { pregradoId: '', familiaId: contexto.familiaId };
  return null;
}

/** Usa el nombre como vino en la lista (igual que la plantilla): puede traer el apellido primero. */
export function saludoCampana(contexto: Record<string, string>): string {
  const nombre = contexto.nombre ?? '';
  const perfil = perfilDeContexto(contexto);
  const pregrado = perfil?.pregradoId
    ? getPrograma(perfil.pregradoId)?.nombre
    : FAMILIAS_EXTERNAS.find((f) => f.id === perfil?.familiaId)?.etiqueta;
  return (
    `¡Hola${nombre ? `, ${nombre}` : ''}! 👋 Qué bueno que te interese.` +
    (pregrado ? `\n\nTe muestro posgrados de la UTB pensados para tu pregrado (${pregrado}).` : '')
  );
}

export const CONFIRMACION_BAJA =
  'Listo, no te enviaremos más mensajes de campañas de Posgrados UTB 🙏\n\n' +
  'Si algún día quieres información, escríbenos cuando quieras y con gusto te ayudamos.';
