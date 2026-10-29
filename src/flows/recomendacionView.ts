/**
 * Vista del flujo de recomendación por pregrado (pasos `reco_*`).
 *
 * Opciones, textos y lectura de respuestas, sin mensajería ni sesión, para
 * probarlos directo con `node:test`. Los handlers están en `recomendacion.ts`
 * y la lógica de qué recomendar en `recomendacionPregrado.ts`.
 */
import { normalize } from './validation';
import {
  NivelPrograma,
  POSGRADOS_URL,
  POSGRADOS_VIRTUALES_URL,
  ProgramaUtb,
  VIGENCIA_VALORES,
  esVirtual,
  getPrograma,
  valorCorto,
} from '../services/catalogoUtb';
import {
  FAMILIAS_EXTERNAS,
  PregradoInterpretado,
  Recomendacion,
  ResultadoRecomendacion,
  interpretarPregrado,
} from './recomendacionPregrado';

// Límites de las listas de WhatsApp (el adaptador de Meta recorta lo que pase).
export const MAX_FILAS = 10;
export const MAX_TITULO_FILA = 24;
export const MAX_DESCRIPCION_FILA = 72;
export const MAX_TEXTO = 4096;
export const MAX_BOTON = 20;

export interface FilaLista {
  id: string;
  title: string;
  description?: string;
}

export interface Boton {
  id: string;
  displayText: string;
}

// ── Paso 1: relación con la UTB ─────────────────────────────────────────────

export type Relacion = 'estudiante_utb' | 'egresado_utb' | 'externo';

export type EleccionRelacion =
  | { tipo: 'relacion'; relacion: Relacion }
  | { tipo: 'salida'; salida: 'pregrado' | 'otras_gestiones' };

interface OpcionRelacion {
  fila: FilaLista;
  eleccion: EleccionRelacion;
  /** Palabras (normalizadas) que también la eligen si la persona escribe en vez de tocar. */
  palabras: readonly string[];
}

const OPCIONES_RELACION: readonly OpcionRelacion[] = [
  {
    fila: { id: '1', title: '🎓 Estudio en la UTB', description: 'Curso un pregrado en la UTB' },
    eleccion: { tipo: 'relacion', relacion: 'estudiante_utb' },
    palabras: ['estudiante', 'estudio en la utb', 'estudiante utb'],
  },
  {
    fila: { id: '2', title: '🎓 Soy egresado UTB', description: 'Terminé mi pregrado en la UTB' },
    eleccion: { tipo: 'relacion', relacion: 'egresado_utb' },
    palabras: ['egresado', 'egresada', 'egresado utb', 'egresada utb', 'soy egresado utb'],
  },
  {
    fila: { id: '3', title: '🏛️ Otra universidad', description: 'Estudio o estudié en otra institución' },
    eleccion: { tipo: 'relacion', relacion: 'externo' },
    palabras: ['otra universidad', 'otra', 'externo', 'externa'],
  },
  {
    fila: { id: '4', title: '🏫 Quiero un pregrado', description: 'Aún no tengo pregrado: conoce las carreras' },
    eleccion: { tipo: 'salida', salida: 'pregrado' },
    palabras: ['pregrado', 'quiero un pregrado', 'carreras'],
  },
  {
    fila: { id: '5', title: '📋 Otras gestiones', description: 'Notas, recibo, turno, vida académica y asesores' },
    eleccion: { tipo: 'salida', salida: 'otras_gestiones' },
    palabras: ['otras gestiones', 'gestiones', 'notas', 'recibo', 'turno', 'tramites'],
  },
];

export const FILAS_RELACION: readonly FilaLista[] = OPCIONES_RELACION.map((o) => o.fila);

export const SALUDO_RELACION =
  'Hola 👋 Soy *Tooli*, el asistente virtual de la Universidad Tecnológica de Bolívar.\n\n' +
  'Si estás pensando en un posgrado, te recomiendo los que mejor encajan con lo que estudiaste. ' +
  '¿Cuál es tu relación con la UTB?';

