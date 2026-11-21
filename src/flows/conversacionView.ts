/**
 * Textos, botones y lógica pura del flujo conversacional de posgrados
 * (`FLUJO_CONVERSACIONAL=true`). La persona escribe lo que quiera y la IA le
 * responde; entre respuesta y respuesta el bot hace una sola pregunta corta con
 * botones, como en NutrIA, y solo de lo que todavía no sabe.
 */
import { normalize } from './validation';
import type { NivelElegido, Relacion } from './recomendacionView';

export interface BotonConversacion {
  id: string;
  displayText: string;
}

/** Lo que el bot espera que responda la persona después de su última pregunta. */
export type Pendiente =
  | 'datos' | 'tiene_programa' | 'estudia_utb' | 'egresado' | 'pregrado' | 'nivel' | 'info' | 'nombre_info' | 'ofrecer'
  | 'regreso';

export const SALUDO_CONVERSACION =
  '¡Hola! 👋 Soy *Tooli*, el asistente de Posgrados de la Universidad Tecnológica de Bolívar 🎓\n\n' +
  'Pregúntame lo que quieras: programas, costos, horarios, requisitos o financiación. ' +
  'También puedes mandarme un audio 🎤';

export const SALUDO_CORTO = '¡Hola! 👋 Soy *Tooli*, de Posgrados UTB 🎓';

/** Primer mensaje con una pregunta: se responde apenas la persona decida sobre sus datos. */
export const SALUDO_CON_PREGUNTA = '¡Hola! 👋 Soy *Tooli*, de Posgrados UTB 🎓 Con gusto te ayudo.';

export const TITULO = '🎓 Posgrados UTB';
export const PIE = 'También puedes escribirme tu pregunta';

export interface Pregunta {
  pendiente: Pendiente;
  texto: string;
  /** Sin botones se pide por escrito. */
  botones?: readonly BotonConversacion[];
  pie?: string;
}

export const PREGUNTAS: Record<Pendiente, Pregunta> = {
  tiene_programa: {
    pendiente: 'tiene_programa',
    texto: '¿Ya tienes un posgrado en mente?',
    botones: [
      { id: 'conv_tengo', displayText: '✅ Sí, ya sé cuál' },
      { id: 'conv_elegir', displayText: '🤔 Ayúdame a elegir' },
    ],
  },
  estudia_utb: {
    pendiente: 'estudia_utb',
    texto: 'Para orientarte mejor: ¿cuál es tu relación con la UTB?',
    botones: [
      { id: 'conv_egresado', displayText: '🎓 Egresado UTB' },
      { id: 'conv_estudiante', displayText: '📚 Estudio en la UTB' },
      { id: 'conv_utb_no', displayText: '🏫 Otra universidad' },
    ],
  },
  egresado: {
    pendiente: 'egresado',
    texto: '¿Ya te graduaste o aún estudias?',
    botones: [
      { id: 'conv_egresado', displayText: '🎓 Ya me gradué' },
      { id: 'conv_estudiante', displayText: '📚 Aún estudio' },
    ],
  },
  pregrado: {
    pendiente: 'pregrado',
    texto: '¿Qué estudiaste? Escríbeme tu carrera ✍️\n\nPor ejemplo: *Ingeniería Industrial* o *Administración de Empresas*.',
  },
  nivel: {
    pendiente: 'nivel',
    texto: '¿Qué nivel de posgrado te interesa?',
    botones: [
      { id: 'conv_esp', displayText: '📘 Especialización' },
      { id: 'conv_mae', displayText: '🎓 Maestría' },
      { id: 'conv_doc', displayText: '🔬 Doctorado' },
    ],
    pie: '¿No sabes aún? Escribe "no sé" y te muestro todo',
  },
  info: {
    pendiente: 'info',
    texto:
      '📬 ¿Te gustaría recibir por WhatsApp información de posgrados de la UTB, como fechas de inscripción, ' +
      'becas y eventos?\n\nAl aceptar autorizas el tratamiento de tu nombre y número para ese fin (*Ley 1581 de 2012*). ' +
      'Puedes darte de baja cuando quieras escribiendo *BAJA*.',
    botones: [
      { id: 'conv_info_si', displayText: '✅ Sí, envíenme' },
      { id: 'conv_info_no', displayText: '❌ No, gracias' },
    ],
    pie: 'Tus datos se usan solo para fines de admisión',
  },
  nombre_info: {
    pendiente: 'nombre_info',
    texto: '¡Genial! 🙌 ¿Cómo te llamas? Así quedas registrado(a) 📝',
  },
  datos: {
    pendiente: 'datos',
    texto:
      '🔒 Una pregunta rápida, solo esta vez: ¿autorizas a la UTB a tratar tus datos (nombre y número de WhatsApp) ' +
      'para orientarte, registrarte como interesado(a), que un asesor te contacte y enviarte información de ' +
      'posgrados por este medio? (*Ley 1581 de 2012*)\n\nPuedes revocarla cuando quieras escribiendo *BAJA*.',
    botones: [
      { id: 'conv_datos_si', displayText: '✅ Sí, autorizo' },
      { id: 'conv_datos_no', displayText: '❌ No autorizo' },
    ],
    pie: 'Tus datos se usan solo para fines de admisión',
  },
  regreso: {
    pendiente: 'regreso',
    texto: '¡Hola de nuevo! 👋 ¿Seguimos donde quedamos?',
    botones: [
      { id: 'conv_seguir_perfil', displayText: '✅ Sí, sigamos' },
      { id: 'conv_reiniciar', displayText: '🔄 Empezar de nuevo' },
    ],
  },
  ofrecer: {
    pendiente: 'ofrecer',
    texto: '¿Quieres que te recomiende los posgrados que mejor encajan con lo que estudiaste?',
    botones: [
      { id: 'conv_reco', displayText: '🎯 Sí, recomiéndame' },
      { id: 'conv_asesor', displayText: '👤 Hablar con asesor' },
    ],
  },
};

