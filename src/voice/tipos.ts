// Tipos compartidos del canal de voz (servidor, panel y pruebas). Sin dependencias de servidor.
// Base: FastFood src/lib/voice/types.ts (transcripción acotada, estado leído a la defensiva); el estado del diálogo
// es nuevo (posgrados, verificación del estudiante, agenda).
import type { AreaAgenda, Franja } from '../contratos/agenda';
import type { TipoConsulta } from '../contratos/academico';

export type Resultado =
  | 'en_curso' | 'consulta' | 'datos_estudiante' | 'transferida' | 'cita' | 'devolver_llamada'
  | 'sin_cupo' | 'fuera_de_horario' | 'colgo' | 'error' | 'silencio';

export type Fase =
  | 'libre'
  | 'pide_codigo_estudiantil'
  | 'pide_otp'
  | 'elige_programa'
  | 'elige_franja'
  | 'confirma_franja'
  | 'ofrece_devolucion'
  | 'ofrece_asesor'
  | 'ofrece_whatsapp_recibo';

export interface EstadoDialogo {
  fase: Fase;
  /** Programa del que se viene hablando (id del catálogo): «¿y cuánto cuesta?» se refiere a él. */
  programa: string | null;
  /** Opciones ofrecidas cuando el nombre era ambiguo. */
  candidatos: string[];
  /** Teléfono vinculado del estudiante YA verificado en esta llamada (a ese se le consulta). */
  verificado: string | null;
  /**
   * Mientras se verifica: a qué teléfono se mandó el código y su huella (nunca el código en claro).
   * canal 'correo': el código lo generó y lo guarda el servicio académico (se mandó al correo institucional);
   * aquí no hay huella y `telefono` es el número que llama.
   */
  verificacion: { telefono: string; huella: string; expira: number; intentos: number; final: string; canal: 'whatsapp' | 'correo' } | null;
  intentosCodigoEstudiantil: number;
  /** Lo que pidió antes de verificar: se responde apenas verifique. */
  consultaPendiente: TipoConsulta | null;
  franjas: Franja[];
  franjaElegida: number | null;
  /** Área de la agenda de las franjas ofrecidas (la reserva va a la misma). */
  areaCita: AreaAgenda | null;
  /** Dijo algo de soporte técnico (clave, no puede entrar…): la cita va a TI. */
  soporte: boolean;
  /** Preguntó por pregrado: si termina en cita, va al área de pregrado. */
  pregrado: boolean;
  /** Código estudiantil que dictó sin decir qué quería: se usa cuando lo diga, sin pedirlo otra vez. */
  codigoDictado: string | null;
  turnos: number;
  /** Turnos seguidos sin entender. */
  fallos: number;
  inyecciones: number;
  ultimaRespuesta: string | null;
  /**
   * Si `ultimaRespuesta` leyó datos académicos, de qué tipo: «repítemelo» la vuelve a decir pero la transcripción guarda
   * solo «[datos académicos leídos: …]» (issue #33).
   */
  ultimaDatos: TipoConsulta | null;
}

export const DIALOGO_VACIO: EstadoDialogo = {
  fase: 'libre',
  programa: null,
  candidatos: [],
  verificado: null,
  verificacion: null,
  intentosCodigoEstudiantil: 0,
  consultaPendiente: null,
  franjas: [],
  franjaElegida: null,
  areaCita: null,
  soporte: false,
  pregrado: false,
  codigoDictado: null,
  turnos: 0,
  fallos: 0,
  inyecciones: 0,
  ultimaRespuesta: null,
  ultimaDatos: null,
};

export type Accion = 'none' | 'transfer' | 'hangup';

export interface LineaTranscripcion {
  /** c = quien llama, a = asistente, s = sistema (nota interna). */
  r: 'c' | 'a' | 's';
  t: string;
  at: string;
}

export const MAX_TURN_CHARS = 300;
export const MAX_LINEAS = 80;