export function parseRelacion(input: string): EleccionRelacion | null {
  const n = normalize(input ?? '');
  if (!n) return null;
  const opcion = OPCIONES_RELACION.find((o) => o.fila.id === n || o.palabras.includes(n));
  return opcion?.eleccion ?? null;
}

// ── Paso 2: grupo y pregrado UTB ────────────────────────────────────────────

export interface GrupoPregrado {
  id: string;
  titulo: string;
  descripcion: string;
  pregrados: readonly string[];
}

/**
 * Las escuelas de la UTB, partidas para que ninguna lista pase de 10 filas.
 * Sistemas está en Transformación Digital, como en la UTB; la descripción lo
 * dice para quien la busque entre las ingenierías.
 */
export const GRUPOS_PREGRADO: readonly GrupoPregrado[] = [
  {
    id: 'ingenierias',
    titulo: 'Ingenierías',
    descripcion: 'Civil, Industrial, Ambiental, Química, Mecánica, Eléctrica…',
    pregrados: [
      'ingenieria-civil', 'ingenieria-industrial', 'ingenieria-ambiental', 'ingenieria-quimica',
      'ingenieria-naval', 'ingenieria-mecanica', 'ingenieria-electrica', 'ingenieria-electronica',
      'ingenieria-mecatronica', 'ingenieria-biomedica',
    ],
  },
  {
    id: 'arquitectura_diseno',
    titulo: 'Arquitectura y Diseño',
    descripcion: 'Arquitectura y Diseño',
    pregrados: ['arquitectura', 'diseno'],
  },
  {
    id: 'transformacion_digital',
    titulo: 'Transformación Digital',
    descripcion: 'Ing. de Sistemas, Ciencia de Datos, Marketing, Comunicación Social',
    pregrados: [
      'ingenieria-de-sistemas-y-computacion', 'ciencia-de-datos',
      'marketing-y-transformacion-digital', 'comunicacion-social',
    ],
  },
  {
    id: 'negocios_leyes',
    titulo: 'Negocios y Leyes',
    descripcion: 'Administración, Finanzas, Contaduría, Derecho, Psicología, Economía…',
    pregrados: [
      'administracion-de-empresas', 'finanzas-y-negocios-internacionales', 'contaduria-publica',
      'virtual-contaduria-publica', 'derecho', 'psicologia', 'economia',
      'ciencia-politica-y-relaciones-internacionales',
    ],
  },
];

/** Nombres que no caben en el título de una fila (24 caracteres). */
const TITULO_CORTO: Readonly<Record<string, string>> = {
  'ingenieria-de-sistemas-y-computacion': 'Ing. de Sistemas',
  'marketing-y-transformacion-digital': 'Marketing y T. Digital',
  'administracion-de-empresas': 'Adm. de Empresas',
  'finanzas-y-negocios-internacionales': 'Finanzas y Neg. Intern.',
  'virtual-contaduria-publica': 'Contaduría Virtual',
  'ciencia-politica-y-relaciones-internacionales': 'Ciencia Política y RRII',
};

export const FILAS_GRUPOS: readonly FilaLista[] = GRUPOS_PREGRADO.map((g, i) => ({
  id: String(i + 1),
  title: g.titulo,
  description: g.descripcion,
}));

export function getGrupo(id: string): GrupoPregrado | undefined {
  return GRUPOS_PREGRADO.find((g) => g.id === id);
}

export function filasPregrados(grupo: GrupoPregrado): FilaLista[] {
  return grupo.pregrados.map((id, i) => {
    const p = getPrograma(id);
    const nombre = p?.nombre ?? id;
    // la descripción lleva el nombre completo solo cuando el título va abreviado
    return TITULO_CORTO[id]
      ? { id: String(i + 1), title: TITULO_CORTO[id], description: nombre }
      : { id: String(i + 1), title: nombre };
  });
}

/** Lo que la persona escribió como su pregrado UTB; solo vale si es un pregrado de la UTB. */
function pregradoUtbEscrito(input: string): string | null {
  const r = interpretarPregrado(input);
  return r?.tipo === 'utb' ? r.pregradoId : null;
}

