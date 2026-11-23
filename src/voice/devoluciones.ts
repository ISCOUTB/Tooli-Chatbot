// Cola de «devolver la llamada» y reporte semanal. Portado de FastFood (src/lib/voice/callbacks-report.ts, p109):
// mismas reglas (una por número, la más reciente; se cae de la cola si después lo atendieron o ya se devolvió; un
// «colgó» de menos de 8 s es un marcado por error). Cambian los resultados que resuelven (consulta, datos, cita,
// transferida) y el reporte cuenta consultas y citas en vez de pedidos y ventas. Puro.
import { VOICE_COP_PER_USD } from './caps';
import type { LlamadaVoz } from './tipos';

export const HUMAN_HOURLY_COP_DEFAULT = 12_000;
export const CALLBACK_OUTCOMES = ['devolver_llamada', 'sin_cupo', 'fuera_de_horario', 'colgo', 'error', 'silencio'] as const;
const RESOLVING = new Set(['consulta', 'datos_estudiante', 'cita', 'transferida']);
export const CALLBACK_WINDOW_DAYS = 3;
const MIN_HANGUP_SECONDS = 8;

export interface PendingCallback {
  id: string;
  phone: string;
  outcome: string;
  startedAt: string;
  summary: string | null;
  attempts: number;
}

type Fila = Pick<LlamadaVoz, 'id' | 'simulada' | 'telefono' | 'resultado' | 'iniciada' | 'duracionSeg' | 'resumen' | 'devolucionHecha'>;

const digits = (p: string | null) => (p ?? '').replace(/\D/g, '');

export function pendingCallbacks(rows: readonly Fila[], now: Date = new Date()): PendingCallback[] {
  const since = now.getTime() - CALLBACK_WINDOW_DAYS * 86_400_000;
  const byPhone = new Map<string, Fila[]>();
  for (const r of rows) {
    const key = digits(r.telefono);
    if (r.simulada || key.length < 7 || Date.parse(r.iniciada) < since) continue;
    byPhone.set(key, [...(byPhone.get(key) ?? []), r]);
  }
  const out: PendingCallback[] = [];
  for (const list of byPhone.values()) {
    list.sort((x, y) => Date.parse(y.iniciada) - Date.parse(x.iniciada));
    let attempts = 0;
    let latest: Fila | null = null;
    for (const r of list) {
      if (RESOLVING.has(r.resultado) || r.devolucionHecha) break;
      if (!(CALLBACK_OUTCOMES as readonly string[]).includes(r.resultado)) continue;
      if (r.resultado === 'colgo' && r.duracionSeg < MIN_HANGUP_SECONDS) continue;
      attempts += 1;
      latest ??= r;
    }
    if (latest) out.push({ id: latest.id, phone: latest.telefono, outcome: latest.resultado, startedAt: latest.iniciada, summary: latest.resumen, attempts });
  }
  return out.sort((x, y) => Date.parse(y.startedAt) - Date.parse(x.startedAt));
}

export const OUTCOME_WHY: Record<string, string> = {
  devolver_llamada: 'Pidió que lo llamen',
  sin_cupo: 'Se acabaron los minutos',
  fuera_de_horario: 'Llamó fuera de horario',
  colgo: 'Colgó esperando',
  error: 'Se cortó la llamada',
  silencio: 'Se quedó en silencio',
};

export interface ReportDay { day: string; calls: number; resolved: number }

export interface WeeklyReport {
  days: ReportDay[];
  calls: number;
  /** Resueltas por la asistente sola (consulta o datos del estudiante). */
  handled: number;
  appointments: number;
  transfers: number;
  minutes: number;
  costCop: number;
  humanCop: number;
  savedCop: number;
  hourlyCop: number;
}

type FilaReporte = Pick<LlamadaVoz, 'simulada' | 'resultado' | 'iniciada' | 'duracionSeg' | 'costoUsd'>;

const bogotaDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

export function lastDays(n: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(bogotaDay(now.getTime() - i * 86_400_000));
  return out;
}

export function buildWeeklyReport(rows: readonly FilaReporte[], opts: { hourlyCop?: number | null; now?: Date; days?: number; rate?: number } = {}): WeeklyReport {
  const now = opts.now ?? new Date();
  const list = lastDays(opts.days ?? 7, now);
  const byDay = new Map<string, ReportDay>(list.map((d) => [d, { day: d, calls: 0, resolved: 0 }]));
  let calls = 0, handled = 0, appointments = 0, transfers = 0, seconds = 0, costUsd = 0;
  for (const r of rows) {
    if (r.simulada) continue;
    const d = byDay.get(bogotaDay(Date.parse(r.iniciada)));
    if (!d) continue;
    calls += 1;
    d.calls += 1;
    costUsd += Number(r.costoUsd) || 0;
    if (r.resultado === 'consulta' || r.resultado === 'datos_estudiante' || r.resultado === 'cita') {
      handled += 1;
      d.resolved += 1;
      seconds += Math.max(0, r.duracionSeg || 0);
    }
    if (r.resultado === 'cita') appointments += 1;
    if (r.resultado === 'transferida') transfers += 1;
  }
  const hourly = opts.hourlyCop && opts.hourlyCop > 0 ? opts.hourlyCop : HUMAN_HOURLY_COP_DEFAULT;
  const costCop = Math.round(costUsd * (opts.rate ?? VOICE_COP_PER_USD));
  const humanCop = Math.round((seconds / 3600) * hourly);
  return {
    days: list.map((d) => byDay.get(d) as ReportDay),
    calls, handled, appointments, transfers,
    minutes: Math.round(seconds / 60),
    costCop, humanCop, savedCop: humanCop - costCop, hourlyCop: hourly,
  };
}
