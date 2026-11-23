/**
 * Lógica pura de la agenda de asesores: disponibilidad, franjas libres y
 * textos con fechas en palabras.
 *
 * No importa Redis, config ni nada que abra un socket: así se prueba entera
 * (ver agendaLogica.test.ts) y la comparten el servicio, WhatsApp y el panel.
 *
 * Hora: America/Bogota es UTC-5 todo el año (Colombia no usa horario de
 * verano), igual que en atencionEquipoService. Por eso las cuentas de zona son
 * una resta fija y no dependen de la zona del servidor ni de ICU.
 */

import type { AreaAgenda } from '../contratos/agenda';

export type { AreaAgenda };

export const AREAS_AGENDA: readonly AreaAgenda[] = ['posgrados', 'pregrado', 'ti'];

export const ETIQUETA_AREA: Record<AreaAgenda, string> = {
  posgrados: 'Posgrados',
  pregrado: 'Pregrado',
  ti: 'Soporte TI',
};

export class AgendaValidacionError extends Error {}

const MIN = 60_000;
const DIA_MS = 24 * 60 * MIN;
const OFFSET_BOGOTA_MS = -5 * 60 * MIN;

/** Un tramo semanal: día 0 (domingo) a 6 (sábado) y horas locales HH:MM. */
export interface Tramo {
  dia: number;
  desde: string;
  hasta: string;
}

/**
 * Bloqueo: vacaciones o día libre. Con solo fechas bloquea los días enteros;
 * con `horaDesde`/`horaHasta` bloquea esas horas en cada día del rango.
 */
export interface Excepcion {
  desde: string;
  hasta: string;
  horaDesde?: string;
  horaHasta?: string;
  motivo?: string;
}

export interface Disponibilidad {
  asesor: string;
  activo: boolean;
  areas: AreaAgenda[];
  /** Duración de cada cita en minutos. */
  duracionMin: number;
  /** Descanso del asesor entre una cita y la siguiente. */
  pausaMin: number;
  semana: Tramo[];
  excepciones: Excepcion[];
  actualizado: number;
}

export interface ConfigAgenda {
  /** No se ofrece lo que empieza en menos de estos minutos. */
  antelacionMin: number;
  /** Citas futuras confirmadas que puede tener un mismo teléfono. */
  maxCitasFuturas: number;
  /** Hasta cuántos días adelante se ofrecen franjas. */
  diasVentana: number;
  /**
   * Días EXTRA (YYYY-MM-DD) en los que nadie atiende (cierres de la universidad…). Los festivos nacionales de
   * Colombia no hace falta escribirlos: se calculan solos (`festivosColombia`).
   */
  festivos: string[];
}

export const CONFIG_AGENDA_DEFAULT: ConfigAgenda = {
  antelacionMin: 120,
  maxCitasFuturas: 2,
  diasVentana: 14,
  festivos: [],
};

/** Mismo formato que HorarioAtencion de atencionEquipoService; es el tope del equipo. */
export interface HorarioEquipo {
  activo: boolean;
  dias: number[];
  desde: string;
  hasta: string;
}

export interface Ocupado {
  inicioMs: number;
  finMs: number;
}

export interface FranjaMs {
  inicioMs: number;
  finMs: number;
}

/* ───────────────────────── Fechas y zona horaria ───────────────────────── */

