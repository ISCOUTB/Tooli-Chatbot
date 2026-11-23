// Minutos, tope y costo estimado de las llamadas. Portado tal cual de FastFood (src/lib/voice/caps.ts). Puro.

export interface VoiceCapSettings {
  dailyMinutesCap: number;
  monthlyMinutesCap: number;
  maxCallMinutes: number;
  costPerMinuteUsd: number;
}

export interface CallUsageRow {
  status: 'active' | 'ended';
  allowedMinutes: number;
  billedMinutes: number;
}

/** Los proveedores cobran por minuto empezado: 61 s = 2 min. 0 s (no contestada) = 0. */
export function billedMinutes(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  return Math.ceil(durationSeconds / 60);
}

export function estimatedCostUsd(durationSeconds: number, costPerMinuteUsd: number): number {
  return Math.round(billedMinutes(durationSeconds) * Math.max(0, costPerMinuteUsd) * 10000) / 10000;
}

/** Minutos usados: las llamadas en curso apartan sus minutos máximos; las cerradas cuentan lo cobrado. */
export function usedMinutes(rows: CallUsageRow[]): number {
  return rows.reduce((sum, r) => sum + (r.status === 'active' ? r.allowedMinutes : r.billedMinutes), 0);
}

/** Minutos que puede durar una llamada nueva (0 = sin cupo: no se contesta con IA). */
export function allowedMinutesForNewCall(settings: VoiceCapSettings, usedToday: number, usedThisMonth: number): number {
  const allowed = Math.min(
    settings.maxCallMinutes,
    settings.dailyMinutesCap - usedToday,
    settings.monthlyMinutesCap - usedThisMonth
  );
  return allowed >= 1 ? Math.floor(allowed) : 0;
}

/** ¿Ya hay que despedirse? Se avisa 30 s antes del tope de la llamada. */
export function shouldWrapUp(startedAtMs: number, allowedMinutes: number, nowMs: number = Date.now()): boolean {
  return nowMs - startedAtMs >= allowedMinutes * 60_000 - 30_000;
}

export function formatUsd(value: number): string {
  return `US$ ${value.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Tasa de referencia para mostrar el costo en pesos (el proveedor cobra en dólares). Solo orientativa. */
export const VOICE_COP_PER_USD = 4000;

/** «≈ $ 168.000» a partir de dólares, con la tasa de referencia. Redondea a la centena. */
export function formatUsdAsCop(usd: number, rate: number = VOICE_COP_PER_USD): string {
  const cop = Math.round((Math.max(0, usd) * rate) / 100) * 100;
  return `≈ $ ${cop.toLocaleString('es-CO')}`;
}
