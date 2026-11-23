import { parseOriginArea } from './commands';
import { FlowContext } from './shared';
import { academicLookupEnabled, sendAcademicPortal } from './academicLookup';
import { iniciarMiSemestre } from './miSemestre';

/**
 * Paso legado `esperando_codigo` (sesiones abiertas antes de «Mi semestre»).
 *
 * Antes se escribía un código cualquiera y se consultaba la hoja de turnos, sin
 * poder comprobar que fuera del remitente (la hoja no tiene correo). Ahora el
 * turno SOLO se consulta con el código ya atado y comprobado al vínculo de quien
 * escribe (academico.consultar('turno')), así que aquí solo se redirige. La
 * lectura de la hoja sigue en services/turnosService.ts, detrás de
 * services/academico/proveedores/turnoSheets.ts.
 */
export async function handleEsperandoCodigo(ctx: FlowContext): Promise<void> {
  const { from, session } = ctx;
  if (!academicLookupEnabled()) return sendAcademicPortal(from, 'turno', session?.data);
  await iniciarMiSemestre(from, parseOriginArea(session?.data.originArea) ?? 'pregrado', 'turno');
}
