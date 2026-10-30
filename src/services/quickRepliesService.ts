/**
 * Respuestas rápidas del equipo de asesores.
 *
 * POR QUÉ:
 *   Los asesores contestan las mismas cinco preguntas todo el día (costos,
 *   fechas de inscripción, dónde queda el campus, cómo aplicar a beca). Sin un
 *   lugar donde guardarlas, cada uno reescribe su versión y las respuestas
 *   terminan diciendo cosas distintas según quién conteste.
 *
 * QUÉ ES REAL:
 *   Todo. Se guardan en Redis, son compartidas por todo el equipo, y el panel
 *   las inserta en el composer de la bandeja. No depende de nada externo.
 *
 * PLACEHOLDERS:
 *   El texto puede traer {nombre}; el panel lo reemplaza con el nombre que el
 *   bot capturó en la conversación antes de insertar. Si no hay nombre, se
 *   sustituye por un saludo neutro — nunca se envía "{nombre}" literal a un
 *   estudiante.
 */

import Redis from 'ioredis';
import { config } from '../config';

const redis = new Redis(config.redis.url);

const KEY = 'quick_replies';
const MAX_RESPUESTAS = 60;

export type AreaRespuesta = 'todas' | 'pregrado' | 'posgrado';

export interface QuickReply {
  id: string;
  titulo: string;
  texto: string;
  area: AreaRespuesta;
  creadoPor: string;
  creadoEn: number;
}

export class QuickReplyError extends Error {}

/** Semilla: si nadie ha creado ninguna, el equipo arranca con algo útil en vez
 *  de una lista vacía. Son plantillas genéricas y verificables, no datos
 *  inventados sobre la universidad (fechas y cifras las pone el asesor). */
const SEMILLA: Array<Omit<QuickReply, 'id' | 'creadoPor' | 'creadoEn'>> = [
  {
    titulo: 'Saludo inicial',
    texto: 'Hola {nombre} 👋 Soy del equipo de admisiones de la UTB. ¿En qué te puedo ayudar?',
    area: 'todas',
  },
  {
    titulo: 'Pedir datos para asesoría',
    texto: 'Con gusto te ayudo, {nombre}. Para darte información precisa, ¿me confirmas el programa que te interesa y si prefieres que te llamemos o seguimos por aquí?',
    area: 'todas',
  },
  {
    titulo: 'Enviar enlace de inscripción',
    texto: 'Te comparto el enlace de inscripciones y admisiones 👇\nhttps://www.utb.edu.co/inscripciones-y-admisiones/\n\nSi te queda alguna duda del proceso, escríbeme y la resolvemos.',
    area: 'todas',
  },
  {
    titulo: 'Becas y apoyo financiero',
    texto: 'Claro que sí, {nombre}. Acá están las becas y opciones de financiación vigentes 👇\nhttps://www.utb.edu.co/apoyo-financiero/becas/\n\n¿Quieres que revisemos juntos cuál se ajusta a tu caso?',
    area: 'todas',
  },
  {
    titulo: 'Cierre de conversación',
    texto: '¡Listo, {nombre}! Cualquier cosa que necesites me escribes por aquí. Que tengas un buen día 😊',
    area: 'todas',
  },
];

function nuevoId(): string {
  return `qr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export async function listQuickReplies(): Promise<QuickReply[]> {
  const raw = await redis.get(KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as QuickReply[];
    } catch {
      // Si el JSON se corrompió, es mejor devolver la semilla que romper la
      // bandeja entera por una respuesta rápida.
      console.error('[quickReplies] JSON corrupto en Redis, devolviendo semilla');
    }
  }
  return SEMILLA.map((s) => ({ ...s, id: nuevoId(), creadoPor: 'sistema', creadoEn: 0 }));
}

async function guardar(lista: QuickReply[]): Promise<void> {
  await redis.set(KEY, JSON.stringify(lista));
}

export async function addQuickReply(
  input: { titulo: string; texto: string; area?: AreaRespuesta },
  creadoPor: string,
): Promise<QuickReply> {
  const titulo = (input.titulo ?? '').trim();
  const texto = (input.texto ?? '').trim();
  if (titulo.length < 2 || titulo.length > 60) throw new QuickReplyError('El título debe tener entre 2 y 60 caracteres');
  if (texto.length < 2 || texto.length > 2000) throw new QuickReplyError('El texto debe tener entre 2 y 2000 caracteres');

  const area: AreaRespuesta = input.area === 'pregrado' || input.area === 'posgrado' ? input.area : 'todas';

  const lista = await listQuickReplies();
  if (lista.length >= MAX_RESPUESTAS) throw new QuickReplyError(`Máximo ${MAX_RESPUESTAS} respuestas rápidas`);

  const nueva: QuickReply = { id: nuevoId(), titulo, texto, area, creadoPor, creadoEn: Date.now() };
  // Si todavía estaba la semilla (nunca se guardó nada), se persiste completa
  // junto con la nueva: si no, agregar una haría desaparecer las demás.
  await guardar([...lista, nueva]);
  return nueva;
}

export async function deleteQuickReply(id: string): Promise<boolean> {
  const lista = await listQuickReplies();
  const filtrada = lista.filter((q) => q.id !== id);
  if (filtrada.length === lista.length) return false;
  await guardar(filtrada);
  return true;
}

export async function renombrarUsuarioEnRespuestasRapidas(viejo: string, nuevo: string): Promise<void> {
  const raw = await redis.get(KEY);
  if (!raw) return;
  const lista = JSON.parse(raw) as QuickReply[];
  let cambio = false;
  const actualizada = lista.map((reply) => {
    if (reply.creadoPor !== viejo) return reply;
    cambio = true;
    return { ...reply, creadoPor: nuevo };
  });
  if (cambio) await redis.set(KEY, JSON.stringify(actualizada), 'KEEPTTL');
}
