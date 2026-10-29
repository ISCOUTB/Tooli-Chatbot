/**
 * Motor de recomendación de posgrados según el pregrado (flujo `reco_*`).
 *
 * La tabla es curada a mano a partir del catálogo extraído de las páginas
 * oficiales (`services/catalogoUtb.ts`) y está documentada en
 * `docs/flujo-recomendacion-posgrados.md`; Posgrados UTB debe validarla.
 * Cada pregrado tiene tres listas ordenadas por prioridad:
 *
 * - profundiza: continuidad directa de la carrera.
 * - complementa: gestión o perfil transversal que suele buscar esa carrera.
 * - investiga: ruta de investigación (Maestría en Ingeniería, doctorados).
 *
 * Es puro (sin sesión ni mensajería) para que `node:test` lo pruebe directo.
 */
import {
  NivelPrograma,
  ProgramaUtb,
  buscarPrograma,
  esVirtual,
  getPrograma,
} from '../services/catalogoUtb';

export type TipoRecomendacion = 'profundiza' | 'complementa' | 'investiga';

export const TIPOS: readonly TipoRecomendacion[] = ['profundiza', 'complementa', 'investiga'];

export type ListasRecomendacion = Record<TipoRecomendacion, readonly string[]>;

// IDs del catálogo. Las pruebas verifican que todos existan y sigan vigentes.
const P = {
  // Especializaciones
  estructural: 'especializacion-en-analisis-y-diseno-estructural',
  automatizacion: 'especializacion-en-automatizacion-y-control-de-procesos-industriales',
  contratacionV: 'virtual-contratacion-estatal',
  derechoComercial: 'especializacion-en-derecho-comercial',
  derechoTrabajo: 'especializacion-en-derecho-del-trabajo-y-relaciones-laborales',
  derechosHumanosV: 'virtual-derechos-humanos',
  direccionEducativas: 'especializacion-en-direccion-de-instituciones-educativas',
  educacionTicV: 'virtual-educacion-mediada-tic',
  estadistica: 'especializacion-en-estadistica-aplicada',
  contabilidad: 'especializacion-en-estandares-internacionales-de-contabilidad-y-auditoria',
  finanzas: 'especializacion-en-finanzas',
  geotecnia: 'especializacion-en-geotecnia-vial-y-pavimentos',
  sst: 'especializacion-en-gerencia-de-la-seguridad-y-salud-en-el-trabajo',
  sstV: 'virtual-seguridad-y-salud-trabajo',
  mantenimiento: 'especializacion-en-gerencia-de-mantenimiento',
  mercadeo: 'especializacion-en-gerencia-de-mercadeo',
  produccion: 'especializacion-en-gerencia-de-produccion-y-calidad',
  proyectos: 'especializacion-en-gerencia-de-proyectos',
  serviciosSaludV: 'virtual-gerencia-servicios-salud',
  talentoHumano: 'especializacion-en-gerencia-del-talento-humano',
  gerenciaEmpresarial: 'especializacion-en-gerencia-empresarial',
  tributaria: 'especializacion-en-gerencia-tributaria',
  ambiental: 'especializacion-en-gestion-ambiental-sostenible',
  cultural: 'especializacion-en-gestion-cultural-sostenible',
  negociosInternacionales: 'especializacion-en-gestion-de-negocios-internacionales',
  disruptivas: 'especializacion-en-gestion-de-tecnologias-disruptivas-en-los-negocios',
  logistica: 'especializacion-gestion-logistica-cadena-suministro',
  territorial: 'especializacion-en-gestion-territorial-y-derecho-urbano',
  softwareV: 'virtual-ingenieria-de-software',
  planeacion: 'especializacion-planeacion-estrategica-y-prospectiva',
  energia: 'especializacion-sistemas-energeticos-sostenibles',
  telecomunicaciones: 'especializacion-en-telecomunicaciones-y-redes',
  // Maestrías
  mba: 'maestria-en-administracion',
  ciberseguridad: 'maestria-en-ciberseguridad',
  mDerecho: 'maestria-en-derecho',
  mEducacion: 'maestria-en-educacion',
  mEducacionTicV: 'virtual-tic-para-educacion',
  mEnsenanza: 'maestria-en-ensenanza-de-las-matematicas-y-ciencias-naturales-en-entornos-digitales',
  mDatos: 'maestria-en-estadistica-aplicada-y-ciencia-de-datos',
  mFinanzas: 'maestria-en-finanzas',
  mMantenimiento: 'maestria-en-gerencia-de-mantenimiento',
  mProyectos: 'maestria-en-gerencia-de-proyectos',
  mTributaria: 'maestria-en-gerencia-tributaria',
  mInnovacion: 'maestria-en-gestion-de-la-innovacion',
  mPatrimonio: 'maestria-en-gestion-del-patrimonio-y-turismo-cultural',
  mGestionHumana: 'maestria-gestion-humana-desarrollo-organizacional',
  mIndustria40: 'maestria-en-industria-4-0-y-automatizacion-industrial',
  mIngenieria: 'maestria-en-ingenieria',
  mPsicosocial: 'maestria-en-intervencion-psicosocial',
  mTransformacionDigital: 'maestria-en-management-de-la-transformacion-digital',
  mInvestigacionSocial: 'maestria-en-metodos-de-investigacion-social',
  mNegociosInternacionales: 'maestria-negocios-internacionales-e-integracion',
  // Doctorados
  dAdministracion: 'doctorado-en-administracion',
  dDesarrollo: 'doctorado-en-desarrollo-regional-y-local',
  dIngenieria: 'doctorado-en-ingenieria',
  dSostenibilidad: 'doctorado-en-sostenibilidad',
} as const;

