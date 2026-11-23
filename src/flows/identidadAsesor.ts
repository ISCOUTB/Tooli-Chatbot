import type { Identity } from '../services/identityService';
import { normalizarCodigo } from '../services/academico/identidadAcademica';

/**
 * Qué tan comprobados están los datos que la persona dio antes de pasar a TI.
 *
 * - `correo_verificado`: este WhatsApp está vinculado (código al correo) con el
 *   mismo correo que escribió. El código estudiantil cuenta como comprobado solo
 *   si académico ya lo ató a ese vínculo (`codigoVerificado`); la cédula siempre
 *   es lo que dijo.
 * - `sin_verificar`: no hay vínculo, o el vínculo es de otro correo. El asesor
 *   debe confirmar la identidad antes de, por ejemplo, restablecer una clave.
 */
export type EstadoIdentidad = 'correo_verificado' | 'sin_verificar';

export function estadoIdentidad(identity: Identity | null, correoDado?: string): EstadoIdentidad {
  if (!identity || !correoDado) return 'sin_verificar';
  return identity.email.trim().toLowerCase() === correoDado.trim().toLowerCase()
    ? 'correo_verificado'
    : 'sin_verificar';
}

export function bloqueIdentidad(
  data: Record<string, string>, estado: EstadoIdentidad,
  identity?: Pick<Identity, 'codigo' | 'codigoVerificado'> | null,
): string {
  // Código comprobado por académico (código + cédula contra el portal), atado al MISMO vínculo del correo verificado.
  const comprobado = estado === 'correo_verificado' && identity?.codigoVerificado === true
    ? normalizarCodigo(identity.codigo)
    : null;
  const titulo = estado !== 'correo_verificado'
    ? '⚠️ *Datos que escribió la persona, SIN verificar. Confirma su identidad antes de cambiar una cuenta.*'
    : comprobado
      ? '🔐 *Correo verificado con código y código estudiantil comprobado por académico (vínculo vigente). Cédula: la escribió la persona.*'
      : '🔐 *Correo verificado con código (vínculo vigente). Código y cédula: los escribió la persona.*';
  let lineaCodigo = data.verifCodigo ?? '(no disponible)';
  if (comprobado) {
    const escrito = data.verifCodigo ? normalizarCodigo(data.verifCodigo) : null;
    lineaCodigo = escrito && escrito !== comprobado
      ? `${comprobado} (comprobado por académico) — escribió ${data.verifCodigo}, NO coincide`
      : `${comprobado} (comprobado por académico)`;
  }
  return (
    `\n${titulo}\n` +
    `   📧 Correo: ${data.verifEmail ?? '(no disponible)'}\n` +
    `   🆔 Código: ${lineaCodigo}\n` +
    `   🪪 Cédula: ${data.verifCedula ?? '(no disponible)'}\n`
  );
}

export function etiquetaIdentidad(estado: EstadoIdentidad): string {
  return estado === 'correo_verificado' ? 'correo-verificado' : 'identidad-sin-verificar';
}
