/**
 * Interruptores de las integraciones académicas.
 *
 * Todas se leen de process.env EN CADA LLAMADA (no al importar): así una prueba
 * puede encender/apagar una integración, y producción puede reiniciar con otro
 * valor sin tocar código. Por defecto todo está APAGADO.
 */

export interface Interruptores {
  /** Notas por SSO de Microsoft a Banner (TOOLI_NOTAS_SSO_ENABLED=1). */
  notas(): boolean;
  /** Recibo (Iceberg) y comprobación del código estudiantil (TOOLI_ACADEMIC_LOOKUP_ENABLED=1). */
  recibo(): boolean;
  /** Turno por la hoja de Google; exige además el código ya comprobado (mismo interruptor del recibo). */
  turno(): boolean;
  /** Horario (TOOLI_HORARIO_ENABLED=1). */
  horario(): boolean;
  /** Cursos y tareas de Savio (TOOLI_SAVIO_ENABLED=1 y SAVIO_WS_TOKEN). */
  cursos(): boolean;
}

const encendido = (nombre: string): boolean => process.env[nombre] === '1';

export const interruptoresDeEntorno: Interruptores = {
  notas: () => encendido('TOOLI_NOTAS_SSO_ENABLED'),
  recibo: () => encendido('TOOLI_ACADEMIC_LOOKUP_ENABLED'),
  turno: () => encendido('TOOLI_ACADEMIC_LOOKUP_ENABLED'),
  horario: () => encendido('TOOLI_HORARIO_ENABLED'),
  cursos: () => encendido('TOOLI_SAVIO_ENABLED') && Boolean(process.env.SAVIO_WS_TOKEN?.trim()),
};

export type CaminoNotas = 'A' | 'B';

/**
 * Camino de las notas.
 *  - B (por defecto): sesión al momento. Se pide la contraseña en cada consulta,
 *    se usa una sola vez y no queda nada.
 *  - A (opcional): con consentimiento, tras un login correcto se guarda CIFRADA la
 *    sesión del navegador (cookies, nunca la contraseña) por unas horas, y la voz
 *    puede reutilizarla. Exige TOOLI_ACADEMICO_CLAVE; sin clave válida cae a B.
 */
export function caminoNotas(clave: string | undefined = process.env.TOOLI_ACADEMICO_CLAVE): CaminoNotas {
  if (process.env.TOOLI_NOTAS_CAMINO?.trim().toUpperCase() !== 'A') return 'B';
  return claveValida(clave) ? 'A' : 'B';
}

export function claveValida(clave: string | undefined): boolean {
  if (!clave) return false;
  const c = clave.trim();
  if (/^[0-9a-f]{64}$/i.test(c)) return true;
  try { return Buffer.from(c, 'base64').length === 32; } catch { return false; }
}

/** Horas de vida de la sesión guardada del camino A (1 a 72; por defecto 12). */
export function horasSesionNotas(): number {
  const n = Number(process.env.TOOLI_NOTAS_SESION_HORAS);
  return Number.isFinite(n) && n >= 1 && n <= 72 ? Math.floor(n) : 12;
}

/** Avisos proactivos (tareas por vencer, recibo por vencer): apagados por defecto. */
export function avisosProactivosActivos(): boolean {
  return encendido('TOOLI_AVISOS_ACADEMICOS_ENABLED');
}

export type ProveedorHorarioNombre = 'banner' | 'simulado';

/**
 * El proveedor simulado SOLO existe para pruebas y demos: nunca en producción.
 * Un estudiante decidiendo con un horario inventado es un daño real.
 */
export function proveedorHorario(): ProveedorHorarioNombre {
  const pedido = process.env.TOOLI_HORARIO_PROVEEDOR?.trim().toLowerCase();
  if (pedido === 'simulado' && process.env.NODE_ENV !== 'production') return 'simulado';
  return 'banner';
}
