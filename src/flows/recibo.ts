import { parseOriginArea } from './commands';
import { FlowContext } from './shared';
import { academicLookupEnabled, sendAcademicPortal } from './academicLookup';
import { iniciarMiSemestre } from './miSemestre';

/**
 * Pasos legados `recibo_codigo` y `recibo_cedula` (sesiones abiertas antes de
 * «Mi semestre»). Antes cualquiera podía escribir un código y una cédula ajenos y
 * recibir el PDF de otra persona. Ahora el recibo SOLO se baja con el código y la
 * cédula ya comprobados y atados al vínculo del remitente
 * (academico.consultar('recibo')), así que aquí solo se redirige. La descarga
 * real sigue en services/icebergService.ts, detrás de
 * services/academico/proveedores/reciboIceberg.ts.
 */
async function redirigir(ctx: FlowContext): Promise<void> {
  const { from, session } = ctx;
  if (!academicLookupEnabled()) return sendAcademicPortal(from, 'recibo', session?.data);
  await iniciarMiSemestre(from, parseOriginArea(session?.data.originArea) ?? 'pregrado', 'recibo');
}

export const handleReciboCodigo = redirigir;
export const handleReciboCedula = redirigir;
