/**
 * Catálogo puro de orientación de posgrados (G02).
 *
 * Los programas, valores y enlaces salen del catálogo extraído de las páginas
 * oficiales (`services/catalogoUtb.ts`). Acá solo se decide qué sugerir por
 * área y cómo mostrarlo; no se inventan programas, precios, requisitos ni URLs.
 *
 * Es puro a propósito: no importa `shared.ts` (que instancia el adaptador
 * de mensajería) ni servicios con conexiones, para que `node:test` lo pruebe
 * sin colgarse.
 */
import { normalize } from './validation';
import {
  DERECHOS_PECUNIARIOS_URL,
  NivelPrograma,
  POSGRADOS_URL,
  POSGRADOS_UTB,
  POSGRADOS_VIRTUALES_URL,
  VIGENCIA_VALORES,
  esVirtual,
  getPrograma,
  nombreCorto,
  programasPorNivel,
  valorCorto,
} from '../services/catalogoUtb';

export { POSGRADOS_URL, POSGRADOS_VIRTUALES_URL };

export type CategoriaPrograma = 'especializaciones' | 'maestrias' | 'doctorados';

export const CATEGORIAS: readonly CategoriaPrograma[] = [
  'especializaciones',
  'maestrias',
  'doctorados',
];

const NIVEL_DE_CATEGORIA: Record<CategoriaPrograma, NivelPrograma> = {
  especializaciones: 'especializacion',
  maestrias: 'maestria',
  doctorados: 'doctorado',
};
const CATEGORIA_DE_NIVEL: Partial<Record<NivelPrograma, CategoriaPrograma>> = {
  especializacion: 'especializaciones',
  maestria: 'maestrias',
  doctorado: 'doctorados',
};

export interface ProgramaCatalogo {
  id: string;
  nombre: string;
  categoria: CategoriaPrograma;
  url: string;
  virtual: boolean;
}

/** Todos los posgrados vigentes publicados por la UTB (presenciales y virtuales). */
export const PROGRAMAS: readonly ProgramaCatalogo[] = POSGRADOS_UTB.map((p) => ({
  id: p.id,
  nombre: p.nombre,
  categoria: CATEGORIA_DE_NIVEL[p.nivel] as CategoriaPrograma,
  url: p.url,
  virtual: esVirtual(p),
}));

export interface AreaInteres {
  id: string;
  titulo: string;
  descripcion: string;
}

/** Conjunto corto de áreas; el número en la lista es su posición (1-7). */
export const AREAS: readonly AreaInteres[] = [
  { id: 'tecnologia', titulo: 'Tecnología y sistemas', descripcion: 'Software, datos, redes y ciberseguridad' },
  { id: 'gestion', titulo: 'Gestión y proyectos', descripcion: 'Proyectos, innovación y MBA' },
  { id: 'negocios', titulo: 'Negocios y finanzas', descripcion: 'Finanzas, tributaria, logística y negocios' },
  { id: 'energia', titulo: 'Energía y ambiente', descripcion: 'Ambiente, energía y sostenibilidad' },
  { id: 'industria', titulo: 'Industria y estructuras', descripcion: 'Estructuras, automatización e Industria 4.0' },
  { id: 'salud_educacion', titulo: 'Salud y educación', descripcion: 'Salud, educación y TIC' },
  { id: 'derecho_sociedad', titulo: 'Derecho y sociedad', descripcion: 'Derecho, contratación estatal y psicosocial' },
];

/** Atajos de una palabra (ya normalizados) hacia cada área. */
const ALIAS_AREAS: Record<string, readonly string[]> = {
  tecnologia: ['tecnologia', 'sistemas', 'software', 'ciberseguridad', 'datos'],
  gestion: ['gestion', 'proyectos', 'innovacion', 'mba'],
  negocios: ['negocios', 'finanzas', 'tributaria', 'logistica'],
  energia: ['energia', 'ambiente', 'sostenibilidad'],
  industria: ['industria', 'estructuras', 'automatizacion', 'infraestructura'],
  salud_educacion: ['salud', 'educacion', 'docencia'],
  derecho_sociedad: ['derecho', 'leyes', 'juridica', 'contratacion', 'psicologia', 'sociedad'],
};

export interface SugerenciaPrograma {
  programa: string;
  categoria: CategoriaPrograma;
  /** Encaje breve; nunca promete admisión ni empleabilidad. */
  encaje: string;
  url: string;
  virtual: boolean;
}

interface SugerenciaBase {
  /** `id` del programa en el catálogo extraído. */
  id: string;
  encaje: string;
}

