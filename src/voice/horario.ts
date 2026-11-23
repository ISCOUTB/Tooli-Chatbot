// Horarios de la línea de voz. Portado de FastFood (src/lib/voice/schedule.ts, p110) con el reloj de Colombia propio
// (allá venía de jukebox-dayparts). Puro: lo usan el manejador, la API del panel, el simulador y las pruebas.
//
// Dos cosas distintas:
//   1. Reglas de ruteo (de FastFood): en ciertas horas la llamada pasa DIRECTO a una persona sin gastar minutos de IA.
//   2. Horario de asesores (nuevo en Tooli): cuándo hay alguien para recibir una transferencia en vivo. Fuera de él,
//      «quiero un asesor» agenda una cita o deja la llamada en la cola de devoluciones.

/** Día de la semana (0 = domingo) y minuto del día (0-1439) en hora de Colombia. */
export function bogotaClock(now: Date = new Date()): { weekday: number; minute: number; day: string; month: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Bogota', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const minute = Number(get('hour')) * 60 + Number(get('minute'));
  const day = `${get('year')}-${get('month')}-${get('day')}`;
  return { weekday, minute, day, month: day.slice(0, 7) };
}

export type CallWho = 'ai' | 'person';

export interface ScheduleRule {
  id: string;
  /** 0 = domingo … 6 = sábado. Vacío = todos los días. */
  days: number[];
  /** «HH:MM» en hora de Colombia. */
  from: string;
  to: string;
  who: CallWho;
}

export interface ScheduleRules {
  on: boolean;
  rules: ScheduleRule[];
  otherwise: CallWho;
}

export const SCHEDULE_LIMITS = { rules: 8 } as const;
export const SCHEDULE_OFF: ScheduleRules = { on: false, rules: [], otherwise: 'ai' };

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const;
export const DAY_SHORT = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;

export function newRuleId(taken: readonly string[]): string {
  for (let i = 1; i < 50; i++) {
    const id = `r${i}`;
    if (!taken.includes(id)) return id;
  }
  return `r${Date.now().toString(36).slice(-6)}`;
}

