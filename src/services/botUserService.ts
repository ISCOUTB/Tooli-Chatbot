import Redis from 'ioredis';
import { config } from '../config';
import { sanitizeActivityText } from './activityPrivacy';

const redis = new Redis(config.redis.url);

export interface BotUserInfo {
  phone: string;
  // `session.data` solo trae lo que los flujos actuales capturan (nombre,
  // correo, programa de interés) — no hay semestre/carrera todavía porque
  // ningún flujo los pregunta ni hay sistema universitario conectado del que
  // traerlos. Ver PENDIENTES_PANEL_ASESORES.md (sección 1) antes de agregar
  // esos campos aquí o en el CRM del panel.
  session: { step: string; data: Record<string, string> } | null;
  banned: boolean;
  banReason?: string;
  aiDisabled: boolean;
  recentMessages: Array<{ ts: number; direction: 'in' | 'out'; text: string }>;
}

const BAN_KEY = (phone: string) => `ban:${phone}`;
const ACTIVITY_KEY = (phone: string) => `activity:${phone}`;
const AI_DISABLED_KEY = (phone: string) => `ai_disabled:${phone}`;

export async function getBotUser(phone: string): Promise<BotUserInfo> {
  const [sessionRaw, banRaw, activityRaw, aiDisabledRaw] = await Promise.all([
    redis.get(`session:${phone}`),
    redis.get(BAN_KEY(phone)),
    redis.lrange(ACTIVITY_KEY(phone), 0, 49),
    redis.get(AI_DISABLED_KEY(phone)),
  ]);

  return {
    phone,
    session: sessionRaw ? JSON.parse(sessionRaw) : null,
    banned: !!banRaw,
    banReason: banRaw ?? undefined,
    aiDisabled: !!aiDisabledRaw,
    recentMessages: activityRaw
      .map(s => {
        try { return JSON.parse(s); } catch { return null; }
      })
      .filter(Boolean),
  };
}

/**
 * Enciende/apaga la IA para un usuario puntual — cuando está apagada, el flujo
 * de chat (aiChat.ts) escala directo a un asesor humano en vez de responder
 * con el modelo. Pensado para que un asesor tome el control de una conversación
 * sin tener que banear al usuario (patrón "IA on/off" por conversación).
 */
export async function setAiEnabled(phone: string, enabled: boolean): Promise<void> {
  if (enabled) await redis.del(AI_DISABLED_KEY(phone));
  else await redis.set(AI_DISABLED_KEY(phone), '1');
}

export async function isAiDisabled(phone: string): Promise<boolean> {
  return (await redis.exists(AI_DISABLED_KEY(phone))) === 1;
}

export async function resetSession(phone: string): Promise<void> {
  await redis.del(`session:${phone}`);
}

export async function banUser(phone: string, reason: string): Promise<void> {
  await redis.set(BAN_KEY(phone), reason);
}

export async function unbanUser(phone: string): Promise<void> {
  await redis.del(BAN_KEY(phone));
}

export async function isBanned(phone: string): Promise<boolean> {
  return (await redis.exists(BAN_KEY(phone))) === 1;
}

/**
 * Guarda actividad reciente del usuario (in/out) para que los asesores la consulten.
 * Mantiene los últimos 50 mensajes en una lista circular con TTL de 30 días.
 */
export async function recordActivity(phone: string, direction: 'in' | 'out', text: string): Promise<void> {
  const key = ACTIVITY_KEY(phone);
  const sessionRaw = await redis.get(`session:${phone}`);
  let step: string | undefined;
  try { step = sessionRaw ? JSON.parse(sessionRaw).step : undefined; }
  catch { step = 'notas_password'; /* sesión dañada: no persistir contenido */ }
  const safeText = sanitizeActivityText(direction, step, text);
  await redis.lpush(key, JSON.stringify({ ts: Date.now(), direction, text: safeText }));
  await redis.ltrim(key, 0, 49);
  await redis.expire(key, 60 * 60 * 24 * 30);
}

/**
 * Lista todos los usuarios que tuvieron actividad reciente (clave activity:*).
 * Limitado por SCAN para no bloquear Redis.
 */
export async function listActiveUsers(limit = 100): Promise<string[]> {
  const phones = new Set<string>();
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'activity:*', 'COUNT', 200);
    cursor = next;
    for (const k of keys) phones.add(k.replace('activity:', ''));
    if (phones.size >= limit) break;
  } while (cursor !== '0');
  return Array.from(phones).slice(0, limit);
}
