import { createHmac } from 'node:crypto';

/**
 * Parte PURA de la identidad fuerte (sin Redis, para poder probarla): formato de
 * código y cédula, claves de búsqueda inversa y qué campos académicos sobreviven
 * cuando un vínculo se renueva.
 */

export const CODIGO_ESTUDIANTIL = /^T\d{8}$/;
export const CEDULA = /^\d{6,12}$/;

export type FuenteCodigo = 'iceberg' | 'banner' | 'declarado';

/** Campos que se suman al vínculo WhatsApp-correo. Todos opcionales: los vínculos viejos siguen valiendo. */
export interface CamposAcademicos {
  codigo?: string;
  /** true solo si una fuente oficial confirmó que ese código es de quien lo dice. */
  codigoVerificado?: boolean;
  codigoFuente?: FuenteCodigo;
  nombre?: string;
  programa?: string;
  nivel?: 'pregrado' | 'posgrado';
  /** Cédula cifrada (AES-GCM) para poder bajar el recibo sin pedirla de nuevo. Nunca en claro. */
  cedulaCifrada?: string;
}

const CLAVES_ACADEMICAS = ['codigo', 'codigoVerificado', 'codigoFuente', 'nombre', 'programa', 'nivel', 'cedulaCifrada'] as const;

export function normalizarCodigo(valor: unknown): string | null {
  const c = String(valor ?? '').trim().toUpperCase();
  return CODIGO_ESTUDIANTIL.test(c) ? c : null;
}

export function normalizarCedula(valor: unknown): string | null {
  const c = String(valor ?? '').replace(/[.\s-]/g, '');
  return CEDULA.test(c) ? c : null;
}

/**
 * Clave de búsqueda inversa. Los códigos y las cédulas son números cortos: un
 * hash sin secreto se revierte en segundos, por eso es HMAC con un secreto.
 * Rotar el secreto solo deja huérfano el índice inverso (la búsqueda por código
 * pide volver a vincular); el vínculo en sí sigue funcionando.
 */
export function claveBusqueda(tipo: 'codigo' | 'cedula', valor: string, secreto: string): string {
  return `identity-${tipo}:${createHmac('sha256', secreto).update(`${tipo}:${valor}`).digest('hex')}`;
}

/** Copia solo los campos académicos conocidos y válidos de un objeto cualquiera (p. ej. JSON de Redis). */
export function extraerCamposAcademicos(origen: unknown): CamposAcademicos {
  if (!origen || typeof origen !== 'object') return {};
  const o = origen as Record<string, unknown>;
  const salida: CamposAcademicos = {};
  const codigo = normalizarCodigo(o.codigo);
  if (codigo) {
    salida.codigo = codigo;
    salida.codigoVerificado = o.codigoVerificado === true;
    if (o.codigoFuente === 'iceberg' || o.codigoFuente === 'banner' || o.codigoFuente === 'declarado') {
      salida.codigoFuente = o.codigoFuente;
    }
  }
  if (typeof o.nombre === 'string' && o.nombre.trim()) salida.nombre = o.nombre.trim().slice(0, 120);
  if (typeof o.programa === 'string' && o.programa.trim()) salida.programa = o.programa.trim().slice(0, 120);
  if (o.nivel === 'pregrado' || o.nivel === 'posgrado') salida.nivel = o.nivel;
  if (typeof o.cedulaCifrada === 'string' && o.cedulaCifrada.startsWith('v1.')) salida.cedulaCifrada = o.cedulaCifrada;
  return salida;
}

/**
 * Al renovar el vínculo (nuevo OTP) se conservan los datos académicos SOLO si el
 * correo es el mismo. Si cambió el correo, otra persona pudo quedarse con el número.
 */
export function conservarAlRenovar(anterior: unknown, correoNuevo: string): CamposAcademicos {
  if (!anterior || typeof anterior !== 'object') return {};
  const email = String((anterior as Record<string, unknown>).email ?? '').trim().toLowerCase();
  return email && email === correoNuevo.trim().toLowerCase() ? extraerCamposAcademicos(anterior) : {};
}

export function sinCamposAcademicos<T extends object>(identidad: T): Omit<T, typeof CLAVES_ACADEMICAS[number]> {
  const copia = { ...identidad } as Record<string, unknown>;
  for (const k of CLAVES_ACADEMICAS) delete copia[k];
  return copia as Omit<T, typeof CLAVES_ACADEMICAS[number]>;
}

export function enmascararTelefono(telefono: string): string {
  const d = String(telefono ?? '').replace(/\D/g, '');
  return d.length <= 4 ? '****' : `****${d.slice(-4)}`;
}

/** a***@utb.edu.co */
export function enmascararCorreo(email: string): string {
  const [local, dominio] = String(email ?? '').split('@');
  if (!local || !dominio) return '';
  return `${local[0]}***@${dominio}`;
}
