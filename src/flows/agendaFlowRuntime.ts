/**
 * Cableado real del flujo de agenda de WhatsApp: adaptador de mensajería,
 * servicio de agenda y estado en Redis. La conversación está en agendaFlow.ts.
 */

import Redis from 'ioredis';
import { config } from '../config';
import type { AreaAgenda } from '../contratos/agenda';
import { agendaServicio } from '../services/agendaService';
import { describeError } from '../services/logSafe';
import { crearFlujoAgenda, EstadoFlujoAgenda, SesionMinima } from './agendaFlow';
import { messaging } from './shared';
import { conAgendaDePrueba } from './agendaDePrueba';

const redis = new Redis(config.redis.url, { lazyConnect: true });
const KEY = (tel: string) => `agenda:flujo:${tel}`;
/** La conversación de agendar caduca sola a los 20 minutos de silencio. */
const TTL_FLUJO_S = 20 * 60;

/** La agenda real, salvo en el simulador del panel: ahí las citas son de prueba (ver agendaDePrueba.ts). */
const agendaDelFlujo = conAgendaDePrueba(agendaServicio);

/** «Empezar de nuevo» en el simulador: olvida las citas de prueba de ese número. */
export function soltarAgendaDePrueba(telefono: string): void {
  agendaDelFlujo.soltar(telefono);
}

const flujo = crearFlujoAgenda({
  agenda: agendaDelFlujo,
  mensajes: messaging,
  estado: {
    async get(tel) {
      const raw = await redis.get(KEY(tel));
      if (!raw) return null;
      try { return JSON.parse(raw) as EstadoFlujoAgenda; } catch { return null; }
    },
    async set(tel, e) { await redis.set(KEY(tel), JSON.stringify(e), 'EX', TTL_FLUJO_S); },
    async del(tel) { await redis.del(KEY(tel)); },
  },
  ahora: () => Date.now(),
  activa: () => config.agenda.activa,
});

/**
 * Lo llama el router de mensajes antes que cualquier otro paso. Devuelve true
 * si el mensaje era de la agenda. Un fallo de la agenda nunca debe tumbar el
 * bot: se registra y el mensaje sigue su camino normal.
 */
export async function atenderAgenda(from: string, text: string, session: SesionMinima | null): Promise<boolean> {
  try {
    return await flujo.atender(from, text, session);
  } catch (err) {
    console.error('[agenda] error en el flujo de WhatsApp:', describeError(err));
    return false;
  }
}

/** ¿Hay algún asesor del área conectado y disponible ahora mismo? Ante la duda, sí (no cambia el flujo actual). */
export async function hayAsesorLibre(area: 'ti' | 'admisiones'): Promise<boolean> {
  try {
    const [{ listUsers }, { estaConectado, obtenerEstadoAsesor }] = await Promise.all([
      import('../services/usersService'),
      import('../services/atencionEquipoService'),
    ]);
    const candidatos = (await listUsers()).filter((u) =>
      u.chatwootUserId && (!u.area || u.area === 'all' || u.area === area));
    for (const u of candidatos) {
      if (estaConectado(u.username) && (await obtenerEstadoAsesor(u.username)) === 'disponible') return true;
    }
    return false;
  } catch (err) {
    console.error('[agenda] no se pudo saber si hay asesor libre:', describeError(err));
    return true;
  }
}

/**
 * Tras crear la conversación con el asesor: si es fuera de horario o no hay
 * nadie libre, ofrece agendar. Nunca lanza: el paso a asesor ya funcionó.
 */
export async function ofrecerAgendaTrasHandoff(from: string, areaHandoff: string, fueraHorario: boolean): Promise<void> {
  if (!config.agenda.activa) return;
  try {
    const area: AreaAgenda = areaHandoff === 'ti' ? 'ti' : areaHandoff === 'posgrados' ? 'posgrados' : 'pregrado';
    if (!fueraHorario && (await hayAsesorLibre(area === 'ti' ? 'ti' : 'admisiones'))) return;
    await flujo.ofrecerTrasHandoff(from, area, fueraHorario ? 'fuera_horario' : 'sin_asesor');
  } catch (err) {
    console.error('[agenda] no se pudo ofrecer la agenda:', describeError(err));
  }
}
