// Revisión independiente de la voz del 23-nov (después de los arreglos de Manuel): lo que haría fallar la primera
// llamada real o el piloto. Cada caso se escribió primero como prueba de concepto que fallaba.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AJUSTES_DEFECTO } from './ajustes';
import { almacenMemoria, type AlmacenVoz } from './almacen';
import { crearManejador, TEXTO_NO_CONTESTO_CON_NUMERO } from './manejador';
import { telnyxProvider } from './proveedor/telnyx';
import { academicoSimulado, agendaSimulada } from './simulados';
import type { VoiceEvent } from './tipos';

type Cmd = { accion: string; callId: string; texto?: string; pata?: string; id?: string };

function espia() {
  const cmds: Cmd[] = [];
  const p = {
    ...telnyxProvider, id: 'telnyx',
    answer: async (_c: unknown, callId: string, id: string) => { cmds.push({ accion: 'answer', callId, id }); },
    speak: async (_c: unknown, callId: string, texto: string, o?: { commandId?: string }) => { cmds.push({ accion: 'speak', callId, texto, id: o?.commandId }); },
    stopSpeaking: async (_c: unknown, callId: string) => { cmds.push({ accion: 'stop', callId }); },
    startListening: async (_c: unknown, callId: string) => { cmds.push({ accion: 'listen', callId }); },
    stopListening: async (_c: unknown, callId: string) => { cmds.push({ accion: 'stop_listen', callId }); },
    transfer: async (_c: unknown, callId: string, _a: string, _id: string, o?: { estadoPata?: string }) => {
      cmds.push({ accion: 'transfer', callId, pata: o?.estadoPata });
    },
    hangup: async (_c: unknown, callId: string) => { cmds.push({ accion: 'hangup', callId }); },
    startRecording: async () => undefined,
    estadoLlamada: async () => ({ viva: true, duracionSeg: null }),
  };
  return { p, cmds };
}

let n = 0;
const ev = (kind: string, extra: Record<string, unknown> = {}) => ({
  eventId: `r${++n}`, kind, rawType: `call.${kind}`, callId: 'cc1', from: '+573009998877', to: '+576050000000',
  direction: 'incoming', occurredAt: null, ...extra,
}) as unknown as VoiceEvent;

function montar(almacenOver?: (a: AlmacenVoz) => AlmacenVoz) {
  let reloj = Date.parse('2026-11-23T15:00:00Z');
  const base = almacenMemoria(() => reloj);
  const almacen = almacenOver ? almacenOver(base) : base;
  const { p, cmds } = espia();
  const ajustes = { ...AJUSTES_DEFECTO, activo: true, numeroDesvio: '+573001112233' };
  const m = crearManejador({
    almacen, proveedor: p as never, credenciales: () => ({ apiKey: 'k', publicKey: 'p', connectionId: null }),
    ajustes: async () => ajustes, programador: { en: () => () => undefined }, puenteMs: 10_000, log: () => undefined,
    ahora: () => new Date(reloj),
    depsTurno: (l) => ({
      academico: academicoSimulado(), agenda: agendaSimulada(new Date(reloj)), ia: null, enviarCodigo: async () => true,
      secreto: 's', ahora: () => new Date(reloj), telefonoLlamante: l.telefono, asesoresEnVivo: true,
    }),
  });
  return { m, cmds, almacen: base, avanzar: (ms: number) => { reloj += ms; } };
}