export type EleccionGrupo = { tipo: 'grupo'; grupoId: string } | { tipo: 'pregrado'; pregradoId: string };

/** Número de grupo, nombre del grupo o, directamente, el nombre del pregrado. */
export function parseGrupo(input: string): EleccionGrupo | null {
  const n = normalize(input ?? '');
  if (!n) return null;
  if (/^\d+$/.test(n)) {
    const grupo = GRUPOS_PREGRADO[parseInt(n, 10) - 1];
    return grupo ? { tipo: 'grupo', grupoId: grupo.id } : null;
  }
  const grupo = GRUPOS_PREGRADO.find((g) => normalize(g.titulo) === n);
  if (grupo) return { tipo: 'grupo', grupoId: grupo.id };
  const pregradoId = pregradoUtbEscrito(input);
  if (pregradoId) return { tipo: 'pregrado', pregradoId };
  // "ingeniería" a secas: abre la lista de ingenierías en vez de rechazarlo
  if (/^ingenier\w*$/.test(n)) return { tipo: 'grupo', grupoId: 'ingenierias' };
  return null;
}

/** Número dentro del grupo o el nombre de cualquier pregrado UTB. */
export function parsePregrado(input: string, grupo: GrupoPregrado | undefined): string | null {
  const n = normalize(input ?? '');
  if (!n) return null;
  if (/^\d+$/.test(n)) return grupo?.pregrados[parseInt(n, 10) - 1] ?? null;
  return pregradoUtbEscrito(input);
}

// ── Paso 2b: pregrado de otra universidad ───────────────────────────────────

export const PEDIR_PREGRADO_EXTERNO =
  '✍️ ¿Qué pregrado estudias o estudiaste? Escríbelo como aparece en tu título, por ejemplo: ' +
  '*Ingeniería de Producción*, *Contaduría*, *Medicina*.\n\n_Escribe *0* para volver._';

/** Pregunta de confirmación; null si la interpretación no se puede mostrar. */
export function textoConfirmacion(interpretado: PregradoInterpretado): string | null {
  if (interpretado.tipo === 'utb') {
    const p = getPrograma(interpretado.pregradoId);
    return p ? `¿Tu pregrado se parece a *${p.nombre}* de la UTB?` : null;
  }
  const familia = FAMILIAS_EXTERNAS.find((f) => f.id === interpretado.familiaId);
  return familia ? `¿Tu pregrado es del área de *${familia.titulo}*?` : null;
}

const ALTERNATIVAS =
  'Puedes elegir de la lista uno que se parezca al tuyo, elegir el área en la que te mueves o escribirlo de otra forma.';

export const SIN_COINCIDENCIA = `No encontré un pregrado parecido en la UTB 🤔\n\n${ALTERNATIVAS}`;

/** Cuando la persona dijo que la asociación propuesta no es la suya. */
export const COINCIDENCIA_DESCARTADA = `Entendido 👍\n\n${ALTERNATIVAS}`;

export const BOTONES_CONFIRMAR: readonly Boton[] = [
  { id: 'si', displayText: '✅ Sí' },
  { id: 'no', displayText: '❌ No' },
];

export const BOTONES_SIN_COINCIDENCIA: readonly Boton[] = [
  { id: 'lista', displayText: '📚 Ver la lista' },
  { id: 'area', displayText: '🧭 Elegir un área' },
  { id: 'escribir', displayText: '✍️ Escribir de nuevo' },
];

export type EleccionSiNo = 'si' | 'no';