const SUGERENCIAS: Record<string, readonly SugerenciaBase[]> = {
  tecnologia: [
    { id: 'virtual-ingenieria-de-software', encaje: 'Afín si vienes de sistemas o software y buscas modalidad virtual.' },
    { id: 'maestria-en-ciberseguridad', encaje: 'Afín si te atrae la seguridad de redes y sistemas.' },
    { id: 'maestria-en-estadistica-aplicada-y-ciencia-de-datos', encaje: 'Relacionada con análisis de datos y modelos estadísticos.' },
    { id: 'especializacion-en-telecomunicaciones-y-redes', encaje: 'Relacionada con redes y telecomunicaciones.' },
  ],
  gestion: [
    { id: 'especializacion-en-gerencia-de-proyectos', encaje: 'Afín si coordinas o quieres coordinar proyectos.' },
    { id: 'maestria-en-gerencia-de-proyectos', encaje: 'Profundiza en gerencia de proyectos con enfoque de maestría.' },
    { id: 'maestria-en-gestion-de-la-innovacion', encaje: 'Afín si te interesa la innovación en organizaciones.' },
    { id: 'maestria-en-administracion', encaje: 'Relacionado con administración y dirección de empresas.' },
  ],
  negocios: [
    { id: 'maestria-en-finanzas', encaje: 'Afín si trabajas en finanzas corporativas o inversión.' },
    { id: 'maestria-en-gerencia-tributaria', encaje: 'Afín si te mueves en impuestos y gestión tributaria.' },
    { id: 'especializacion-en-gestion-de-negocios-internacionales', encaje: 'Relacionada con comercio y negocios internacionales.' },
    { id: 'especializacion-gestion-logistica-cadena-suministro', encaje: 'Relacionada con logística y cadena de suministro.' },
  ],
  energia: [
    { id: 'especializacion-en-gestion-ambiental-sostenible', encaje: 'Afín si te interesa la gestión ambiental.' },
    { id: 'especializacion-sistemas-energeticos-sostenibles', encaje: 'Relacionada con sistemas de energía.' },
    { id: 'doctorado-en-sostenibilidad', encaje: 'Opción investigativa si te atrae la sostenibilidad.' },
  ],
  industria: [
    { id: 'especializacion-en-analisis-y-diseno-estructural', encaje: 'Afín si trabajas con estructuras y obra.' },
    { id: 'especializacion-en-automatizacion-y-control-de-procesos-industriales', encaje: 'Relacionada con automatización y planta industrial.' },
    { id: 'maestria-en-industria-4-0-y-automatizacion-industrial', encaje: 'Afín si te interesa la transformación digital de la industria.' },
    { id: 'maestria-en-ingenieria', encaje: 'Opción con enfoque en investigación aplicada en ingeniería.' },
  ],
  salud_educacion: [
    { id: 'virtual-gerencia-servicios-salud', encaje: 'Afín si trabajas en salud y buscas gestión, en modalidad virtual.' },
    { id: 'virtual-educacion-mediada-tic', encaje: 'Afín si te interesa enseñar con apoyo de tecnología.' },
    { id: 'virtual-tic-para-educacion', encaje: 'Profundiza en educación mediada por tecnología.' },
    { id: 'maestria-en-educacion', encaje: 'Relacionada con la práctica y la investigación educativa.' },
  ],
  derecho_sociedad: [
    { id: 'maestria-en-derecho', encaje: 'Afín si eres abogado y quieres profundizar tu formación jurídica.' },
    { id: 'especializacion-en-derecho-comercial', encaje: 'Relacionada con derecho de empresas y contratos comerciales.' },
    { id: 'virtual-contratacion-estatal', encaje: 'Afín si trabajas con contratos públicos, en modalidad virtual.' },
    { id: 'maestria-en-intervencion-psicosocial', encaje: 'Relacionada con intervención en comunidades y organizaciones.' },
  ],
};

/** Normalización con tildes (reusa la de `validation.ts`). */
export function normalizeTexto(s: string): string {
  return normalize(s ?? '');
}

export function esCategoriaValida(categoria: string): categoria is CategoriaPrograma {
  return (CATEGORIAS as readonly string[]).includes(categoria);
}

export function getArea(id: string): AreaInteres | undefined {
  const clave = normalizeTexto(id ?? '');
  return AREAS.find((a) => a.id === clave);
}

/**
 * Reconoce la selección de área: número de lista ("1"-"7"), id, título
 * exacto (con o sin tildes/mayúsculas) o palabra clave. Lo demás → null
 * para que el flujo lo explique y re-pregunte.
 */
export function parseAreaSeleccion(input: string): string | null {
  const crudo = (input ?? '').trim();
  if (!crudo) return null;
  const n = normalizeTexto(crudo);
  if (/^[1-9]\d*$/.test(n)) {
    const num = parseInt(n, 10);
    if (num >= 1 && num <= AREAS.length) return AREAS[num - 1].id;
    return null;
  }
  for (const area of AREAS) {
    if (n === normalizeTexto(area.id)) return area.id;
    if (n === normalizeTexto(area.titulo)) return area.id;
  }
  for (const area of AREAS) {
    if ((ALIAS_AREAS[area.id] ?? []).includes(n)) return area.id;
  }
  return null;
}

