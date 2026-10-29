/**
 * Catálogo de programas UTB (pregrado y posgrado).
 *
 * Sale de `src/data/programas-utb.json`, que se genera con
 * `tools/utb-programas/` a partir de las fichas de utb.edu.co,
 * virtual.utb.edu.co y la tabla de derechos pecuniarios. Para actualizarlo se
 * vuelve a correr la extracción; acá no se escriben programas a mano.
 *
 * Es puro (solo lee el JSON empaquetado) para que flujos, base de
 * conocimiento, asistente IA y pruebas compartan los mismos datos.
 */
import catalogo from '../data/programas-utb.json';

export type NivelPrograma = 'pregrado' | 'especializacion' | 'maestria' | 'doctorado';

export interface PeriodoPlan {
  periodo: string;
  asignaturas: string[];
}

export interface ProgramaUtb {
  id: string;
  nivel: NivelPrograma;
  nombre: string;
  sitio: string;
  url: string;
  escuela: string | null;
  modalidad: string | null;
  duracion: string | null;
  duracion_semestres: number | null;
  inversion_texto: string | null;
  inversion_cop: number | null;
  titulo_otorgado: string | null;
  snies: string | null;
  acreditacion_alta_calidad: boolean;
  registro_calificado: string | null;
  numero_asignaturas?: number | null;
  descripcion?: string[];
  objetivos?: string[];
  beneficios?: string[];
  que_hace?: string[];
  campo_laboral?: string[];
  perfil_egresado?: string[];
  perfil_aspirante?: string[];
  salario?: string;
  plan_estudios_texto?: string[];
  plan_estudios: PeriodoPlan[];
  plan_estudios_pdf: string | null;
  brochure_pdf: string | null;
  profesores: string[];
  inscripcion_url: string | null;
  oferta_vigente: boolean;
  notas?: string[];
}

interface CatalogoUtb {
  extraido_en: string;
  vigencia_valores: string | null;
  programas: ProgramaUtb[];
}

const DATA = catalogo as unknown as CatalogoUtb;

export const CATALOGO_EXTRAIDO_EN = DATA.extraido_en;
export const VIGENCIA_VALORES = DATA.vigencia_valores ?? '2026';

export const POSGRADOS_URL = 'https://www.utb.edu.co/posgrado/';
export const POSGRADOS_VIRTUALES_URL = 'https://virtual.utb.edu.co/posgrados-virtuales/';
export const DERECHOS_PECUNIARIOS_URL = 'https://www.utb.edu.co/la-utb/derechos-pecuniarios/';

/** Solo la oferta vigente: listado oficial o matrícula fijada para la vigencia. */
export const PROGRAMAS_UTB: readonly ProgramaUtb[] = DATA.programas.filter((p) => p.oferta_vigente);
export const POSGRADOS_UTB: readonly ProgramaUtb[] = PROGRAMAS_UTB.filter((p) => p.nivel !== 'pregrado');

export const NIVELES_POSGRADO: readonly NivelPrograma[] = ['especializacion', 'maestria', 'doctorado'];

const NOMBRE_NIVEL: Record<NivelPrograma, string> = {
  pregrado: 'Pregrado',
  especializacion: 'Especialización',
  maestria: 'Maestría',
  doctorado: 'Doctorado',
};

export function esVirtual(p: ProgramaUtb): boolean {
  return p.sitio === 'virtual.utb.edu.co';
}

export function getPrograma(id: string): ProgramaUtb | undefined {
  return PROGRAMAS_UTB.find((p) => p.id === id);
}

/** Programas de un nivel: primero presenciales, luego virtuales, cada grupo en orden alfabético. */
export function programasPorNivel(nivel: NivelPrograma): ProgramaUtb[] {
  return PROGRAMAS_UTB.filter((p) => p.nivel === nivel).sort(
    (a, b) => Number(esVirtual(a)) - Number(esVirtual(b)) || a.nombre.localeCompare(b.nombre, 'es'),
  );
}

/** "Especialización en Finanzas" → "Finanzas"; los doctorados y pregrados quedan igual. */
export function nombreCorto(p: ProgramaUtb): string {
  return p.nombre.replace(/^(Especializaci[oó]n|Maestr[ií]a) en /i, '');
}

const miles = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** "$10.200.000/sem", "8 SMMLV/sem" o null si la UTB no publica el valor. */
export function valorSemestre(p: ProgramaUtb): string | null {
  if (p.inversion_cop != null) return `$${miles(p.inversion_cop)}/sem`;
  const texto = p.inversion_texto?.replace(/\s*por semestre$/i, '');
  return texto ? `${texto}/sem` : null;
}

/** "$10.2M/sem", "$7.95M/sem" para listas cortas de WhatsApp. */
export function valorCorto(p: ProgramaUtb): string | null {
  if (p.inversion_cop == null) return valorSemestre(p);
  return `$${Number((p.inversion_cop / 1e6).toFixed(2))}M/sem`;
}

// ── Búsqueda por nombre ─────────────────────────────────────────────────────

const normalizar = (s: string) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const VACIAS = new Set([
  'de', 'del', 'la', 'las', 'los', 'el', 'en', 'y', 'e', 'para', 'por', 'a', 'con',
  'programa', 'carrera', 'especializacion', 'maestria', 'magister', 'doctorado', 'pregrado',
  'virtual', 'presencial', 'utb',
]);
const palabras = (s: string) => normalizar(s).split(' ').filter((w) => w && !VACIAS.has(w));