const listas = (
  profundiza: readonly string[],
  complementa: readonly string[],
  investiga: readonly string[],
): ListasRecomendacion => ({ profundiza, complementa, investiga });

const INGENIERIA_INVESTIGA = [P.mIngenieria, P.dIngenieria];

const CONTADURIA = listas(
  [P.contabilidad, P.tributaria, P.mTributaria],
  [P.finanzas, P.mFinanzas],
  [P.dAdministracion],
);

/** Pregrado UTB (id del catálogo) → posgrados recomendados. */
export const TABLA_PREGRADO: Readonly<Record<string, ListasRecomendacion>> = {
  // Escuela de Ingeniería, Arquitectura & Diseño
  'ingenieria-civil': listas([P.estructural, P.geotecnia], [P.proyectos, P.mProyectos, P.territorial], INGENIERIA_INVESTIGA),
  arquitectura: listas([P.territorial, P.mPatrimonio], [P.proyectos, P.mProyectos], [P.dDesarrollo, P.dSostenibilidad]),
  diseno: listas([P.mInnovacion, P.cultural], [P.mercadeo, P.disruptivas, P.proyectos], []),
  'ingenieria-industrial': listas([P.produccion, P.logistica, P.mProyectos], [P.mba, P.sst, P.mInnovacion], INGENIERIA_INVESTIGA),
  'ingenieria-ambiental': listas([P.ambiental, P.energia], [P.sst, P.proyectos], [P.dSostenibilidad, P.mIngenieria]),
  'ingenieria-quimica': listas([P.produccion, P.ambiental, P.energia], [P.sst, P.proyectos], INGENIERIA_INVESTIGA),
  'ingenieria-naval': listas([P.mantenimiento, P.mMantenimiento], [P.logistica, P.proyectos], INGENIERIA_INVESTIGA),
  'ingenieria-mecanica': listas([P.mantenimiento, P.mMantenimiento, P.energia, P.automatizacion], [P.produccion, P.proyectos], INGENIERIA_INVESTIGA),
  'ingenieria-electrica': listas([P.energia, P.automatizacion, P.mIndustria40], [P.mantenimiento, P.proyectos], INGENIERIA_INVESTIGA),
  'ingenieria-electronica': listas([P.automatizacion, P.mIndustria40, P.telecomunicaciones], [P.ciberseguridad, P.proyectos], INGENIERIA_INVESTIGA),
  'ingenieria-mecatronica': listas([P.mIndustria40, P.automatizacion], [P.mantenimiento, P.proyectos], INGENIERIA_INVESTIGA),
  'ingenieria-biomedica': listas([P.serviciosSaludV, P.mantenimiento], [P.proyectos, P.mInnovacion], INGENIERIA_INVESTIGA),
  // Escuela de Transformación Digital
  'ingenieria-de-sistemas-y-computacion': listas(
    [P.softwareV, P.ciberseguridad, P.mDatos, P.telecomunicaciones],
    [P.mTransformacionDigital, P.proyectos],
    INGENIERIA_INVESTIGA,
  ),
  'ciencia-de-datos': listas([P.mDatos, P.estadistica], [P.ciberseguridad, P.mTransformacionDigital, P.disruptivas], [P.mIngenieria]),
  'marketing-y-transformacion-digital': listas([P.mercadeo, P.mTransformacionDigital, P.disruptivas], [P.mba, P.negociosInternacionales], [P.dAdministracion]),
  'comunicacion-social': listas([P.cultural, P.mPatrimonio, P.mercadeo], [P.mTransformacionDigital, P.mInvestigacionSocial], [P.dDesarrollo]),
  // Escuela de Negocios, Leyes y Sociedad
  'administracion-de-empresas': listas(
    [P.mba, P.gerenciaEmpresarial, P.planeacion, P.talentoHumano],
    [P.proyectos, P.mercadeo, P.mGestionHumana],
    [P.dAdministracion],
  ),
  'finanzas-y-negocios-internacionales': listas(
    [P.mFinanzas, P.finanzas, P.negociosInternacionales, P.mNegociosInternacionales],
    [P.mba, P.logistica],
    [P.dAdministracion],
  ),
  'contaduria-publica': CONTADURIA,
  'virtual-contaduria-publica': CONTADURIA,
  derecho: listas(
    [P.mDerecho, P.derechoComercial, P.derechoTrabajo, P.contratacionV, P.derechosHumanosV],
    [P.territorial, P.tributaria],
    [P.dDesarrollo],
  ),
  psicologia: listas([P.mPsicosocial, P.talentoHumano, P.mGestionHumana], [P.sst, P.mEducacion, P.mInvestigacionSocial], [P.dDesarrollo]),
  economia: listas(
    [P.mFinanzas, P.mDatos, P.estadistica, P.mNegociosInternacionales],
    [P.planeacion, P.tributaria],
    [P.dDesarrollo, P.dAdministracion],
  ),
  'ciencia-politica-y-relaciones-internacionales': listas(
    [P.derechosHumanosV, P.mNegociosInternacionales, P.negociosInternacionales, P.contratacionV],
    [P.mInvestigacionSocial, P.planeacion, P.territorial],
    [P.dDesarrollo],
  ),
};

