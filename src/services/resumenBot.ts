/**
 * Resumen con IA de lo que una persona habló con el bot, para que el asesor
 * que toma la conversación no tenga que leer todo el historial.
 *
 * Usa el mismo historial que ve el panel (`activity:*`, los últimos 50
 * mensajes), que ya llega sin contraseñas, códigos ni otros datos sensibles
 * (activityPrivacy.ts). El resumen se guarda y solo se vuelve a pedir si la
 * persona escribió algo nuevo.
 */
import Redis from 'ioredis';
import { config } from '../config';

export interface MensajeBot {
  ts: number;
  direction: 'in' | 'out';
  text: string;
}

export interface ResumenBot {
  texto: string;
  /** Hora del último mensaje que alcanzó a leer. */
  hastaTs: number;
  generadoEn: number;
}

export class ResumenNoDisponibleError extends Error {}
/** El asesor pidió demasiados resúmenes nuevos en poco tiempo. */
export class ResumenLimiteError extends Error {}

const MAX_CARACTERES = 6000;

/** El historial como guion legible, del más viejo al más nuevo, sin pasarse del largo. */
export function transcripcion(mensajes: MensajeBot[]): string {
  const lineas = [...mensajes]
    .filter(m => m && typeof m.text === 'string' && m.text.trim())
    .sort((a, b) => a.ts - b.ts)
    .map(m => `${m.direction === 'in' ? 'Persona' : 'Bot'}: ${m.text.replace(/\s+/g, ' ').trim()}`);
  // Si no cabe, se queda lo más reciente: es lo que explica por qué pidió asesor.
  const out: string[] = [];
  let largo = 0;
  for (let i = lineas.length - 1; i >= 0; i--) {
    if (largo + lineas[i].length > MAX_CARACTERES) break;
    out.unshift(lineas[i]);
    largo += lineas[i].length + 1;
  }
  return out.join('\n');
}

export const INSTRUCCIONES = [
  'Ayudas a un asesor de admisiones de la Universidad Tecnológica de Bolívar (UTB).',
  'Te paso lo que una persona habló por WhatsApp con el bot antes de pedir un asesor.',
  'Escribe en español un resumen de máximo 3 viñetas cortas (empieza cada una con "• "):',
  'qué busca o pregunta la persona; qué datos dio (programa de interés, si es estudiante, egresada o de otra universidad);',
  'y qué quedó pendiente o por qué pidió un asesor.',
  'No inventes nada: si algo no aparece, no lo menciones. No copies números de documento, códigos, correos ni teléfonos.',
  'No saludes ni des recomendaciones al asesor.',
].join(' ');

export type Completar = (sistema: string, usuario: string) => Promise<string>;

const completarConOpenAI: Completar = async (sistema, usuario) => {
  if (!config.openai.apiKey) throw new ResumenNoDisponibleError('El resumen con IA no está configurado.');
  const { default: OpenAI } = await import('openai');
  const cliente = new OpenAI({ apiKey: config.openai.apiKey });
  const r = await cliente.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 220,
    temperature: 0.2,
    messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }],
  });
  return String(r.choices?.[0]?.message?.content ?? '').trim();
};

export interface AlmacenResumen {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, segundos: number): Promise<void>;
}

const redis = new Redis(config.redis.url, { lazyConnect: true });
const REDIS_RESUMEN: AlmacenResumen = {
  get: (key) => redis.get(key),
  set: async (key, value, segundos) => { await redis.set(key, value, 'EX', segundos); },
};
const CLAVE = (telefono: string) => `atencion:resumen:${telefono}`;
const TTL_SEGUNDOS = 7 * 24 * 60 * 60;

/**
 * El resumen de la conversación con el bot, o null si no hay nada que resumir.
 * `forzar` lo vuelve a pedir aunque no haya mensajes nuevos. `permitir` se
 * consulta solo antes de pedirlo a la IA: leer el guardado no gasta el límite.
 */
export async function resumirConversacionBot(
  telefono: string, mensajes: MensajeBot[],
  { forzar = false, completar = completarConOpenAI, almacen = REDIS_RESUMEN, permitir }: {
    forzar?: boolean; completar?: Completar; almacen?: AlmacenResumen; permitir?: () => Promise<boolean>;
  } = {},
): Promise<ResumenBot | null> {
  const guion = transcripcion(mensajes);
  if (!guion || !mensajes.some(m => m.direction === 'in')) return null;
  const hastaTs = Math.max(...mensajes.map(m => m.ts));
  if (!forzar) {
    try {
      const guardado = JSON.parse((await almacen.get(CLAVE(telefono))) ?? 'null') as ResumenBot | null;
      if (guardado && guardado.hastaTs === hastaTs && guardado.texto) return guardado;
    } catch { /* sin caché se pide de nuevo */ }
  }
  if (permitir && !(await permitir())) {
    throw new ResumenLimiteError('Pediste muchos resúmenes en la última hora. Espera un poco.');
  }
  const texto = String(await completar(INSTRUCCIONES, guion) ?? '').trim().slice(0, 1200);
  if (!texto) throw new ResumenNoDisponibleError('La IA no devolvió un resumen. Intenta de nuevo.');
  const resumen: ResumenBot = { texto, hastaTs, generadoEn: Date.now() };
  await almacen.set(CLAVE(telefono), JSON.stringify(resumen), TTL_SEGUNDOS).catch(() => {});
  return resumen;
}
