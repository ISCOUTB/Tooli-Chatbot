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
export type Pendiente = 'tiene_programa' | 'estudia_utb' | 'egresado' | 'pregrado' | 'nivel' | 'ofrecer';

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
  | 'conv_esp' | 'conv_mae' | 'conv_doc' | 'conv_reco' | 'conv_asesor' | 'conv_pregrados' | 'conv_seguir';

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
  return null;
}

export function nivelDeBoton(boton: BotonId): NivelElegido | null {
  if (boton === 'conv_esp') return 'especializacion';
  if (boton === 'conv_mae') return 'maestria';
  if (boton === 'conv_doc') return 'doctorado';
  return null;
}
