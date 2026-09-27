import { normalize } from './validation';

export type GlobalCommand = 'menu' | 'volver' | 'salir';
export type FlowArea = 'pregrado' | 'posgrado';

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

