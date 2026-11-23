/**
 * Lee un valor en pesos colombianos de una línea de portal: "$ 8.363.000",
 * "8.363.000,00", "COP 8363000". Devuelve null si no encuentra un valor creíble
 * (se descartan fechas y porcentajes, y todo lo menor a $1.000).
 */
export function leerValorPesos(linea: string): number | null {
  const sinFechas = String(linea ?? '').replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, ' ').replace(/\d+\s*%/g, ' ');
  const candidatos = sinFechas.match(/\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{4,}(?:,\d{1,2})?/g) ?? [];
  const valores = candidatos
    .map((c) => Number(c.replace(/\./g, '').replace(',', '.')))
    .filter((n) => Number.isFinite(n) && n >= 1000);
  return valores.length ? Math.max(...valores) : null;
}

/** 8363000 -> "$8.363.000" (para WhatsApp). */
export function formatearPesos(valor: number): string {
  return `$${String(Math.round(valor)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}
