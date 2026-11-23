/**
 * Lo que el bot no entendió, para mejorarlo con casos reales: cada vez cuenta
 * en las métricas (`no_reconocido`, por paso) y el texto queda en una lista
 * corta en Redis (los últimos 200, 30 días) que el panel muestra en Métricas.
 * No se guarda el teléfono, y números largos y correos se tapan.
 */
import Redis from 'ioredis';
import { config } from '../config';
import { describeExternalError } from './logSafe';
import { saltarEnSimulacion } from './simulacion';

const redis = new Redis(config.redis.url, { lazyConnect: true });
const CLAVE = 'noreconocido:textos';
const MAXIMO = 200;
const TTL_SEG = 30 * 24 * 60 * 60;

export interface NoReconocido {
  paso: string;
  texto: string;
  fecha: string;
}

/** Sin datos personales evidentes: correos y números largos (teléfonos, documentos) se tapan. */
export function textoSeguro(texto: string): string {
  return (texto ?? '')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[correo]')
    .replace(/\d[\d\s.-]{5,}\d/g, '[número]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export async function registrarNoReconocido(paso: string, texto: string): Promise<void> {
  if (saltarEnSimulacion('No reconocido', `El bot no reconoció «${textoSeguro(texto)}» en el paso ${paso} (no se cuenta en el panel).`)) return;
  // Se carga aquí: el módulo de métricas abre Redis al importarse y las pruebas de textoSeguro no lo necesitan.
  const { track } = await import('./metrics');
  await track('no_reconocido', { paso });
  const limpio = textoSeguro(texto);
  if (!limpio || limpio.startsWith('__')) return;
  try {
    const item: NoReconocido = { paso, texto: limpio, fecha: new Date().toISOString() };
    await redis.multi().lpush(CLAVE, JSON.stringify(item)).ltrim(CLAVE, 0, MAXIMO - 1).expire(CLAVE, TTL_SEG).exec();
  } catch (err) {
    console.error('[no-reconocido] no se pudo guardar:', describeExternalError(err));
  }
}

export async function ultimosNoReconocidos(limite = 50): Promise<NoReconocido[]> {
  const crudos = await redis.lrange(CLAVE, 0, Math.max(0, Math.min(limite, MAXIMO) - 1));
  return crudos.flatMap((r) => {
    try {
      const x = JSON.parse(r) as NoReconocido;
      return x && typeof x.texto === 'string' ? [x] : [];
    } catch {
      return [];
    }
  });
}
