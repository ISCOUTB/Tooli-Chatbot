/**
 * Autorización de tratamiento de datos (Ley 1581 de 2012) que el bot pide la
 * primera vez que alguien le escribe. No expira: es la constancia de lo que la
 * persona decidió y evita preguntárselo en cada conversación. Solo guarda la
 * decisión y la fecha; si escribe BAJA, queda en "no".
 */
import Redis from 'ioredis';
import { config } from '../config';
import { describeExternalError } from './logSafe';

const redis = new Redis(config.redis.url, { lazyConnect: true });
const CLAVE = (telefono: string) => `consentimiento:${telefono}`;

export type Decision = 'si' | 'no';
export interface Consentimiento {
  datos: Decision;
  fecha: string;
}

export function leerRegistro(raw: string | null): Consentimiento | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Consentimiento> | null;
    if (!parsed || (parsed.datos !== 'si' && parsed.datos !== 'no')) return null;
    return { datos: parsed.datos, fecha: typeof parsed.fecha === 'string' ? parsed.fecha : '' };
  } catch {
    return null;
  }
}

export function registro(datos: Decision, ahora = new Date()): string {
  return JSON.stringify({ datos, fecha: ahora.toISOString() });
}

/** La decisión guardada, o null si nunca decidió (o si Redis no responde). */
export async function decisionGuardada(telefono: string): Promise<Decision | null> {
  try {
    return leerRegistro(await redis.get(CLAVE(telefono)))?.datos ?? null;
  } catch (err) {
    console.error('[consentimiento] no se pudo leer:', describeExternalError(err));
    return null;
  }
}

/** Guarda la decisión. Si falla, la conversación sigue: se volverá a preguntar. */
export async function registrarDecision(telefono: string, datos: Decision): Promise<void> {
  try {
    await redis.set(CLAVE(telefono), registro(datos));
  } catch (err) {
    console.error('[consentimiento] no se pudo guardar:', describeExternalError(err));
    // Se carga aquí para no crear una dependencia circular al arrancar.
    const { registrarIncidencia } = await import('./incidenciasService');
    await registrarIncidencia('datos', 'No se pudo guardar la constancia de autorización de datos (Redis)', err);
  }
}
