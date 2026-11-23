import type { Interruptores } from './interruptores';
import { normalizarCedula, normalizarCodigo } from './identidadAcademica';
import type { VerificadorCodigo } from './proveedores/reciboIceberg';

/**
 * Atar el código estudiantil a un vínculo ya verificado por correo. Es el paso
 * que cierra el TODO de identityService: el correo prueba QUIÉN controla el
 * WhatsApp; el par código+cédula, aceptado por Iceberg, prueba que ese código es
 * de esa persona; y el índice inverso impide que el mismo código se ate a dos
 * correos distintos.
 */

export type EstadoVinculo =
  | 'ok' | 'formato_codigo' | 'formato_cedula' | 'sin_identidad' | 'apagado' | 'no_coincide' | 'en_uso' | 'error';

export interface DepsVinculo {
  interruptores: Pick<Interruptores, 'recibo'>;
  verificador: VerificadorCodigo;
  /** ¿Este teléfono tiene un vínculo vigente con correo? */
  tieneVinculo(telefono: string): Promise<boolean>;
  guardar(telefono: string, datos: {
    codigo: string; verificado: boolean; fuente: 'iceberg'; nombre?: string; cedula: string;
  }): Promise<'ok' | 'sin_identidad' | 'en_uso' | 'formato'>;
}

export async function vincularCodigoEstudiantil(
  deps: DepsVinculo,
  entrada: { telefono: string; codigo: string; cedula: string },
): Promise<{ estado: EstadoVinculo; nombre?: string }> {
  const codigo = normalizarCodigo(entrada.codigo);
  if (!codigo) return { estado: 'formato_codigo' };
  const cedula = normalizarCedula(entrada.cedula);
  if (!cedula) return { estado: 'formato_cedula' };
  // Sin fuente oficial encendida NO se ata nada como verificado: un código sin comprobar no abre datos.
  if (!deps.interruptores.recibo()) return { estado: 'apagado' };
  if (!(await deps.tieneVinculo(entrada.telefono))) return { estado: 'sin_identidad' };

  const r = await deps.verificador.verificar(codigo, cedula);
  if (r.estado === 'no_coincide') return { estado: 'no_coincide' };
  if (r.estado === 'error') return { estado: 'error' };

  const g = await deps.guardar(entrada.telefono, {
    codigo, verificado: true, fuente: 'iceberg', cedula, ...(r.nombre ? { nombre: r.nombre } : {}),
  });
  if (g === 'ok') return { estado: 'ok', ...(r.nombre ? { nombre: r.nombre } : {}) };
  if (g === 'en_uso') return { estado: 'en_uso' };
  return { estado: g === 'sin_identidad' ? 'sin_identidad' : 'formato_codigo' };
}