/** La pregunta de la carrera cambia un poco si estudia o estudió en la UTB. */
export function textoPregrado(relacion: string | undefined): string {
  if (relacion === 'estudiante_utb') return '¿Qué carrera estudias en la UTB? Escríbemela ✍️\n\n_Si prefieres, escribe *lista* y la eliges._';
  if (relacion === 'egresado_utb') return '¿Qué carrera estudiaste en la UTB? Escríbemela ✍️\n\n_Si prefieres, escribe *lista* y la eliges._';
  return PREGUNTAS.pregrado.texto;
}

export const PEDIR_PROGRAMA = '¡Genial! 🙌 ¿Cuál es? Escríbeme su nombre o lo que quieras saber de él 👇';

/** Salidas para quien todavía no tiene un título universitario. */
export const BOTONES_SIN_PREGRADO: readonly BotonConversacion[] = [
  { id: 'conv_pregrados', displayText: '🏫 Ver pregrados UTB' },
  { id: 'conv_seguir', displayText: '💬 Otra pregunta' },
];

export const BOTONES_TECNICO: readonly BotonConversacion[] = [
  { id: 'conv_asesor', displayText: '👤 Hablar con asesor' },
  { id: 'conv_pregrados', displayText: '🏫 Ver pregrados UTB' },
];

export const SIN_PREGRADO =
  '¡Gracias por contarme! 🙌 Los posgrados son para quienes ya tienen un *título profesional universitario*. ' +
  'Si estás pensando en tu primera carrera, la UTB tiene pregrados que te pueden gustar.';

export const TECNICO =
  'Los posgrados de la UTB piden un *título profesional universitario*. Si tu título es técnico o tecnólogo, ' +
  'un asesor te confirma qué opciones tienes.';

export const SEGUIR_PREGUNTANDO = '¡Claro! Pregúntame lo que quieras 👇';

export const INFO_RECHAZADA = 'Entendido, no te enviaremos información 👍';

// ── Preguntas sugeridas ─────────────────────────────────────────────────────

/** Va como instrucción de sistema: la IA propone dos preguntas de seguimiento en la misma llamada. */
export const INSTRUCCION_SUGERENCIAS =
  'Al final de tu respuesta, en una línea aparte, escribe exactamente "SUGERENCIAS: " seguido de dos preguntas ' +
  'muy cortas (máximo 20 caracteres cada una) que la persona podría hacerte a continuación sobre este tema, ' +
  'separadas por " | ". Sin emojis ni comillas. Ejemplo: SUGERENCIAS: ¿Hay becas? | ¿Cuándo empieza?\n' +
  'Si la persona quiere inscribirse, matricularse o pagar; pide que la llamen o la contacten; pregunta por su caso ' +
  'particular (homologación de materias, descuentos o becas para su situación, validación de títulos, excepciones); ' +
  'o pregunta algo que no puedes confirmar con la información oficial, agrega además una línea "ASESOR: sí". ' +
  'No la agregues para preguntas generales que sí respondiste.';

