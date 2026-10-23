/**
 * Catálogo puro de orientación de posgrados (G02).
 *
 * Todo sale de datos ya presentes en el repo (`knowledgeBase.ts` y los
 * textos de `programas.ts`): nombres de programas reales y los enlaces
 * oficiales de categoría. No inventa programas, precios, requisitos ni URLs.
 *
 * Es puro a propósito: no importa `shared.ts` (que instancia el adaptador
 * de mensajería) ni servicios, para que `node:test` lo pruebe sin colgarse.
 */
import { normalize } from './validation';

export type CategoriaPrograma = 'especializaciones' | 'maestrias' | 'doctorados';

export const CATEGORIAS: readonly CategoriaPrograma[] = [
  'especializaciones',
  'maestrias',
  'doctorados',
];

/** Enlaces oficiales de categoría ya existentes en `knowledgeBase.ts`. */
export const CATEGORIA_URLS: Record<CategoriaPrograma, string> = {
  especializaciones: 'https://www.utb.edu.co/posgrado/especializaciones/',
  maestrias: 'https://www.utb.edu.co/posgrado/maestrias/',
  doctorados: 'https://www.utb.edu.co/posgrado/doctorados/',
};

/** Enlace general oficial ya existente en `knowledgeBase.ts`. */
export const POSGRADOS_URL = 'https://www.utb.edu.co/posgrados/';

export const URLS_OFICIALES: readonly string[] = [
  POSGRADOS_URL,
  CATEGORIA_URLS.especializaciones,
  CATEGORIA_URLS.maestrias,
  CATEGORIA_URLS.doctorados,
];

export interface ProgramaCatalogo {
  nombre: string;
  categoria: CategoriaPrograma;
}

/** Los 20 programas reales (10 esp. + 7 mae. + 3 doc.) de `knowledgeBase.ts`. */
export const PROGRAMAS: readonly ProgramaCatalogo[] = [
  { nombre: 'Telecomunicaciones y Redes', categoria: 'especializaciones' },
  { nombre: 'Logística del Transporte', categoria: 'especializaciones' },
  { nombre: 'Gestión Ambiental Sostenible', categoria: 'especializaciones' },
  { nombre: 'Sistemas Energéticos Sostenibles', categoria: 'especializaciones' },
  { nombre: 'Automatización Industrial', categoria: 'especializaciones' },
  { nombre: 'Gerencia de Proyectos', categoria: 'especializaciones' },
  { nombre: 'Análisis y Diseño Estructural', categoria: 'especializaciones' },
  { nombre: 'Ingeniería de Software (virtual)', categoria: 'especializaciones' },
  { nombre: 'Gerencia de Servicios de Salud (virtual)', categoria: 'especializaciones' },
  { nombre: 'Educación Mediada por TIC (virtual)', categoria: 'especializaciones' },
  { nombre: 'Maestría en Gestión de la Innovación', categoria: 'maestrias' },
  { nombre: 'Maestría en Ingeniería', categoria: 'maestrias' },
  { nombre: 'Maestría en Gerencia de Proyectos', categoria: 'maestrias' },
  { nombre: 'MBA', categoria: 'maestrias' },
  { nombre: 'Maestría en Gerencia Tributaria', categoria: 'maestrias' },
  { nombre: 'Maestría en Ciberseguridad', categoria: 'maestrias' },
  { nombre: 'Maestría en Educación Mediada por TIC (virtual)', categoria: 'maestrias' },
  { nombre: 'Doctorado en Ingeniería', categoria: 'doctorados' },
  { nombre: 'Doctorado en Desarrollo Regional y Local', categoria: 'doctorados' },
  { nombre: 'Doctorado en Sostenibilidad', categoria: 'doctorados' },
];

export interface AreaInteres {
  id: string;
  titulo: string;
  descripcion: string;
}

