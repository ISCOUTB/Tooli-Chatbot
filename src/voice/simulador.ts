// Simulador del panel: escribir como si se hablara y ver lo que diría la línea. Usa el MISMO manejador y el mismo
// turno que una llamada real, con un proveedor «grabador» que anota los comandos en vez de mandarlos a Telnyx.
// Diferencias a propósito: la llamada queda marcada `simulada` (no gasta cupo ni cuenta en el reporte), hay un tope de
// simulaciones por día, y los datos académicos y la agenda son SIEMPRE simulados (nunca se reserva una cita real ni se
// lee a un estudiante real desde el panel).
import { randomUUID } from 'node:crypto';
import type { AjustesVoz } from './ajustes';
import type { AlmacenVoz } from './almacen';
import type { ClienteIa } from './entender';
import { SCHEDULE_OFF, asesoresDisponibles } from './horario';
import { crearManejador } from './manejador';
import type { VoiceEvent, VoiceProvider } from './proveedor/tipos';
import { ESTUDIANTE_EJEMPLO, academicoSimulado, agendaSimulada } from './simulados';
import type { AgendaApi } from '../contratos/agenda';

export type ComandoSim =
  | { tipo: 'decir'; texto: string; encolado: boolean }
  | { tipo: 'transferir'; a: string }
  | { tipo: 'colgar' }
  | { tipo: 'cortar_audio' }
  | { tipo: 'contestar' }
  | { tipo: 'escuchar' }
  | { tipo: 'grabar' };

export const TELEFONO_SIMULADO = '573000000009';