/** Se ofrece una vez por conversación, cuando la IA marca que hace falta una persona. */
export const OFRECER_ASESOR = '👤 Esto te lo resuelve mejor un asesor de Posgrados. ¿Quieres que te contacte?';
export const BOTONES_OFRECER_ASESOR: readonly BotonConversacion[] = [
  { id: 'conv_asesor', displayText: '👤 Sí, contáctenme' },
  { id: 'conv_seguir', displayText: '💬 Seguir con Tooli' },
];

export const PREFIJO_SUGERENCIA = 'conv_sug:';
export const BOTON_ASESOR: BotonConversacion = { id: 'conv_asesor', displayText: '👤 Hablar con asesor' };
export const BOTON_PREGRADOS: BotonConversacion = { id: 'conv_pregrados', displayText: '🏫 Ver pregrados UTB' };
export const PIE_SUGERENCIAS = 'O escríbeme lo que quieras';
export const SEGUIR_CON_SUGERENCIAS = '¿Quieres saber algo más? 👇';

/** Si la IA no propone nada, siempre queda algo que tocar. */
export const SUGERENCIAS_RESPALDO: Record<'posgrados' | 'admisiones', readonly string[]> = {
  posgrados: ['¿Hay becas?', '¿Cuándo inician?'],
  admisiones: ['¿Cómo me inscribo?', '¿Hay becas?'],
};