export function parseSiNo(input: string): EleccionSiNo | null {
  // sin puntuación: "Sí, autorizo" escrito a mano también vale
  const n = normalize(input ?? '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (['si', 's', 'si es', 'correcto', 'exacto', 'claro', 'si autorizo', 'autorizo', 'acepto'].includes(n)) return 'si';
  if (['no', 'n', 'no es', 'para nada'].includes(n)) return 'no';
  return null;
}

export type EleccionSinCoincidencia = 'lista' | 'area' | 'escribir';

export function parseSinCoincidencia(input: string): EleccionSinCoincidencia | null {
  const n = normalize(input ?? '');
  if (['lista', 'ver la lista', 'elegir de la lista'].includes(n)) return 'lista';
  if (['area', 'elegir un area'].includes(n)) return 'area';
  if (['escribir', 'escribir de nuevo'].includes(n)) return 'escribir';
  return null;
}

// ── Paso 3: nivel ───────────────────────────────────────────────────────────

/** '' = "Aún no sé" (no filtra). */
export type NivelElegido = NivelPrograma | '';

const OPCIONES_NIVEL: readonly { fila: FilaLista; nivel: NivelElegido; palabras: readonly string[] }[] = [
  { fila: { id: '1', title: '🎯 Especialización', description: '1 año aprox. · enfoque práctico' }, nivel: 'especializacion', palabras: ['especializacion', 'especializaciones'] },
  { fila: { id: '2', title: '🎓 Maestría', description: '1,5 a 2 años · profundización o investigación' }, nivel: 'maestria', palabras: ['maestria', 'maestrias', 'magister', 'mba'] },
  { fila: { id: '3', title: '🔬 Doctorado', description: '4 años · investigación avanzada' }, nivel: 'doctorado', palabras: ['doctorado', 'doctorados', 'phd'] },
  { fila: { id: '4', title: '🤔 Aún no sé', description: 'Muéstrame las mejores opciones de todos los niveles' }, nivel: '', palabras: ['no se', 'aun no se', 'todos', 'cualquiera'] },
];

export const FILAS_NIVEL: readonly FilaLista[] = OPCIONES_NIVEL.map((o) => o.fila);

export function parseNivel(input: string): NivelElegido | null {
  const n = normalize(input ?? '');
  if (!n) return null;
  const opcion = OPCIONES_NIVEL.find((o) => o.fila.id === n || o.palabras.includes(n));
  return opcion ? opcion.nivel : null;
}

// ── Paso 4: resultados ──────────────────────────────────────────────────────

const PLURAL_NIVEL: Record<NivelPrograma, string> = {
  pregrado: 'pregrados',
  especializacion: 'especializaciones',
  maestria: 'maestrías',
  doctorado: 'doctorados',
};

export interface ContextoResultados {
  relacion: Relacion;
  /** "Ingeniería Industrial" o "un pregrado del área de la salud". */
  etiquetaPregrado: string;
  nivel: NivelElegido;
  soloVirtual: boolean;
}

function lineaPrograma(r: Recomendacion, numero: number): string {
  const p: ProgramaUtb = r.programa;
  const modalidad = esVirtual(p) ? 'Virtual' : p.modalidad ?? 'Presencial';
  const datos = [
    modalidad,
    p.duracion_semestres ? `${p.duracion_semestres} semestres` : null,
    valorCorto(p) ?? 'valor por confirmar',
  ].filter(Boolean).join(' · ');
  return `${numero}. *${p.nombre}*\n   ${r.motivo}\n   ${datos}\n   🔗 ${p.url}`;
}

function notaRelajado(resultado: ResultadoRecomendacion, ctx: ContextoResultados): string | null {
  if (resultado.relajado === 'modalidad') {
    return '_No encontré suficientes opciones virtuales para tu perfil; incluí también presenciales._';
  }
  if (resultado.relajado === 'nivel' && ctx.nivel) {
    return `_No encontré suficientes ${PLURAL_NIVEL[ctx.nivel]} para tu perfil; te muestro otras opciones._`;
  }
  return null;
}

/** Mensaje con las recomendaciones; numera desde `desde` para "Más opciones". */
export function formatearResultados(
  resultado: ResultadoRecomendacion,
  ctx: ContextoResultados,
  opciones: { mas?: boolean } = {},
): string {
  const lista = opciones.mas ? resultado.resto : resultado.recomendaciones;
  const desde = opciones.mas ? resultado.recomendaciones.length + 1 : 1;
  const encabezado = opciones.mas
    ? '➕ *Más opciones para ti*'
    : `🎯 *Posgrados para ti*\nSegún tu pregrado (${ctx.etiquetaPregrado}), estas opciones de la UTB pueden encajarte:`;

  const partes = [encabezado, lista.map((r, i) => lineaPrograma(r, desde + i)).join('\n\n')];
  const nota = opciones.mas ? null : notaRelajado(resultado, ctx);
  if (nota) partes.push(nota);
  if (!opciones.mas && ctx.relacion === 'egresado_utb') {
    partes.push('🎓 Como egresado(a) UTB tienes beneficios en posgrados; pide sus condiciones al asesor.');
  }

  const enlaces = [`🔗 Todos los posgrados: ${POSGRADOS_URL}`];
  if (lista.some((r) => esVirtual(r.programa))) enlaces.push(`💻 Posgrados virtuales: ${POSGRADOS_VIRTUALES_URL}`);
  partes.push(enlaces.join('\n'));
  partes.push(
    `_Valores de matrícula publicados para ${VIGENCIA_VALORES}. La elección depende de tu perfil y del proceso de admisión; ` +
      'verifica requisitos y costos en los enlaces oficiales._',
  );
  return partes.join('\n\n');
}

export type AccionResultados = 'ficha' | 'ia' | 'asesor' | 'mas' | 'virtual' | 'presencial' | 'nivel' | 'pregrado';

const FILA_IA: FilaLista = { id: 'ia', title: '🤖 Preguntar a la IA', description: 'Dudas sobre requisitos, plan de estudios o diferencias' };
const FILA_ASESOR: FilaLista = { id: 'asesor', title: '👤 Hablar con asesor', description: 'El equipo de Posgrados te contacta' };
const FILA_MENU: FilaLista = { id: 'menu', title: '🏠 Menú principal', description: 'Volver al inicio' };

/** Acciones tras ver las recomendaciones; solo se ofrece lo que aplica. */
export function filasAcciones(resultado: ResultadoRecomendacion, ctx: ContextoResultados, yaVioMas: boolean): FilaLista[] {
  const filas: FilaLista[] = [
    { id: 'ficha', title: '📄 Ver un programa', description: 'Detalle, plan de estudios y valor (o escribe su número)' },
    FILA_IA,
    FILA_ASESOR,
  ];
  if (!yaVioMas && resultado.resto.length) {
    filas.push({ id: 'mas', title: '➕ Más opciones', description: `${resultado.resto.length} programas más para tu pregrado` });
  }
  filas.push(
    ctx.soloVirtual
      ? { id: 'presencial', title: '🏫 Incluir presenciales', description: 'Ver también los programas presenciales' }
      : { id: 'virtual', title: '💻 Solo virtuales', description: 'Ver solo programas de UTB Virtual' },
    { id: 'nivel', title: '🎚️ Cambiar nivel', description: 'Especialización, maestría o doctorado' },
    { id: 'pregrado', title: '🔄 Cambiar pregrado', description: 'Empezar de nuevo con otro pregrado' },
    FILA_MENU,
  );
  return filas;
}

const PALABRAS_ACCION: Readonly<Record<AccionResultados, readonly string[]>> = {
  ficha: ['ficha', 'ver un programa', 'ver programa', 'detalle', 'ver detalle'],
  ia: ['ia', 'preguntar a la ia', 'asistente', 'asistente ia'],
  asesor: ['asesor', 'hablar con asesor', 'hablar con un asesor', 'humano', 'agente'],
  mas: ['mas', 'mas opciones', 'ver mas'],
  virtual: ['virtual', 'solo virtuales', 'virtuales'],
  presencial: ['presencial', 'incluir presenciales', 'presenciales'],
  nivel: ['nivel', 'cambiar nivel'],
  pregrado: ['pregrado', 'cambiar pregrado', 'otro pregrado', 'empezar de nuevo'],
};

export function parseAccion(input: string): AccionResultados | null {
  const n = normalize(input ?? '');
  const accion = (Object.keys(PALABRAS_ACCION) as AccionResultados[]).find((a) => PALABRAS_ACCION[a].includes(n));
  return accion ?? null;
}

/** "2" → segundo programa mostrado. Los programas mostrados van en sesión como JSON de IDs. */
export function programaPorNumero(input: string, mostrados: readonly string[]): string | null {
  const n = normalize(input ?? '');
  if (!/^\d+$/.test(n)) return null;
  return mostrados[parseInt(n, 10) - 1] ?? null;
}

/** IDs guardados en sesión, solo los que siguen en el catálogo. */
export function idsMostrados(json: string | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(json ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && !!getPrograma(id)) : [];
  } catch {
    return [];
  }
}

