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

const digitos = (v: string) => v.replace(/\D/g, '');

/**
 * El portal muestra «[CÉDULA, NOMBRE]» en la cabecera cuando de verdad se entró como esa persona. Es la única prueba
 * positiva: `loginAndDownloadReceipt` da `{ ok: true, noRecibos: true }` también cuando el «login» pasa sin llegar a
 * la página del estudiante (la detección de error del captcha no es exhaustiva).
 */
function cedulaConfirmada(r: ResultadoIceberg, cedula: string): 'si' | 'otra' | 'no_leida' {
  if (!r.cedula || !digitos(r.cedula)) return 'no_leida';
  return digitos(r.cedula) === digitos(cedula) ? 'si' : 'otra';
}

export function crearProveedorReciboIceberg(login: LoginIceberg): ProveedorRecibo {
  return {
    async consultar(codigo, cedula): Promise<RespuestaRecibo> {
      let r: ResultadoIceberg;
      try { r = await login(codigo, cedula); } catch { return { estado: 'error' }; }
      const confirmada = cedulaConfirmada(r, cedula);
      // Sin la cédula en la página no se afirma «no tienes recibos»; con otra cédula no se entrega nada.
      if (confirmada === 'otra') return { estado: 'error' };
      if (r.noRecibos) return confirmada === 'si' ? { estado: 'sin_recibos', nombre: r.nombre } : { estado: 'error' };
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
 * El portal acepta el par código+cédula solo si son de la misma persona. Cuenta como comprobado SOLO si, tras
 * entrar, el portal muestra esa misma cédula en su cabecera (aunque luego no haya recibos o falle la descarga).
 * Entrar sin que aparezca la cédula no prueba nada (puede ser una página inesperada): queda en `error` y no se ata
 * el código. Una cédula distinta a la escrita es `no_coincide`.
 */
export function crearVerificadorCodigoIceberg(login: LoginIceberg): VerificadorCodigo {
  return {
    async verificar(codigo, cedula) {
      let r: ResultadoIceberg;
      try { r = await login(codigo, cedula); } catch { return { estado: 'error' }; }
      const entro = r.ok || Boolean(r.nombre);
      if (entro) {
        const confirmada = cedulaConfirmada(r, cedula);
        if (confirmada === 'otra') return { estado: 'no_coincide' };
        if (confirmada === 'no_leida') return { estado: 'error' };
        return { estado: 'ok', nombre: r.nombre };
      }
      return /Login fall/i.test(r.error ?? '') ? { estado: 'no_coincide' } : { estado: 'error' };
    },
  };
}
