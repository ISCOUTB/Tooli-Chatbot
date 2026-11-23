import type { Identity } from '../services/identityService';
import { normalizarCodigo } from '../services/academico/identidadAcademica';

/**
 * Qué tan comprobados están los datos que la persona dio antes de pasar a TI.
 *
 * - `correo_verificado`: este WhatsApp está vinculado (código al correo) con el
 *   mismo correo que escribió. Si académico ya ató un código a ese vínculo
 *   (`codigoVerificado`), lo único comprobado es que alguien con este WhatsApp
 *   conocía un par código+cédula que el portal aceptó: NO que sea el titular
 *   (quien conozca el par de otra persona lo puede atar). El bloque lo dice así.
 *   La cédula escrita siempre es lo que dijo.
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
  // Código atado al MISMO vínculo del correo verificado: el portal aceptó el par código + cédula. No prueba titularidad.
  const vinculado = estado === 'correo_verificado' && identity?.codigoVerificado === true
    ? normalizarCodigo(identity.codigo)
    : null;
  const titulo = estado !== 'correo_verificado'
    ? '⚠️ *Datos que escribió la persona, SIN verificar. Confirma su identidad antes de cambiar una cuenta.*'
    : vinculado
      ? '🔐 *Correo verificado con código (vínculo vigente). Código estudiantil vinculado con un par código + cédula que el portal aceptó: prueba que conocía ese par, no que sea su titular. Cédula: la escribió la persona.*'
      : '🔐 *Correo verificado con código (vínculo vigente). Código y cédula: los escribió la persona.*';
  let lineaCodigo = data.verifCodigo ?? '(no disponible)';
  if (vinculado) {
    const escrito = data.verifCodigo ? normalizarCodigo(data.verifCodigo) : null;
    const etiqueta = `${vinculado} (vinculado: el portal aceptó código + cédula)`;
    lineaCodigo = escrito && escrito !== vinculado ? `${etiqueta} — escribió ${data.verifCodigo}, NO coincide` : etiqueta;
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