// ── Paso 5: ficha de un programa ────────────────────────────────────────────

const recortar = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

/** Lista para elegir cuál de los programas mostrados ver en detalle. */
export function filasElegirPrograma(mostrados: readonly string[]): FilaLista[] {
  return mostrados.slice(0, MAX_FILAS).flatMap((id, i) => {
    const p = getPrograma(id);
    if (!p) return [];
    const corto = p.nombre.replace(/^(Especializaci[oó]n|Maestr[ií]a) en /i, '');
    return [{
      id: String(i + 1),
      title: recortar(`${i + 1}. ${corto}`, MAX_TITULO_FILA),
      description: recortar(`${p.nombre}${esVirtual(p) ? ' (virtual)' : ''}`, MAX_DESCRIPCION_FILA),
    }];
  });
}

const NOMBRE_NIVEL: Record<NivelPrograma, string> = {
  pregrado: 'Pregrado',
  especializacion: 'Especialización',
  maestria: 'Maestría',
  doctorado: 'Doctorado',
};

/** Ficha corta para WhatsApp; la completa (para la IA) es `fichaPrograma` del catálogo. */
export function formatearFicha(p: ProgramaUtb): string {
  const datos = [
    NOMBRE_NIVEL[p.nivel],
    esVirtual(p) ? 'Virtual' : p.modalidad ?? 'Presencial',
    p.duracion_semestres ? `${p.duracion_semestres} semestres` : p.duracion,
    valorCorto(p) ?? 'valor por confirmar',
  ].filter(Boolean).join(' · ');

  const partes = [`📄 *${p.nombre}*\n${datos}`];
  const credenciales = [
    p.titulo_otorgado && `🎓 Título: ${p.titulo_otorgado}`,
    p.snies && `🏛️ SNIES ${p.snies}${p.acreditacion_alta_calidad ? ' · Acreditación de alta calidad' : ''}`,
  ].filter(Boolean);
  if (credenciales.length) partes.push(credenciales.join('\n'));
  if (p.descripcion?.length) partes.push(recortar(p.descripcion.slice(0, 2).join(' '), 600));

  if (p.plan_estudios.length) {
    const plan = p.plan_estudios.slice(0, 8).map((s) => `• *${s.periodo}:* ${recortar(s.asignaturas.join(', '), 220)}`);
    partes.push(`*Plan de estudios*\n${plan.join('\n')}`);
  }

  const enlaces = [`🔗 Página oficial: ${p.url}`];
  if (p.plan_estudios_pdf) enlaces.push(`📎 Plan de estudios (PDF): ${p.plan_estudios_pdf}`);
  else if (p.brochure_pdf) enlaces.push(`📎 Brochure (PDF): ${p.brochure_pdf}`);
  partes.push(enlaces.join('\n'));
  partes.push(`_Valor de matrícula publicado para ${VIGENCIA_VALORES}; verifica requisitos y costos en la página oficial._`);
  return partes.join('\n\n');
}

