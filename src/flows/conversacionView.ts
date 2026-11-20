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
export type Pendiente = 'tiene_programa' | 'estudia_utb' | 'egresado' | 'pregrado' | 'nivel' | 'info' | 'nombre_info' | 'ofrecer' | 'regreso';

export const SALUDO_CONVERSACION =
  '¡Hola! 👋 Soy *Tooli*, el asistente de Posgrados de la Universidad Tecnológica de Bolívar 🎓\n\n' +
  'Pregúntame lo que quieras: programas, costos, horarios, requisitos o financiación. ' +
  'También puedes mandarme un audio 🎤';

export const SALUDO_CORTO = '¡Hola! 👋 Soy *Tooli*, de Posgrados UTB 🎓';

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
    texto: 'Para orientarte mejor: ¿estudias o estudiaste en la UTB?',
    botones: [
      { id: 'conv_utb_si', displayText: '✅ Sí' },
      { id: 'conv_utb_no', displayText: '❌ No' },
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
  'separadas por " | ". Sin emojis ni comillas. Ejemplo: SUGERENCIAS: ¿Hay becas? | ¿Cuándo empieza?';

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

/** Separa la línea "SUGERENCIAS: a | b" de la respuesta; solo quedan las que caben en un botón. */
export function separarSugerencias(respuesta: string): { texto: string; sugerencias: string[] } {
  const resto: string[] = [];
  let sugerencias: string[] = [];
  for (const linea of (respuesta ?? '').split('\n')) {
    const m = /^\s*[*_]*\s*sugerencias\s*[*_]*\s*:\s*(.*)$/i.exec(linea);
    if (m) {
      sugerencias = m[1].split('|').map(limpiarSugerencia).filter(Boolean);
      continue;
    }
    resto.push(linea);
  }
  const validas = [...new Set(sugerencias)].filter((s) => [...s].length <= 20).slice(0, 2);
  return { texto: resto.join('\n').trim(), sugerencias: validas };
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

export function infoAceptada(nombre: string): string {
  const primero = nombre.trim().split(/\s+/)[0] ?? '';
  return `¡Listo, ${primero}! Te escribiremos cuando haya novedades de posgrados 📬\n\n_Si cambias de opinión, escribe *BAJA*._`;
}

export const PEDIR_NOMBRE_VALIDO = 'Escríbeme tu nombre, por favor (al menos 3 letras) ✍️';

/** Nombre escrito a mano: espacios normalizados, sin emojis ni números sueltos. */
export function limpiarNombre(texto: string): string | null {
  const limpio = (texto ?? '').replace(/[^\p{L}\s'.-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return limpio.replace(/[^\p{L}]/gu, '').length >= 3 ? limpio : null;
}

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
  if (/\b(tecnico|tecnica|tecnologo|tecnologa)\b/.test(n)) return 'tecnico';
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
  | 'conv_info_si' | 'conv_info_no' | 'conv_seguir_perfil' | 'conv_reiniciar';

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
export function esSaludo(texto: string): boolean {
  const n = normalize(texto ?? '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return n === '' || SALUDOS.has(n);
}

export function esPedidoAsesor(texto: string): boolean {
  const n = normalize(texto ?? '').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return ['asesor', 'humano', 'agente', 'un asesor', 'hablar con asesor', 'hablar con un asesor', 'quiero un asesor',
    'quiero hablar con un asesor', 'hablar con una persona'].includes(n);
}

/** Una pregunta va a la IA aunque el bot esté esperando la carrera. */
export function pareceUnaPregunta(texto: string): boolean {
  const n = normalize(texto ?? '');
  return n.includes('?') || /^(que|cual|cuales|cuanto|cuanta|cuantos|como|cuando|donde|hay|tienen|tiene|me puedes|puedo|quiero saber|necesito saber|informacion)\b/.test(n);
}

export type RespuestaEscrita = { boton: BotonId } | { nivel: NivelElegido };

/** Respuestas escritas a mano que equivalen a tocar un botón de la pregunta pendiente. */
export function interpretarRespuestaEscrita(pendiente: Pendiente | '' | undefined, texto: string): RespuestaEscrita | null {
  const n = normalize(texto ?? '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  // Un "sí"/"no" corto equivale al botón; una frase larga es una pregunta para la IA.
  const corto = n.split(' ').length <= 4;
  const si = corto && /^(si|sip|claro|correcto|asi es|exacto|obvio|por supuesto)( .*)?$/.test(n);
  const no = corto && /^(no|nop|nunca|todavia no|aun no)( .*)?$/.test(n);
  switch (pendiente) {
    case 'tiene_programa':
      if (si) return { boton: 'conv_tengo' };
      if (no || /ayuda|elegir|no se|recomiend/.test(n)) return { boton: 'conv_elegir' };
      return null;
    case 'estudia_utb':
      if (/egresad|me gradue|ya me gradue/.test(n)) return { boton: 'conv_egresado' };
      if (si) return { boton: 'conv_utb_si' };
      if (no || /otra universidad/.test(n)) return { boton: 'conv_utb_no' };
      return null;
    case 'egresado':
      if (/egresad|gradu|termine|ya sali|ya me/.test(n)) return { boton: 'conv_egresado' };
      if (/estudi|curso|aun|todavia|semestre/.test(n)) return { boton: 'conv_estudiante' };
      return null;
    case 'nivel':
      if (/no se|aun no|todavia no|cualquier|todos|todas|no estoy segur/.test(n)) return { nivel: '' };
      return null;
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
  // Sin título universitario no hay posgrado que recomendar: no se pregunta más.
  if (data.sinPregrado === '1') return null;
  if (!data.relacion) return 'estudia_utb';
  if (!data.pregradoId && !data.familiaId) return 'pregrado';
  if (data.nivelListo !== '1') return 'nivel';
  // Con el perfil completo: si quiere recibir información, y su nombre si aceptó.
  if (!data.info) return 'info';
  if (data.info === 'si' && !data.nombre) return 'nombre_info';
  return null;
}

export function nivelDeBoton(boton: BotonId): NivelElegido | null {
  if (boton === 'conv_esp') return 'especializacion';
  if (boton === 'conv_mae') return 'maestria';
  if (boton === 'conv_doc') return 'doctorado';
  return null;
}
