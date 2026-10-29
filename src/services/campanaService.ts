/**
 * Estado de las campañas que inicia el bot (envíos masivos con plantilla).
 *
 * - Contexto por persona: lo que la campaña sabía de ella (relación con la
 *   UTB, pregrado, nombre). Se guarda solo cuando Meta confirma el envío y
 *   lo usa el flujo de recomendación cuando la persona responde.
 * - Bajas: quien tocó "No me interesa" no vuelve a recibir campañas. La cola
 *   de envíos lo revisa antes de cada envío (Ley 1581: puede revocar la
 *   autorización en cualquier momento).
 */
import Redis from 'ioredis';
import { config } from '../config';

const redis = new Redis(config.redis.url, { lazyConnect: true });

const BAJAS = 'campana:bajas';
const CONTEXTO = (telefono: string) => `campana:contexto:${telefono}`;

/** Una campaña suele responderse en días; pasado un mes el contexto ya no sirve. */
export const TTL_CONTEXTO_SEGUNDOS = 30 * 24 * 60 * 60;

export type ContextoCampana = Record<string, string>;

export async function estaDadoDeBaja(telefono: string): Promise<boolean> {
  return (await redis.sismember(BAJAS, telefono)) === 1;
}

/** Registra la baja y borra el contexto pendiente: no se le vuelve a escribir. */
export async function darDeBaja(telefono: string): Promise<void> {
  await redis.multi().sadd(BAJAS, telefono).del(CONTEXTO(telefono)).exec();
}

export async function guardarContextoCampana(telefono: string, contexto: ContextoCampana): Promise<void> {
  await redis.setex(CONTEXTO(telefono), TTL_CONTEXTO_SEGUNDOS, JSON.stringify(contexto));
}

export async function leerContextoCampana(telefono: string): Promise<ContextoCampana | null> {
  const raw = await redis.get(CONTEXTO(telefono));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'),
    );
  } catch {
    return null;
  }
}

export async function borrarContextoCampana(telefono: string): Promise<void> {
  await redis.del(CONTEXTO(telefono));
}
