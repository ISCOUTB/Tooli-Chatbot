import { normalize } from './validation';

/**
 * Orientación funcional de pregrado (P02).
 *
 * Funciones puras para la subnavegación de personas indecisas dentro de los
 * pasos `pregrado_registro_carrera` y `pregrado_prospecto_carrera`.
 *
 * La subnavegación vive en los datos de sesión (claves
 * `pregrado_guidance_stage` / `pregrado_guidance_area`), así que no se
 * agregan handlers ni pasos nuevos al índice.
 *
 * El catálogo sale únicamente de la sección "PROGRAMAS DE PREGRADO
 * DISPONIBLES" de `src/services/knowledgeBase.ts`. No hay costos, fechas
 * ni enlaces en este módulo.
 */

export type PregradoAreaId =
  | 'ingenieria'
  | 'diseno_arquitectura'
  | 'negocios'
  | 'sociedad'
  | 'transformacion_digital';

export interface PregradoArea {
  id: PregradoAreaId;
  label: string;
  careers: readonly string[];
}

export const PREGRADO_AREAS: readonly PregradoArea[] = [
  {
    id: 'ingenieria',
    label: 'Ingeniería',
    careers: [
      'Ingeniería Eléctrica',
      'Ingeniería Electrónica',
      'Ingeniería Civil',
      'Ingeniería Ambiental',
      'Ingeniería Química',
      'Ingeniería Biomédica',
      'Ingeniería Mecánica',
      'Ingeniería Mecatrónica',
      'Ingeniería Naval',
      'Ingeniería Industrial',
      'Ingeniería de Sistemas y Computación',
    ],
  },
  {
    id: 'diseno_arquitectura',
    label: 'Diseño y Arquitectura',
    careers: ['Arquitectura', 'Diseño'],
  },
  {
    id: 'negocios',
    label: 'Negocios',
    careers: [
      'Administración de Empresas',
      'Contaduría Pública',
      'Finanzas y Negocios Internacionales',
      'Economía',
      'Marketing y Transformación Digital',
    ],
  },
  {
    id: 'sociedad',
    label: 'Sociedad',
    careers: [
      'Psicología',
      'Derecho',
      'Ciencia Política y Relaciones Internacionales',
      'Comunicación Social',
    ],
  },
  {
    id: 'transformacion_digital',
    label: 'Transformación Digital',
    careers: ['Ciencia de Datos', 'Ingeniería de Sistemas y Computación'],
  },
];

export const GUIDANCE_STAGE_KEY = 'pregrado_guidance_stage';
export const GUIDANCE_AREA_KEY = 'pregrado_guidance_area';

export type GuidanceStage = 'area' | 'career';

export interface GuidanceState {
  stage: GuidanceStage;
  areaId?: PregradoAreaId;
}

export type CareerSelection =
  | { kind: 'career'; career: string }
  | { kind: 'undecided' }
  | { kind: 'invalid' };

/** Normaliza para comparar entradas (minúsculas, sin tildes ni espacios sobrantes). */
export function normalizeGuidanceInput(text: string): string {
  return normalize(text).replace(/\s+/g, ' ').trim();
}

const GUIDANCE_EXACT: ReadonlySet<string> = new Set([
  'no se',
  'nose',
  'no lo se',
  'aun no se',
  'aun no lo se',
  'todavia no se',
  'aun no me decido',
  'no me decido',
  'no estoy seguro',
  'no estoy segura',
  'indeciso',
  'indecisa',
  'ver carreras',
  'ver opciones',
  'ver programas',
  'ver areas',
  'explorar carreras',
  'explorar opciones',
  'quiero explorar',
  'carreras disponibles',
  'que carreras hay',
  'ayudame a elegir',
  'ayuda a elegir',
  'ayudame a decidir',
]);

