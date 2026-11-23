/**
 * Seguimiento de conversaciones a medias. Si el bot hace una pregunta y la
 * persona no contesta en 3 horas, le escribe una sola vez para retomarla.
 *
 * Reglas: solo a quien autorizó sus datos; nunca de noche (de 21:00 a 8:00 en
 * Colombia, se corre a las 8:00); siempre dentro de las 24 horas en que
 * WhatsApp deja escribir sin plantilla; uno por día como máximo. Cualquier
 * mensaje de la persona lo cancela. Quién envía y cómo lo decide el flujo
 * (`recordarPendiente`), que se pasa al iniciar para no importar flujos aquí.
 */
import Redis from 'ioredis';
import { config } from '../config';
import { describeExternalError } from './logSafe';
import { registrarIncidencia } from './incidenciasService';
import { saltarEnSimulacion } from './simulacion';

const redis = new Redis(config.redis.url, { lazyConnect: true });

const COLA = 'seguimiento:cola';
const ITEM = (telefono: string) => `seguimiento:${telefono}`;
const ENVIADO = (telefono: string) => `seguimiento:enviado:${telefono}`;

const HORA_MS = 60 * 60 * 1000;
export const ESPERA_MS = 3 * HORA_MS;
/** Margen dentro de la ventana de 24 horas de WhatsApp. */
const VENTANA_MS = 23 * HORA_MS;
const COLOMBIA_MS = -5 * HORA_MS;
const HORA_INICIO = 8;
const HORA_FIN = 21;
const UN_DIA_SEG = 24 * 60 * 60;

/** Cuándo enviar el seguimiento de una pregunta hecha en `desde`, o null si ya no cabe en la ventana. */
export function horaDeEnvio(desde: number, espera = ESPERA_MS): number | null {
  let cuando = desde + espera;
  const local = new Date(cuando + COLOMBIA_MS);
  const hora = local.getUTCHours();
  if (hora >= HORA_FIN || hora < HORA_INICIO) {
    if (hora >= HORA_FIN) local.setUTCDate(local.getUTCDate() + 1);
    local.setUTCHours(HORA_INICIO, 0, 0, 0);
    cuando = local.getTime() - COLOMBIA_MS;
  }
  return cuando - desde <= VENTANA_MS ? cuando : null;
}

/** Programa el seguimiento de la pregunta pendiente (reemplaza al anterior, si había). */
export async function programarSeguimiento(telefono: string, pendiente: string, ahora = Date.now()): Promise<void> {
  if (!config.seguimiento.activo) return;
  if (saltarEnSimulacion('Seguimiento', 'No se programó el mensaje de seguimiento por si la persona deja de responder.', telefono)) return;
  try {
    if (await redis.exists(ENVIADO(telefono))) return;
    const cuando = horaDeEnvio(ahora);
    if (!cuando) return;
    await redis.multi()
      .set(ITEM(telefono), JSON.stringify({ pendiente }), 'EX', UN_DIA_SEG)
      .zadd(COLA, cuando, telefono)
      .exec();
  } catch (err) {
    console.error('[seguimiento] no se pudo programar:', describeExternalError(err));
  }
}

/** La persona escribió: ya no hace falta recordarle nada. */
export async function cancelarSeguimiento(telefono: string): Promise<void> {
  try {
    await redis.multi().zrem(COLA, telefono).del(ITEM(telefono)).exec();
  } catch (err) {
    console.error('[seguimiento] no se pudo cancelar:', describeExternalError(err));
  }
}

export type EnviarSeguimiento = (telefono: string, pendiente: string) => Promise<boolean>;

/** Envía los seguimientos vencidos. Devuelve cuántos salieron. */
export async function procesarSeguimientos(enviar: EnviarSeguimiento, ahora = Date.now()): Promise<number> {
  const vencidos = await redis.zrangebyscore(COLA, 0, ahora, 'LIMIT', 0, 20);
  let enviados = 0;
  for (const telefono of vencidos) {
    // Quien logra sacarlo de la cola es quien lo envía.
    if ((await redis.zrem(COLA, telefono)) !== 1) continue;
    const raw = await redis.get(ITEM(telefono));
    await redis.del(ITEM(telefono));
    let pendiente = '';
    try {
      pendiente = String((JSON.parse(raw ?? '{}') as { pendiente?: unknown }).pendiente ?? '');
    } catch {
      pendiente = '';
    }
    if (!pendiente) continue;
    // La marca va antes de enviar: así la pregunta que se reenvía no programa otro seguimiento.
    await redis.set(ENVIADO(telefono), '1', 'EX', UN_DIA_SEG);
    try {
      if (await enviar(telefono, pendiente)) enviados++;
      else await redis.del(ENVIADO(telefono));
    } catch (err) {
      console.error('[seguimiento] no se pudo enviar:', describeExternalError(err));
      await registrarIncidencia('seguimiento', 'No se pudo enviar un seguimiento a una conversación a medias', err);
    }
  }
  return enviados;
}

let temporizador: NodeJS.Timeout | null = null;

export function iniciarSeguimientos(enviar: EnviarSeguimiento, intervaloMs = 60_000): void {
  if (temporizador || !config.seguimiento.activo) return;
  let ocupado = false;
  temporizador = setInterval(() => {
    if (ocupado) return;
    ocupado = true;
    procesarSeguimientos(enviar)
      .catch((err) => console.error('[seguimiento] error del ciclo:', describeExternalError(err)))
      .finally(() => { ocupado = false; });
  }, intervaloMs);
  temporizador.unref();
}