export interface FamiliaExterna {
  id: string;
  titulo: string;
  /** Cómo se nombra en el motivo: "Continuación directa de {etiqueta}". */
  etiqueta: string;
  /** Raíces normalizadas (sin tildes) que identifican la familia en el texto escrito. */
  palabras: readonly string[];
  listas: ListasRecomendacion;
}

/**
 * Familias para pregrados de otras universidades que no se parecen a uno de
 * la UTB. El orden importa: "licenciatura en matemáticas" es educación, no
 * ciencias básicas.
 */
export const FAMILIAS_EXTERNAS: readonly FamiliaExterna[] = [
  {
    id: 'educacion',
    titulo: 'Educación',
    etiqueta: 'un pregrado en educación',
    palabras: ['licenciad', 'pedagog', 'docen', 'educacion', 'educador', 'normalista'],
    listas: listas(
      [P.mEducacion, P.mEducacionTicV, P.educacionTicV, P.direccionEducativas, P.mEnsenanza],
      [P.mInvestigacionSocial],
      [P.dDesarrollo],
    ),
  },
  {
    id: 'salud',
    titulo: 'Salud',
    etiqueta: 'un pregrado del área de la salud',
    palabras: [
      'medic', 'enfermer', 'odontolog', 'bacteriolog', 'fisioterap', 'nutricion', 'instrumentac',
      'optometr', 'fonoaudiolog', 'terapia', 'farmac', 'salud',
    ],
    listas: listas([P.serviciosSaludV, P.sst, P.sstV], [P.mba, P.proyectos], []),
  },
  {
    id: 'ciencias_basicas',
    titulo: 'Ciencias básicas',
    etiqueta: 'un pregrado en ciencias básicas',
    palabras: ['matematic', 'fisica', 'quimica', 'biolog', 'estadistic', 'geolog'],
    listas: listas([P.mDatos, P.estadistica, P.mEnsenanza], [P.ambiental], [P.mIngenieria, P.dSostenibilidad]),
  },
  {
    id: 'humanidades',
    titulo: 'Humanidades y turismo',
    etiqueta: 'un pregrado en humanidades o turismo',
    palabras: [
      'historia', 'filosof', 'artes', 'musica', 'literatura', 'linguistic', 'turismo', 'hoteler',
      'trabajo social', 'sociolog', 'antropolog', 'gastronom',
    ],
    listas: listas([P.mPatrimonio, P.cultural], [P.mInvestigacionSocial, P.mPsicosocial], [P.dDesarrollo]),
  },
];