/** Siglas o nombres comunes que no comparten palabras con el nombre oficial. */
const ALIAS: Record<string, readonly string[]> = {
  mba: ['maestria-en-administracion'],
  sst: ['especializacion-en-gerencia-de-la-seguridad-y-salud-en-el-trabajo', 'virtual-seguridad-y-salud-trabajo'],
};

function nivelPedido(consulta: string): NivelPrograma | null {
  const n = normalizar(consulta);
  if (/\bespecializacion/.test(n)) return 'especializacion';
  if (/\b(maestria|magister|mba)\b/.test(n)) return 'maestria';
  if (/\bdoctorado/.test(n)) return 'doctorado';
  if (/\b(pregrado|carrera)\b/.test(n)) return 'pregrado';
  return null;
}

/**
 * Programas que corresponden a un nombre escrito por una persona o por la IA
 * ("Maestría en Ciberseguridad", "MBA", "ingeniería de sistemas"). Todas las
 * palabras significativas de la consulta deben estar en el nombre; gana el
 * nombre más parecido y, a igualdad, el del nivel y la modalidad pedidos.
 * Devuelve [] si nada encaja, y varios si la consulta es ambigua.
 */
export function buscarPrograma(consulta: string, niveles?: readonly NivelPrograma[]): ProgramaUtb[] {
  const candidatos = PROGRAMAS_UTB.filter((p) => !niveles || niveles.includes(p.nivel));
  const n = normalizar(consulta);
  if (!n) return [];

  const exacto = candidatos.filter((p) => normalizar(p.nombre) === n);
  if (exacto.length) return exacto;

  const nivel = nivelPedido(consulta);
  const pideVirtual = /\bvirtual\b/.test(n);
  const alias = n.split(' ').flatMap((w) => ALIAS[w] ?? []);

  const q = palabras(consulta);
  const puntuados = candidatos
    .map((p) => {
      let score: number;
      if (alias.includes(p.id)) score = 2;
      else {
        if (!q.length) return null;
        const nombre = new Set(palabras(p.nombre));
        if (!q.every((w) => nombre.has(w))) return null;
        score = q.length / nombre.size;
      }
      if (nivel && p.nivel === nivel) score += 1;
      if (pideVirtual === esVirtual(p)) score += 0.5;
      return { p, score };
    })
    .filter((x): x is { p: ProgramaUtb; score: number } => x !== null)
    .sort((a, b) => b.score - a.score);

  if (!puntuados.length) return [];
  const mejor = puntuados[0].score;
  return puntuados.filter((x) => x.score === mejor).slice(0, 3).map((x) => x.p);
}

// ── Ficha para el asistente IA ──────────────────────────────────────────────

const LIMITE_FICHA = 6000;

function lista(titulo: string, items: readonly string[] | undefined, max = 8): string[] {
  if (!items?.length) return [];
  return [`${titulo}:`, ...items.slice(0, max).map((t) => `- ${t}`)];
}

/** Texto plano con lo publicado del programa, acotado para no inflar el prompt. */
export function fichaPrograma(p: ProgramaUtb): string {
  const valor = valorSemestre(p);
  const lineas = [
    `${p.nombre} (${NOMBRE_NIVEL[p.nivel]}${esVirtual(p) ? ', UTB Virtual' : ''})`,
    `Página oficial: ${p.url}`,
    p.modalidad && `Modalidad: ${p.modalidad}`,
    p.duracion && `Duración: ${p.duracion}`,
    p.numero_asignaturas && `Asignaturas: ${p.numero_asignaturas}`,
    `Valor de matrícula ${VIGENCIA_VALORES}: ${valor ?? 'no publicado; confirmar con la UTB'}`,
    p.titulo_otorgado && `Título que otorga: ${p.titulo_otorgado}`,
    p.escuela && `Escuela: ${p.escuela}`,
    p.snies && `SNIES: ${p.snies}`,
    p.registro_calificado && `Registro calificado: ${p.registro_calificado}`,
    p.acreditacion_alta_calidad && 'Acreditación de alta calidad: sí',
    '',
    ...lista('Descripción', p.descripcion, 3),
    ...lista('Objetivos', p.objetivos, 5),
    ...lista('Qué hace el egresado', p.que_hace, 3),
  ].filter((l): l is string => typeof l === 'string');

  if (p.plan_estudios.length) {
    lineas.push('Plan de estudios:', ...p.plan_estudios.map((s) => `- ${s.periodo}: ${s.asignaturas.join('; ')}`));
  } else {
    lineas.push(...lista('Plan de estudios', p.plan_estudios_texto, 12));
  }
  if (p.plan_estudios_pdf) lineas.push(`Plan de estudios (PDF): ${p.plan_estudios_pdf}`);
  if (p.brochure_pdf) lineas.push(`Brochure (PDF): ${p.brochure_pdf}`);

  lineas.push(
    ...lista('Perfil del egresado', p.perfil_egresado, 10),
    ...lista('Dónde puede trabajar', p.campo_laboral, 8),
    ...lista('Perfil del aspirante', p.perfil_aspirante, 6),
    ...(p.salario ? [`Salario de referencia publicado por la UTB: ${p.salario}`] : []),
    ...(p.profesores.length ? [`Profesores: ${p.profesores.join(', ')}`] : []),
    ...lista('Notas', p.notas, 4),
    `(Datos tomados de las páginas oficiales de la UTB el ${CATALOGO_EXTRAIDO_EN}.)`,
  );

  const texto = lineas.join('\n');
  return texto.length <= LIMITE_FICHA ? texto : `${texto.slice(0, LIMITE_FICHA - 1)}…`;
}
