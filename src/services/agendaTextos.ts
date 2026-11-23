/**
 * Textos de la agenda para WhatsApp. Puros: reciben la cita y devuelven texto.
 * Los usan el flujo del bot, los recordatorios y el panel (vista previa).
 */

import type { Cita } from '../contratos/agenda';
import { ETIQUETA_AREA, fechaEnPalabras, msDeIso } from './agendaLogica';

export const COMANDO_CANCELAR = 'cancelar cita';
export const COMANDO_REPROGRAMAR = 'reprogramar';
export const COMANDO_MIS_CITAS = 'mis citas';

export function minutosDeCita(cita: Pick<Cita, 'inicio' | 'fin'>): number {
  return Math.round((msDeIso(cita.fin) - msDeIso(cita.inicio)) / 60_000);
}

export function resumenCita(cita: Cita, ahoraMs?: number): string {
  return (
    `📅 ${fechaEnPalabras(msDeIso(cita.inicio), ahoraMs)}\n` +
    `👤 Con ${cita.asesorNombre} · ${ETIQUETA_AREA[cita.area]}\n` +
    `⏱️ Duración: ${minutosDeCita(cita)} min`
  );
}

export function textoConfirmacion(cita: Cita, ahoraMs?: number): string {
  return (
    '✅ *Tu cita quedó confirmada*\n\n' +
    `${resumenCita(cita, ahoraMs)}\n\n` +
    `Para cancelarla escribe *${COMANDO_CANCELAR}*; para cambiar el horario, *${COMANDO_REPROGRAMAR}*; ` +
    `para ver tus citas, *${COMANDO_MIS_CITAS}*.`
  );
}

/** Solo promete el aviso si de verdad quedó un recordatorio programado (`recordatorios` lo anota la agenda). */
export function textoReprogramada(cita: Cita & { recordatorios?: string[] }, ahoraMs?: number): string {
  const aviso = cita.recordatorios?.length ? '\n\nTe avisaremos antes de la hora.' : '';
  return `🔁 *Cambiamos tu cita*\n\n${resumenCita(cita, ahoraMs)}${aviso}`;
}

export function textoRecordatorio(cita: Pick<Cita, 'inicio' | 'fin' | 'asesorNombre' | 'area'>, tipo: '24h' | '1h'): string {
  const cuando = fechaEnPalabras(msDeIso(cita.inicio));
  const cabecera = tipo === '24h' ? '⏰ *Recordatorio:* mañana tienes una cita con un asesor.' : '⏰ *Tu cita es en una hora.*';
  return (
    `${cabecera}\n\n📅 ${cuando}\n👤 Con ${cita.asesorNombre} · ${ETIQUETA_AREA[cita.area]}\n\n` +
    `Si no puedes asistir, escribe *${COMANDO_CANCELAR}* o *${COMANDO_REPROGRAMAR}*.`
  );
}

/** Fila corta para una lista de WhatsApp (el título admite 24 caracteres). */
export function tituloFilaFranja(inicioMs: number): string {
  const ts = fechaEnPalabras(inicioMs);
  // "martes 25 de noviembre a las 3:00 p. m." -> "mar 25 nov · 3:00 p. m."
  const m = /^(\p{L}+) (\d+) de (\p{L}+) a las? (.+)$/u.exec(ts);
  if (!m) return ts.slice(0, 24);
  return `${m[1].slice(0, 3)} ${m[2]} ${m[3].slice(0, 3)} · ${m[4]}`.slice(0, 24);
}
