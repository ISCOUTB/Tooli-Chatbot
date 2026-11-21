/**
 * Envía el flyer de un programa (foto oficial + datos, con la línea gráfica de
 * la UTB) con un pie corto. Si no hay cómo (el adaptador no envía imágenes, los
 * flyers están apagados con FOTOS_PROGRAMAS o algo falla), devuelve false y
 * quien llama manda el texto completo en su lugar.
 */
import { config } from '../config';
import { POSGRADOS_UTB, ProgramaUtb } from '../services/catalogoUtb';
import { idDeFlyer, precalentarFlyers } from '../services/fotoProgramaService';
import { describeExternalError } from '../services/logSafe';
import { registrarIncidencia } from '../services/incidenciasService';
import { esperarSalida } from '../services/entregasMeta';
import { messaging } from './shared';

export function fotosDisponibles(): boolean {
  return config.fotos.activas && !!messaging.subirImagen && !!messaging.sendImageId;
}

const subir = (jpg: Buffer) => messaging.subirImagen!(jpg, 'image/jpeg');

/** Flyers enviados a cada persona cuya salida todavía no se confirmó. */
const flyersEnCamino = new Map<string, string[]>();

export async function enviarFlyerPrograma(to: string, programa: ProgramaUtb, pie: string): Promise<boolean> {
  if (!fotosDisponibles()) return false;
  try {
    const id = await idDeFlyer(programa, subir);
    let idMensaje: string | void;
    try {
      idMensaje = await messaging.sendImageId!(to, id, pie);
    } catch {
      // El id pudo vencer en Meta: se genera y se sube de nuevo, una sola vez.
      idMensaje = await messaging.sendImageId!(to, await idDeFlyer(programa, subir, true), pie);
    }
    if (idMensaje) flyersEnCamino.set(to, [...(flyersEnCamino.get(to) ?? []), idMensaje].slice(-10));
    return true;
  } catch (err) {
    console.warn(`[flyers] sin flyer para ${programa.id}:`, describeExternalError(err));
    await registrarIncidencia('flyer', `No se pudo enviar el flyer de ${programa.nombre}; salió en texto`, err);
    return false;
  }
}

/**
 * WhatsApp entrega las imágenes más lento que el texto. Lo que va después de los
 * flyers (el menú, los botones, la respuesta) espera a que Meta confirme que
 * salieron, para que le llegue de último. Nunca más de `maxMs`.
 */
export async function esperarFlyers(to: string, maxMs = 6_000): Promise<void> {
  const ids = flyersEnCamino.get(to);
  flyersEnCamino.delete(to);
  if (!ids?.length) return;
  await esperarSalida(ids, maxMs);
  // Un respiro para que el siguiente mensaje no empate con el último flyer.
  await new Promise((r) => setTimeout(r, 400));
}

/** Al arrancar, genera y sube a Meta los flyers que falten para que nadie los espere. */
export function iniciarPrecalentamientoFlyers(esperaMs = 30_000): void {
  if (!fotosDisponibles()) return;
  setTimeout(() => {
    precalentarFlyers(POSGRADOS_UTB, subir)
      .then((n) => { if (n) console.log(`[flyers] ${n} flyers de posgrados subidos a Meta`); })
      .catch((err) => console.warn('[flyers] no se pudieron generar de antemano:', describeExternalError(err)));
  }, esperaMs).unref();
}
