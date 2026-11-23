import Redis from 'ioredis';
import { config } from '../config';

const redis = new Redis(config.redis.url, { lazyConnect: true });

export interface Session {
  step: string;
  data: Record<string, string>;
}

export async function getSession(phoneNumber: string): Promise<Session | null> {
  const raw = await redis.get(`session:${phoneNumber}`);
  if (!raw) return null;
  return JSON.parse(raw) as Session;
}

export async function setSession(phoneNumber: string, session: Session): Promise<void> {
  await redis.setex(
    `session:${phoneNumber}`,
    config.redis.sessionTtl,
    JSON.stringify(session)
  );
}

export async function deleteSession(phoneNumber: string): Promise<void> {
  await redis.del(`session:${phoneNumber}`);
}

/**
 * Marca un messageId como procesado. Si ya estaba marcado, devuelve false
 * (no lo proceses de nuevo). TTL de 5 minutos para evitar consumo infinito.
 */
export async function claimMessageId(messageId: string): Promise<boolean> {
  const res = await redis.set(`msgproc:${messageId}`, '1', 'EX', 300, 'NX');
  return res === 'OK';
}
