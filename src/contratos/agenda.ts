/**
 * Contrato de la agenda de asesores. Lo implementa la rama `agenda-asesores`
 * (src/services/agendaService.ts, exportando `agenda: AgendaApi`) y lo usan
 * WhatsApp y la voz. NO cambiar la firma sin avisar al orquestador.
 */
export type AreaAgenda = 'posgrados' | 'pregrado' | 'ti';
export type CanalCita = 'whatsapp' | 'voz' | 'panel';

export interface Franja {
  asesor: string;       // username del asesor en el panel
  asesorNombre: string; // para decirlo en voz o WhatsApp
  inicio: string;       // ISO 8601 con zona (-05:00)
  fin: string;
}

export interface Cita {
  id: string;
  telefono: string;     // E.164 sin '+', igual que `from` en los flujos
  nombre?: string;
  area: AreaAgenda;
  asesor: string;
  asesorNombre: string;
  inicio: string;
  fin: string;
  canal: CanalCita;
  motivo?: string;
  estado: 'confirmada' | 'cancelada' | 'atendida' | 'no_asistio';
}

export type ResultadoReserva =
  | { ok: true; cita: Cita }
  | { ok: false; motivo: 'ocupada' | 'invalida' | 'limite' };

export interface AgendaApi {
  /** Próximas franjas libres reales, ordenadas por hora. */
  franjasLibres(opts: { area: AreaAgenda; desde?: Date; dias?: number; max?: number }): Promise<Franja[]>;
  /** Reserva atómica: dos personas nunca obtienen la misma franja. */
  reservar(input: { telefono: string; nombre?: string; area: AreaAgenda; franja: Franja; canal: CanalCita; motivo?: string }): Promise<ResultadoReserva>;
  /** Citas futuras confirmadas de ese teléfono. */
  citasDe(telefono: string): Promise<Cita[]>;
  /** Solo cancela si la cita es de ese teléfono. */
  cancelar(citaId: string, telefono: string): Promise<boolean>;
}
