/**
 * Catálogo de recursos académicos oficiales de la UTB.
 *
 * QUÉ ES REAL AQUÍ:
 *   Las URLs y las descripciones de cada plataforma NO son inventadas: salen de
 *   `src/services/knowledgeBaseTI.ts` (base de conocimiento del soporte TI de la
 *   universidad, que ya se usaba para responder preguntas sobre estas mismas
 *   plataformas) y de los enlaces institucionales que ya usaban otros flujos.
 *
 * QUÉ *NO* HACE ESTO:
 *   Las notas ya se consultan en el flujo protegido `notas.ts`. Horarios y tareas
 *   todavía requieren entrar al portal institucional; este catálogo indica al
 *   estudiante dónde hacerlo y con qué credenciales.
 *
 *   El día que exista una integración real, la costura está definida abajo en
 *   `AcademicoProvider`: se implementa ese contrato y los flujos pasan a mostrar
 *   el dato en vez del enlace, sin reescribir la navegación.
 *   Ver PENDIENTES_PANEL_ASESORES.md (sección 1).
 */

export type AreaRecurso = 'pregrado' | 'posgrado' | 'ambos';

export interface RecursoAcademico {
  /** Identificador estable — se usa en métricas (`academico_<id>`). */
  id: string;
  emoji: string;
  titulo: string;
  /** Una línea, se muestra en la lista del menú de WhatsApp (máx ~72 chars). */
  resumen: string;
  url: string;
  /** Qué va a encontrar el estudiante ahí dentro. */
  queEncuentras: string[];
  /** Con qué credenciales entra (o null si es público). */
  acceso: string | null;
  area: AreaRecurso;
}

export const RECURSOS_ACADEMICOS: RecursoAcademico[] = [
  {
    id: 'notas',
    emoji: '📊',
    titulo: 'Mis notas',
    resumen: 'Calificaciones oficiales en el autoservicio',
    url: 'https://autoservicio4prod.utb.edu.co',
    queEncuentras: [
      'Calificaciones parciales y definitivas por asignatura',
      'Historial académico y promedio acumulado',
    ],
    acceso: 'Código estudiantil + contraseña institucional UTB',
    area: 'ambos',
  },
  {
    id: 'horario',
    emoji: '🗓️',
    titulo: 'Mi horario de clases',
    resumen: 'Horario y asignaturas inscritas',
    url: 'https://autoservicio4prod.utb.edu.co',
    queEncuentras: [
      'Las asignaturas que tienes inscritas este periodo',
      'Días, horas y salones de cada clase',
    ],
    acceso: 'Código estudiantil + contraseña institucional UTB',
    area: 'ambos',
  },
  {
    id: 'savio',
    emoji: '📚',
    titulo: 'Mis cursos y tareas (Savio)',
    resumen: 'Aulas virtuales, entregas y fechas límite',
    url: 'https://savio.utb.edu.co/my/',
    queEncuentras: [
      'Tus cursos virtuales con el material de clase',
      'Tareas pendientes con su fecha de entrega',
      'Foros y anuncios de tus profesores',
    ],
    acceso: 'Usuario y contraseña institucional UTB',
    area: 'ambos',
  },
  {
    id: 'calendario',
    emoji: '📅',
    titulo: 'Calendario académico',
    resumen: 'Fechas clave del periodo',
    url: 'https://www.utb.edu.co/la-utb/directivas/secretaria-general/registro-academico/calendario-academico/',
    queEncuentras: [
      'Inicio y fin de clases, y de cada corte',
      'Fechas de matrícula, adiciones y cancelaciones',
      'Semana de exámenes y periodos de vacaciones',
    ],
    acceso: null,
    area: 'ambos',
  },
  {
    id: 'recibo',
    emoji: '🧾',
    titulo: 'Recibos y estado financiero',
    resumen: 'Portal Iceberg: recibos y pagos',
    url: 'https://iceberg-niif.utb.edu.co/iceberg-pf/',
    queEncuentras: [
      'Tu recibo de matrícula en PDF',
      'Pagos realizados y créditos vigentes',
    ],
    acceso: 'Código estudiantil + cédula',
    area: 'ambos',
  },
  {
    id: 'correo',
    emoji: '✉️',
    titulo: 'Correo institucional',
    resumen: 'Office 365 (@utb.edu.co)',
    url: 'https://outlook.office.com',
    queEncuentras: [
      'Comunicados oficiales de la universidad',
      'Acceso a Teams y al resto de Office 365',
    ],
    acceso: 'Tu correo @utb.edu.co o @utbvirtual.edu.co',
    area: 'ambos',
  },
  {
    id: 'becas',
    emoji: '🎁',
    titulo: 'Becas y apoyo financiero',
    resumen: 'Convocatorias, descuentos y crédito',
    url: 'https://www.utb.edu.co/apoyo-financiero/becas/',
    queEncuentras: [
      'Becas y descuentos vigentes con sus requisitos',
      'Opciones de crédito educativo (incluido ICETEX)',
    ],
    acceso: null,
    area: 'ambos',
  },
  {
    id: 'derechos',
    emoji: '💳',
    titulo: 'Costos y derechos pecuniarios',
    resumen: 'Valores oficiales del periodo',
    url: 'https://www.utb.edu.co/la-utb/derechos-pecuniarios/',
    queEncuentras: [
      'Valor de matrícula y de otros trámites',
      'Costos de certificados, supletorios y homologaciones',
    ],
    acceso: null,
    area: 'ambos',
  },
];

export function getRecursos(area: AreaRecurso = 'ambos'): RecursoAcademico[] {
  if (area === 'ambos') return RECURSOS_ACADEMICOS;
  return RECURSOS_ACADEMICOS.filter((r) => r.area === 'ambos' || r.area === area);
}

export function getRecurso(id: string): RecursoAcademico | undefined {
  return RECURSOS_ACADEMICOS.find((r) => r.id === id);
}

/**
 * COSTURA DE INTEGRACIÓN FUTURA — hoy NO tiene implementación, y eso es
 * deliberado: no existe un sistema contra el cual consultar desde este repo.
 *
 * Cuando la universidad exponga una API académica (o se autorice un scraping
 * autenticado como el que `src/services/icebergService.ts` ya hace contra el
 * portal financiero con Playwright), se implementa este contrato en un
 * `academicoService.ts` y el flujo `src/flows/academico.ts` pasa a mostrar el
 * dato real donde hoy entrega el enlace. NO implementar esto con datos
 * simulados: un estudiante tomando decisiones con una nota inventada es un
 * daño real, no un detalle de UI.
 */
export interface AcademicoProvider {
  getNotas(codigoEstudiantil: string): Promise<Array<{ asignatura: string; nota: number; corte: string }>>;
  getHorario(codigoEstudiantil: string): Promise<Array<{ asignatura: string; dia: string; hora: string; salon: string }>>;
  getPendientes(codigoEstudiantil: string): Promise<Array<{ titulo: string; curso: string; venceEn: string }>>;
}