export function crearSimulador(opts: {
  almacen: AlmacenVoz;
  ajustes: () => Promise<AjustesVoz>;
  ia: ClienteIa | null;
  secreto: string;
  ahora?: () => Date;
  puenteMs?: number;
}) {
  const cola = new Map<string, ComandoSim[]>();
  const agendas = new Map<string, AgendaApi>();
  const push = (callId: string, c: ComandoSim): void => { cola.set(callId, [...(cola.get(callId) ?? []), c]); };
  const grabador: VoiceProvider = {
    id: 'simulador',
    label: 'Simulador',
    verifyWebhook: () => ({ ok: false, reason: 'simulador' }),
    parseEvent: () => null,
    answer: async (_c, id) => push(id, { tipo: 'contestar' }),
    speak: async (_c, id, texto, o) => push(id, { tipo: 'decir', texto, encolado: o.interrumpir === false }),
    stopSpeaking: async (_c, id) => push(id, { tipo: 'cortar_audio' }),
    startListening: async (_c, id) => push(id, { tipo: 'escuchar' }),
    transfer: async (_c, id, a) => push(id, { tipo: 'transferir', a }),
    hangup: async (_c, id) => push(id, { tipo: 'colgar' }),
    startRecording: async (_c, id) => push(id, { tipo: 'grabar' }),
    testConnection: async () => ({ ok: true, message: 'simulador' }),
  };
  const ajustesSim = async (): Promise<AjustesVoz> => ({ ...(await opts.ajustes()), activo: true, reglasRuteo: SCHEDULE_OFF });
  const manejador = crearManejador({
    almacen: opts.almacen,
    proveedor: grabador,
    credenciales: () => ({ apiKey: 'simulador', publicKey: null, connectionId: null }),
    ajustes: ajustesSim,
    ahora: opts.ahora,
    puenteMs: opts.puenteMs,
    programador: null,
    log: () => undefined,
    depsTurno: (l, a) => {
      if (!agendas.has(l.id)) agendas.set(l.id, agendaSimulada(opts.ahora?.() ?? new Date()));
      return {
        academico: academicoSimulado(ESTUDIANTE_EJEMPLO, { numeroVinculado: true }),
        agenda: agendas.get(l.id)!,
        ia: opts.ia,
        enviarCodigo: async (_tel, codigo) => {
          await opts.almacen.agregarLinea(l.id, { r: 's', t: `Código enviado por WhatsApp (simulado): ${codigo}`, at: new Date().toISOString() }, a.retencionDias);
          return true;
        },
        secreto: opts.secreto,
        ahora: opts.ahora ?? (() => new Date()),
        telefonoLlamante: l.telefono,
        asesoresEnVivo: Boolean(a.numeroDesvio) && asesoresDisponibles(a.horarioAsesores, opts.ahora?.() ?? new Date()),
        simulada: true,
      };
    },
  });

  const evento = (callId: string, kind: VoiceEvent['kind'], extra: Partial<VoiceEvent> = {}): VoiceEvent => ({
    eventId: randomUUID(), kind, rawType: `sim.${kind}`, callId, from: TELEFONO_SIMULADO, to: null, direction: 'incoming', occurredAt: null, ...extra,
  });

  /** Corre el evento y, como haría Telnyx, avisa que cada frase empezó y terminó de sonar. */
  async function correr(callId: string, ev: VoiceEvent): Promise<ComandoSim[]> {
    const salida: ComandoSim[] = [];
    await manejador.procesarEvento(ev);
    for (let vueltas = 0; vueltas < 10; vueltas++) {
      const nuevos = cola.get(callId) ?? [];
      cola.delete(callId);
      if (!nuevos.length) break;
      salida.push(...nuevos);
      for (const c of nuevos) {
        if (c.tipo !== 'decir') continue;
        await manejador.procesarEvento(evento(callId, 'speak_started'));
        await manejador.procesarEvento(evento(callId, 'speak_ended'));
      }
      if (nuevos.some((c) => c.tipo === 'transferir' || c.tipo === 'colgar')) {
        await manejador.procesarEvento(evento(callId, 'hangup', { durationSeconds: null }));
      }
    }
    return salida;
  }

  async function estado(llamadaId: string) {
    const l = await opts.almacen.leer(llamadaId);
    return l && {
      llamadaId: l.id, estado: l.estado, resultado: l.resultado, fase: l.dialogo.fase, verificado: l.verificada || Boolean(l.dialogo.verificado),
      transcripcion: await opts.almacen.transcripcion(l.id),
    };
  }

  return {
    async iniciar(args: { desdeNumeroDelEstudiante?: boolean } = {}) {
      const a = await opts.ajustes();
      if (!(await opts.almacen.contarSimulacion(opts.ahora?.() ?? new Date(), a.topeSimulacionesDia))) return { ok: false as const, motivo: 'tope_diario' };
      const callId = `sim-${randomUUID()}`;
      const from = args.desdeNumeroDelEstudiante ? ESTUDIANTE_EJEMPLO.telefono : TELEFONO_SIMULADO;
      const c1 = await correr(callId, evento(callId, 'incoming', { from }));
      const l = await opts.almacen.porProveedor('simulador', callId);
      if (!l) return { ok: false as const, motivo: 'no_creada' };
      const c2 = await correr(callId, evento(callId, 'answered', { from }));
      return { ok: true as const, comandos: [...c1, ...c2], ...(await estado(l.id))! };
    },
    async decir(llamadaId: string, texto: string) {
      const l = await opts.almacen.leer(llamadaId);
      if (!l || !l.simulada) return { ok: false as const, motivo: 'no_encontrada' };
      if (l.estado !== 'activa') return { ok: false as const, motivo: 'cerrada' };
      const comandos = await correr(l.proveedorCallId, evento(l.proveedorCallId, 'speech', { transcript: texto.slice(0, 300), isFinal: true }));
      return { ok: true as const, comandos, ...(await estado(l.id))! };
    },
    async silencio(llamadaId: string) {
      const l = await opts.almacen.leer(llamadaId);
      if (!l || !l.simulada) return { ok: false as const, motivo: 'no_encontrada' };
      await manejador.silencio(l.id);
      const comandos = await correr(l.proveedorCallId, evento(l.proveedorCallId, 'other'));
      return { ok: true as const, comandos, ...(await estado(l.id))! };
    },
    async colgar(llamadaId: string) {
      const l = await opts.almacen.leer(llamadaId);
      if (!l || !l.simulada) return { ok: false as const, motivo: 'no_encontrada' };
      await correr(l.proveedorCallId, evento(l.proveedorCallId, 'hangup', { durationSeconds: null }));
      agendas.delete(l.id);
      return { ok: true as const, comandos: [], ...(await estado(l.id))! };
    },
  };
}

export type Simulador = ReturnType<typeof crearSimulador>;
