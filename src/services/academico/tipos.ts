/**
 * Puertos (interfaces) de los proveedores de datos académicos.
 *
 * Idea rescatada de nutriIA (adapters/university/I*Adapter): el servicio no
 * conoce Playwright, Moodle ni Google; conoce estos contratos. Cada fuente real
 * (Banner, Iceberg, hoja de turnos, Savio) vive en ./proveedores y se puede
 * reemplazar por un fake en las pruebas o por otra universidad más adelante.
 */

export interface DatosEstudiante {
  telefono: string;
  email: string;
  codigo?: string;
  /** true cuando el código se comprobó contra una fuente oficial (Iceberg). */
  codigoVerificado?: boolean;
  nombre?: string;
  programa?: string;
  nivel?: 'pregrado' | 'posgrado';
}

export interface Corte {
  nombre: string;
  /** Porcentaje de la nota final (0-100). */
  peso: number;
  /** Ausente si el corte todavía no tiene nota. */
  nota?: number;
}

export interface CursoNota {
  titulo: string;
  /** Nota definitiva tal como la muestra el portal ("4.2"), si ya existe. */
  notaFinal?: string;
  /** Cortes parciales, cuando la fuente los entrega. */
  cortes?: Corte[];
}

export type RespuestaNotas =
  | { estado: 'ok'; periodo?: string; cursos: CursoNota[] }
  | { estado: 'sin_sesion' }
  | { estado: 'error' };

export interface ProveedorNotas {
  consultar(e: DatosEstudiante): Promise<RespuestaNotas>;
}

export interface Vencimiento {
  tipo: 'ORDINARIA' | 'EXTRAORDINARIA' | 'EXTEMPORANEA';
  /** dd/mm/aaaa como lo muestra el portal. */
  fecha: string;
  /** "0%", "2%"… */
  recargo: string;
  /** Valor a pagar en pesos, si se pudo leer del portal. */
  valor?: number;
}

export type RespuestaRecibo =
  | { estado: 'ok'; nombre?: string; vencimientos: Vencimiento[]; pdf?: Buffer }
  | { estado: 'sin_recibos'; nombre?: string }
  | { estado: 'credenciales' }
  | { estado: 'error' };

export interface ProveedorRecibo {
  consultar(codigo: string, cedula: string): Promise<RespuestaRecibo>;
}

export interface TurnoDato {
  codigo: string;
  nombre: string;
  programa: string;
  turno: string;
  fecha: string;
  hora: string;
  fechaLimite?: string;
  horaLimite?: string;
}

export interface ProveedorTurno {
  /** null si el código no está en la hoja. Lanza si la fuente falla. */
  consultar(codigo: string): Promise<TurnoDato | null>;
}

export interface ClaseHorario {
  materia: string;
  /** "lunes", "martes"… en minúscula y sin abreviar. */
  dia: string;
  /** HH:MM en 24 h. */
  inicio: string;
  fin: string;
  salon?: string;
  crn?: string;
}

export type RespuestaHorario =
  | { estado: 'ok'; clases: ClaseHorario[]; simulado?: boolean }
  | { estado: 'sin_sesion' }
  | { estado: 'error' };

export interface ProveedorHorario {
  consultar(e: DatosEstudiante): Promise<RespuestaHorario>;
}

export interface TareaProxima {
  titulo: string;
  curso: string;
  /** ISO 8601 */
  vence: string;
}

export interface CursoSavio {
  id: number;
  nombre: string;
  url: string;
}

export type RespuestaCursos =
  | { estado: 'ok'; cursos: CursoSavio[]; tareas: TareaProxima[] }
  | { estado: 'no_encontrado' }
  | { estado: 'error' };

export interface ProveedorCursos {
  consultar(email: string): Promise<RespuestaCursos>;
}
