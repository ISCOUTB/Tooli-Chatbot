/* Funciones puras de la pantalla Agenda: fechas de Bogotá, agrupar citas y
   convertir el formulario de disponibilidad. Sin DOM, para poder probarlas.

   Todas las fechas del panel se manejan como texto AAAA-MM-DD en hora de
   Bogotá (UTC-5 todo el año), sin importar la zona del navegador: la agenda
   dice "9:00 a. m." en Bogotá aunque la persona abra el panel desde otro país. */

const OFFSET_MS = -5 * 3600_000;
const DIA_MS = 86_400_000;
const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Orden en que se muestran los días de la semana: lunes primero. */
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];

const ESTADOS_CITA = {
  confirmada: { label: 'Confirmada', color: '#2f6fd6' },
  atendida: { label: 'Atendida', color: '#15803d' },
  no_asistio: { label: 'No asistió', color: '#b45309' },
  cancelada: { label: 'Cancelada', color: '#64748b' },
};

const AREAS = {
  posgrados: 'Posgrados',
  pregrado: 'Pregrado',
  ti: 'Soporte TI',
};

function fechaValida(f) {
  if (typeof f !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  const [a, m, d] = f.split('-').map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/** Fecha de hoy en Bogotá. */
function hoyBogota(ahoraMs = Date.now()) {
  return new Date(ahoraMs + OFFSET_MS).toISOString().slice(0, 10);
}

function sumarDias(fecha, n) {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d) + n * DIA_MS).toISOString().slice(0, 10);
}

