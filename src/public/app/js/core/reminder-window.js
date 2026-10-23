const VENTANA_META_MS = 24 * 60 * 60 * 1000;

/** Evalúa la ventana de texto libre en el instante del envío programado. */
function estadoVentanaRecordatorio(ultimoEntranteTs, scheduledAt) {
  if (!Number.isFinite(scheduledAt)) return 'sin-fecha';
  if (!Number.isFinite(ultimoEntranteTs)) return 'sin-historial';
  return scheduledAt - ultimoEntranteTs >= VENTANA_META_MS ? 'fuera' : 'dentro';
}

export { estadoVentanaRecordatorio };
