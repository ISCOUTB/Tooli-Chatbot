// Cableado de la línea de voz con las implementaciones reales de los contratos (integración, 22-nov-2026).
// Vive fuera de src/index.ts para poder probarlo: src/voice/integracion.test.ts lo llama con dobles en memoria.
import { config } from '../config';
import type { AcademicoApi } from '../contratos/academico';
import type { AgendaApi } from '../contratos/agenda';
import { academico as academicoReal } from '../services/academico/servicio';
import { agenda as agendaReal } from '../services/agendaService';
import { registrarAcademico, registrarAgenda } from './servicio';

/**
 * Registra los contratos que usa la voz. La agenda solo con AGENDA_ACTIVA=true (viene apagada): con la agenda
 * apagada, la voz tampoco ofrece citas (queda la devolución de llamada).
 */
export function conectarContratosVoz(impl: { academico?: AcademicoApi; agenda?: AgendaApi; agendaActiva?: boolean } = {}): void {
  registrarAcademico(impl.academico ?? academicoReal);
  const activa = impl.agendaActiva ?? config.agenda.activa;
  registrarAgenda(activa ? (impl.agenda ?? agendaReal) : null);
}