// ── Interpretar el pregrado escrito ─────────────────────────────────────────

const normalizar = (s: string) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Nombres con que la gente se refiere a carreras equivalentes a las de la UTB.
 * Se revisan en orden, así que lo más específico va primero ("negocios
 * internacionales" antes que "negocios").
 */
const SINONIMOS_UTB: readonly (readonly [RegExp, string])[] = [
  [/\b(ciencia(s)? de (los )?datos|analitica de datos|big data)\b/, 'ciencia-de-datos'],
  [/\b(sistemas|informatica|software|computacion|telematica|programacion|desarrollo de software)\b/, 'ingenieria-de-sistemas-y-computacion'],
  [/\b(negocios internacionales|comercio (exterior|internacional)|finanzas)\b/, 'finanzas-y-negocios-internacionales'],
  [/\b(administracion|administrador|administradora|gerencia|negocios)\b/, 'administracion-de-empresas'],
  [/\b(contaduria|contador|contadora|contable|contabilidad)\b/, 'contaduria-publica'],
  [/\b(derecho|abogad[oa]|jurisprudencia|leyes)\b/, 'derecho'],
  [/\b(economia|economista)\b/, 'economia'],
  [/\b(psicologia|psicolog[oa])\b/, 'psicologia'],
  [/\b(ciencia politica|politolog[oa]|relaciones internacionales|gobierno)\b/, 'ciencia-politica-y-relaciones-internacionales'],
  [/\b(comunicacion|comunicador|comunicadora|periodismo|periodista)\b/, 'comunicacion-social'],
  [/\b(mercadeo|marketing|publicidad|publicista)\b/, 'marketing-y-transformacion-digital'],
  [/\b(arquitectura|arquitect[oa])\b/, 'arquitectura'],
  [/\bdiseno\b/, 'diseno'],
  // Ingenierías: exigen la palabra "ingeniería" para no confundir, p. ej.,
  // Química (ciencia básica) con Ingeniería Química.
  [/\bingenier\w* (de )?produccion\b/, 'ingenieria-industrial'],
  [/\bingenier\w* (sanitaria|ambiental)\b/, 'ingenieria-ambiental'],
  [/\bingenier\w* (de )?(telecomunicaciones|electronica)\b/, 'ingenieria-electronica'],
  [/\bingenier\w* (naval|oceanica)\b/, 'ingenieria-naval'],
  [/\bingenier\w* (de )?petroleos?\b/, 'ingenieria-quimica'],
];

const SIN_AFINIDAD = /\b(veterinari\w*|zootecni\w*|agronom\w*|agricol\w*|acuicultura)\b/;
const LICENCIATURA = /\b(licenciad\w*|licenciatura|pedagogi\w*|normalista)\b/;

export type PregradoInterpretado =
  | { tipo: 'utb'; pregradoId: string }
  | { tipo: 'familia'; familiaId: string };

/**
 * Asocia lo que la persona escribió como su pregrado a un pregrado UTB
 * parecido o, si no, a una familia externa. Devuelve null si nada encaja:
 * el flujo pasa entonces a la orientación por áreas en vez de adivinar.
 * El flujo siempre confirma la asociación antes de recomendar.
 */
export function interpretarPregrado(texto: string): PregradoInterpretado | null {
  const n = normalizar(texto);
  if (!n) return null;

  // Carreras sin posgrados afines en la UTB: mejor la orientación por áreas que forzar una.
  if (SIN_AFINIDAD.test(n)) return null;
  // Una licenciatura es educación aunque nombre una disciplina ("licenciatura en informática").
  if (LICENCIATURA.test(n)) return { tipo: 'familia', familiaId: 'educacion' };

  // Nombre de un pregrado UTB. Las ingenierías solo si la persona dijo "ingeniería".
  const mencionaIngenieria = /\bingenier/.test(n);
  const utb = buscarPrograma(texto, ['pregrado']).filter(
    (p) => mencionaIngenieria || !/^Ingenier/i.test(p.nombre),
  );
  if (utb.length === 1) return { tipo: 'utb', pregradoId: utb[0].id };

  for (const [patron, pregradoId] of SINONIMOS_UTB) {
    if (patron.test(n)) return { tipo: 'utb', pregradoId };
  }

  const familia = FAMILIAS_EXTERNAS.find((f) => f.palabras.some((w) => n.includes(w)));
  if (familia) return { tipo: 'familia', familiaId: familia.id };

  return null;
}

// ── Selección ───────────────────────────────────────────────────────────────

export interface PerfilRecomendacion {
  /** Pregrado UTB (id del catálogo). */
  pregradoId?: string;
  /** Familia externa, si el pregrado no es de la UTB ni se parece a uno. */
  familiaId?: string;
}

export interface FiltrosRecomendacion {
  /** Nivel pedido; null o ausente = "Aún no sé". */
  nivel?: NivelPrograma | null;
  soloVirtual?: boolean;
}

export interface Recomendacion {
  programa: ProgramaUtb;
  tipo: TipoRecomendacion;
  motivo: string;
}

export interface ResultadoRecomendacion {
  /** Lo que se muestra primero (máximo 4). */
  recomendaciones: Recomendacion[];
  /** El resto de la tabla que cumple los filtros, para "Más opciones". */
  resto: Recomendacion[];
  /**
   * Qué filtro se tuvo que soltar para tener suficientes opciones. Se sueltan
   * en orden, así que 'nivel' implica que también se soltó la modalidad.
   */
  relajado: 'modalidad' | 'nivel' | null;
}

const MAXIMO = 4;
const CUPOS: readonly (readonly [TipoRecomendacion, number])[] = [
  ['profundiza', 2],
  ['complementa', 1],
  ['investiga', 1],
];

/** Listas y etiqueta para el motivo; undefined si el perfil no es válido. */
function listasDe(perfil: PerfilRecomendacion): { listas: ListasRecomendacion; etiqueta: string } | undefined {
  if (perfil.pregradoId) {
    const listasPregrado = TABLA_PREGRADO[perfil.pregradoId];
    const pregrado = getPrograma(perfil.pregradoId);
    if (listasPregrado && pregrado) return { listas: listasPregrado, etiqueta: pregrado.nombre };
  }
  if (perfil.familiaId) {
    const familia = FAMILIAS_EXTERNAS.find((f) => f.id === perfil.familiaId);
    if (familia) return { listas: familia.listas, etiqueta: familia.etiqueta };
  }
  return undefined;
}

/** Texto breve del porqué. Nunca promete admisión ni empleo. */
export function motivo(tipo: TipoRecomendacion, etiqueta: string): string {
  if (tipo === 'profundiza') return `Continuación directa de ${etiqueta}.`;
  if (tipo === 'complementa') return `Complementa un perfil de ${etiqueta} con otra área.`;
  return 'Ruta de investigación, si te interesa la academia o la I+D.';
}

function seleccionar(
  base: ListasRecomendacion,
  etiqueta: string,
  cumple: (p: ProgramaUtb) => boolean,
): { recomendaciones: Recomendacion[]; resto: Recomendacion[] } {
  const porTipo = Object.fromEntries(
    TIPOS.map((tipo) => [
      tipo,
      base[tipo]
        .map((id) => getPrograma(id))
        .filter((p): p is ProgramaUtb => !!p && cumple(p))
        .map((programa) => ({ programa, tipo, motivo: motivo(tipo, etiqueta) })),
    ]),
  ) as Record<TipoRecomendacion, Recomendacion[]>;

  const elegidas: Recomendacion[] = [];
  for (const [tipo, cupo] of CUPOS) elegidas.push(...porTipo[tipo].slice(0, cupo));
  // Si a un tipo le faltan programas, el cupo pasa al siguiente en orden de prioridad.
  for (const tipo of TIPOS) {
    for (const r of porTipo[tipo]) {
      if (elegidas.length >= MAXIMO) break;
      if (!elegidas.includes(r)) elegidas.push(r);
    }
  }
  const resto = TIPOS.flatMap((tipo) => porTipo[tipo]).filter((r) => !elegidas.includes(r));
  return { recomendaciones: elegidas, resto };
}

/**
 * Recomienda hasta 4 posgrados: 2 que profundizan, 1 que complementa y 1 de
 * investigación, filtrados por nivel y modalidad. Si con los filtros quedan
 * muy pocos (menos de 2, o ningún doctorado), suelta primero la modalidad y
 * luego el nivel, y lo reporta en `relajado` para que el flujo lo diga.
 */
export function recomendar(perfil: PerfilRecomendacion, filtros: FiltrosRecomendacion = {}): ResultadoRecomendacion {
  const origen = listasDe(perfil);
  if (!origen) return { recomendaciones: [], resto: [], relajado: null };

  const nivel = filtros.nivel ?? null;
  const minimo = nivel === 'doctorado' ? 1 : 2;
  const intentos: { relajado: ResultadoRecomendacion['relajado']; cumple: (p: ProgramaUtb) => boolean }[] = [
    { relajado: null, cumple: (p) => (!nivel || p.nivel === nivel) && (!filtros.soloVirtual || esVirtual(p)) },
  ];
  if (filtros.soloVirtual) intentos.push({ relajado: 'modalidad', cumple: (p) => !nivel || p.nivel === nivel });
  if (nivel) intentos.push({ relajado: 'nivel', cumple: () => true });

  let resultado: ResultadoRecomendacion = { recomendaciones: [], resto: [], relajado: null };
  for (const intento of intentos) {
    resultado = { ...seleccionar(origen.listas, origen.etiqueta, intento.cumple), relajado: intento.relajado };
    if (resultado.recomendaciones.length >= minimo) break;
  }
  return resultado;
}
