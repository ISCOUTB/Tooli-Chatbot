/**
 * Agenda de asesores: montaje con las dependencias reales.
 * Las rutas viven en agendaRouter.ts (fábrica probada con dobles).
 */

import { config } from '../../config';
import { messaging } from '../../flows/shared';
import { agendaServicio } from '../../services/agendaService';
import { logAudit } from '../../services/auditService';
import { describeError } from '../../services/logSafe';
import { crearAgendaRouter } from './agendaRouter';
import { motivoVentanaCerrada } from './shared';

export const agendaRouter = crearAgendaRouter({
  servicio: agendaServicio,
  audit: logAudit,
  // Se lee en cada petición: con AGENDA_ACTIVA=false la API y la pestaña del panel quedan apagadas.
  activa: () => config.agenda.activa,
  /**
   * Avisar a la persona de lo que hizo el equipo. Con Meta, fuera de las 24 h
   * de su último mensaje solo puede salir una plantilla aprobada: en ese caso
   * NO se envía y se le dice al asesor, para que la contacte por otro medio.
   */
  async avisar(telefono, texto) {
    try {
      const cerrada = await motivoVentanaCerrada(telefono);
      if (cerrada) return { enviado: false, motivo: cerrada };
      await messaging.sendText({ to: telefono, text: texto });
      return { enviado: true };
    } catch (err) {
      console.error('[tools/agenda] no se pudo avisar a la persona:', describeError(err));
      return { enviado: false, motivo: 'No se pudo enviar el WhatsApp; avísale por otro medio.' };
    }
  },
});