export type AccionFicha = 'ia' | 'asesor' | 'recomendaciones';

export const FILAS_TRAS_FICHA: readonly FilaLista[] = [
  { ...FILA_IA, description: 'Pregunta lo que quieras sobre este programa' },
  FILA_ASESOR,
  { id: 'recomendaciones', title: '🔙 Ver recomendaciones', description: 'Volver a los programas recomendados' },
  FILA_MENU,
];

export function parseAccionFicha(input: string): AccionFicha | null {
  const n = normalize(input ?? '');
  if (PALABRAS_ACCION.ia.includes(n)) return 'ia';
  if (PALABRAS_ACCION.asesor.includes(n)) return 'asesor';
  if (['recomendaciones', 'ver recomendaciones', 'volver a las recomendaciones'].includes(n)) return 'recomendaciones';
  return null;
}

// ── Paso 6: asesor con consentimiento ───────────────────────────────────────

/** Mismo texto que el flujo de evento de Posgrados. */
export const PEDIR_CONSENTIMIENTO =
  '👤 Para que un asesor de Posgrados te contacte necesito tu nombre y tu correo.\n\n' +
  '🔒 ¿Autorizas que un asesor de la UTB te contacte y el tratamiento de tus datos personales conforme a la *Ley 1581 de 2012*?';