/** 0 domingo … 6 sábado. */
function diaSemana(fecha) {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/** El lunes de la semana de esa fecha. */
function lunesDe(fecha) {
  const dia = diaSemana(fecha);
  return sumarDias(fecha, dia === 0 ? -6 : 1 - dia);
}

/** "lun 23 nov" */
function etiquetaDia(fecha) {
  const [, m, d] = fecha.split('-').map(Number);
  return `${DIAS_CORTOS[diaSemana(fecha)]} ${d} ${MESES_CORTOS[m - 1]}`;
}

/** "lunes 23 de noviembre" */
function etiquetaDiaLarga(fecha) {
  const [, m, d] = fecha.split('-').map(Number);
  return `${DIAS_LARGOS[diaSemana(fecha)]} ${d} de ${MESES_LARGOS[m - 1]}`;
}

/** "9:00 a. m." a partir del ISO con zona -05:00 que entrega la API. */
function horaCorta(iso) {
  const [h, m] = String(iso).slice(11, 16).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
}

/** Fecha AAAA-MM-DD de un ISO con zona -05:00. */
function fechaDeIso(iso) {
  return String(iso).slice(0, 10);
}

/** ISO de Bogotá a partir de fecha y hora HH:MM. */
function isoBogota(fecha, hora) {
  return `${fecha}T${hora}:00-05:00`;
}

/** { 'AAAA-MM-DD': [citas ordenadas por hora] } */
function agruparPorDia(citas) {
  const grupos = {};
  for (const c of [...citas].sort((a, b) => a.inicio.localeCompare(b.inicio))) {
    (grupos[fechaDeIso(c.inicio)] ??= []).push(c);
  }
  return grupos;
}

/** Mezcla citas y franjas libres de un día en una sola línea de tiempo. */
function lineaDelDia(citas, franjas) {
  const items = [
    ...citas.map(c => ({ tipo: 'cita', inicio: c.inicio, fin: c.fin, cita: c })),
    ...franjas.map(f => ({ tipo: 'libre', inicio: f.inicio, fin: f.fin, franja: f })),
  ];
  return items.sort((a, b) => a.inicio.localeCompare(b.inicio) || (a.tipo === 'cita' ? -1 : 1));
}

/** Citas que todavía requieren que alguien las marque (ya empezaron y siguen "confirmada"). */
function porMarcar(citas, ahoraMs = Date.now()) {
  return citas.filter(c => c.estado === 'confirmada' && Date.parse(c.inicio) <= ahoraMs);
}

/* ───────────── Formulario de disponibilidad ───────────── */

/** Modelo del formulario a partir de lo que devuelve la API. */
function formDesdeDisponibilidad(d) {
  const dias = {};
  for (const n of ORDEN_DIAS) dias[n] = [];
  for (const t of d?.semana ?? []) dias[t.dia]?.push({ desde: t.desde, hasta: t.hasta });
  return {
    activo: d?.activo === true,
    areas: [...(d?.areas ?? [])],
    duracionMin: d?.duracionMin ?? 30,
    pausaMin: d?.pausaMin ?? 0,
    dias,
    excepciones: (d?.excepciones ?? []).map(e => ({ ...e })),
  };
}

/** Cuerpo del PUT a partir del modelo del formulario. */
function disponibilidadDesdeForm(form) {
  const semana = [];
  for (const n of ORDEN_DIAS) {
    for (const t of form.dias[n] ?? []) semana.push({ dia: n, desde: t.desde, hasta: t.hasta });
  }
  return {
    activo: form.activo === true,
    areas: [...new Set(form.areas)],
    duracionMin: Number(form.duracionMin),
    pausaMin: Number(form.pausaMin) || 0,
    semana,
    excepciones: form.excepciones.map(e => {
      const out = { desde: e.desde, hasta: e.hasta || e.desde };
      if (e.horaDesde && e.horaHasta) { out.horaDesde = e.horaDesde; out.horaHasta = e.horaHasta; }
      if (e.motivo?.trim()) out.motivo = e.motivo.trim();
      return out;
    }),
  };
}

/** Primer problema del formulario, o null. Los mismos límites que valida el servidor. */
function errorDeForm(form) {
  if (form.activo && !form.areas.length) return 'Elige al menos un área para atender.';
  const dur = Number(form.duracionMin);
  if (!Number.isInteger(dur) || dur < 10 || dur > 180) return 'La duración de la cita debe estar entre 10 y 180 minutos.';
  const pausa = Number(form.pausaMin) || 0;
  if (!Number.isInteger(pausa) || pausa < 0 || pausa > 60) return 'La pausa entre citas debe estar entre 0 y 60 minutos.';
  for (const n of ORDEN_DIAS) {
    const tramos = [...(form.dias[n] ?? [])].sort((a, b) => a.desde.localeCompare(b.desde));
    for (let i = 0; i < tramos.length; i++) {
      const t = tramos[i];
      if (!/^\d{2}:\d{2}$/.test(t.desde) || !/^\d{2}:\d{2}$/.test(t.hasta)) return `${DIAS_LARGOS[n]}: completa las horas.`;
      if (t.desde >= t.hasta) return `${DIAS_LARGOS[n]}: la hora de inicio debe ser anterior a la de cierre.`;
      if (i > 0 && t.desde < tramos[i - 1].hasta) return `${DIAS_LARGOS[n]}: dos tramos se traslapan.`;
    }
  }
  for (const e of form.excepciones) {
    if (!fechaValida(e.desde) || !fechaValida(e.hasta || e.desde)) return 'Una excepción tiene una fecha inválida.';
    if ((e.hasta || e.desde) < e.desde) return 'En una excepción, la fecha inicial no puede ser posterior a la final.';
    if ((e.horaDesde || e.horaHasta) && !(e.horaDesde && e.horaHasta && e.horaDesde < e.horaHasta)) return 'En una excepción por horas, el inicio debe ser anterior al cierre.';
  }
  return null;
}

/** Cuántas citas caben en un tramo (para mostrarle al asesor el efecto de su duración). */
function citasPorTramo(tramo, duracionMin, pausaMin) {
  const [h1, m1] = tramo.desde.split(':').map(Number);
  const [h2, m2] = tramo.hasta.split(':').map(Number);
  const total = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (!(total > 0) || !(duracionMin > 0)) return 0;
  return Math.max(0, Math.floor((total + pausaMin) / (duracionMin + pausaMin)));
}

/** Festivos escritos como texto libre (uno por línea o separados por coma). */
function parseFestivos(texto) {
  const partes = String(texto ?? '').split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
  const validos = [...new Set(partes.filter(fechaValida))].sort();
  const invalidos = partes.filter(p => !fechaValida(p));
  return { validos, invalidos };
}

/** Cómo se nombra a la persona de una cita. Sin nombre, el número enmascarado
    solo («****0101») parece un dato roto: se dice que falta el nombre. */
function nombreDeCita(c) {
  const nombre = String(c?.nombre ?? '').trim();
  if (nombre) return nombre;
  return c?.telefonoMasc ? `Sin nombre · ${c.telefonoMasc}` : 'Sin nombre';
}

export {
  AREAS, DIAS_CORTOS, DIAS_LARGOS, ESTADOS_CITA, ORDEN_DIAS,
  agruparPorDia, citasPorTramo, diaSemana, disponibilidadDesdeForm, errorDeForm, etiquetaDia, etiquetaDiaLarga,
  fechaDeIso, fechaValida, formDesdeDisponibilidad, horaCorta, hoyBogota, isoBogota, lineaDelDia, lunesDe,
  nombreDeCita, parseFestivos, porMarcar, sumarDias,
};
