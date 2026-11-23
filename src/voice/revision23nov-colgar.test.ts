// Revisión 23-nov, H3: quien llama cuelga mientras el turno reserva una cita. La cita queda hecha afuera: el panel tiene
// que enterarse y la llamada debe quedar con resultado «cita» (no «colgó», que la mandaría a la cola de devoluciones).
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { VoiceEvent } from './tipos';

const SIN_MOCKS = typeof (mock as { module?: unknown }).module !== 'function'
  ? 'necesita Node 22.3+ con --experimental-test-module-mocks' : false;

let soltar: () => void = () => undefined;

describe('revisión 23-nov, H3: colgar mientras el turno reserva', { skip: SIN_MOCKS }, () => {
  it('la cita reservada llega al panel y la llamada queda con resultado «cita»', async () => {
    const real = await import('./dialogo');
    mock.module('./dialogo', {
      namedExports: {
        ...real,
        correrTurno: async (_t: string, estado: unknown, deps: { agenda: { reservar: (x: object) => Promise<unknown> } }) => {
          await deps.agenda.reservar({});
          await new Promise<void>((r) => { soltar = r; });
          return { respuesta: 'Listo, tu cita quedó reservada.', accion: 'none', resultado: 'cita', aviso: 'Cita reservada: martes 10 am', estado };
        },
      },
    });
    const { AJUSTES_DEFECTO } = await import('./ajustes');
    const { almacenMemoria } = await import('./almacen');
    const { crearManejador } = await import('./manejador');
    const { telnyxProvider } = await import('./proveedor/telnyx');
    let n = 0;
    const ev = (kind: string, extra: Record<string, unknown> = {}) => ({
      eventId: `q${++n}`, kind, rawType: `call.${kind}`, callId: 'cc1', from: '+573009998877', to: '+576050000000',
      direction: 'incoming', occurredAt: null, ...extra,
    }) as unknown as VoiceEvent;
    const almacen = almacenMemoria();
    const avisos: string[] = [];
    const nada = async () => undefined;
    const p = {
      ...telnyxProvider, id: 'telnyx', answer: nada, speak: nada, stopSpeaking: nada, startListening: nada, stopListening: nada,
      transfer: nada, hangup: nada, startRecording: nada, estadoLlamada: async () => null,
    } as never;
    const m = crearManejador({
      almacen, proveedor: p, credenciales: () => ({ apiKey: 'k', publicKey: 'p', connectionId: null }),
      ajustes: async () => ({ ...AJUSTES_DEFECTO, activo: true }), programador: null, puenteMs: 60_000, log: () => undefined,
      avisarPanel: (a) => avisos.push(`${a.tipo}: ${a.texto}`),
      depsTurno: (l) => ({
        academico: null, agenda: { reservar: async () => ({ ok: true }) } as never, ia: null, enviarCodigo: async () => true,
        secreto: 's', ahora: () => new Date(), telefonoLlamante: l.telefono, asesoresEnVivo: false,
      }),
    });
    await m.procesarEvento(ev('incoming'));
    await m.procesarEvento(ev('answered'));
    const turno = m.procesarEvento(ev('speech', { transcript: 'sí, el martes a las diez', isFinal: true }));
    await new Promise((r) => setTimeout(r, 20));
    await m.procesarEvento(ev('hangup', { durationSeconds: 40 }));
    soltar();
    await turno;
    const l = await almacen.porProveedor('telnyx', 'cc1');
    assert.ok(avisos.some((a) => a.startsWith('cita')), avisos.join(' | '));
    assert.equal(l?.resultado, 'cita');
    assert.equal(l?.estado, 'cerrada');
  });
});