/** Conjunto corto de áreas; el número en la lista es su posición (1-6). */
export const AREAS: readonly AreaInteres[] = [
  { id: 'tecnologia', titulo: 'Tecnología y sistemas', descripcion: 'Software, redes y ciberseguridad' },
  { id: 'gestion', titulo: 'Gestión y proyectos', descripcion: 'Proyectos, innovación y MBA' },
  { id: 'negocios', titulo: 'Negocios y finanzas', descripcion: 'Tributaria, logística y negocios' },
  { id: 'energia', titulo: 'Energía y ambiente', descripcion: 'Ambiente, energía y sostenibilidad' },
  { id: 'industria', titulo: 'Industria y estructuras', descripcion: 'Automatización, estructuras e ingeniería' },
  { id: 'salud_educacion', titulo: 'Salud y educación', descripcion: 'Salud, educación TIC y desarrollo' },
];

/** Atajos de una palabra (ya normalizados) hacia cada área. */
const ALIAS_AREAS: Record<string, readonly string[]> = {
  tecnologia: ['tecnologia', 'sistemas', 'software', 'ciberseguridad'],
  gestion: ['gestion', 'proyectos', 'innovacion', 'mba'],
  negocios: ['negocios', 'finanzas', 'tributaria', 'logistica'],
  energia: ['energia', 'ambiente', 'sostenibilidad'],
  industria: ['industria', 'estructuras', 'automatizacion', 'infraestructura'],
  salud_educacion: ['salud', 'educacion', 'desarrollo'],
};

export interface SugerenciaPrograma {
  programa: string;
  categoria: CategoriaPrograma;
  /** Encaje breve; nunca promete admisión ni empleabilidad. */
  encaje: string;
  url: string;
}

interface SugerenciaBase {
  programa: string;
  categoria: CategoriaPrograma;
  encaje: string;
}

const SUGERENCIAS: Record<string, readonly SugerenciaBase[]> = {
  tecnologia: [
    { programa: 'Ingeniería de Software (virtual)', categoria: 'especializaciones', encaje: 'Afin si vienes de sistemas o software y buscas modalidad virtual.' },
    { programa: 'Maestría en Ciberseguridad', categoria: 'maestrias', encaje: 'Afin si te atrae la seguridad de redes y sistemas.' },
    { programa: 'Telecomunicaciones y Redes', categoria: 'especializaciones', encaje: 'Relacionada con redes y telecomunicaciones.' },
    { programa: 'Maestría en Ingeniería', categoria: 'maestrias', encaje: 'Opción con enfoque en investigación aplicada en ingeniería.' },
  ],
  gestion: [
    { programa: 'Gerencia de Proyectos', categoria: 'especializaciones', encaje: 'Afin si coordinas o quieres coordinar proyectos.' },
    { programa: 'Maestría en Gerencia de Proyectos', categoria: 'maestrias', encaje: 'Profundiza en gerencia de proyectos con enfoque de maestría.' },
    { programa: 'Maestría en Gestión de la Innovación', categoria: 'maestrias', encaje: 'Afin si te interesa la innovación en organizaciones.' },
    { programa: 'MBA', categoria: 'maestrias', encaje: 'Relacionado con administración y dirección de empresas.' },
  ],
  negocios: [
    { programa: 'MBA', categoria: 'maestrias', encaje: 'Relacionado con administración y dirección de empresas.' },
    { programa: 'Maestría en Gerencia Tributaria', categoria: 'maestrias', encaje: 'Afin si te mueves en impuestos y gestión tributaria.' },
    { programa: 'Logística del Transporte', categoria: 'especializaciones', encaje: 'Relacionada con transporte y cadena de suministro.' },
  ],
  energia: [
    { programa: 'Gestión Ambiental Sostenible', categoria: 'especializaciones', encaje: 'Afin si te interesa la gestión ambiental.' },
    { programa: 'Sistemas Energéticos Sostenibles', categoria: 'especializaciones', encaje: 'Relacionada con sistemas de energía.' },
    { programa: 'Doctorado en Sostenibilidad', categoria: 'doctorados', encaje: 'Opción investigativa si te atrae la sostenibilidad.' },
  ],
  industria: [
    { programa: 'Análisis y Diseño Estructural', categoria: 'especializaciones', encaje: 'Afin si trabajas con estructuras y obra.' },
    { programa: 'Automatización Industrial', categoria: 'especializaciones', encaje: 'Relacionada con automatización y planta industrial.' },
    { programa: 'Maestría en Ingeniería', categoria: 'maestrias', encaje: 'Opción con enfoque en investigación aplicada en ingeniería.' },
    { programa: 'Doctorado en Ingeniería', categoria: 'doctorados', encaje: 'Opción investigativa avanzada en ingeniería.' },
  ],
  salud_educacion: [
    { programa: 'Gerencia de Servicios de Salud (virtual)', categoria: 'especializaciones', encaje: 'Afin si trabajas en salud y buscas gestión, en modalidad virtual.' },
    { programa: 'Educación Mediada por TIC (virtual)', categoria: 'especializaciones', encaje: 'Afin si te interesa enseñar con apoyo de tecnología.' },
    { programa: 'Maestría en Educación Mediada por TIC (virtual)', categoria: 'maestrias', encaje: 'Profundiza en educación mediada por tecnología.' },
    { programa: 'Doctorado en Desarrollo Regional y Local', categoria: 'doctorados', encaje: 'Opción investigativa ligada al desarrollo de territorios.' },
  ],
};

