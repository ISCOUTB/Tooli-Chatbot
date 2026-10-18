import { normalize } from './validation';

export type GlobalCommand = 'menu' | 'volver' | 'salir';
export type FlowArea = 'pregrado' | 'posgrado';
export type AiArea = 'ti' | 'admisiones' | 'posgrados';
export type SessionData = Record<string, string>;

const MENU_ALIASES: ReadonlySet<string> = new Set(['menu']);
const VOLVER_ALIASES: ReadonlySet<string> = new Set(['volver', 'atras', '0']);
const SALIR_ALIASES: ReadonlySet<string> = new Set(['salir']);

/** Reconoce únicamente el mensaje completo; nunca subcadenas dentro de un dato. */
export function parseGlobalCommand(text: string): GlobalCommand | null {
  const normalized = normalize(text);
  if (MENU_ALIASES.has(normalized)) return 'menu';
  if (VOLVER_ALIASES.has(normalized)) return 'volver';
  if (SALIR_ALIASES.has(normalized)) return 'salir';
  return null;
}

const POSGRADO_STEPS: ReadonlySet<string> = new Set([
  'menu_posgrado',
  'programas_categoria',
  'programas_detalle',
  'prospecto_nombre',
  'prospecto_email',
  'prospecto_programa',
  'registro_nombre',
  'registro_email',
  'registro_programa',
]);

const PREGRADO_STEPS: ReadonlySet<string> = new Set([
  'menu_pregrado',
  'pregrado_registro_nombre',
  'pregrado_registro_email',
  'pregrado_registro_carrera',
  'pregrado_prospecto_nombre',
  'pregrado_prospecto_email',
  'pregrado_prospecto_carrera',
]);

/** Área deducible de un step; los pasos compartidos dependen de la sesión. */
export function areaOfStep(step: string): FlowArea | null {
  if (POSGRADO_STEPS.has(step)) return 'posgrado';
  if (PREGRADO_STEPS.has(step)) return 'pregrado';
  return null;
}

export function menuStepForArea(area: FlowArea): 'menu_pregrado' | 'menu_posgrado' {
  return area === 'pregrado' ? 'menu_pregrado' : 'menu_posgrado';
}

/** `originArea` estricto: solo `pregrado` o `posgrado`. Todo lo demás es ausencia o corrupción. */
export function parseOriginArea(value: unknown): FlowArea | null {
  if (value === 'pregrado' || value === 'posgrado') return value;
  return null;
}

/** Origen efectivo de la sesión. Solo confía en `originArea` explícito; nunca lo adivina. */
export function resolveOriginArea(data: SessionData | undefined | null): FlowArea | null {
  if (!data) return null;
  return parseOriginArea(data.originArea);
}

/**
 * Menú al que debe volver un paso compartido con “volver”/`0`.
 * Fallback explícito para sesiones legacy o corruptas: menú raíz.
 */
export function returnMenuStep(data: SessionData | undefined | null): 'menu' | 'menu_pregrado' | 'menu_posgrado' {
  const origin = resolveOriginArea(data);
  if (origin) return menuStepForArea(origin);
  return 'menu';
}

/** Destino de un comando global dentro de un paso compartido: “volver” al origen, “menu”/“salir” a la raíz. */
export function sharedReturnStep(
  data: SessionData | undefined | null,
  command: GlobalCommand,
): 'menu' | 'menu_pregrado' | 'menu_posgrado' {
  if (command === 'volver') return returnMenuStep(data);
  return 'menu';
}

/**
 * Área de IA válida para la sesión, o `null` si toca recuperación explícita.
 * Nunca asume Posgrado: conserva un área válida (sesiones legacy), si falta o
 * es corrupta usa `originArea` (`posgrado`→`posgrados`, `pregrado`→`admisiones`),
 * y sin ningún contexto válido devuelve `null`.
 */
export function resolveAiArea(data: SessionData | undefined | null): AiArea | null {
  const area = data?.area;
  if (area === 'ti' || area === 'admisiones' || area === 'posgrados') return area;
  const origin = resolveOriginArea(data);
  if (origin === 'posgrado') return 'posgrados';
  if (origin === 'pregrado') return 'admisiones';
  return null;
}

