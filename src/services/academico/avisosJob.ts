import Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { config } from '../../config';
import { describeExternalError } from '../logSafe';
import { getBotUser } from '../botUserService';
import { decisionGuardada } from '../consentimientoService';
import { listarTelefonosVinculados } from '../identityService';
import { ultimoEntranteVerificable, ventanaTextoLibreAbierta } from '../replyWindow';
import { track } from '../metrics';
import { avisosProactivosActivos } from './interruptores';
import { ejecutarAvisos, esHoraDeAvisar } from './avisos';
import { academico } from './servicio';

/**
 * Programación de los avisos académicos proactivos. Solo arranca si
 * TOOLI_AVISOS_ACADEMICOS_ENABLED=1. Quién envía llega por parámetro para no
 * importar los flujos desde aquí (mismo patrón que iniciarSeguimientos).
 */

const redis = new Redis(config.redis.url, { lazyConnect: true });
const CADA_MS = 30 * 60 * 1000;
const SIETE_DIAS_SEG = 7 * 24 * 3600;
/** Margen dentro de la ventana de 24 horas de WhatsApp. */
const VENTANA_MS = 23 * 3600_000;

async function una(enviar: (telefono: string, texto: string) => Promise<void>): Promise<void> {
  const resumen = await ejecutarAvisos({
    ahora: () => new Date(),
    listarTelefonos: (limite) => listarTelefonosVinculados(limite),
    consultar: (telefono, tipo) => academico.consultar(telefono, tipo),
    async ventanaAbierta(telefono) {
      const info = await getBotUser(telefono);
      const ultimo = ultimoEntranteVerificable(info.recentMessages, Date.now());
      // Margen de una hora: se avisa solo si la última escritura de la persona fue hace menos de ~23 h.
      return ventanaTextoLibreAbierta(ultimo, Date.now() + (24 * 3600_000 - VENTANA_MS));
    },
    async reservar(telefono, clave) {
      const llave = `avisos-acad:${telefono}:${createHash('sha256').update(clave).digest('hex').slice(0, 24)}`;
      return (await redis.set(llave, '1', 'EX', SIETE_DIAS_SEG, 'NX')) === 'OK';
    },
    enviar,
    optoutDe: async (telefono) => (await decisionGuardada(telefono)) === 'no',
  });
  if (resumen.enviados > 0) await track('avisos_academicos_enviados', { enviados: resumen.enviados });
}

/** Una sola corrida por día: la primera revisión después de las 8:00 de Colombia (cada una consulta Savio y la hoja de turnos por estudiante). */
async function corridaDelDia(): Promise<boolean> {
  const hoy = new Date(Date.now() - 5 * 3600_000).toISOString().slice(0, 10);
  return (await redis.set(`avisos-acad:corrida:${hoy}`, '1', 'EX', 36 * 3600, 'NX')) === 'OK';
}

export function iniciarAvisosAcademicos(enviar: (telefono: string, texto: string) => Promise<void>): void {
  if (!avisosProactivosActivos()) return;
  const correr = async () => {
    if (!esHoraDeAvisar(new Date()) || !(await corridaDelDia())) return;
    await una(enviar);
  };
  const protegido = () => correr().catch((err) => console.error('[avisos-acad] ciclo fallido:', describeExternalError(err)));
  setInterval(protegido, CADA_MS).unref();
  console.log('[avisos-acad] avisos académicos proactivos ACTIVOS');
}