/** Normalización con tildes (reusa la de `validation.ts`). */
export function normalizeTexto(s: string): string {
  return normalize(s ?? '');
}

export function esCategoriaValida(categoria: string): categoria is CategoriaPrograma {
  return (CATEGORIAS as readonly string[]).includes(categoria);
}

/** URL oficial de la categoría, o null si no es válida. */
export function categoriaUrl(categoria: string): string | null {
  if (!esCategoriaValida(categoria)) return null;
  return CATEGORIA_URLS[categoria];
}

export function getArea(id: string): AreaInteres | undefined {
  const clave = normalizeTexto(id ?? '');
  return AREAS.find((a) => a.id === clave);
}

/**
 * Reconoce la selección de área: número de lista ("1"-"6"), id, título
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

/** 2-4 sugerencias reales del área, con su URL oficial; [] si inválida. */
export function recomendarPorArea(areaId: string): SugerenciaPrograma[] {
  const clave = normalizeTexto(areaId ?? '');
  const lista = SUGERENCIAS[clave];
  if (!lista) return [];
  return lista.map((s) => ({ ...s, url: CATEGORIA_URLS[s.categoria] }));
}

/** Contexto breve derivado del catálogo, sin confiar en una lista guardada en sesión. */
export function resumenOrientacion(areaId: string): string | null {
  const area = getArea(areaId);
  if (!area) return null;
  const programas = recomendarPorArea(area.id).map((s) => s.programa);
  if (!programas.length) return null;
  return `Área explorada: ${area.titulo}. Programas sugeridos: ${programas.join(', ')}.`;
}

const NOMBRE_CATEGORIA: Record<CategoriaPrograma, string> = {
  especializaciones: 'Especializaciones',
  maestrias: 'Maestrías',
  doctorados: 'Doctorados',
};

/** Texto de sugerencias con enlaces oficiales; null si el área es inválida. */
export function formatearSugerencias(areaId: string): string | null {
  const clave = normalizeTexto(areaId ?? '');
  const area = AREAS.find((a) => a.id === clave);
  const sugerencias = recomendarPorArea(clave);
  if (!area || sugerencias.length === 0) return null;

  const lineas = sugerencias.map(
    (s, i) => `${i + 1}. *${s.programa}*\n   ${s.encaje}`,
  );

  const categoriasVistas: CategoriaPrograma[] = [];
  for (const s of sugerencias) {
    if (!categoriasVistas.includes(s.categoria)) categoriasVistas.push(s.categoria);
  }
  const enlaces = categoriasVistas.map(
    (c) => `• ${NOMBRE_CATEGORIA[c]}: ${CATEGORIA_URLS[c]}`,
  );
  enlaces.push(`• Posgrados UTB: ${POSGRADOS_URL}`);

  return (
    `🧭 *${area.titulo}*\n` +
    'Según tu interés, estas opciones reales de posgrado UTB pueden encajarte:\n\n' +
    lineas.join('\n\n') +
    '\n\n🔗 *Enlaces oficiales:*\n' +
    enlaces.join('\n') +
    '\n\n_La elección depende de tu perfil y del proceso de admisión; ' +
    'verifica requisitos y costos en los enlaces oficiales._'
  );
}