const HORA_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export function minutosDeHora(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

export function fechaValida(fecha: unknown): fecha is string {
  if (typeof fecha !== 'string' || !FECHA_RE.test(fecha)) return false;
  const [a, m, d] = fecha.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/** Medianoche local de Bogotá de esa fecha, en epoch ms. */
export function inicioDelDia(fecha: string): number {
  const [a, m, d] = fecha.split('-').map(Number);
  return Date.UTC(a, m - 1, d) - OFFSET_BOGOTA_MS;
}

export interface PartesBogota {
  fecha: string;
  /** 0 domingo … 6 sábado */
  dia: number;
  /** minutos desde la medianoche local */
  minutos: number;
}

export function partesBogota(ms: number): PartesBogota {
  const local = new Date(ms + OFFSET_BOGOTA_MS);
  return {
    fecha: local.toISOString().slice(0, 10),
    dia: local.getUTCDay(),
    minutos: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

/** ISO 8601 con zona -05:00, como pide el contrato. */
export function isoBogota(ms: number): string {
  return `${new Date(ms + OFFSET_BOGOTA_MS).toISOString().slice(0, 19)}-05:00`;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Epoch ms de un ISO con zona; NaN si no es un instante válido. */
export function msDeIso(iso: unknown): number {
  if (typeof iso !== 'string' || !ISO_RE.test(iso)) return NaN;
  if (!fechaValida(iso.slice(0, 10))) return NaN;
  return Date.parse(iso);
}

export function sumarDias(fecha: string, dias: number): string {
  return new Date(inicioDelDia(fecha) + dias * DIA_MS + 12 * 60 * MIN + OFFSET_BOGOTA_MS)
    .toISOString().slice(0, 10);
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export function nombreDia(dia: number): string {
  return DIAS[dia] ?? '';
}

/** "3:00 p. m." / "9:30 a. m." — la hora local de Bogotá. */
export function horaEnPalabras(ms: number): string {
  const { minutos } = partesBogota(ms);
  const h24 = Math.floor(minutos / 60);
  const m = minutos % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'a. m.' : 'p. m.'}`;
}

/**
 * "mañana martes 25 de noviembre a las 3:00 p. m." Con `ahoraMs` dice "hoy" y
 * "mañana" cuando corresponde; sin él, siempre la fecha completa.
 */
export function fechaEnPalabras(ms: number, ahoraMs?: number): string {
  const p = partesBogota(ms);
  const [, m, d] = p.fecha.split('-').map(Number);
  let prefijo = '';
  if (ahoraMs !== undefined) {
    const hoy = partesBogota(ahoraMs).fecha;
    if (p.fecha === hoy) prefijo = 'hoy ';
    else if (p.fecha === sumarDias(hoy, 1)) prefijo = 'mañana ';
  }
  const hora = horaEnPalabras(ms);
  const articulo = hora.startsWith('1:') ? 'a la' : 'a las';
  return `${prefijo}${DIAS[p.dia]} ${d} de ${MESES[m - 1]} ${articulo} ${hora}`;
}

/** Solo el día: "martes 25 de noviembre". */
export function diaEnPalabras(ms: number, ahoraMs?: number): string {
  const p = partesBogota(ms);
  const [, m, d] = p.fecha.split('-').map(Number);
  let prefijo = '';
  if (ahoraMs !== undefined) {
    const hoy = partesBogota(ahoraMs).fecha;
    if (p.fecha === hoy) prefijo = 'hoy ';
    else if (p.fecha === sumarDias(hoy, 1)) prefijo = 'mañana ';
  }
  return `${prefijo}${DIAS[p.dia]} ${d} de ${MESES[m - 1]}`;
}

/* ─────────────────────────── Festivos de Colombia ──────────────────────── */

const fechaUTC = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d));
const textoFecha = (f: Date) => f.toISOString().slice(0, 10);
const masDias = (f: Date, n: number) => new Date(f.getTime() + n * DIA_MS);

/** Domingo de Pascua (calendario gregoriano, algoritmo de Meeus/Jones/Butcher). */
export function domingoDePascua(anio: number): string {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return textoFecha(fechaUTC(anio, mes, dia));
}

/** Ley Emiliani (Ley 51 de 1983): el festivo que no cae en lunes se corre al lunes siguiente. */
function alLunes(f: Date): Date {
  const dia = f.getUTCDay();
  return dia === 1 ? f : masDias(f, (8 - dia) % 7);
}

const cacheFestivos = new Map<number, string[]>();

/**
 * Festivos nacionales de Colombia de un año, ordenados: los fijos, los que se corren al lunes (Ley Emiliani) y los
 * que dependen de la Pascua (Jueves y Viernes Santo; Ascensión, Corpus Christi y Sagrado Corazón, corridos al lunes).
 */
export function festivosColombia(anio: number): string[] {
  const guardado = cacheFestivos.get(anio);
  if (guardado) return guardado;
  const fijos = [[1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25]].map(([m, d]) => fechaUTC(anio, m, d));
  const emiliani = [[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]].map(([m, d]) => alLunes(fechaUTC(anio, m, d)));
  const pascua = new Date(`${domingoDePascua(anio)}T00:00:00Z`);
  const deSemanaSanta = [-3, -2].map((n) => masDias(pascua, n));
  // Ascensión (+39), Corpus Christi (+60) y Sagrado Corazón (+68) caen en jueves/viernes y se corren al lunes.
  const corridos = [39, 60, 68].map((n) => alLunes(masDias(pascua, n)));
  const lista = [...new Set([...fijos, ...emiliani, ...deSemanaSanta, ...corridos].map(textoFecha))].sort();
  cacheFestivos.set(anio, lista);
  return lista;
}

/** Festivos nacionales entre dos fechas AAAA-MM-DD (incluidas). */
export function festivosColombiaEntre(desde: string, hasta: string): string[] {
  const salida: string[] = [];
  for (let a = Number(desde.slice(0, 4)); a <= Number(hasta.slice(0, 4)); a++) {
    salida.push(...festivosColombia(a).filter((f) => f >= desde && f <= hasta));
  }
  return salida;
}

export function esFestivoColombia(fecha: string): boolean {
  return fechaValida(fecha) && festivosColombia(Number(fecha.slice(0, 4))).includes(fecha);
}

/* ───────────────────────────── Validaciones ────────────────────────────── */

function esObjeto(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function textoCorto(v: unknown, max: number, campo: string): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || v.length > max) throw new AgendaValidacionError(`${campo} no puede superar ${max} caracteres.`);
  return v.trim() || undefined;
}

export function disponibilidadVacia(asesor: string): Disponibilidad {
  return {
    asesor,
    activo: false,
    areas: [],
    duracionMin: 30,
    pausaMin: 0,
    semana: [],
    excepciones: [],
    actualizado: 0,
  };
}

/** Devuelve una copia canónica; nunca conserva referencias del cuerpo recibido. */
export function validarDisponibilidad(input: unknown, asesor: string): Disponibilidad {
  if (!esObjeto(input)) throw new AgendaValidacionError('La disponibilidad no es válida.');
  if (typeof input.activo !== 'boolean') throw new AgendaValidacionError('"activo" debe ser verdadero o falso.');

  if (!Array.isArray(input.areas)) throw new AgendaValidacionError('Las áreas deben ser una lista.');
  if (input.areas.some((a) => !AREAS_AGENDA.includes(a as AreaAgenda))) {
    throw new AgendaValidacionError('Un área no es válida (posgrados, pregrado o ti).');
  }
  const areas = [...new Set(input.areas as AreaAgenda[])];
  if (input.activo && !areas.length) throw new AgendaValidacionError('Elige al menos un área para atender.');

  const dur = input.duracionMin;
  if (!Number.isInteger(dur) || (dur as number) < 10 || (dur as number) > 180) {
    throw new AgendaValidacionError('La duración de la cita debe estar entre 10 y 180 minutos.');
  }
  const pausa = input.pausaMin ?? 0;
  if (!Number.isInteger(pausa) || (pausa as number) < 0 || (pausa as number) > 60) {
    throw new AgendaValidacionError('La pausa entre citas debe estar entre 0 y 60 minutos.');
  }

  if (!Array.isArray(input.semana) || input.semana.length > 70) {
    throw new AgendaValidacionError('La semana debe ser una lista de tramos (máximo 70).');
  }
  const semana: Tramo[] = input.semana.map((t) => {
    if (!esObjeto(t)) throw new AgendaValidacionError('Un tramo de la semana no es válido.');
    if (!Number.isInteger(t.dia) || (t.dia as number) < 0 || (t.dia as number) > 6) {
      throw new AgendaValidacionError('El día de un tramo debe ser un número entre 0 (domingo) y 6 (sábado).');
    }
    if (typeof t.desde !== 'string' || !HORA_RE.test(t.desde) || typeof t.hasta !== 'string' || !HORA_RE.test(t.hasta)) {
      throw new AgendaValidacionError('Las horas de un tramo deben tener el formato HH:MM.');
    }
    if (t.desde >= t.hasta) throw new AgendaValidacionError('En un tramo, la hora de inicio debe ser anterior a la de cierre.');
    return { dia: t.dia as number, desde: t.desde, hasta: t.hasta };
  }).sort((a, b) => a.dia - b.dia || a.desde.localeCompare(b.desde));
  for (let i = 1; i < semana.length; i++) {
    if (semana[i].dia === semana[i - 1].dia && semana[i].desde < semana[i - 1].hasta) {
      throw new AgendaValidacionError('Dos tramos del mismo día no pueden traslaparse.');
    }
  }

  if (input.excepciones !== undefined && (!Array.isArray(input.excepciones) || input.excepciones.length > 200)) {
    throw new AgendaValidacionError('Las excepciones deben ser una lista (máximo 200).');
  }
  const excepciones: Excepcion[] = ((input.excepciones ?? []) as unknown[]).map((e) => {
    if (!esObjeto(e)) throw new AgendaValidacionError('Una excepción no es válida.');
    if (!fechaValida(e.desde) || !fechaValida(e.hasta)) {
      throw new AgendaValidacionError('Las fechas de una excepción deben tener el formato AAAA-MM-DD y existir.');
    }
    if (e.desde > e.hasta) throw new AgendaValidacionError('En una excepción, la fecha inicial no puede ser posterior a la final.');
    const out: Excepcion = { desde: e.desde, hasta: e.hasta };
    const tieneHoras = e.horaDesde !== undefined || e.horaHasta !== undefined;
    if (tieneHoras) {
      if (typeof e.horaDesde !== 'string' || !HORA_RE.test(e.horaDesde) || typeof e.horaHasta !== 'string' || !HORA_RE.test(e.horaHasta)) {
        throw new AgendaValidacionError('Las horas de una excepción deben tener el formato HH:MM.');
      }
      if (e.horaDesde >= e.horaHasta) throw new AgendaValidacionError('En una excepción, la hora de inicio debe ser anterior a la de cierre.');
      out.horaDesde = e.horaDesde;
      out.horaHasta = e.horaHasta;
    }
    const motivo = textoCorto(e.motivo, 120, 'El motivo');
    if (motivo) out.motivo = motivo;
    return out;
  });

  return { asesor, activo: input.activo, areas, duracionMin: dur as number, pausaMin: pausa as number, semana, excepciones, actualizado: Date.now() };
}

export function validarConfigAgenda(input: unknown): ConfigAgenda {
  if (!esObjeto(input)) throw new AgendaValidacionError('La configuración de la agenda no es válida.');
  const { antelacionMin, maxCitasFuturas, diasVentana } = input;
  if (!Number.isInteger(antelacionMin) || (antelacionMin as number) < 0 || (antelacionMin as number) > 7 * 24 * 60) {
    throw new AgendaValidacionError('La antelación mínima debe estar entre 0 y 10080 minutos.');
  }
  if (!Number.isInteger(maxCitasFuturas) || (maxCitasFuturas as number) < 1 || (maxCitasFuturas as number) > 10) {
    throw new AgendaValidacionError('El máximo de citas futuras por teléfono debe estar entre 1 y 10.');
  }
  if (!Number.isInteger(diasVentana) || (diasVentana as number) < 1 || (diasVentana as number) > 60) {
    throw new AgendaValidacionError('La ventana de días debe estar entre 1 y 60.');
  }
  const festivosIn = input.festivos ?? [];
  if (!Array.isArray(festivosIn) || festivosIn.length > 400 || festivosIn.some((f) => !fechaValida(f))) {
    throw new AgendaValidacionError('Los festivos deben ser fechas AAAA-MM-DD válidas.');
  }
  return {
    antelacionMin: antelacionMin as number,
    maxCitasFuturas: maxCitasFuturas as number,
    diasVentana: diasVentana as number,
    festivos: [...new Set(festivosIn as string[])].sort(),
  };
}

/* ───────────────────────────── Franjas libres ──────────────────────────── */

/**
 * Dos citas del mismo asesor chocan si se traslapan o si no dejan la pausa
 * entre ellas. Una que termina justo cuando empieza otra NO choca con pausa 0.
 */
export function chocan(a: FranjaMs, b: FranjaMs, pausaMs: number): boolean {
  return a.inicioMs < b.finMs + pausaMs && b.inicioMs < a.finMs + pausaMs;
}

export interface ParamsFranjas {
  disp: Disponibilidad;
  ocupados: Ocupado[];
  ahoraMs: number;
  /** Primer instante que interesa (incluido). */
  desdeMs: number;
  /** Último instante de inicio que interesa (excluido). */
  hastaMs: number;
  antelacionMin: number;
  festivos: string[];
  horarioEquipo?: HorarioEquipo | null;
  /** Para validar una reserva: ignora las citas ocupadas y mira solo si encaja en la disponibilidad. */
  ignorarOcupados?: boolean;
}

function bloqueado(fecha: string, ini: number, fin: number, disp: Disponibilidad, festivos: string[]): boolean {
  // Los festivos nacionales siempre; la configuración solo agrega días.
  if (esFestivoColombia(fecha) || festivos.includes(fecha)) return true;
  for (const e of disp.excepciones) {
    if (fecha < e.desde || fecha > e.hasta) continue;
    if (!e.horaDesde || !e.horaHasta) return true;
    if (ini < minutosDeHora(e.horaHasta) && minutosDeHora(e.horaDesde) < fin) return true;
  }
  return false;
}

/** Franjas reales de UN asesor: su semana, menos excepciones, equipo, pasado, antelación y citas. */
export function calcularFranjasAsesor(p: ParamsFranjas): FranjaMs[] {
  const { disp } = p;
  if (!disp.activo || !disp.semana.length || !disp.areas.length) return [];
  const durMs = disp.duracionMin * MIN;
  const pausaMs = disp.pausaMin * MIN;
  const minimoMs = Math.max(p.desdeMs, p.ahoraMs + p.antelacionMin * MIN);
  if (p.hastaMs <= minimoMs) return [];

  const salida: FranjaMs[] = [];
  const primerDia = partesBogota(minimoMs).fecha;
  const ultimoDia = partesBogota(p.hastaMs - 1).fecha;
  for (let fecha = primerDia; fecha <= ultimoDia; fecha = sumarDias(fecha, 1)) {
    const base = inicioDelDia(fecha);
    const dia = partesBogota(base + 12 * 60 * MIN).dia;
    if (p.horarioEquipo?.activo && !p.horarioEquipo.dias.includes(dia)) continue;
    for (const tramo of disp.semana) {
      if (tramo.dia !== dia) continue;
      let desdeMin = minutosDeHora(tramo.desde);
      let hastaMin = minutosDeHora(tramo.hasta);
      // El horario del equipo es un tope: la agenda nunca se sale de él.
      if (p.horarioEquipo?.activo) {
        desdeMin = Math.max(desdeMin, minutosDeHora(p.horarioEquipo.desde));
        hastaMin = Math.min(hastaMin, minutosDeHora(p.horarioEquipo.hasta));
      }
      for (let s = desdeMin; s + disp.duracionMin <= hastaMin; s += disp.duracionMin + disp.pausaMin) {
        const inicioMs = base + s * MIN;
        if (inicioMs < minimoMs || inicioMs >= p.hastaMs) continue;
        if (bloqueado(fecha, s, s + disp.duracionMin, disp, p.festivos)) continue;
        const franja = { inicioMs, finMs: inicioMs + durMs };
        if (!p.ignorarOcupados && p.ocupados.some((o) => chocan(franja, o, pausaMs))) continue;
        salida.push(franja);
      }
    }
  }
  return salida.sort((a, b) => a.inicioMs - b.inicioMs);
}

/**
 * Elige `n` franjas variadas: primero la más temprana de cada día distinto y,
 * si faltan, las siguientes en orden. Así la persona ve opciones en días
 * distintos y no tres horas pegadas del mismo día.
 */
export function elegirVariadas<T extends { inicio: string }>(franjas: T[], n: number): T[] {
  const porDia = new Set<string>();
  const elegidas: T[] = [];
  for (const f of franjas) {
    const dia = f.inicio.slice(0, 10);
    if (porDia.has(dia)) continue;
    porDia.add(dia);
    elegidas.push(f);
    if (elegidas.length === n) break;
  }
  for (const f of franjas) {
    if (elegidas.length >= n) break;
    if (!elegidas.includes(f)) elegidas.push(f);
  }
  return elegidas.sort((a, b) => a.inicio.localeCompare(b.inicio)).slice(0, n);
}

/* ───────────────────────────── Recordatorios ───────────────────────────── */

export interface RecordatorioCita {
  tipo: '24h' | '1h';
  /** Cuándo debe salir (epoch ms). */
  cuandoMs: number;
}

export const VENTANA_WHATSAPP_MS = 24 * 60 * MIN;
const MARGEN_VENTANA_MS = 5 * MIN;

/**
 * Qué recordatorios corresponde programar para una cita y cuáles quedan sin
 * programar por la ventana de 24 h de WhatsApp.
 *
 * Con Meta Cloud el texto libre solo vale dentro de las 24 h siguientes al
 * ÚLTIMO MENSAJE ENTRANTE de la persona (la marca de `activity:<tel>`, la misma
 * que usa Conversaciones), no al momento de la reserva: una cita que agenda un
 * asesor desde el panel, o por llamada, puede no tener ventana abierta. Sin
 * mensaje entrante conocido no hay ventana. Lo que no cabe necesita una
 * plantilla aprobada: queda «sin recordatorio» (ver docs/agenda-asesores.md).
 * Con Evolution (Baileys) no hay ventana.
 */
export function planearRecordatorios(opts: {
  inicioMs: number;
  ahoraMs: number;
  /** Último mensaje de la persona por WhatsApp (epoch ms) o null si no se conoce. */
  ultimoEntranteMs: number | null;
  adaptador: 'meta' | 'evolution';
}): { programar: RecordatorioCita[]; sinVentana: RecordatorioCita[] } {
  const candidatos: RecordatorioCita[] = [
    { tipo: '24h', cuandoMs: opts.inicioMs - 24 * 60 * MIN },
    { tipo: '1h', cuandoMs: opts.inicioMs - 60 * MIN },
  ];
  const cierraVentana = opts.ultimoEntranteMs === null ? -Infinity : opts.ultimoEntranteMs + VENTANA_WHATSAPP_MS - MARGEN_VENTANA_MS;
  const programar: RecordatorioCita[] = [];
  const sinVentana: RecordatorioCita[] = [];
  for (const c of candidatos) {
    // Debe quedar en el futuro con margen para que el worker lo alcance.
    if (c.cuandoMs < opts.ahoraMs + 2 * MIN) continue;
    if (opts.adaptador === 'meta' && c.cuandoMs > cierraVentana) {
      sinVentana.push(c);
    } else {
      programar.push(c);
    }
  }
  return { programar, sinVentana };
}
