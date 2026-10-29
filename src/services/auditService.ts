import Redis from 'ioredis';
import { config } from '../config';

const redis = new Redis(config.redis.url);

const LOG_TTL = 60 * 60 * 24 * 90; // 90 días
const LOG_KEY = (username: string) => `audit:${username}`;
const GLOBAL_LOG_KEY = 'audit:__all';
const MAX_ENTRIES = 500;

export type AuditAction =
  | 'login'
  | 'turno_consultado'
  | 'recibo_descargado'
  | 'sesion_reseteada'
  | 'usuario_baneado'
  | 'usuario_desbaneado'
  | 'ia_activada'
  | 'ia_desactivada'
  | 'usuario_creado'
  | 'usuario_eliminado'
  | 'seguimiento_evento_actualizado'
  | 'recordatorio_enviado'
  | 'invitacion_evento_enviada'
  | 'broadcast_enviado'
  | 'recordatorio_programado'
  | 'recordatorio_cancelado'
  | 'mensaje_enviado'
  | 'crm_nota_agregada'
  | 'crm_estado_actualizado'
  | 'crm_asignado'
  | 'inbound_review_resolved'
  | 'atencion_nota_privada'
  | 'atencion_estado_cambiado'
  | 'atencion_asignada'
  | 'atencion_etiquetas'
  | 'atencion_adjunto'
  | 'atencion_macro'
  | 'atencion_macro_creada';

export interface AuditEntry {
  ts: number;
  username: string;
  action: AuditAction;
  detail?: string;
}

/**
 * Registra una acción de un asesor/admin — respalda la pantalla "Actividad
 * de asesores" (admin) y "Mi actividad" (cualquier rol). Guarda tanto en la
 * lista del usuario como en una lista global recortada, ambas como listas
 * circulares en Redis (mismo patrón que botUserService.recordActivity).
 */
export async function logAudit(username: string, action: AuditAction, detail?: string): Promise<void> {
  const entry: AuditEntry = { ts: Date.now(), username, action, detail };
  const payload = JSON.stringify(entry);
  const pipeline = redis.pipeline();
  pipeline.lpush(LOG_KEY(username), payload);
  pipeline.ltrim(LOG_KEY(username), 0, MAX_ENTRIES - 1);
  pipeline.expire(LOG_KEY(username), LOG_TTL);
  pipeline.lpush(GLOBAL_LOG_KEY, payload);
  pipeline.ltrim(GLOBAL_LOG_KEY, 0, MAX_ENTRIES - 1);
  pipeline.expire(GLOBAL_LOG_KEY, LOG_TTL);
  await pipeline.exec();
}

function parseEntries(raw: string[]): AuditEntry[] {
  return raw.map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean) as AuditEntry[];
}

export async function getUserAudit(username: string, limit = 50): Promise<AuditEntry[]> {
  return parseEntries(await redis.lrange(LOG_KEY(username), 0, limit - 1));
}

export async function getGlobalAudit(limit = 200): Promise<AuditEntry[]> {
  return parseEntries(await redis.lrange(GLOBAL_LOG_KEY, 0, limit - 1));
}

/** Resumen por asesor: cuántas acciones de cada tipo hizo, últimos N días. */
export async function getAdvisorSummary(days = 7): Promise<Record<string, Record<AuditAction, number>>> {
  const since = Date.now() - days * 86400000;
  const all = await getGlobalAudit(500);
  const summary: Record<string, Record<string, number>> = {};
  for (const entry of all) {
    if (entry.ts < since) continue;
    summary[entry.username] ??= {};
    summary[entry.username][entry.action] = (summary[entry.username][entry.action] ?? 0) + 1;
  }
  return summary as Record<string, Record<AuditAction, number>>;
}