function limpiarSugerencia(s: string): string {
  return s.replace(/["'“”*_]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Separa de la respuesta la línea "SUGERENCIAS: a | b" (solo quedan las que
 * caben en un botón) y la marca "ASESOR: sí" (hace falta una persona).
 */
export function separarSugerencias(respuesta: string): { texto: string; sugerencias: string[]; asesor: boolean } {
  const resto: string[] = [];
  let sugerencias: string[] = [];
  let asesor = false;
  for (const linea of (respuesta ?? '').split('\n')) {
    const m = /^\s*[*_]*\s*sugerencias\s*[*_]*\s*:\s*(.*)$/i.exec(linea);
    if (m) {
      sugerencias = m[1].split('|').map(limpiarSugerencia).filter(Boolean);
      continue;
    }
    const a = /^\s*[*_]*\s*asesor\s*[*_]*\s*:\s*(.*)$/i.exec(linea);
    if (a) {
      asesor = /^\s*[*_]*\s*s[ií](?!\p{L})/iu.test(a[1]);
      continue;
    }
    resto.push(linea);
  }
  const validas = [...new Set(sugerencias)].filter((s) => [...s].length <= 20).slice(0, 2);
  return { texto: resto.join('\n').trim(), sugerencias: validas, asesor };
}

const clavePregunta = (s: string) => normalize(s).replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Botones de la respuesta: las preguntas sugeridas y una salida a una persona.
 * Nunca se sugiere lo mismo que la persona acaba de preguntar.
 */
export function botonesSugeridos(
  sugerencias: readonly string[], area: 'posgrados' | 'admisiones', preguntaActual = '',
): BotonConversacion[] {
  const actual = clavePregunta(preguntaActual);
  const distinta = (s: string) => clavePregunta(s) !== actual;
  const propias = sugerencias.filter(distinta);
  const usar = propias.length ? propias : SUGERENCIAS_RESPALDO[area].filter(distinta);
  return [
    ...usar.slice(0, 2).map((s) => ({ id: `${PREFIJO_SUGERENCIA}${s}`, displayText: s })),
    area === 'admisiones' ? BOTON_PREGRADOS : BOTON_ASESOR,
  ];
}

/**
 * La respuesta va con sus botones en un solo mensaje si cabe. Con enlaces va
 * como texto normal (WhatsApp les muestra la vista previa) y los botones aparte.
 */
export function cabeConBotones(texto: string): boolean {
  return [...texto].length <= 1000 && !/https?:\/\/|www\./i.test(texto);
}

/** Un toque en una pregunta sugerida es esa pregunta, escrita. */
export function parseSugerencia(texto: string): string | null {
  const t = (texto ?? '').trim();
  if (!t.startsWith(PREFIJO_SUGERENCIA)) return null;
  const pregunta = t.slice(PREFIJO_SUGERENCIA.length).trim().slice(0, 60);
  return pregunta || null;
}

// ── Seguimiento ─────────────────────────────────────────────────────────────

/** Encabeza la pregunta que quedó sin contestar, unas horas después. */
export function recordatorioSeguimiento(nombre?: string): string {
  const primero = (nombre ?? '').trim().split(/\s+/)[0] ?? '';
  return `👋 ${primero ? `¡Hola, ${primero}! ` : '¡Hola! '}¿Seguimos donde quedamos?`;
}

// ── Quien vuelve ────────────────────────────────────────────────────────────

const PLURAL_NIVEL: Record<string, string> = {
  especializacion: 'especializaciones', maestria: 'maestrías', doctorado: 'doctorados',
};

function primerNombre(nombre: string | undefined): string {
  return (nombre ?? '').trim().split(/\s+/)[0] ?? '';
}

/** "¡Hola de nuevo, Laura! 👋" — sin nombre, solo "¡Hola de nuevo! 👋". */
export function saludoCortoRegreso(nombre?: string): string {
  const primero = primerNombre(nombre);
  return primero ? `¡Hola de nuevo, ${primero}! 👋` : '¡Hola de nuevo! 👋';
}

/** Recuerda lo que buscaba la última vez y ofrece seguir. */
export function saludoRegreso(nombre?: string, carrera?: string | null, nivel?: string): string {
  const plural = nivel ? PLURAL_NIVEL[nivel] : undefined;
  const busqueda = carrera
    ? (plural ? `La última vez buscabas *${plural}* para *${carrera}*.` : `La última vez hablamos de posgrados para *${carrera}*.`)
    : 'La última vez hablamos de posgrados.';
  return `${saludoCortoRegreso(nombre)} ${busqueda} ¿Seguimos?`;
}

export const DATOS_RECHAZADOS = 'Entendido, no guardaré tus datos 👍 Igual puedo responder tus preguntas de posgrados.';

/** Quien autorizó al empezar y dio su nombre: ya está en el CRM. */
export function datosAceptados(nombre: string): string {
  const primero = nombre.trim().split(/\s+/)[0] ?? '';
  return `¡Gracias, ${primero}! Ya quedaste registrado(a) ✅ Te contaremos de becas, fechas y eventos de posgrados 📬\n\n` +
    '_Si cambias de opinión, escribe *BAJA*._';
}

export function infoAceptada(nombre: string): string {
  const primero = nombre.trim().split(/\s+/)[0] ?? '';
  return `¡Listo, ${primero}! Te escribiremos cuando haya novedades de posgrados 📬\n\n_Si cambias de opinión, escribe *BAJA*._`;
}

export const PEDIR_NOMBRE_VALIDO = 'Para registrarte, escríbeme solo tu nombre, por ejemplo: *Laura Gómez* ✍️';

/** Nombre escrito a mano: espacios normalizados, sin emojis ni números sueltos. */
/** Palabras que no pueden ser (o empezar) un nombre: ruido, verbos y palabras de la conversación. */
const NO_ES_NOMBRE = new Set([
  'hola', 'ok', 'okay', 'si', 'no', 'gracias', 'espera', 'momento', 'un', 'una', 'que', 'como', 'soy', 'tengo', 'estoy',
  'trabajo', 'vivo', 'mi', 'me', 'mis', 'el', 'en', 'es', 'de', 'del', 'la', 'los', 'las', 'y', 'a', 'con', 'por', 'para',
  'correo', 'numero', 'cedula', 'cc', 'info', 'informacion', 'maestria', 'especializacion', 'doctorado', 'posgrado',
  'posgrados', 'asesor', 'carrera', 'quiero', 'necesito', 'cuanto', 'cuando', 'donde', 'porque', 'pero', 'bueno', 'listo',
  'dale', 'entiendo', 'claro', 'anos', 'ano', 'buenas', 'buenos', 'dias', 'tardes', 'noches', 'nombre', 'llamo', 'ah', 'eh',
  'mmm', 'ya', 'vuelvo', 'jaja', 'jajaja', 'jeje', 'lol', 'xd', 'k', 'q', 'aja', 'volver', 'atras', 'menu', 'inicio', 'salir',
]);
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'san', 'da', 'do']);

/**
 * El nombre que escribió, o null si no parece un nombre: "jajaja", "un momento",
 * "soy de Barranquilla" o "tengo 32 años" no se registran. De "me llamo Laura"
 * o "soy Laura Gómez" se toma solo el nombre.
 */