/** Sanea lo que llegue (base de datos o panel). Nunca lanza. */
export function readScheduleRules(raw: unknown): ScheduleRules {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return SCHEDULE_OFF;
  const o = raw as { on?: unknown; rules?: unknown; otherwise?: unknown };
  const rules: ScheduleRule[] = [];
  const seen = new Set<string>();
  if (Array.isArray(o.rules)) {
    for (const r of o.rules) {
      if (!r || typeof r !== 'object') continue;
      const x = r as Record<string, unknown>;
      const id = typeof x.id === 'string' && /^[a-z0-9]{2,12}$/.test(x.id) ? x.id : null;
      if (!id || seen.has(id) || typeof x.from !== 'string' || typeof x.to !== 'string' || !HHMM.test(x.from) || !HHMM.test(x.to) || x.from === x.to) continue;
      if (x.who !== 'ai' && x.who !== 'person') continue;
      const days = Array.isArray(x.days) ? [...new Set(x.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
      seen.add(id);
      rules.push({ id, days: days.length === 7 ? [] : days, from: x.from, to: x.to, who: x.who });
      if (rules.length >= SCHEDULE_LIMITS.rules) break;
    }
  }
  return { on: o.on === true && rules.length > 0, rules, otherwise: o.otherwise === 'person' ? 'person' : 'ai' };
}

function minutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/** La primera regla que cubre ese día y minuto (de 0 a 1439), o null. */
export function matchRule(rules: ScheduleRules, weekday: number, minute: number): ScheduleRule | null {
  if (!rules.on) return null;
  for (const r of rules.rules) {
    const from = minutes(r.from);
    const to = minutes(r.to);
    const inside = from < to ? minute >= from && minute < to : minute >= from || minute < to;
    if (!inside) continue;
    const startDay = from < to || minute >= from ? weekday : (weekday + 6) % 7;
    if (r.days.length === 0 || r.days.includes(startDay)) return r;
  }
  return null;
}

export interface RouteDecision {
  /** Lo que dicen las reglas. */
  who: CallWho;
  /** Lo que hará la llamada de verdad (sin número de desvío no se puede pasar a una persona). */
  effective: CallWho;
  /** Qué regla decidió (null = «en cualquier otro momento» o reglas apagadas). */
  rule: ScheduleRule | null;
  /** Una frase para el panel. */
  reason: string;
}

export function hhmmShort(hhmm: string): string {
  const h = Number(hhmm.slice(0, 2));
  return `${h % 12 || 12}:${hhmm.slice(3, 5)} ${h < 12 ? 'am' : 'pm'}`;
}

export function describeRule(r: ScheduleRule): string {
  const days = r.days.length === 0 ? 'todos los días' : r.days.map((d) => DAY_NAMES[d]).join(', ');
  return `${days}, de ${hhmmShort(r.from)} a ${hhmmShort(r.to)}`;
}

/**
 * Qué hace una llamada que entra en ese día y minuto de Colombia. `hasForward` = el local dejó un número de desvío:
 * sin él, «atiende una persona» no se puede cumplir y la asistente contesta (mejor que dejar la llamada sin atender).
 */
export function decideRoute(rules: ScheduleRules, hasForward: boolean, at: { weekday: number; minute: number }): RouteDecision {
  const hit = matchRule(rules, at.weekday, at.minute);
  const who: CallWho = hit ? hit.who : rules.on ? rules.otherwise : 'ai';
  const effective: CallWho = who === 'person' && !hasForward ? 'ai' : who;
  const base = hit ? `Regla «${describeRule(hit)}»` : rules.on ? 'En cualquier otro momento' : 'Sin horarios inteligentes';
  const reason = `${base}: ${who === 'person' ? 'atiende una persona' : 'atiende la línea automática'}${effective !== who ? ' (no hay número de desvío: contesta la línea automática)' : ''}.`;
  return { who, effective, rule: hit, reason };
}

/** Ahora mismo, con el reloj de Colombia. */
export function decideRouteNow(rules: ScheduleRules, hasForward: boolean, now: Date = new Date()): RouteDecision {
  const { weekday, minute } = bogotaClock(now);
  return decideRoute(rules, hasForward, { weekday, minute });
}

// ------------------------------------------------------------------ horario de asesores (Tooli)

export interface FranjaAsesores {
  /** 0 = domingo … 6 = sábado. */
  dias: number[];
  desde: string;
  hasta: string;
}

/** Por defecto: lunes a viernes de 8:00 a 18:00 y sábado de 8:00 a 12:00 (hora de Colombia). */
export const HORARIO_ASESORES_DEFECTO: FranjaAsesores[] = [
  { dias: [1, 2, 3, 4, 5], desde: '08:00', hasta: '18:00' },
  { dias: [6], desde: '08:00', hasta: '12:00' },
];

export function leerHorarioAsesores(raw: unknown): FranjaAsesores[] {
  if (!Array.isArray(raw)) return HORARIO_ASESORES_DEFECTO;
  const out: FranjaAsesores[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const x = r as Record<string, unknown>;
    if (typeof x.desde !== 'string' || typeof x.hasta !== 'string' || !HHMM.test(x.desde) || !HHMM.test(x.hasta)) continue;
    if (minutes(x.desde) >= minutes(x.hasta)) continue;
    const dias = Array.isArray(x.dias) ? [...new Set(x.dias.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
    if (!dias.length) continue;
    out.push({ dias, desde: x.desde, hasta: x.hasta });
    if (out.length >= 14) break;
  }
  return out;
}

export function asesoresDisponibles(horario: readonly FranjaAsesores[], now: Date = new Date()): boolean {
  const { weekday, minute } = bogotaClock(now);
  return horario.some((f) => f.dias.includes(weekday) && minute >= minutes(f.desde) && minute < minutes(f.hasta));
}