// Estas respuestas confirman indecisión. Pedir orientación o comparar carreras
// mantiene el paso abierto para que la persona elija una opción de la lista.
const EXPLICIT_UNDECIDED: ReadonlySet<string> = new Set([
  'no se',
  'nose',
  'no lo se',
  'aun no se',
  'aun no lo se',
  'todavia no se',
  'no se aun',
  'no se todavia',
  'aun no me decido',
  'no me decido',
  'no estoy seguro',
  'no estoy segura',
  'indeciso',
  'indecisa',
]);

const GUIDANCE_PATTERNS: readonly RegExp[] = [
  /^(aun\s+)?no\s+se(\s+(aun|todavia))?$/,
  /^no\s+se\s+que\s+(elegir|estudiar|escoger)$/,
  /^(quiero\s+)?(ver|mostrar|explorar)\s+(las\s+)?(carreras|opciones|programas|areas)\b/,
  /\bayud\w*\s+(a\s+)?(elegir|decidir|escoger)\b/,
  /\bestoy\s+indecis[oa]\b/,
  /\bque\s+me\s+recomiend\w*\b/,
];

/**
 * Detecta variantes inequívocas de "no sé" / "ver carreras" /
 * "ayúdame a elegir" y equivalentes. Solo coincide con el mensaje completo
 * o con patrones cerrados: un nombre de carrera concreto nunca da positivo.
 */
export function isGuidanceRequest(text: string): boolean {
  const input = normalizeGuidanceInput(text);
  if (!input) return false;
  if (GUIDANCE_EXACT.has(input)) return true;
  return GUIDANCE_PATTERNS.some((pattern) => pattern.test(input));
}

const GLOBAL_TOKENS: ReadonlySet<string> = new Set(['menu', 'volver', 'salir', 'atras', '0']);

const AREA_ALIASES: Readonly<Record<string, PregradoAreaId>> = {
  ingenieria: 'ingenieria',
  ingenierias: 'ingenieria',
  'diseno y arquitectura': 'diseno_arquitectura',
  diseno: 'diseno_arquitectura',
  arquitectura: 'diseno_arquitectura',
  negocios: 'negocios',
  sociedad: 'sociedad',
  'transformacion digital': 'transformacion_digital',
  'transformacion digital y datos': 'transformacion_digital',
  transformacion: 'transformacion_digital',
  datos: 'transformacion_digital',
};

/**
 * Interpreta la selección de área (número 1-5 o nombre del área).
 * Devuelve null si no es una selección válida. Los comandos globales
 * (`menu`, `volver`, `salir`, `0`) nunca son un área: el llamador los
 * atiende antes con `salirDelPregrado`.
 */
export function parseAreaSelection(text: string): PregradoAreaId | null {
  const input = normalizeGuidanceInput(text);
  if (!input || GLOBAL_TOKENS.has(input)) return null;
  if (/^[1-5]$/.test(input)) return PREGRADO_AREAS[Number(input) - 1].id;
  return AREA_ALIASES[input] ?? null;
}

/**
 * Interpreta la respuesta dentro del paso de carrera de un área:
 * número o nombre exacto de la carrera, "aún no sé" como interés
 * explícito, o inválida.
 */
export function parseCareerSelection(text: string, areaId: PregradoAreaId): CareerSelection {
  const careers = getCareersByArea(areaId);
  if (careers.length === 0) return { kind: 'invalid' };
  const input = normalizeGuidanceInput(text);
  if (!input || GLOBAL_TOKENS.has(input)) return { kind: 'invalid' };
  if (EXPLICIT_UNDECIDED.has(input)) return { kind: 'undecided' };
  if (/^\d+$/.test(input)) {
    const index = Number.parseInt(input, 10);
    if (index >= 1 && index <= careers.length) return { kind: 'career', career: careers[index - 1] };
    if (index === careers.length + 1) return { kind: 'undecided' };
    return { kind: 'invalid' };
  }
  const found = careers.find((career) => normalizeGuidanceInput(career) === input);
  return found ? { kind: 'career', career: found } : { kind: 'invalid' };
}

