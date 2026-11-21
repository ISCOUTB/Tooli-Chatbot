/**
 * Errores del bot que alguien tiene que revisar: la IA que no respondió, un
 * audio que no se transcribió, el asesor que no se pudo conectar, un dato que
 * no se guardó en el CRM… Cada uno cuenta en las métricas (`incidencia`, por
 * tipo) y queda en una lista corta en Redis (los últimos 200, 30 días) que el
 * panel muestra en Métricas. Nunca se guarda el teléfono ni lo que escribió.
 */
import Redis from 'ioredis';
import { config } from '../config';
import { describeExternalError } from './logSafe';

const redis = new Redis(config.redis.url, { lazyConnect: true });
const CLAVE = 'incidencias:lista';
const MAXIMO = 200;
const TTL_SEG = 30 * 24 * 60 * 60;

export type TipoIncidencia = 'ia' | 'audio' | 'asesor' | 'crm' | 'flyer' | 'mensaje' | 'seguimiento' | 'datos';

export interface Incidencia {
  tipo: TipoIncidencia;
  detalle: string;
  fecha: string;
}

/** Qué pasó, más el estado HTTP si lo hay ("external status=502"), sin datos personales. */
export function detalleSeguro(detalle: string, err?: unknown): string {
  const causa = err === undefined ? '' : ` (${describeExternalError(err)})`;
  return `${detalle}${causa}`
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[correo]')
    .replace(/\d[\d\s.-]{5,}\d/g, '[número]')
    .slice(0, 140);
}

export async function registrarIncidencia(tipo: TipoIncidencia, detalle: string, err?: unknown): Promise<void> {
  try {
    // Se carga aquí: el módulo de métricas abre Redis al importarse.
    const { track } = await import('./metrics');
    await track('incidencia', { tipo });
    const item: Incidencia = { tipo, detalle: detalleSeguro(detalle, err), fecha: new Date().toISOString() };
    await redis.multi().lpush(CLAVE, JSON.stringify(item)).ltrim(CLAVE, 0, MAXIMO - 1).expire(CLAVE, TTL_SEG).exec();
  } catch (e) {
    console.error('[incidencias] no se pudo guardar:', describeExternalError(e));
  }
}

export async function ultimasIncidencias(limite = 50): Promise<Incidencia[]> {
  const crudos = await redis.lrange(CLAVE, 0, Math.max(0, Math.min(limite, MAXIMO) - 1));
  return crudos.flatMap((r) => {
    try {
      const x = JSON.parse(r) as Incidencia;
      return x && typeof x.detalle === 'string' ? [x] : [];
    } catch {
      return [];
    }
  });
}