export const BOTONES_CONSENTIMIENTO: readonly Boton[] = [
  { id: 'si', displayText: '✅ Sí, autorizo' },
  { id: 'no', displayText: '❌ No' },
];

export const CONSENTIMIENTO_NEGADO =
  'Entendido, no guardaré tus datos 👍\n\n' +
  'Puedes seguir viendo programas o preguntarle a la IA. Si cambias de opinión, elige *Hablar con asesor*.';

export const PEDIR_NOMBRE = '✍️ ¿Cuál es tu *nombre completo*?\n\n_Escribe *0* para volver._';

export function pedirCorreo(nombre: string): string {
  const primero = nombre.trim().split(/\s+/)[0] ?? '';
  return `¡Gracias, ${primero}! 📧\n\n¿Cuál es tu *correo electrónico*?\n\n_Escribe *0* para volver._`;
}

/** Correo general (el institucional de `validation.ts` es solo para estudiantes UTB). */
export const CORREO_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Contexto para la IA y para el asesor ────────────────────────────────────

const RELACION_TEXTO: Record<Relacion, string> = {
  estudiante_utb: 'estudiante de pregrado UTB',
  egresado_utb: 'egresado(a) UTB',
  externo: 'de otra universidad',
};

const nombres = (ids: readonly string[]) => ids.map((id) => getPrograma(id)?.nombre).filter(Boolean).join(', ');

/**
 * Resumen del recorrido para la IA y el asesor. Sale solo de IDs del
 * catálogo y de valores cerrados: nunca del texto que escribió la persona,
 * que podría traer instrucciones para la IA.
 */
export function resumenRecomendacion(data: Record<string, string> | undefined | null): string | null {
  if (!data) return null;
  const pregrado = data.pregradoId
    ? getPrograma(data.pregradoId)?.nombre
    : FAMILIAS_EXTERNAS.find((f) => f.id === data.familiaId)?.etiqueta;
  if (!pregrado) return null;

  const relacion = RELACION_TEXTO[data.relacion as Relacion];
  const nivel = NOMBRE_NIVEL[data.nivel as NivelPrograma];
  const recomendados = nombres(idsMostrados(data.recomendados));
  const interes = data.programaInteres ? getPrograma(data.programaInteres)?.nombre : undefined;

  return [
    `Pregrado: ${pregrado}${relacion ? ` (${relacion})` : ''}.`,
    `Nivel buscado: ${nivel ?? 'aún no sabe'}.`,
    recomendados && `Programas recomendados: ${recomendados}.`,
    interes && `Revisó en detalle: ${interes}.`,
    data.campana === '1' && 'Llegó respondiendo una campaña del bot.',
  ].filter(Boolean).join(' ');
}

/** Programa de interés para el lead: el que revisó o, si no, "Por definir". */
export function programaInteresLead(data: Record<string, string>): string {
  return (data.programaInteres && getPrograma(data.programaInteres)?.nombre) || 'Por definir';
}
