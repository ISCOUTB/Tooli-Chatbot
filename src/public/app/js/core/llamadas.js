/* Utilidades puras de la pantalla Llamadas (línea de voz). Sin DOM: se prueban
   con node:test en llamadas.test.js. */

const RESULTADOS = {
  en_curso: { label: 'En curso', color: '#2f6fd6' },
  consulta: { label: 'Consulta resuelta', color: '#15803d' },
  datos_estudiante: { label: 'Datos del estudiante', color: '#15803d' },
  cita: { label: 'Cita agendada', color: '#0f766e' },
  transferida: { label: 'Pasó a un asesor', color: '#003087' },
  devolver_llamada: { label: 'Pidió devolución', color: '#b45309' },
  sin_cupo: { label: 'Sin minutos', color: '#c5221f' },
  fuera_de_horario: { label: 'Fuera de horario', color: '#64748b' },
  colgo: { label: 'Colgó', color: '#64748b' },
  silencio: { label: 'En silencio', color: '#64748b' },
  error: { label: 'Se cortó', color: '#c5221f' },
};

export function resultadoLlamada(clave) {
  return RESULTADOS[clave] ?? { label: String(clave ?? '—'), color: '#64748b' };
}

/** 0 → «0:00», 65 → «1:05». */
export function duracionCorta(seg) {
  const s = Math.max(0, Math.round(Number(seg) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Porcentaje de uso de un tope (0-100, entero). Tope 0 = 100 % (sin cupo). */
export function porcentajeUso(usado, tope) {
  const t = Number(tope) || 0;
  if (t <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round(((Number(usado) || 0) / t) * 100)));
}

const DIAS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

/** Horario de asesores a texto editable: «L M X J V 08:00-18:00» por línea. */
export function horarioATexto(franjas) {
  return (franjas ?? []).map(f => `${f.dias.map(d => DIAS[d]).join(' ')} ${f.desde}-${f.hasta}`).join('\n');
}

/** Texto editable a franjas. Las líneas que no se entienden se devuelven en `errores`. */
export function textoAHorario(texto) {
  const franjas = [];
  const errores = [];
  for (const linea of String(texto ?? '').split('\n').map(l => l.trim()).filter(Boolean)) {
    const m = linea.toUpperCase().match(/^([DLMXJVS](?:[\s,]+[DLMXJVS])*)\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
    if (!m) { errores.push(linea); continue; }
    const dias = [...new Set(m[1].split(/[\s,]+/).map(d => DIAS.indexOf(d)))].sort((a, b) => a - b);
    franjas.push({ dias, desde: m[2], hasta: m[3] });
  }
  return { franjas, errores };
}

/** Qué rol tiene cada línea de la transcripción en el simulador. */
export function rolLinea(r) {
  return r === 'c' ? 'Persona' : r === 's' ? 'Sistema' : 'Línea';
}