/** 2-4 sugerencias reales del área, con la URL oficial de cada programa; [] si inválida. */
export function recomendarPorArea(areaId: string): SugerenciaPrograma[] {
  const clave = normalizeTexto(areaId ?? '');
  const lista = SUGERENCIAS[clave];
  if (!lista) return [];
  return lista.flatMap((s) => {
    const p = getPrograma(s.id);
    if (!p) return [];
    return [{
      programa: p.nombre,
      categoria: CATEGORIA_DE_NIVEL[p.nivel] as CategoriaPrograma,
      encaje: s.encaje,
      url: p.url,
      virtual: esVirtual(p),
    }];
  });
}

/** Contexto breve derivado del catálogo, sin confiar en una lista guardada en sesión. */
export function resumenOrientacion(areaId: string): string | null {
  const area = getArea(areaId);
  if (!area) return null;
  const programas = recomendarPorArea(area.id).map((s) => s.programa);
  if (!programas.length) return null;
  return `Área explorada: ${area.titulo}. Programas sugeridos: ${programas.join(', ')}.`;
}

/** Texto de sugerencias con el enlace oficial de cada programa; null si el área es inválida. */
export function formatearSugerencias(areaId: string): string | null {
  const clave = normalizeTexto(areaId ?? '');
  const area = AREAS.find((a) => a.id === clave);
  const sugerencias = recomendarPorArea(clave);
  if (!area || sugerencias.length === 0) return null;

  const lineas = sugerencias.map(
    (s, i) => `${i + 1}. *${s.programa}*${s.virtual ? ' _(virtual)_' : ''}\n   ${s.encaje}\n   🔗 ${s.url}`,
  );

  const enlaces = [`• Todos los posgrados: ${POSGRADOS_URL}`];
  if (sugerencias.some((s) => s.virtual)) enlaces.push(`• Posgrados virtuales: ${POSGRADOS_VIRTUALES_URL}`);

  return (
    `🧭 *${area.titulo}*\n` +
    'Según tu interés, estas opciones reales de posgrado UTB pueden encajarte:\n\n' +
    lineas.join('\n\n') +
    '\n\n🔗 *Más opciones:*\n' +
    enlaces.join('\n') +
    '\n\n_La elección depende de tu perfil y del proceso de admisión; ' +
    'verifica requisitos y costos en los enlaces oficiales._'
  );
}

const ENCABEZADO_CATEGORIA: Record<CategoriaPrograma, string> = {
  especializaciones: '📚 *Especializaciones UTB*',
  maestrias: '🎓 *Maestrías UTB*',
  doctorados: '🔬 *Doctorados UTB*',
};

/** Listado completo de una categoría con su valor por semestre, para enviar por WhatsApp. */
export function formatearListado(categoria: CategoriaPrograma): string {
  const nivel = NIVEL_DE_CATEGORIA[categoria];
  const programas = programasPorNivel(nivel);
  const linea = (p: (typeof programas)[number]) => {
    const nombre = categoria === 'doctorados' ? p.nombre : nombreCorto(p);
    const modalidad = !esVirtual(p) && p.modalidad && !/^presencial$/i.test(p.modalidad) ? ` _(${p.modalidad.toLowerCase()})_` : '';
    const valor = valorCorto(p) ?? 'valor por confirmar';
    const duracion = categoria === 'maestrias' && p.duracion_semestres ? ` · ${p.duracion_semestres} sem` : '';
    return `• ${nombre}${modalidad} — ${valor}${duracion}`;
  };

  const presenciales = programas.filter((p) => !esVirtual(p));
  const virtuales = programas.filter((p) => esVirtual(p));
  const bloques = virtuales.length
    ? [`*Presenciales*\n${presenciales.map(linea).join('\n')}`, `*Virtuales (UTB Virtual)*\n${virtuales.map(linea).join('\n')}`]
    : [presenciales.map(linea).join('\n')];

  const enlaces = [`Conoce cada programa: ${POSGRADOS_URL}`];
  if (virtuales.length) enlaces.push(`Posgrados virtuales: ${POSGRADOS_VIRTUALES_URL}`);
  enlaces.push(`Valores y derechos de inscripción: ${DERECHOS_PECUNIARIOS_URL}`);

  return (
    `${ENCABEZADO_CATEGORIA[categoria]}\n` +
    `_Valores de matrícula publicados para ${VIGENCIA_VALORES}; verifica condiciones vigentes antes de inscribirte._\n\n` +
    bloques.join('\n\n') +
    (categoria === 'doctorados' ? '\n\n_Consulta los requisitos propios de cada programa._' : '') +
    '\n\n' +
    enlaces.join('\n')
  );
}