export function limpiarNombre(texto: string): string | null {
  let t = (texto ?? '').trim();
  const presentado = /^(?:hola[,!.\s]+)?(?:me llamo|mi nombre es|soy|yo soy)\s+(.+)$/i.exec(t);
  if (presentado) t = presentado[1];
  if (/[@\d]/.test(t)) return null;
  const limpio = t.replace(/[^\p{L}\s'.-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  const palabras = limpio.split(' ').filter(Boolean);
  if (!palabras.length || palabras.length > 5 || limpio.replace(/[^\p{L}]/gu, '').length < 3) return null;
  const norm = palabras.map((w) => normalize(w).replace(/[^a-z]/g, ''));
  if (norm.some((w) => /^(ja|je|ji|jo|js)+j?$|^m{2,}$|^a+h*$|^x+d+$/.test(w))) return null;
  if (NO_ES_NOMBRE.has(norm[0]) || PARTICULAS.has(norm[0])) return null;
  if (norm.some((w) => NO_ES_NOMBRE.has(w) && !PARTICULAS.has(w))) return null;
  return limpio;
}

/** "mmm", "jajaja", "😂", "?", "...", "ey": sin contenido para responder. */
export function esRuido(texto: string): boolean {
  const t = (texto ?? '').trim();
  if (!t) return false;
  if (/^[\p{P}\s]+$/u.test(t)) return true;
  if (/^[\p{Extended_Pictographic}\s\u200d\ufe0f]+$/u.test(t) && !/[👍👌🙏🙌✅❤]/u.test(t)) return true;
  const n = normalize(t).replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return /^((ja|je|ji|jo|js)+j?|m{2,}|a+h+|aja|ey+|eh+|k|q|x+d+|hmm+|uff+|ah ok|ok\?)$/.test(n) || /^[a-z]$/.test(n);
}

/** "espera", "un momento", "ya vuelvo": se le espera. */
export function esEspera(texto: string): boolean {
  const n = normalize(texto ?? '').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return /^(espera|esperame|espere|un momento|un momentico|dame un momento|ya vuelvo|ahorita|ahora te digo|dejame ver|deja ver)$/.test(n);
}

/** "no entiendo", "¿qué?", "cómo así": se le explica de otra forma. */
export function esConfusion(texto: string): boolean {
  const n = normalize(texto ?? '').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return /^(no entiendo|no te entiendo|no entendi|que|que cosa|como asi|como|explicame|no se que poner|que pongo|que hago)$/.test(n);
}

/** "esto no sirve", "no me ayudas": se pide perdón y se ofrece una persona. */
export function esQueja(texto: string): boolean {
  const n = normalize(texto ?? '').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return /^(esto |este bot |el bot )?(no sirve|no sirves|no funciona|no me ayuda|no me ayudas|no me entiendes|no me entiende|no me sirve)( para nada)?$/.test(n)
    || /^(pesimo|que malo|malo|horrible|inutil|que mal servicio|mal servicio)$/.test(n);
}

/** Un dato personal suelto: no se manda a la IA. */
export function datoPersonal(texto: string): { tipo: 'correo'; valor: string } | { tipo: 'telefono' | 'documento' } | null {
  const t = (texto ?? '').trim();
  const correo = /[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/i.exec(t);
  if (correo) return { tipo: 'correo', valor: correo[0].toLowerCase().replace(/[.,;]+$/, '') };
  const digitos = t.replace(/[^\d]/g, '');
  if (/\b(cc|c\.c|cedula|cédula|documento|ti|tarjeta de identidad)\b/i.test(t) && digitos.length >= 6) return { tipo: 'documento' };
  if (/^\+?[\d\s().-]+$/.test(t) && /^(57)?3\d{9}$/.test(digitos)) return { tipo: 'telefono' };
  if (/^\+?[\d\s.-]+$/.test(t) && digitos.length >= 6) return { tipo: 'documento' };
  return null;
}

export const ESPERO = 'Claro, aquí te espero 🙂';
export const SEGUIMOS = '¿Seguimos? 🙂';
export const TE_EXPLICO = 'Perdón si no fui claro 🙏 Te lo pregunto de otra forma:';
export const SIN_PREGUNTA_PENDIENTE = '¿En qué te ayudo? 🙂 Pregúntame por programas, costos, horarios o becas, o toca una opción 👇';
export const QUEJA = 'Perdón 🙏 Quiero ayudarte. ¿Te paso con un asesor de Posgrados?';
export const TELEFONO_YA = 'Ya tengo tu número de WhatsApp 👍 No hace falta que lo escribas.';
export const DOCUMENTO_NO = 'No necesito tu documento 🙏 Por seguridad, mejor no lo compartas por aquí.';
export function correoAnotado(correo: string): string {
  return `📧 Anoté tu correo: *${correo}* ✅ Un asesor lo usará si pides que te contacten.`;
}
export const CORREO_SIN_AUTORIZACION = '📧 Gracias. Por ahora no guardo correos; si quieres que un asesor te contacte, escribe *asesor*.';

/** "BAJA", "no quiero recibir más mensajes": revoca la autorización (Ley 1581). */
export function esBaja(texto: string): boolean {
  const n = normalize(texto ?? '').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return n === 'baja' || n === 'darme de baja' || /^no (quiero|deseo) recibir (mas )?(informacion|mensajes)/.test(n)
    || /^no me (envien|manden) mas/.test(n);
}

/**
 * "No he estudiado", "soy bachiller" → 'ninguno'; "soy tecnólogo" → 'tecnico'.
 * Sirve para no insistir con la carrera a quien todavía no tiene pregrado.
 */
export function sinPregrado(texto: string): 'ninguno' | 'tecnico' | null {
  const n = normalize(texto ?? '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  if (/^(ninguna|ninguno|nada)\b/.test(n)
    || /\bno (he|e) (estudiado|empezado|hecho)\b/.test(n)
    || /\b(todavia|aun) no (he )?(estudiado|empezado)\b/.test(n)
    || /\bno (tengo|tiene) (carrera|pregrado|titulo|estudios)\b/.test(n)
    || /\bbachiller(ato)?\b/.test(n)
    || /\b(sali|salgo|termine) (del|el) colegio\b/.test(n)) return 'ninguno';
  if (/\b(tecnico|tecnica|tecnologo|tecnologa)\b/.test(n) || /^(soy |tengo (una )?|estudie (una )?)?tecnologia en\b/.test(n)) return 'tecnico';
  return null;
}

export const NO_RECONOCI_PREGRADO =
  'No reconocí esa carrera 🤔\n\nPuedes elegir de la lista una que se parezca, elegir el área en la que te mueves ' +
  'o escribirla de otra forma.';

export const IA_NO_DISPONIBLE =
  'Ahora mismo no puedo responder esa pregunta 🙏 Si quieres, te conecto con un asesor de Posgrados.';

export const SUGERIR_ASESOR =
  '🤔 Hemos hablado bastante. Si aún no resuelves tu duda, un asesor de Posgrados puede ayudarte.';

/** Pasado este número de respuestas de la IA, se ofrece un asesor. */
export const TURNOS_ANTES_DE_ASESOR = 12;

export type BotonId =
  | 'conv_tengo' | 'conv_elegir' | 'conv_utb_si' | 'conv_utb_no' | 'conv_egresado' | 'conv_estudiante'
  | 'conv_esp' | 'conv_mae' | 'conv_doc' | 'conv_reco' | 'conv_asesor' | 'conv_pregrados' | 'conv_seguir'
  | 'conv_info_si' | 'conv_info_no' | 'conv_seguir_perfil' | 'conv_reiniciar' | 'conv_datos_si' | 'conv_datos_no';

const IDS: ReadonlySet<string> = new Set([
  ...Object.values(PREGUNTAS).flatMap((p) => (p.botones ?? []).map((b) => b.id)),
  'conv_pregrados', 'conv_seguir',
]);

/** Los botones de este flujo llevan ids únicos, así que valen aunque se toquen tarde. */
export function parseBoton(texto: string): BotonId | null {
  const t = (texto ?? '').trim();
  return IDS.has(t) ? (t as BotonId) : null;
}

const SALUDOS: ReadonlySet<string> = new Set([
  'hola', 'holi', 'hello', 'hi', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'buen dia',
  'hola buenas', 'hola buenos dias', 'hola buenas tardes', 'hola buenas noches', 'saludos', 'que tal', 'hey',
  'informacion', 'info', 'hola informacion', 'hola info',
]);

/** Un saludo suelto (sin pregunta): el bot se presenta y pregunta. */
const PALABRAS_DE_SALUDO = new Set([
  'hola', 'holi', 'hello', 'hi', 'hey', 'buenas', 'buenos', 'buen', 'dias', 'dia', 'tardes', 'noches', 'saludos',
  'que', 'tal', 'como', 'estas', 'esta', 'tooli', 'info', 'informacion', 'por', 'favor', 'porfa', 'porfavor', 'gracias',
]);

/** Un saludo suelto (también "Hola Tooli" o "Hola, info por favor"): el bot se presenta y pregunta. */
export function esSaludo(texto: string): boolean {
  const n = normalize(texto ?? '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (n === '' || SALUDOS.has(n)) return true;
  const palabras = n.split(' ');
  return palabras.length <= 6 && /^(hola|holi|hello|hi|hey|buenas|buenos|buen|saludos)$/.test(palabras[0])
    && palabras.every((p) => PALABRAS_DE_SALUDO.has(p));
}

/** "Gracias", "ok", "👍", "me sirvió": no es una opción ni una pregunta. */
export function esAgradecimiento(texto: string): boolean {
  const t = (texto ?? '').trim();
  if (/^[\s👍👌🙏🙌✅😊🙂😀😁❤️]+$/u.test(t) && t.length) return true;
  const n = normalize(t).replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return /^(muchas |mil )?gracias( (tooli|por todo|por la info(rmacion)?))?$|^(ok|okay|oki|vale|listo|perfecto|genial|excelente|super|chevere|bueno|entendido|de acuerdo|dale)( gracias)?$|^(si )?me sirvio( mucho)?$/.test(n);
}

/** Una pregunta suelta en un paso de lista se responde y se sigue con la lista de arriba. */
export const SIGUE_ARRIBA = '👆 Cuando quieras, sigue con la opción de arriba.';
export const CON_GUSTO = '¡Con gusto! 🙌 Elige otra opción de arriba o escríbeme tu pregunta.';

const PERSONA = String.raw`(asesor|asesora|asesores|humano|persona|alguien|agente|ejecutivo|ejecutiva)`;
const ARTICULO = String.raw`( (con|a))?( (un|una|el|la|algun|alguna))?`;
const PEDIDOS_ASESOR: readonly RegExp[] = [
  // La persona va justo después del verbo: "hablar con un asesor", "quiero un asesor", "necesito alguien".
  new RegExp(String.raw`\b(hablar|comunicarme|contactar|contactarme|chatear|conversar|pasame|paseme|comuniqueme|comunicame)${ARTICULO} ${PERSONA}\b`),
  new RegExp(String.raw`\b(quiero|necesito|deseo|prefiero)( (hablar|comunicarme|chatear))?${ARTICULO} ${PERSONA}\b`),
  /\bque me (llamen|llame|contacten|contacte|escriba|escriban)\b/,
  /\bme (pueden|puede|podrian|podria) (llamar|contactar)\b/,
  /\b(llamenme|llamame|contactenme|contactame)\b/,
];

/** Pide hablar con una persona: "asesor", "quiero hablar con alguien", "que me llamen"… */
export function esPedidoAsesor(texto: string): boolean {
  const n = normalize(texto ?? '').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return false;
  // Una palabra o dos sueltas ("asesor", "un asesor", "asesor porfa").
  if (n.split(' ').length <= 3 && new RegExp(String.raw`\b(asesor|asesora|humano|agente)\b`).test(n)) return true;
  return PEDIDOS_ASESOR.some((r) => r.test(n));
}

/** Una pregunta va a la IA aunque el bot esté esperando la carrera. */
export function pareceUnaPregunta(texto: string): boolean {
  const n = normalize(texto ?? '');
  return n.includes('?') || /^(que|cual|cuales|cuanto|cuanta|cuantos|como|cuando|donde|hay|tienen|tiene|me puedes|puedo|quiero saber|necesito saber|informacion|info)\b/.test(n) && n.split(' ').length >= 2
    // Pedidos ("quiero el plan de estudios", "me interesa saber…") también van a la IA.
    || /^(quiero|necesito|me interesa|me gustaria|quisiera|podrias|puedes|dime|cuentame|explicame|muestrame)\b/.test(n) && n.split(' ').length >= 4;
}

export type RespuestaEscrita = { boton: BotonId } | { nivel: NivelElegido };

/** Respuestas escritas a mano que equivalen a tocar un botón de la pregunta pendiente. */
export function interpretarRespuestaEscrita(pendiente: Pendiente | '' | undefined, texto: string): RespuestaEscrita | null {
  const n = normalize(texto ?? '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  // Una pregunta ("¿Hay descuento por ser egresado?") no es la respuesta a la pregunta pendiente.
  if ((texto ?? '').includes('?') && n.split(' ').length > 3) return null;
  // Un "sí"/"no" corto equivale al botón; una frase larga es una pregunta para la IA.
  const corto = n.split(' ').length <= 4;
  // También como se contesta en WhatsApp: "dale", "ok", "sii", "de una", "nel", "para nada".
  const si = corto && /^(si+|sip|simon|claro|correcto|asi es|exacto|obvio|por supuesto|dale|ok|okay|oki|vale|bueno|listo|de una|afirmativo|perfecto|me parece bien|acepto|autorizo)( .*)?$/.test(n);
  const no = corto && /^(no+|nop|nones|nel|nah|nunca|negativo|para nada|todavia no|aun no)( .*)?$/.test(n);
  switch (pendiente) {
    case 'datos':
      if (no || /\bno (acepto|autorizo)\b/.test(n)) return { boton: 'conv_datos_no' };
      if (si || /\b(acepto|autorizo)\b/.test(n)) return { boton: 'conv_datos_si' };
      return null;
    case 'tiene_programa':
      if (si) return { boton: 'conv_tengo' };
      if (no || /ayuda|elegir|no se|recomiend/.test(n)) return { boton: 'conv_elegir' };
      return null;
    case 'estudia_utb':
      if (/egresad|me gradue|ya me gradue|graduad/.test(n)) return { boton: 'conv_egresado' };
      if (no || /otra universidad|otra u\b|de otra/.test(n)) return { boton: 'conv_utb_no' };
      if (/\b(estudio|estudiante|estoy estudiando|curso|semestre)\b/.test(n) && !/\botra\b/.test(n)) return { boton: 'conv_estudiante' };
      if (si) return { boton: 'conv_utb_si' };
      return null;
    case 'egresado':
      if (/egresad|gradu|termine|ya sali|ya me/.test(n)) return { boton: 'conv_egresado' };
      if (/estudi|curso|aun|todavia|semestre/.test(n)) return { boton: 'conv_estudiante' };
      return null;
    case 'nivel': {
      if (/no se|aun no|todavia no|cualquier|todos|todas|no estoy segur/.test(n)) return { nivel: '' };
      // "La más corta" o "la más rápida" es la especialización (un año).
      if (/\b(mas corta|mas corto|mas rapida|mas rapido|menos tiempo|la corta)\b/.test(n)) return { boton: 'conv_esp' };
      // El nivel escrito ("una maestría", "especialización"): solo si nombra uno.
      const niveles = [
        /especializ/.test(n) && 'conv_esp', /maestr|magister|master|\bmba\b/.test(n) && 'conv_mae', /doctor|\bphd\b/.test(n) && 'conv_doc',
      ].filter(Boolean) as BotonId[];
      return niveles.length === 1 && n.split(' ').length <= 5 ? { boton: niveles[0] } : null;
    }
    case 'info':
      if (si) return { boton: 'conv_info_si' };
      if (no) return { boton: 'conv_info_no' };
      return null;
    case 'regreso':
      if (si || /sigamos|seguir|continu/.test(n)) return { boton: 'conv_seguir_perfil' };
      if (no || /de nuevo|empezar|otra vez|reinici/.test(n)) return { boton: 'conv_reiniciar' };
      return null;
    case 'ofrecer':
      if (si || /recomiend/.test(n)) return { boton: 'conv_reco' };
      return null;
    default:
      return null;
  }
}

export interface PerfilDetectado {
  relacion?: Relacion;
  nivel?: NivelElegido;
}

/**
 * Lo que una frase libre dice de la persona ("soy egresado de la UTB", "busco una
 * maestría"). Solo valores cerrados: nunca se guarda lo que escribió.
 */
export function detectarPerfil(texto: string): PerfilDetectado {
  const n = normalize(texto ?? '');
  const perfil: PerfilDetectado = {};
  const utb = /\butb\b|tecnologica de bolivar/.test(n);
  if (/\begresad[oa]\b/.test(n) && utb) perfil.relacion = 'egresado_utb';
  else if (/\b(estudio|estudiante|curso)\b/.test(n) && utb) perfil.relacion = 'estudiante_utb';
  else if (/otra universidad|no (soy|estudie|estudio) (de|en) la utb/.test(n)) perfil.relacion = 'externo';
  if (/especializacion/.test(n)) perfil.nivel = 'especializacion';
  else if (/maestria|\bmba\b|magister/.test(n)) perfil.nivel = 'maestria';
  else if (/doctorado|\bphd\b/.test(n)) perfil.nivel = 'doctorado';
  return perfil;
}

/**
 * La siguiente pregunta que falta, en orden: relación con la UTB, carrera y
 * nivel. Con todo eso ya se puede recomendar.
 */
export function siguientePregunta(data: Record<string, string>): Pendiente | null {
  // Lo primero es la autorización de datos (quien ya respondió lo de recibir información, ya decidió).
  if (!data.datos && !data.info) return 'datos';
  // Sin título universitario no hay posgrado que recomendar: no se pregunta más.
  if (data.sinPregrado === '1') return null;
  if (!data.relacion) return 'estudia_utb';
  if (!data.pregradoId && !data.familiaId) return 'pregrado';
  if (data.nivelListo !== '1') return 'nivel';
  // Con el perfil completo: si quiere recibir información, y su nombre si aceptó.
  if (!data.info && data.datos !== 'no') return 'info';
  if (data.info === 'si' && !data.nombre) return 'nombre_info';
  return null;
}

export function nivelDeBoton(boton: BotonId): NivelElegido | null {
  if (boton === 'conv_esp') return 'especializacion';
  if (boton === 'conv_mae') return 'maestria';
  if (boton === 'conv_doc') return 'doctorado';
  return null;
}
