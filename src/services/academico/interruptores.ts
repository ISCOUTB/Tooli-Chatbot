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

/**
 * ¿Hay al menos una integración académica encendida? Con todas apagadas (lo de fábrica) «Mi semestre» no existe:
 * ni en los menús, ni al escribirlo, ni en «Mi vida académica». Todo se comporta como antes de los datos académicos.
 */
export function miSemestreDisponible(i: Interruptores = interruptoresDeEntorno): boolean {
  return i.notas() || i.recibo() || i.turno() || i.horario() || i.cursos();
}

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

export interface ProblemaConfigAcademica {
  /** `bloqueo`: el preflight detiene el despliegue; `aviso`: solo se dice. El arranque muestra los dos. */
  nivel: 'bloqueo' | 'aviso';
  mensaje: string;
}

type Entorno = Record<string, string | undefined>;

/**
 * Lo que está encendido sin lo que necesita. Lo usan el arranque (src/config) y, con la misma regla,
 * tools/deploy-preflight.py. Sin TOOLI_ACADEMICO_CLAVE la cédula no se guarda: con el recibo encendido cada intento
 * terminaba en «vincula tu código» -> login a Iceberg -> la cédula se descartaba -> «vincula tu código» otra vez.
 */
export function problemasConfigAcademica(env: Entorno): ProblemaConfigAcademica[] {
  const on = (k: string) => env[k] === '1';
  const conClave = claveValida(env.TOOLI_ACADEMICO_CLAVE);
  const salida: ProblemaConfigAcademica[] = [];
  if (on('TOOLI_ACADEMIC_LOOKUP_ENABLED') && !conClave) {
    salida.push({
      nivel: 'bloqueo',
      mensaje: 'TOOLI_ACADEMIC_LOOKUP_ENABLED=1 necesita TOOLI_ACADEMICO_CLAVE (32 bytes en hex o base64: openssl rand -hex 32): sin ella la cédula no se guarda y el recibo no se puede descargar. Pon la clave o apaga el interruptor.',
    });
  }
  if (env.TOOLI_NOTAS_CAMINO?.trim().toUpperCase() === 'A' && !conClave) {
    salida.push({ nivel: 'aviso', mensaje: 'TOOLI_NOTAS_CAMINO=A sin TOOLI_ACADEMICO_CLAVE válida: las notas usan el camino B (no se guarda la sesión).' });
  }
  const horarioBanner = (env.TOOLI_HORARIO_PROVEEDOR?.trim().toLowerCase() !== 'simulado') || env.NODE_ENV === 'production';
  if (on('TOOLI_HORARIO_ENABLED') && horarioBanner && (!conClave || env.TOOLI_NOTAS_CAMINO?.trim().toUpperCase() !== 'A')) {
    salida.push({ nivel: 'aviso', mensaje: 'TOOLI_HORARIO_ENABLED=1 necesita TOOLI_NOTAS_CAMINO=A y TOOLI_ACADEMICO_CLAVE: sin la sesión guardada el horario solo manda al autoservicio.' });
  }
  return salida;
}

