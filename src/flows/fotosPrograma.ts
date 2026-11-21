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
import { messaging } from './shared';

export function fotosDisponibles(): boolean {
  return config.fotos.activas && !!messaging.subirImagen && !!messaging.sendImageId;
}

const subir = (jpg: Buffer) => messaging.subirImagen!(jpg, 'image/jpeg');

export async function enviarFlyerPrograma(to: string, programa: ProgramaUtb, pie: string): Promise<boolean> {
  if (!fotosDisponibles()) return false;
  try {
    const id = await idDeFlyer(programa, subir);
    try {
      await messaging.sendImageId!(to, id, pie);
    } catch {
      // El id pudo vencer en Meta: se genera y se sube de nuevo, una sola vez.
      await messaging.sendImageId!(to, await idDeFlyer(programa, subir, true), pie);
    }
    return true;
  } catch (err) {
    console.warn(`[flyers] sin flyer para ${programa.id}:`, describeExternalError(err));
    return false;
  }
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
