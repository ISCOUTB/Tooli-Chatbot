import type { Corte } from './tipos';

/**
 * Cálculos de notas. La regla de la UTB NO está documentada en la base de
 * conocimiento del bot (src/services/knowledgeBase*.ts no trae nota mínima ni
 * pesos de cortes), así que es PARAMETRIZABLE y estos son los valores por
 * defecto, SIN CONFIRMAR con Registro Académico:
 *   - escala 0.0 a 5.0
 *   - nota mínima aprobatoria 3.0              (TOOLI_NOTA_MINIMA)
 *   - tres cortes que pesan 30 %, 30 % y 40 %  (TOOLI_CORTES_PESOS="30,30,40")
 * Confirmarlos con la universidad (y poner TOOLI_REGLA_NOTAS_CONFIRMADA=1)
 * antes de presentar «cuánto necesitas» como un dato oficial.
 */

export interface ReglaNotas {
  notaMinima: number;
  notaMaxima: number;
  /** Pesos por defecto de los cortes, en porcentaje. */
  pesosCortes: number[];
  /** true mientras nadie haya confirmado la regla con la UTB. */
  sinConfirmar: boolean;
}

export function reglaNotas(env: NodeJS.ProcessEnv = process.env): ReglaNotas {
  const min = Number(env.TOOLI_NOTA_MINIMA);
  const pesos = (env.TOOLI_CORTES_PESOS ?? '')
    .split(',').map((p) => Number(p.trim())).filter((p) => Number.isFinite(p) && p > 0);
  const sumaOk = pesos.length > 0 && Math.abs(pesos.reduce((a, b) => a + b, 0) - 100) < 0.001;
  return {
    notaMinima: Number.isFinite(min) && min > 0 && min <= 5 ? min : 3.0,
    notaMaxima: 5.0,
    pesosCortes: sumaOk ? pesos : [30, 30, 40],
    sinConfirmar: env.TOOLI_REGLA_NOTAS_CONFIRMADA !== '1',
  };
}

const redondear = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d;

/** Promedio aritmético de notas válidas (0 a 5). null si no hay ninguna. */
export function promedio(notas: Array<number | string | undefined | null>, maxima = 5): number | null {
  const validas = notas
    .map((n) => (typeof n === 'number' ? n : (n == null || String(n).trim() === '' ? NaN : Number(String(n).replace(',', '.')))))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= maxima);
  if (validas.length === 0) return null;
  return redondear(validas.reduce((a, b) => a + b, 0) / validas.length);
}

export interface AvanceCortes {
  /** Puntos de la definitiva ya ganados (nota*peso/100 de los cortes con nota). */
  acumulado: number;
  pesoCursado: number;
  pesoPendiente: number;
  /** Promedio ponderado de lo ya cursado, sobre 5. null si no hay cortes con nota. */
  promedioCursado: number | null;
}

export function avanceCortes(cortes: Corte[]): AvanceCortes {
  const conNota = cortes.filter((c) => typeof c.nota === 'number' && Number.isFinite(c.nota));
  const pesoCursado = conNota.reduce((a, c) => a + c.peso, 0);
  const pesoTotal = cortes.reduce((a, c) => a + c.peso, 0);
  const acumulado = conNota.reduce((a, c) => a + (c.nota as number) * c.peso / 100, 0);
  return {
    acumulado: redondear(acumulado),
    pesoCursado,
    pesoPendiente: Math.max(0, redondear(pesoTotal - pesoCursado)),
    promedioCursado: pesoCursado > 0 ? redondear(acumulado * 100 / pesoCursado) : null,
  };
}

export type Necesario =
  | { caso: 'ya_aprobada'; necesaria: number }
  | { caso: 'posible'; necesaria: number }
  | { caso: 'imposible'; necesaria: number }
  | { caso: 'sin_pendientes'; definitiva: number }
  | { caso: 'sin_datos' };

/**
 * Cuánto hay que sacar en lo que falta (el final u otros cortes pendientes, todos
 * con la MISMA nota) para llegar a la nota mínima.
 */
export function necesarioParaPasar(
  cortes: Corte[],
  regla: Pick<ReglaNotas, 'notaMinima' | 'notaMaxima'>,
): Necesario {
  if (cortes.length === 0) return { caso: 'sin_datos' };
  const { acumulado, pesoPendiente } = avanceCortes(cortes);
  if (pesoPendiente <= 0) return { caso: 'sin_pendientes', definitiva: redondear(acumulado) };
  const necesaria = redondear((regla.notaMinima - acumulado) / (pesoPendiente / 100));
  if (necesaria <= 0) return { caso: 'ya_aprobada', necesaria: 0 };
  if (necesaria > regla.notaMaxima + 1e-9) return { caso: 'imposible', necesaria };
  return { caso: 'posible', necesaria };
}

/** Arma los cortes con los pesos de la regla a partir de las notas ya sacadas: [3.5, 4] -> 30/30/40. */
export function cortesDesdeNotas(notas: number[], regla: Pick<ReglaNotas, 'pesosCortes'>): Corte[] {
  return regla.pesosCortes.map((peso, i) => ({
    nombre: i === regla.pesosCortes.length - 1 ? 'Final' : `Corte ${i + 1}`,
    peso,
    ...(i < notas.length ? { nota: notas[i] } : {}),
  }));
}

/** "3.5 4,0" o "3.5, 4" -> [3.5, 4]. Descarta lo que no sea nota válida (0 a 5). */
export function leerNotasEscritas(texto: string): number[] {
  return (texto.match(/\d+(?:[.,]\d+)?/g) ?? [])
    .map((n) => Number(n.replace(',', '.')))
    .filter((n) => n >= 0 && n <= 5);
}