export interface LlamadaVoz {
  id: string;
  proveedor: string;
  proveedorCallId: string;
  telefono: string;
  simulada: boolean;
  estado: 'activa' | 'cerrada';
  resultado: Resultado;
  iniciada: string;
  contestada: string | null;
  cerrada: string | null;
  duracionSeg: number;
  minutosPermitidos: number;
  minutosCobrados: number;
  costoUsd: number;
  /** Claves de uso (día y mes de Colombia) a las que se cargaron los minutos: al cerrar se ajustan esas mismas. */
  usoDia: string;
  usoMes: string;
  resumen: string | null;
  /** Lo que vence la retención (ms). */
  expira: number;
  devolucionHecha: string | null;
  devolucionNota: string | null;
  devolucionPor: string | null;
  /** Compare-and-set: cada escritura sube la versión; una escritura con versión vieja se rechaza. */
  version: number;
  dialogo: EstadoDialogo;
  /** Hay audio del bot sonando (para el barge-in). */
  hablando: boolean;
  /** Qué hacer cuando termine de sonar lo último (transferir o colgar). */
  despuesDeHablar: 'transfer' | 'hangup' | null;
  /** Número de la última frase final recibida (el turno de una frase vieja no se aplica). */
  frase: number;
  /**
   * Cuántos turnos se aplicaron al diálogo. Un turno calculado sobre un diálogo que otro turno ya cambió (y sin efectos
   * propios) se descarta en vez de pisarlo.
   */
  turnoAplicado: number;
  /** Frases puente sonando: su `speak_ended` no dispara la acción pendiente (esa es de la respuesta que va detrás). */
  puentes: number;
  /** Etapa del control de silencio: 0 nada, 1 ya preguntó «¿sigues ahí?», 2 ya se despidió. */
  silencio: 0 | 1 | 2;
  /** Marca de la última actividad (ms). */
  actividad: number;
  /**
   * Fecha límite (ms) del control de silencio en curso, o null. Vive en el estado de la llamada (Redis), no en un
   * temporizador de la instancia: sobrevive a un reinicio y cualquier instancia la puede cumplir. Solo actúa quien
   * gane el compare-and-set que la pone en null, así que «¿sigues ahí?» se dice una sola vez.
   */
  silencioVence: number | null;
  /**
   * Dígitos de frases seguidas que eran solo un dictado mientras la línea pedía el código («cuatro ocho dos» /
   * «nueve uno tres»): se juntan con la siguiente. Se vacía al usarlos, con cualquier otra frase y al colgar.
   */
  dictado: string;
  /**
   * Se verificó a un estudiante en esta llamada. Al colgar se borra el teléfono del vínculo (`dialogo.verificado`) y
   * queda solo esto, para que el panel lo muestre sin guardar el dato 180 días (punto 12).
   */
  verificada: boolean;
  /** Último `speak_ended` (ms, del reloj del proveedor): un `speak_started` más viejo llegó tarde y se ignora. */
  finHabla: number | null;
  /** Cuándo el barrido colgó la llamada por pasar el tope duro (ms); si después no llega el call.hangup, la cierra. */
  colgadoForzado: number | null;
  /**
   * Cuándo se pasó a un asesor (ISO). Desde ahí el bot no atiende: ni turnos, ni silencio, ni avisos de tiempo, y no
   * se transcribe (punto 9). Vuelve a null si el asesor no contestó y el bot retoma (punto 16).
   */
  transferidaEn: string | null;
  /** Hasta cuándo puede durar la pata del asesor (ms): el tope duro de una llamada transferida. */
  transferidaHasta: number | null;
  /** La pata saliente (asesor) contestó. */
  pataContestada: boolean;
  /** Duración real de la pata del asesor (s), cuando llegó su call.hangup; null = no llegó (al cerrar se estima). */
  segPata: number | null;
  /** Minutos cobrados de la pata del asesor (incluidos en `minutosCobrados`, punto 14). */
  minutosPata: number;
}

const TIPOS_CONSULTA: readonly TipoConsulta[] = ['notas', 'recibo', 'turno', 'horario', 'cursos'];

export function leerDialogo(raw: unknown): EstadoDialogo {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<EstadoDialogo>;
  const fases: Fase[] = ['libre', 'pide_codigo_estudiantil', 'pide_otp', 'elige_programa', 'elige_franja', 'confirma_franja', 'ofrece_devolucion', 'ofrece_asesor', 'ofrece_whatsapp_recibo'];
  const v = s.verificacion;
  return {
    fase: fases.includes(s.fase as Fase) ? (s.fase as Fase) : 'libre',
    programa: typeof s.programa === 'string' ? s.programa.slice(0, 120) : null,
    candidatos: Array.isArray(s.candidatos) ? s.candidatos.filter((c) => typeof c === 'string').slice(0, 3) : [],
    verificado: typeof s.verificado === 'string' ? s.verificado.slice(0, 20) : null,
    verificacion:
      v && typeof v.telefono === 'string' && typeof v.huella === 'string' && Number.isFinite(v.expira)
        ? {
            telefono: v.telefono, huella: v.huella, expira: v.expira, intentos: Number(v.intentos) || 0, final: String(v.final ?? ''),
            canal: v.canal === 'correo' ? 'correo' : 'whatsapp',
          }
        : null,
    intentosCodigoEstudiantil: Number.isInteger(s.intentosCodigoEstudiantil) ? (s.intentosCodigoEstudiantil as number) : 0,
    consultaPendiente: TIPOS_CONSULTA.includes(s.consultaPendiente as TipoConsulta)
      ? (s.consultaPendiente as TipoConsulta)
      : null,
    franjas: Array.isArray(s.franjas) ? s.franjas.slice(0, 3) : [],
    franjaElegida: Number.isInteger(s.franjaElegida) ? (s.franjaElegida as number) : null,
    areaCita: s.areaCita === 'posgrados' || s.areaCita === 'pregrado' || s.areaCita === 'ti' ? s.areaCita : null,
    soporte: s.soporte === true,
    pregrado: s.pregrado === true,
    codigoDictado: typeof s.codigoDictado === 'string' && /^T\d{8}$/.test(s.codigoDictado) ? s.codigoDictado : null,
    turnos: Number.isInteger(s.turnos) ? (s.turnos as number) : 0,
    fallos: Number.isInteger(s.fallos) ? Math.max(0, Math.min(10, s.fallos as number)) : 0,
    inyecciones: Number.isInteger(s.inyecciones) ? (s.inyecciones as number) : 0,
    ultimaRespuesta: typeof s.ultimaRespuesta === 'string' ? s.ultimaRespuesta.slice(0, 420) : null,
    ultimaDatos: TIPOS_CONSULTA.includes(s.ultimaDatos as TipoConsulta) ? (s.ultimaDatos as TipoConsulta) : null,
  };
}
