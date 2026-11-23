// Lo que ve el panel de una llamada. Puro. El teléfono va enmascarado salvo para admin; el estado interno del diálogo
// (huella del código, franjas) nunca sale.
import { maskPhone } from '../services/logSafe';
import { bogotaClock } from './horario';
import type { LineaTranscripcion, LlamadaVoz } from './tipos';

export function vistaLlamada(l: LlamadaVoz, admin: boolean) {
  return {
    id: l.id,
    telefono: admin ? l.telefono : maskPhone(l.telefono),
    simulada: l.simulada,
    estado: l.estado,
    resultado: l.resultado,
    iniciada: l.iniciada,
    duracionSeg: l.duracionSeg,
    minutosCobrados: l.minutosCobrados,
    costoUsd: l.costoUsd,
    resumen: l.resumen,
    verificado: Boolean(l.dialogo.verificado),
    devolucionHecha: l.devolucionHecha,
    devolucionNota: l.devolucionNota,
    devolucionPor: l.devolucionPor,
  };
}

/** En la transcripción de una llamada REAL no se muestran códigos de 6 dígitos que la persona dictó. */
export function vistaTranscripcion(lineas: readonly LineaTranscripcion[], simulada: boolean): LineaTranscripcion[] {
  if (simulada) return [...lineas];
  return lineas.map((x) => (x.r === 'c' ? { ...x, t: x.t.replace(/(\d[\s-]?){6}/g, '••••••') } : x));
}

/** Costo del mes (USD) de las llamadas reales iniciadas en el mes de Colombia actual. */
export function costoMesUsd(rows: readonly LlamadaVoz[], now: Date = new Date()): number {
  const mes = bogotaClock(now).month;
  const total = rows.filter((l) => !l.simulada && l.usoMes === mes).reduce((s, l) => s + (Number(l.costoUsd) || 0), 0);
  return Math.round(total * 10000) / 10000;
}
