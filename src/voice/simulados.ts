// Implementaciones simuladas de los contratos para el simulador del panel y las pruebas. Nunca tocan datos reales ni
// reservan citas reales: el simulador las usa SIEMPRE, aunque la rama real esté conectada.
import type { AcademicoApi, Estudiante, TipoConsulta } from '../contratos/academico';
import type { AgendaApi, Cita, Franja } from '../contratos/agenda';

export const ESTUDIANTE_EJEMPLO: Estudiante = {
  telefono: '573000000001', email: 'estudiante.ejemplo@utb.edu.co', codigo: 'T00012345', nombre: 'Estudiante de ejemplo', programa: 'Maestría de ejemplo', nivel: 'posgrado',
};

const RESPUESTAS: Record<TipoConsulta, string> = {
  notas: 'Datos de ejemplo: en Estadística tienes cuatro punto dos y en Finanzas tres punto ocho.',
  recibo: 'Datos de ejemplo: tu recibo de matrícula está generado y vence el 30 de enero.',
  turno: 'Datos de ejemplo: tu turno de inscripción es el lunes a las 9 de la mañana.',
  horario: 'Datos de ejemplo: tienes clase los sábados de 8 a 12.',
  cursos: 'Datos de ejemplo: estás inscrito en tres cursos en Savio.',
};

export function academicoSimulado(est: Estudiante = ESTUDIANTE_EJEMPLO, opts: { numeroVinculado?: boolean } = {}): AcademicoApi {
  return {
    async estudianteDe(telefono) {
      return opts.numeroVinculado && telefono.replace(/\D/g, '') === est.telefono ? est : null;
    },
    async buscarParaVerificar({ codigo }) {
      return codigo?.toUpperCase() === est.codigo ? { encontrado: true, telefonoVinculado: est.telefono, emailEnmascarado: 'es***@utb.edu.co' } : { encontrado: false };
    },
    async consultar(telefono, tipo) {
      if (telefono !== est.telefono) {
        return { ok: false, tipo, motivo: 'no_verificado', paraVoz: 'No tengo un estudiante verificado con ese número.', paraTexto: 'No verificado.' };
      }
      return { ok: true, tipo, datos: { ejemplo: true }, paraVoz: RESPUESTAS[tipo], paraTexto: RESPUESTAS[tipo] };
    },
  };
}

/** Agenda en memoria con 3 franjas el siguiente día hábil (9, 10 y 15 h de Colombia). */
export function agendaSimulada(base: Date = new Date()): AgendaApi & { citas: Cita[] } {
  const citas: Cita[] = [];
  const d = new Date(base.getTime() + 86_400_000);
  while ([0, 6].includes(new Date(d.getTime() - 5 * 3_600_000).getUTCDay())) d.setTime(d.getTime() + 86_400_000);
  const fecha = new Date(d.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
  const franja = (h: number): Franja => ({
    asesor: 'asesora.ejemplo', asesorNombre: 'Laura', inicio: `${fecha}T${String(h).padStart(2, '0')}:00:00-05:00`, fin: `${fecha}T${String(h).padStart(2, '0')}:30:00-05:00`,
  });
  const todas = [franja(9), franja(10), franja(15)];
  return {
    citas,
    async franjasLibres({ max = 3 }) {
      return todas.filter((f) => !citas.some((c) => c.inicio === f.inicio && c.estado === 'confirmada')).slice(0, max);
    },
    async reservar({ telefono, nombre, area, franja: f, canal, motivo }) {
      if (citas.some((c) => c.inicio === f.inicio && c.estado === 'confirmada')) return { ok: false, motivo: 'ocupada' };
      const cita: Cita = { id: `sim-${citas.length + 1}`, telefono, nombre, area, asesor: f.asesor, asesorNombre: f.asesorNombre, inicio: f.inicio, fin: f.fin, canal, motivo, estado: 'confirmada' };
      citas.push(cita);
      return { ok: true, cita };
    },
    async citasDe(telefono) { return citas.filter((c) => c.telefono === telefono); },
    async cancelar(id, telefono) {
      const c = citas.find((x) => x.id === id && x.telefono === telefono);
      if (!c) return false;
      c.estado = 'cancelada';
      return true;
    },
  };
}
