// Lo que ve el panel de una llamada. Puro. El teléfono va enmascarado salvo para admin; el estado interno del diálogo
// (huella del código, franjas) nunca sale.
import { maskPhone } from '../services/logSafe';
import { bogotaClock } from './horario';
import { taparDictadoPartido } from './texto';
import type { LineaTranscripcion, LlamadaVoz } from './tipos';

/**
 * Por qué no se pudo verificar por voz (#35). Los topes del código son por número que llama y por estudiante, por hora y
 * por DÍA, compartidos entre el correo y el WhatsApp: con 10 envíos en un día (incluso pedidos por otra persona con el
 * código de ese estudiante) la verificación por voz queda en pausa hasta 24 h. Se ofrece WhatsApp o un asesor.
 */
export function textoVerificacionNegada(motivo: LlamadaVoz['verificacionNegada']): string | null {
  if (motivo === 'bloqueado') return 'Verificación por voz bloqueada 1 h: se agotaron los intentos del código varias veces.';
  if (motivo === 'tope_dia') {
    return 'Verificación por voz en pausa hasta mañana: se alcanzó el tope del día de códigos (10 al correo o al WhatsApp). El estudiante puede verificarse por WhatsApp o con un asesor.';
  }
  if (motivo === 'espera') {
    return 'Verificación por voz en pausa un rato: se pidieron códigos hace poco (espera de 60 s o tope por hora, menos de 1 h). El estudiante puede verificarse por WhatsApp o con un asesor.';
  }
  return null;
}

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
    verificado: l.verificada || Boolean(l.dialogo.verificado),
    verificacionNegada: l.verificacionNegada,
    verificacionNegadaTexto: textoVerificacionNegada(l.verificacionNegada),
    devolucionHecha: l.devolucionHecha,
    devolucionNota: l.devolucionNota,
    devolucionPor: l.devolucionPor,
  };
}

/**
 * Frases con las que el servicio académico lee datos de un estudiante (turno, recibo, notas, horario, cursos). Desde el
 * arreglo de #33 la transcripción guarda solo «[datos académicos leídos: …]»; esto tapa los registros que quedaron de
 * antes (o cualquier línea que se cuele) en vez de mostrárselos a cualquier asesor durante la retención.
 */
const DATOS_ACADEMICOS = new RegExp([
  'tu turno de (matricula|inscripcion) es', 'te toca el', 'tu recibo de matricula esta', 'no tienes recibos pendientes', 'paga hasta',
  'estas son tus notas', 'tu promedio es', 'necesitas sacar', 'no alcanzas la nota minima', 'todavia no veo notas',
  'tienes clase', 'hoy no tienes clases', 'tu proxima clase', 'no veo clases en tu horario', 'hoy (lunes|martes|miercoles|jueves|viernes|sabado|domingo) tienes',
  'estas inscrito en', 'tareas? proximas?', 'no aparecen cursos asociados', 'no tienes tareas por vencer',
].map((f) => `\\b${f}\\b`).join('|'));

export function pareceDatosAcademicos(texto: string): boolean {
  return DATOS_ACADEMICOS.test(texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
}

/**
 * Lo que ve el panel de una llamada REAL: sin códigos ni números que la persona dictó (también partidos entre frases
 * seguidas suyas, con el mismo lector que los entiende) y sin líneas del bot que lean datos académicos. La simulada se
 * ve completa.
 */
export function vistaTranscripcion(lineas: readonly LineaTranscripcion[], simulada: boolean): LineaTranscripcion[] {
  if (simulada) return [...lineas];
  const deQuienLlama = lineas.map((x, i) => ({ x, i })).filter(({ x }) => x.r === 'c');
  const tapadas = new Map(taparDictadoPartido(deQuienLlama.map(({ x }) => x.t)).map((t, k) => [deQuienLlama[k].i, t]));
  return lineas.map((x, i) => {
    if (x.r === 'c') return { ...x, t: (tapadas.get(i) ?? x.t).replace(/(\d[\s-]?){6}/g, '••••••') };
    if (x.r === 'a' && !x.t.startsWith('[datos académicos leídos') && pareceDatosAcademicos(x.t)) return { ...x, t: '[datos académicos leídos]' };
    return x;
  });
}

/** Costo del mes (USD) de las llamadas reales iniciadas en el mes de Colombia actual. */
export function costoMesUsd(rows: readonly LlamadaVoz[], now: Date = new Date()): number {
  const mes = bogotaClock(now).month;
  const total = rows.filter((l) => !l.simulada && l.usoMes === mes).reduce((s, l) => s + (Number(l.costoUsd) || 0), 0);
  return Math.round(total * 10000) / 10000;
}
