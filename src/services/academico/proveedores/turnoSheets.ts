import type { ProveedorTurno, TurnoDato } from '../tipos';

/** Forma mínima de lo que devuelve turnosService.consultarTurno. */
export interface FilaTurno {
  codigo: string;
  nombre: string;
  apellido: string;
  programa: string;
  turno: string;
  fecha: string;
  hora: string;
  fechaLimite?: string;
  horaLimite?: string;
}

/**
 * Turno desde la hoja de Google. La hoja NO tiene correo: por eso este proveedor
 * solo se llama con el código ya atado (y comprobado) al vínculo del remitente.
 */
export function crearProveedorTurnoSheets(consultar: (codigo: string) => Promise<FilaTurno | null>): ProveedorTurno {
  return {
    async consultar(codigo): Promise<TurnoDato | null> {
      const fila = await consultar(codigo);
      if (!fila) return null;
      return {
        codigo: fila.codigo,
        nombre: `${fila.nombre} ${fila.apellido}`.trim(),
        programa: fila.programa,
        turno: fila.turno,
        fecha: fila.fecha,
        hora: fila.hora,
        ...(fila.fechaLimite ? { fechaLimite: fila.fechaLimite } : {}),
        ...(fila.horaLimite ? { horaLimite: fila.horaLimite } : {}),
      };
    },
  };
}