export function getAreaById(areaId: PregradoAreaId): PregradoArea | null {
  return PREGRADO_AREAS.find((area) => area.id === areaId) ?? null;
}

export function getCareersByArea(areaId: PregradoAreaId): string[] {
  return [...(getAreaById(areaId)?.careers ?? [])];
}

/** Catálogo completo sin duplicados (Ing. de Sistemas consta en dos áreas). */
export function getAllCareers(): string[] {
  const seen = new Set<string>();
  const all: string[] = [];
  for (const area of PREGRADO_AREAS) {
    for (const career of area.careers) {
      if (!seen.has(career)) {
        seen.add(career);
        all.push(career);
      }
    }
  }
  return all;
}

/**
 * Etiqueta explícita para quien confirma que aún no sabe, con el área que
 * exploró, de modo que el registro y el asesor la aprovechen.
 */
export function buildUndecidedLabel(areaLabel: string): string {
  return `Aún no sé (área de interés: ${areaLabel})`;
}

export function formatAreasMessage(mode: 'initial' | 'invalid'): string {
  const intro =
    mode === 'invalid'
      ? 'No reconocí esa opción 🤔\n\nElige un área de la lista con su *número* o su *nombre*:'
      : '🤔 *¿No sabes qué estudiar? Te ayudo a explorar.*\n\nElige un área con su *número* o su *nombre*:';
  const rows = PREGRADO_AREAS.map((area, index) => `${index + 1}. ${area.label}`).join('\n');
  return `${intro}\n\n${rows}\n\n_Escribe *menu* para volver al inicio._`;
}

export function formatCareersMessage(areaId: PregradoAreaId, mode: 'initial' | 'invalid'): string {
  const area = getAreaById(areaId);
  if (!area) return formatAreasMessage('invalid');
  const intro =
    mode === 'invalid'
      ? `No reconocí esa opción 🤔\n\nEstas son las carreras del área *${area.label}*. Elige una con su *número* o su *nombre exacto*:`
      : `*Área: ${area.label}*\n\nEstas son las carreras de esa área. Elige una con su *número* o su *nombre exacto*:`;
  const rows = area.careers.map((career, index) => `${index + 1}. ${career}`).join('\n');
  const undecidedOption = `${area.careers.length + 1}. Aún no sé`;
  return (
    `${intro}\n\n${rows}\n${undecidedOption}\n\n` +
    'Si aún no te decides, escribe *"Aún no sé"*.\n\n' +
    '_Escribe *menu* para volver al inicio._'
  );
}

/** Lee la subnavegación desde los datos de sesión; null si no hay guía activa. */
export function getGuidanceState(data: Record<string, string> | null | undefined): GuidanceState | null {
  const stage = data?.[GUIDANCE_STAGE_KEY];
  if (stage !== 'area' && stage !== 'career') return null;
  if (stage === 'area') return { stage };
  const areaId = data?.[GUIDANCE_AREA_KEY] as PregradoAreaId | undefined;
  if (!areaId || !getAreaById(areaId)) return null;
  return { stage, areaId };
}

/** Devuelve una copia de los datos con la guía fijada (conserva nombre/correo). */
export function withGuidance(data: Record<string, string>, state: GuidanceState): Record<string, string> {
  const next: Record<string, string> = { ...data, [GUIDANCE_STAGE_KEY]: state.stage };
  if (state.stage === 'career' && state.areaId) {
    next[GUIDANCE_AREA_KEY] = state.areaId;
  } else {
    delete next[GUIDANCE_AREA_KEY];
  }
  return next;
}

/** Devuelve una copia de los datos sin rastros de la guía. */
export function withoutGuidance(data: Record<string, string>): Record<string, string> {
  const next: Record<string, string> = { ...data };
  delete next[GUIDANCE_STAGE_KEY];
  delete next[GUIDANCE_AREA_KEY];
  return next;
}
