/**
 * Agenda del flujo de WhatsApp vista desde el simulador del panel.
 *
 * Fuera del simulador pasa todo a la agenda real. En una conversación simulada:
 *   - Los horarios se LEEN de la agenda real (así se prueba la disponibilidad que
 *     configuraron los asesores). Si no hay ninguno libre, ofrece horarios de
 *     ejemplo y lo dice en una nota.
 *   - Reservar, cancelar y reprogramar NUNCA tocan la agenda real: las citas de
 *     prueba viven en memoria, por número simulado. No bloquean la hora de un
 *     estudiante real ni programan recordatorios.
 */
import type { Cita, Franja, ResultadoReserva } from '../contratos/agenda';
import { agendaSimulada } from '../voice/simulados';
import { esNumeroSimulado, saltarEnSimulacion, telefonoEnSimulacion } from '../services/simulacion';
import type { AgendaDelFlujo } from './agendaFlow';

const MAX_NUMEROS = 100;

export interface AgendaConPrueba extends AgendaDelFlujo {
  /** Borra las citas de prueba de un número (al empezar de nuevo). */
  soltar(telefono: string): void;
}

export function conAgendaDePrueba(real: AgendaDelFlujo, ahora: () => Date = () => new Date()): AgendaConPrueba {
  const citas = new Map<string, Cita[]>();
  let secuencia = 0;

  const deQuien = (telefono?: string): string | null =>
    (esNumeroSimulado(telefono) ? telefono! : telefonoEnSimulacion());
  const citasDe = (tel: string): Cita[] => {
    let lista = citas.get(tel);
    if (!lista) {
      if (citas.size >= MAX_NUMEROS) citas.delete(citas.keys().next().value!);
      lista = [];
      citas.set(tel, lista);
    }
    return lista;
  };
  const ocupada = (tel: string, f: Franja, salvo?: string) =>
    citasDe(tel).some((c) => c.estado === 'confirmada' && c.inicio === f.inicio && c.asesor === f.asesor && c.id !== salvo);

  return {
    async franjasLibres(opts) {
      const tel = deQuien();
      if (!tel) return real.franjasLibres(opts);
      let libres: Franja[] = [];
      try { libres = await real.franjasLibres(opts); } catch { libres = []; }
      libres = libres.filter((f) => !ocupada(tel, f));
      if (libres.length) return libres;
      saltarEnSimulacion('Agenda', 'La agenda real no tiene horarios libres para esta área: el simulador ofrece horarios de ejemplo.');
      return (await agendaSimulada(ahora()).franjasLibres(opts)).filter((f) => !ocupada(tel, f));
    },
    async reservar(input): Promise<ResultadoReserva> {
      const tel = deQuien(input.telefono);
      if (!tel) return real.reservar(input);
      if (ocupada(tel, input.franja)) return { ok: false, motivo: 'ocupada' };
      secuencia += 1;
      const cita: Cita = {
        id: `cita_prueba${secuencia}`, telefono: input.telefono, nombre: input.nombre, area: input.area,
        asesor: input.franja.asesor, asesorNombre: input.franja.asesorNombre, inicio: input.franja.inicio, fin: input.franja.fin,
        canal: input.canal, motivo: input.motivo, estado: 'confirmada',
      };
      citasDe(tel).push(cita);
      saltarEnSimulacion('Agenda', `Cita de prueba con ${cita.asesorNombre}: no se guardó en la agenda real, no bloquea la hora y no programa recordatorios.`);
      return { ok: true, cita };
    },
    async citasDe(telefono) {
      const tel = deQuien(telefono);
      if (!tel) return real.citasDe(telefono);
      const desde = ahora().getTime();
      return citasDe(tel).filter((c) => c.estado === 'confirmada' && Date.parse(c.fin) > desde);
    },
    async cancelar(citaId, telefono) {
      const tel = deQuien(telefono);
      if (!tel) return real.cancelar(citaId, telefono);
      const c = citasDe(tel).find((x) => x.id === citaId && x.estado === 'confirmada');
      if (!c) return false;
      c.estado = 'cancelada';
      return true;
    },
    async reprogramar(citaId, telefono, franja): Promise<ResultadoReserva> {
      const tel = deQuien(telefono);
      if (!tel) return real.reprogramar(citaId, telefono, franja);
      const c = citasDe(tel).find((x) => x.id === citaId && x.estado === 'confirmada');
      if (!c) return { ok: false, motivo: 'invalida' };
      if (ocupada(tel, franja, citaId)) return { ok: false, motivo: 'ocupada' };
      Object.assign(c, { asesor: franja.asesor, asesorNombre: franja.asesorNombre, inicio: franja.inicio, fin: franja.fin });
      return { ok: true, cita: { ...c } };
    },
    soltar(telefono) {
      citas.delete(telefono);
    },
  };
}
