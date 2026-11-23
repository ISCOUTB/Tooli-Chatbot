import type { ProveedorRecibo, RespuestaRecibo, Vencimiento } from '../tipos';

/**
 * Recibo de matrícula desde el portal Iceberg, y comprobación de que un código
 * estudiantil pertenece a quien lo dice (código + cédula contra el portal).
 * Envuelve loginAndDownloadReceipt sin tocar su lógica (idea tomada de
 * IcebergEnrollmentAdapter de nutriIA).
 */

/** Forma mínima de lo que devuelve icebergService.loginAndDownloadReceipt. */
export interface ResultadoIceberg {
  ok: boolean;
  error?: string;
  nombre?: string;
  cedula?: string;
  noRecibos?: boolean;
  pdf?: Buffer;
  matriculas?: Array<{ tipo: Vencimiento['tipo']; fechaVencimiento: string; recargo: string; valor?: number }>;
}

export type LoginIceberg = (codigo: string, cedula: string) => Promise<ResultadoIceberg>;

export function crearProveedorReciboIceberg(login: LoginIceberg): ProveedorRecibo {
  return {
    async consultar(codigo, cedula): Promise<RespuestaRecibo> {
      let r: ResultadoIceberg;
      try { r = await login(codigo, cedula); } catch { return { estado: 'error' }; }
      if (r.noRecibos) return { estado: 'sin_recibos', nombre: r.nombre };
      if (r.ok && r.pdf) {
        return {
          estado: 'ok',
          nombre: r.nombre,
          pdf: r.pdf,
          vencimientos: (r.matriculas ?? []).map((m) => ({
            tipo: m.tipo, fecha: m.fechaVencimiento, recargo: m.recargo, ...(m.valor ? { valor: m.valor } : {}),
          })),
        };
      }
      if (!r.ok && /Login fall/i.test(r.error ?? '')) return { estado: 'credenciales' };
      return { estado: 'error' };
    },
  };
}

export type ResultadoVerificacionCodigo =
  | { estado: 'ok'; nombre?: string }
  | { estado: 'no_coincide' }
  | { estado: 'error' };

export interface VerificadorCodigo {
  verificar(codigo: string, cedula: string): Promise<ResultadoVerificacionCodigo>;
}

/**
 * El portal acepta el par código+cédula solo si son de la misma persona. Entrar
 * (aunque luego no haya recibos o falle la descarga) prueba el par; si además el
 * portal muestra una cédula distinta a la escrita, se rechaza.
 */
export function crearVerificadorCodigoIceberg(login: LoginIceberg): VerificadorCodigo {
  return {
    async verificar(codigo, cedula) {
      let r: ResultadoIceberg;
      try { r = await login(codigo, cedula); } catch { return { estado: 'error' }; }
      const entro = r.ok || Boolean(r.nombre);
      if (entro) {
        if (r.cedula && r.cedula.replace(/\D/g, '') !== cedula.replace(/\D/g, '')) return { estado: 'no_coincide' };
        return { estado: 'ok', nombre: r.nombre };
      }
      return /Login fall/i.test(r.error ?? '') ? { estado: 'no_coincide' } : { estado: 'error' };
    },
  };
}