describe('revisión 23-nov de la voz', () => {
  it('H1: si el incoming falla después de reservar (500), el reintento de Telnyx sí contesta, con el mismo command_id', async () => {
    let falla = true;
    const x = montar((a) => ({
      ...a,
      fueColgada: async (...args: Parameters<AlmacenVoz['fueColgada']>) => {
        if (falla) { falla = false; throw new Error('redis'); }
        return a.fueColgada(...args);
      },
    }));
    const e = ev('incoming');
    await assert.rejects(x.m.procesarEvento(e));
    await x.m.procesarEvento(e);
    const answers = x.cmds.filter((c) => c.accion === 'answer');
    assert.equal(answers.length, 1, 'la llamada quedó reservada y nunca se contesta');
    assert.equal(answers[0].id, `${e.eventId}-answer`, 'mismo command_id: Telnyx descarta el repetido');
  });

  it('H1: un incoming repetido de una llamada ya contestada no vuelve a contestar', async () => {
    const x = montar();
    const e = ev('incoming');
    await x.m.procesarEvento(e);
    await x.m.procesarEvento(ev('answered'));
    const otro = { ...e, eventId: `${e.eventId}-otro` } as VoiceEvent;
    await x.m.procesarEvento(otro);
    assert.equal(x.cmds.filter((c) => c.accion === 'answer').length, 1);
  });

  it('H1: el reintento de una frase ya aplicada no corre el turno otra vez: solo repite lo dicho', async () => {
    let fallar = false;
    const x = montar((a) => ({
      ...a,
      agregarLinea: async (...args: Parameters<AlmacenVoz['agregarLinea']>) => {
        if (fallar && args[1].r === 'a') { fallar = false; throw new Error('redis'); }
        return a.agregarLinea(...args);
      },
    }));
    await x.m.procesarEvento(ev('incoming'));
    await x.m.procesarEvento(ev('answered'));
    await x.m.procesarEvento(ev('speak_ended'));
    const frase = ev('speech', { transcript: 'cuánto cuesta la maestría en finanzas', isFinal: true });
    fallar = true;
    await assert.rejects(x.m.procesarEvento(frase)); // falló al guardar lo que dijo el bot: 500
    const l1 = (await x.almacen.porProveedor('telnyx', 'cc1'))!;
    await x.m.procesarEvento(frase); // Telnyx reintenta
    const l2 = (await x.almacen.porProveedor('telnyx', 'cc1'))!;
    assert.equal(l2.turnoAplicado, l1.turnoAplicado, 'el turno no se aplicó dos veces');
    assert.equal(l2.dialogo.turnos, l1.dialogo.turnos);
    const lineasPersona = (await x.almacen.transcripcion(l2.id)).filter((t) => t.r === 'c');
    assert.equal(lineasPersona.length, 1, 'la frase no se guardó dos veces en la transcripción');
    const speaks = x.cmds.filter((c) => c.accion === 'speak' && c.id === `${frase.eventId}-reply`);
    assert.ok(speaks.length >= 1 && speaks.every((s) => s.texto === speaks[0].texto), 'repite la misma respuesta');
  });

  it('H2: tras el aviso de fin de tiempo, si el asesor no contesta, se despide y cuelga (sin bucle de transferencias)', async () => {
    const x = montar();
    await x.m.procesarEvento(ev('incoming'));
    await x.m.procesarEvento(ev('answered'));
    await x.m.procesarEvento(ev('speak_ended'));
    x.avanzar(9.5 * 60_000 + 1000);
    await x.m.procesarEvento(ev('speech', { transcript: 'quiero saber de la maestría', isFinal: true }));
    await x.m.procesarEvento(ev('speak_ended'));
    const pata = x.cmds.find((c) => c.accion === 'transfer')!.pata!;
    x.avanzar(30_000);
    await x.m.procesarEvento(ev('hangup', { callId: 'pata-b', clientState: pata, hangupCause: 'timeout', durationSeconds: 0 }));
    const dicho = x.cmds.filter((c) => c.accion === 'speak').at(-1)!.texto!;
    assert.doesNotMatch(dicho, /algo más/, 'al cierre no pregunta «¿algo más?»');
    assert.notEqual(dicho, TEXTO_NO_CONTESTO_CON_NUMERO);
    assert.match(dicho, /devuelva la llamada/);
    await x.m.procesarEvento(ev('speak_ended'));
    assert.equal(x.cmds.at(-1)!.accion, 'hangup', 'cuelga al terminar la despedida');
    x.avanzar(3000);
    // Una frase entre el hangup y el call.hangup de Telnyx no abre otro aviso ni otra transferencia.
    await x.m.procesarEvento(ev('speech', { transcript: 'sí, otra pregunta', isFinal: true }));
    await x.m.procesarEvento(ev('speak_ended'));
    assert.equal(x.cmds.filter((c) => c.accion === 'transfer').length, 1, 'no vuelve a transferir');
  });

  it('H2: lejos del cierre, si el asesor no contesta, el bot retoma y sigue preguntando', async () => {
    const x = montar();
    await x.m.procesarEvento(ev('incoming'));
    await x.m.procesarEvento(ev('answered'));
    await x.m.procesarEvento(ev('speak_ended'));
    await x.m.procesarEvento(ev('speech', { transcript: 'quiero hablar con un asesor', isFinal: true }));
    await x.m.procesarEvento(ev('speak_ended'));
    const pata = x.cmds.find((c) => c.accion === 'transfer')?.pata;
    assert.ok(pata, 'transfirió');
    await x.m.procesarEvento(ev('hangup', { callId: 'pata-b', clientState: pata, hangupCause: 'timeout', durationSeconds: 0 }));
    assert.equal(x.cmds.filter((c) => c.accion === 'speak').at(-1)!.texto, TEXTO_NO_CONTESTO_CON_NUMERO);
  });

  it('la pata del asesor que nunca contestó no se cobra (solo timbró)', async () => {
    const x = montar();
    await x.m.procesarEvento(ev('incoming'));
    await x.m.procesarEvento(ev('answered'));
    await x.m.procesarEvento(ev('speak_ended'));
    await x.m.procesarEvento(ev('speech', { transcript: 'quiero hablar con un asesor', isFinal: true }));
    await x.m.procesarEvento(ev('speak_ended'));
    const pata = x.cmds.find((c) => c.accion === 'transfer')!.pata!;
    x.avanzar(70_000); // timbra más de un minuto y quien llama cuelga
    await x.m.procesarEvento(ev('hangup', { durationSeconds: 100 }));
    let l = (await x.almacen.porProveedor('telnyx', 'cc1'))!;
    assert.equal(l.minutosPata, 0, 'el timbre no cuenta contra el cupo');
    await x.m.procesarEvento(ev('hangup', { callId: 'pata-b', clientState: pata, hangupCause: 'originator_cancel', durationSeconds: 70 }));
    l = (await x.almacen.porProveedor('telnyx', 'cc1'))!;
    assert.equal(l.minutosPata, 0, 'ni con la duración real de la pata');
  });
});
