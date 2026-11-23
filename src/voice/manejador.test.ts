// Ciclo de vida de la llamada con eventos simulados de Telnyx, almacén en memoria y un proveedor espía.
// Cubre lo que FastFood nunca probó en vivo: idempotencia, cupo, barge-in, silencio, frase puente, acción pendiente al
// terminar de hablar, turnos cruzados (compare-and-set), retención, el simulador y el webhook.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { request as httpRequest } from 'node:http';

/**
 * POST con node:http y sin keep-alive. fetch (undici) deja un pool interno vivo y, con
 * --test-force-exit, Node aborta al salir en Windows (UV_HANDLE_CLOSING).
 */
function enviar(url: string, opts: { method: string; headers: Record<string, string>; body: string }): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: opts.method, headers: { ...opts.headers, connection: 'close' }, agent: false }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}
import { AJUSTES_DEFECTO, type AjustesVoz } from './ajustes';
import { almacenMemoria } from './almacen';
import type { ClienteIa } from './entender';
import { DESPEDIDA_SILENCIO, FRASES_PUENTE, SIGUES_AHI, type DepsTurno } from './dialogo';
import { crearManejador, type Programador } from './manejador';
import { telnyxProvider } from './proveedor/telnyx';
import type { ProviderCredentials, VoiceEvent, VoiceProvider } from './proveedor/tipos';
import { ESTUDIANTE_EJEMPLO, academicoSimulado, agendaSimulada } from './simulados';
import { crearSimulador } from './simulador';
import { crearWebhookVoz } from '../routes/voiceWebhook';
import { aplicarLexico, taparDatosDictados } from './texto';

type Cmd = { accion: string; callId: string; texto?: string; interrumpir?: boolean; a?: string };

function espia(opts: { fallarSpeak?: boolean } = {}) {
  const cmds: Cmd[] = [];
  const p: VoiceProvider = {
    ...telnyxProvider,
    id: 'telnyx',
    answer: async (_c, callId) => { cmds.push({ accion: 'answer', callId }); },
    speak: async (_c, callId, texto, o) => {
      if (opts.fallarSpeak) throw new Error('Telnyx 500');
      cmds.push({ accion: 'speak', callId, texto, interrumpir: o.interrumpir !== false });
    },
    stopSpeaking: async (_c, callId) => { cmds.push({ accion: 'stop', callId }); },
    startListening: async (_c, callId) => { cmds.push({ accion: 'listen', callId }); },
    transfer: async (_c, callId, a) => { cmds.push({ accion: 'transfer', callId, a }); },
    hangup: async (_c, callId) => { cmds.push({ accion: 'hangup', callId }); },
    startRecording: async (_c, callId) => { cmds.push({ accion: 'record', callId }); },
    // Nunca a la red en las pruebas.
    estadoLlamada: async () => null,
    stopListening: async (_c, callId) => { cmds.push({ accion: 'stop_listen', callId }); },
  } as VoiceProvider;
  return { p, cmds };
}

function programadorManual() {
  const tareas: { ms: number; fn: () => void; vivo: boolean }[] = [];
  const prog: Programador = {
    en(ms, fn) {
      const t = { ms, fn, vivo: true };
      tareas.push(t);
      return () => { t.vivo = false; };
    },
  };
  return {
    prog,
    vivas: () => tareas.filter((t) => t.vivo),
    async disparar() {
      const t = tareas.filter((x) => x.vivo).pop();
      assert.ok(t, 'no hay temporizador vivo');
      t.vivo = false;
      t.fn();
      await new Promise((r) => setTimeout(r, 20));
    },
  };
}

const CREDS: ProviderCredentials = { apiKey: 'k', publicKey: 'p', connectionId: null };
let n = 0;
const ev = (kind: VoiceEvent['kind'], extra: Partial<VoiceEvent> = {}): VoiceEvent => ({
  eventId: `e${++n}`, kind, rawType: `call.${kind}`, callId: 'cc1', from: '+573009998877', to: '+576050000000', direction: 'incoming', occurredAt: null, ...extra,
});

function montar(over: { ajustes?: Partial<AjustesVoz>; ia?: ClienteIa | null; fallarSpeak?: boolean; puenteMs?: number; creds?: ProviderCredentials | null; asesoresEnVivo?: boolean } = {}) {
  const almacen = almacenMemoria();
  const { p, cmds } = espia({ fallarSpeak: over.fallarSpeak });
  const reloj = programadorManual();
  const ajustes: AjustesVoz = { ...AJUSTES_DEFECTO, activo: true, ...over.ajustes };
  const avisos: string[] = [];
  const m = crearManejador({
    almacen,
    proveedor: p,
    credenciales: () => (over.creds === undefined ? CREDS : over.creds),
    ajustes: async () => ajustes,
    programador: reloj.prog,
    puenteMs: over.puenteMs ?? 200,
    log: () => undefined,
    avisarPanel: (a) => avisos.push(a.texto),
    depsTurno: (l): DepsTurno => ({
      academico: academicoSimulado(),
      agenda: agendaSimulada(new Date('2026-11-23T15:00:00Z')),
      ia: over.ia ?? null,
      enviarCodigo: async () => true,
      secreto: 's',
      ahora: () => new Date(),
      telefonoLlamante: l.telefono,
      asesoresEnVivo: over.asesoresEnVivo ?? false,
    }),
  });
  const llamada = async () => (await almacen.porProveedor('telnyx', 'cc1'))!;
  return { m, almacen, cmds, reloj, avisos, llamada };
}

async function contestar(x: ReturnType<typeof montar>) {
  await x.m.procesarEvento(ev('incoming'));
  await x.m.procesarEvento(ev('answered'));
  await x.m.procesarEvento(ev('speak_started'));
  await x.m.procesarEvento(ev('speak_ended'));
  x.cmds.length = 0;
}

describe('ciclo de la llamada', () => {
  it('entra, reserva cupo, contesta, saluda con aviso de transcripción y retención, escucha', async () => {
    const x = montar();
    await x.m.procesarEvento(ev('incoming'));
    assert.deepEqual(x.cmds.map((c) => c.accion), ['answer']);
    await x.m.procesarEvento(ev('answered'));
    assert.deepEqual(x.cmds.map((c) => c.accion), ['answer', 'speak', 'listen']);
    assert.match(x.cmds[1].texto!, /se transcribe.*180 días/);
    assert.match(x.cmds[1].texto!, /U T B/, 'el léxico se aplica a lo que suena');
    const l = await x.llamada();
    assert.equal(l.minutosPermitidos, 10);
    assert.match((await x.almacen.transcripcion(l.id))[0].t, /UTB/, 'el registro guarda el texto original');
    assert.deepEqual(await x.almacen.uso(new Date()), { dia: 10, mes: 10 });
  });
  it('con grabación encendida, graba y lo avisa', async () => {
    const x = montar({ ajustes: { grabar: true } });
    await x.m.procesarEvento(ev('incoming'));
    await x.m.procesarEvento(ev('answered'));
    assert.ok(x.cmds.some((c) => c.accion === 'record'));
    assert.match(x.cmds.find((c) => c.accion === 'speak')!.texto!, /se graba y se transcribe/);
  });
  it('un evento repetido se procesa una sola vez', async () => {
    const x = montar();
    const e = ev('incoming');
    await x.m.procesarEvento(e);
    assert.deepEqual(await x.m.procesarEvento(e), { handled: false, note: 'duplicado' });
    assert.equal(x.cmds.filter((c) => c.accion === 'answer').length, 1);
  });
  it('si procesar falla, suelta la idempotencia y el reintento sirve', async () => {
    const x = montar();
    await x.m.procesarEvento(ev('incoming'));
    const e = ev('answered');
    const roto = { ...x.almacen, guardar: async () => { throw new Error('redis caído'); } };
    const m2 = crearManejador({ almacen: roto, proveedor: espia().p, credenciales: () => CREDS, ajustes: async () => ({ ...AJUSTES_DEFECTO, activo: true }), depsTurno: () => { throw new Error('no'); }, log: () => undefined });
    await assert.rejects(m2.procesarEvento(e));
    assert.equal((await x.m.procesarEvento(e)).note, 'saludo');
  });
  it('apagada: desvía si hay número; sin cupo: queda en el registro para devolverla', async () => {
    const off = montar({ ajustes: { activo: false, numeroDesvio: '+573001112233' } });
    await off.m.procesarEvento(ev('incoming'));
    assert.deepEqual(off.cmds.map((c) => c.accion), ['transfer']);
    const sin = montar({ ajustes: { topeMinutosDia: 0 } });
    assert.equal((await sin.m.procesarEvento(ev('incoming'))).note, 'sin cupo');
    assert.deepEqual(sin.cmds.map((c) => c.accion), ['hangup']);
    const [l] = await sin.almacen.listar(5);
    assert.equal(l.resultado, 'sin_cupo');
    assert.deepEqual(await sin.almacen.uso(new Date()), { dia: 0, mes: 0 });
  });
  it('dos llamadas a la vez no pasan juntas el tope del día', async () => {
    const x = montar({ ajustes: { topeMinutosDia: 15, maxMinutosLlamada: 10 } });
    const [a, b] = await Promise.all([
      x.m.procesarEvento(ev('incoming', { callId: 'A' })),
      x.m.procesarEvento(ev('incoming', { callId: 'B' })),
    ]);
    assert.deepEqual([a.note, b.note], ['contestada', 'contestada']);
    const ls = await x.almacen.listar(5);
    assert.equal(ls.reduce((s, l) => s + l.minutosPermitidos, 0), 15);
    assert.equal((await x.m.procesarEvento(ev('incoming', { callId: 'C' }))).note, 'sin cupo');
  });
  it('al colgar cobra por minuto empezado y devuelve lo apartado que no se usó', async () => {
    const x = montar();
    await contestar(x);
    await x.m.procesarEvento(ev('hangup', { durationSeconds: 61 }));
    const l = await x.llamada();
    assert.equal(l.estado, 'cerrada');
    assert.equal(l.minutosCobrados, 2);
    assert.equal(l.costoUsd, 0.14);
    assert.equal(l.resultado, 'colgo');
    assert.deepEqual(await x.almacen.uso(new Date()), { dia: 2, mes: 2 });
  });
  it('sin llaves del proveedor registra todo pero no manda comandos', async () => {
    const x = montar({ creds: null });
    await x.m.procesarEvento(ev('incoming'));
    await x.m.procesarEvento(ev('answered'));
    assert.equal(x.cmds.length, 0);
    assert.equal((await x.almacen.transcripcion((await x.llamada()).id)).length, 1);
  });
});

describe('turnos, transferencia y puente', () => {
  it('pregunta → respuesta hablada; «quiero un asesor» en horario: habla y transfiere al terminar', async () => {
    const x = montar({ ajustes: { numeroDesvio: '+573001112233' }, asesoresEnVivo: true });
    await contestar(x);
    await x.m.procesarEvento(ev('speech', { transcript: '¿cuánto vale el MBA?', isFinal: true }));
    assert.match(x.cmds.at(-1)!.texto!, /17 millones 900 mil pesos/);
    await x.m.procesarEvento(ev('speech', { transcript: 'quiero hablar con un asesor', isFinal: true }));
    assert.equal(x.cmds.some((c) => c.accion === 'transfer'), false, 'no transfiere antes de terminar de hablar');
    await x.m.procesarEvento(ev('speak_started'));
    await x.m.procesarEvento(ev('speak_ended'));
    assert.deepEqual(x.cmds.at(-1), { accion: 'transfer', callId: 'cc1', a: '+573001112233' });
    assert.equal((await x.llamada()).resultado, 'transferida');
    assert.equal(x.avisos.length, 1);
  });
  it('frase puente si pensar tarda; la respuesta va encolada y la acción espera a la respuesta', async () => {
    const lenta: ClienteIa = { clasificar: () => new Promise((r) => setTimeout(() => r(JSON.stringify({ herramienta: 'asesor' })), 120)) };
    const x = montar({ ia: lenta, puenteMs: 30, ajustes: { numeroDesvio: '+573001112233' }, asesoresEnVivo: true });
    await contestar(x);
    await x.m.procesarEvento(ev('speech', { transcript: 'me gustaría que alguien me explique', isFinal: true }));
    const habla = x.cmds.filter((c) => c.accion === 'speak');
    assert.ok(FRASES_PUENTE.includes(habla[0].texto!), 'primero la frase puente');
    assert.equal(habla[0].interrumpir, true);
    assert.equal(habla[1].interrumpir, false, 'la respuesta no corta la frase puente');
    // Termina la frase puente: todavía no transfiere.
    await x.m.procesarEvento(ev('speak_ended'));
    assert.equal(x.cmds.some((c) => c.accion === 'transfer'), false);
    await x.m.procesarEvento(ev('speak_ended'));
    assert.equal(x.cmds.at(-1)!.accion, 'transfer');
  });
  it('sin demora no hay frase puente', async () => {
    const x = montar();
    await contestar(x);
    await x.m.procesarEvento(ev('speech', { transcript: 'qué doctorados hay', isFinal: true }));
    assert.equal(x.cmds.filter((c) => c.accion === 'speak').length, 1);
  });
  it('un turno que se cruzó con otro más nuevo se descarta (compare-and-set del diálogo)', async () => {
    let soltar: () => void = () => undefined;
    const ia: ClienteIa = { clasificar: () => new Promise((r) => { soltar = () => r(JSON.stringify({ herramienta: 'listar_programas', nivel: 'maestria' })); }) };
    const x = montar({ ia, puenteMs: 10_000 });
    await contestar(x);
    const viejo = x.m.procesarEvento(ev('speech', { transcript: 'cuéntame algo bonito', isFinal: true }));
    await new Promise((r) => setTimeout(r, 20));
    await x.m.procesarEvento(ev('speech', { transcript: 'cuánto vale el MBA', isFinal: true }));
    soltar();
    assert.equal((await viejo).note, 'turno viejo descartado');
    const dichos = x.cmds.filter((c) => c.accion === 'speak').map((c) => c.texto);
    assert.equal(dichos.length, 1);
    assert.match(dichos[0]!, /17 millones/);
  });
  it('se acaba el tiempo de la llamada: avisa y cuelga al terminar de hablar', async () => {
    const x = montar({ ajustes: { maxMinutosLlamada: 1 } });
    await contestar(x);
    const l = await x.llamada();
    await x.almacen.guardar({ ...l, contestada: new Date(Date.now() - 45_000).toISOString() });
    await x.m.procesarEvento(ev('speech', { transcript: 'hola', isFinal: true }));
    assert.match(x.cmds.at(-1)!.texto!, /Se nos acaba el tiempo/);
    await x.m.procesarEvento(ev('speak_ended'));
    assert.equal(x.cmds.at(-1)!.accion, 'hangup');
  });
});

describe('se escucha bien: barge-in y silencio', () => {
  it('barge-in: un parcial mientras el bot habla corta el audio; sin hablar, no', async () => {
    const x = montar();
    await contestar(x);
    await x.m.procesarEvento(ev('speech', { transcript: 'qué maestrías tienen', isFinal: true }));
    await x.m.procesarEvento(ev('speak_started'));
    assert.equal((await x.llamada()).hablando, true);
    x.cmds.length = 0;
    assert.equal((await x.m.procesarEvento(ev('speech', { transcript: 'esp', isFinal: false }))).note, 'barge-in');
    assert.deepEqual(x.cmds.map((c) => c.accion), ['stop']);
    assert.equal((await x.llamada()).hablando, false);
    assert.equal((await x.m.procesarEvento(ev('speech', { transcript: 'espera', isFinal: false }))).note, 'parcial');
    assert.equal(x.cmds.length, 1);
  });
  it('silencio: «¿sigues ahí?» y luego despedida y cuelga', async () => {
    const x = montar();
    await contestar(x);
    assert.equal(x.reloj.vivas().length, 1, 'al terminar el saludo empieza a contar el silencio');
    await x.reloj.disparar();
    assert.equal(x.cmds.at(-1)!.texto, SIGUES_AHI);
    await x.m.procesarEvento(ev('speak_ended'));
    await x.reloj.disparar();
    assert.equal(x.cmds.at(-1)!.texto, aplicarLexico(DESPEDIDA_SILENCIO));
    await x.m.procesarEvento(ev('speak_ended'));
    assert.equal(x.cmds.at(-1)!.accion, 'hangup');
    await x.m.procesarEvento(ev('hangup', { durationSeconds: 30 }));
    assert.equal((await x.llamada()).resultado, 'silencio');
  });
  it('si habla, el silencio se cancela y vuelve a empezar desde cero', async () => {
    const x = montar();
    await contestar(x);
    await x.m.procesarEvento(ev('speech', { transcript: 'hola', isFinal: true }));
    assert.equal(x.reloj.vivas().length, 0);
    await x.m.procesarEvento(ev('speak_ended'));
    await x.reloj.disparar();
    assert.equal(x.cmds.at(-1)!.texto, SIGUES_AHI);
  });
  it('un temporizador viejo no actúa si hubo actividad después', async () => {
    const x = montar();
    await contestar(x);
    const vence = (await x.llamada()).silencioVence;
    assert.ok(vence, 'la fecha límite queda en el estado de la llamada');
    await x.m.procesarEvento(ev('speech', { transcript: 'hol', isFinal: false }));
    assert.equal((await x.llamada()).silencioVence, null, 'hablar la borra');
    assert.equal((await x.m.silencio((await x.llamada()).id, vence)).handled, false);
  });
});

describe('silencio persistente (sobrevive a reinicios y a varias instancias)', () => {
  /** Dos instancias del servidor sobre el MISMO almacén, con reloj controlado y temporizadores que nunca disparan. */
  function dosInstancias() {
    const almacen = almacenMemoria();
    let reloj = Date.parse('2026-11-23T15:00:00Z');
    const instancia = () => {
      const { p, cmds } = espia();
      const m = crearManejador({
        almacen, proveedor: p, credenciales: () => CREDS, ajustes: async () => ({ ...AJUSTES_DEFECTO, activo: true }),
        // Un temporizador local que nunca dispara: como si la instancia se hubiera reiniciado.
        programador: { en: () => () => undefined }, puenteMs: 200, log: () => undefined, ahora: () => new Date(reloj),
        silencioMs: [6000, 7000],
        depsTurno: (l): DepsTurno => ({
          academico: academicoSimulado(), agenda: agendaSimulada(new Date(reloj)), ia: null, enviarCodigo: async () => true,
          secreto: 's', ahora: () => new Date(reloj), telefonoLlamante: l.telefono, asesoresEnVivo: false,
        }),
      });
      return { m, cmds };
    };
    const a = instancia();
    const b = instancia();
    const dichos = (t: string) => [...a.cmds, ...b.cmds].filter((c) => c.accion === 'speak' && c.texto === aplicarLexico(t)).length;
    return { almacen, a, b, avanzar: (ms: number) => { reloj += ms; }, dichos, llamada: async () => (await almacen.porProveedor('telnyx', 'cc1'))! };
  }

  async function contestarEn(m: ReturnType<typeof crearManejador>) {
    await m.procesarEvento(ev('incoming'));
    await m.procesarEvento(ev('answered'));
    await m.procesarEvento(ev('speak_started'));
    await m.procesarEvento(ev('speak_ended'));
  }

  it('la instancia que contestó muere: otra cumple la fecha límite desde el almacén', async () => {
    const x = dosInstancias();
    await contestarEn(x.a.m);
    const l = await x.llamada();
    assert.equal(l.silencioVence, Date.parse('2026-11-23T15:00:06Z'));
    assert.deepEqual(await x.almacen.silenciosVencidos(Number.MAX_SAFE_INTEGER, 10), [{ id: l.id, vence: l.silencioVence }]);
    x.avanzar(5000);
    assert.equal(await x.b.m.barrerSilencios(), 0, 'antes de la fecha no dice nada');
    x.avanzar(1500);
    assert.equal(await x.b.m.barrerSilencios(), 1);
    assert.equal(x.dichos(SIGUES_AHI), 1);
    assert.deepEqual(await x.almacen.silenciosVencidos(Number.MAX_SAFE_INTEGER, 10), [], 'el índice queda limpio');
    // Termina de sonar el «¿sigues ahí?» (el evento llega a la instancia viva) y la segunda etapa también se cumple.
    await x.b.m.procesarEvento(ev('speak_ended'));
    x.avanzar(7000);
    assert.equal(await x.b.m.barrerSilencios(), 1);
    assert.equal(x.dichos(DESPEDIDA_SILENCIO), 1);
  });

  it('dos instancias barren a la vez: «¿sigues ahí?» se dice una sola vez', async () => {
    const x = dosInstancias();
    await contestarEn(x.a.m);
    x.avanzar(6000);
    const [na, nb] = await Promise.all([x.a.m.barrerSilencios(), x.b.m.barrerSilencios()]);
    assert.equal(na + nb, 1);
    assert.equal(x.dichos(SIGUES_AHI), 1);
    assert.equal(await x.a.m.barrerSilencios(), 0, 'un barrido repetido no lo vuelve a decir');
    assert.equal(x.dichos(SIGUES_AHI), 1);
  });

  it('si habló antes de la fecha, el barrido no dice nada (aunque lo procese otra instancia)', async () => {
    const x = dosInstancias();
    await contestarEn(x.a.m);
    x.avanzar(3000);
    await x.b.m.procesarEvento(ev('speech', { transcript: 'eh', isFinal: false }));
    x.avanzar(10_000);
    assert.equal(await x.a.m.barrerSilencios(), 0);
    assert.equal(x.dichos(SIGUES_AHI), 0);
  });

  it('una llamada colgada no recibe el «¿sigues ahí?»', async () => {
    const x = dosInstancias();
    await contestarEn(x.a.m);
    await x.b.m.procesarEvento(ev('hangup', { durationSeconds: 3 }));
    x.avanzar(6000);
    assert.equal(await x.a.m.barrerSilencios(), 0);
    assert.equal(x.dichos(SIGUES_AHI), 0);
  });
});

describe('retención (Ley 1581)', () => {
  it('pasados los días de retención la llamada y su transcripción ya no se leen', async () => {
    let ahora = Date.now();
    const almacen = almacenMemoria(() => ahora);
    const r = await almacen.reservarLlamada({ proveedor: 't', proveedorCallId: 'x', telefono: '573001', simulada: false, topes: { ...AJUSTES_DEFECTO, retencionDias: 2 }, ahora: new Date() });
    assert.ok(r.ok);
    if (!r.ok) return;
    await almacen.agregarLinea(r.llamada.id, { r: 'c', t: 'hola', at: '' }, 2);
    ahora += 3 * 86_400_000;
    assert.equal(await almacen.leer(r.llamada.id), null);
    assert.deepEqual(await almacen.transcripcion(r.llamada.id), []);
    assert.deepEqual(await almacen.listar(10), []);
  });
});

describe('simulador', () => {
  it('mismo motor, llamada simulada, sin gastar cupo; agenda simulada', async () => {
    const almacen = almacenMemoria();
    const sim = crearSimulador({ almacen, ajustes: async () => ({ ...AJUSTES_DEFECTO, activo: false }), ia: null, secreto: 's', ahora: () => new Date('2026-11-23T15:00:00Z') });
    const ini = await sim.iniciar();
    assert.ok(ini.ok);
    if (!ini.ok) return;
    assert.ok(ini.comandos.some((c) => c.tipo === 'decir' && /Posgrados de la U T B/.test(c.texto)));
    const r1 = await sim.decir(ini.llamadaId!, 'quiero un asesor');
    assert.ok(r1.ok && r1.comandos.some((c) => c.tipo === 'decir' && /la primera, el/.test(c.texto)));
    await sim.decir(ini.llamadaId!, 'la primera');
    const r3 = await sim.decir(ini.llamadaId!, 'sí');
    assert.ok(r3.ok);
    if (!r3.ok) return;
    assert.equal(r3.resultado, 'cita');
    const l = await almacen.leer(ini.llamadaId!);
    assert.equal(l?.simulada, true);
    assert.deepEqual(await almacen.uso(new Date('2026-11-23T15:00:00Z')), { dia: 0, mes: 0 });
  });
  it('verificación en el simulador: el código aparece en la transcripción para dictarlo', async () => {
    const almacen = almacenMemoria();
    const sim = crearSimulador({ almacen, ajustes: async () => AJUSTES_DEFECTO, ia: null, secreto: 's' });
    const ini = await sim.iniciar();
    assert.ok(ini.ok);
    if (!ini.ok) return;
    await sim.decir(ini.llamadaId!, 'quiero mis notas');
    const r = await sim.decir(ini.llamadaId!, 'T00012345');
    assert.ok(r.ok);
    if (!r.ok) return;
    const codigo = r.transcripcion.find((x) => x.r === 's')!.t.match(/(\d{6})/)![1];
    const r2 = await sim.decir(ini.llamadaId!, codigo.split('').join(' '));
    assert.ok(r2.ok && r2.verificado);
  });
  it('silencio y colgar en el simulador; tope diario', async () => {
    const almacen = almacenMemoria();
    const sim = crearSimulador({ almacen, ajustes: async () => ({ ...AJUSTES_DEFECTO, topeSimulacionesDia: 1 }), ia: null, secreto: 's' });
    const ini = await sim.iniciar();
    assert.ok(ini.ok);
    if (!ini.ok) return;
    const s1 = await sim.silencio(ini.llamadaId!);
    assert.ok(s1.ok && s1.comandos.some((c) => c.tipo === 'decir' && c.texto === SIGUES_AHI));
    const s2 = await sim.silencio(ini.llamadaId!);
    assert.ok(s2.ok && s2.estado === 'cerrada');
    assert.deepEqual(await sim.iniciar(), { ok: false, motivo: 'tope_diario' });
  });
});

describe('webhook', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = Buffer.from(publicKey.export({ format: 'der', type: 'spki' }).subarray(12)).toString('base64');
  const CLAVE = 'clave-larga-de-prueba-0123456789';

  async function servidor(procesar: (e: VoiceEvent) => Promise<{ handled: boolean; note: string }>) {
    const app = express();
    app.use('/voice', crearWebhookVoz({ clave: () => CLAVE, llavePublica: () => pub, proveedor: telnyxProvider, procesar, log: () => undefined }));
    app.use(express.json());
    const srv = app.listen(0);
    await new Promise((r) => srv.once('listening', r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/voice/telnyx`;
    // fetch deja conexiones keep-alive: sin cerrarlas, close() queda esperando y
    // --test-force-exit aborta en Windows con UV_HANDLE_CLOSING.
    // fetch deja conexiones keep-alive: se cierran para que close() no espere.
    return { url, cerrar: () => new Promise((r) => { srv.closeAllConnections(); srv.close(r); }) };
  }
  const cuerpo = JSON.stringify({ data: { id: 'w1', event_type: 'call.initiated', payload: { call_control_id: 'c', direction: 'incoming' } } });
  const firmar = (body: string, ts = String(Math.floor(Date.now() / 1000))) => ({
    'content-type': 'application/json', 'telnyx-timestamp': ts, 'telnyx-signature-ed25519': sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString('base64'),
  });

  it('clave equivocada 404, firma mala 401, cuerpo grande 413, bueno: procesa y responde 200', async () => {
    const vistos: VoiceEvent[] = [];
    const s = await servidor(async (e) => { vistos.push(e); return { handled: true, note: 'ok' }; });
    try {
      assert.equal((await enviar(`${s.url}/otra-clave-cualquiera-xxxxxxxx`, { method: 'POST', headers: firmar(cuerpo), body: cuerpo })).status, 404);
      assert.equal((await enviar(`${s.url}/${CLAVE}`, { method: 'POST', headers: firmar(cuerpo), body: cuerpo.replace('w1', 'w2') })).status, 401);
      const grande = JSON.stringify({ x: 'a'.repeat(300_000) });
      assert.equal((await enviar(`${s.url}/${CLAVE}`, { method: 'POST', headers: firmar(grande), body: grande })).status, 413);
      const ok = await enviar(`${s.url}/${CLAVE}`, { method: 'POST', headers: firmar(cuerpo), body: cuerpo });
      assert.equal(ok.status, 200);
      assert.equal(vistos.length, 1);
      assert.equal(vistos[0].eventId, 'w1');
    } finally {
      await s.cerrar();
    }
  });
  it('un fallo al procesar responde 500 para que Telnyx lo reintente (un 2xx no se reintenta)', async () => {
    const s = await servidor(async () => { throw new Error('falló'); });
    try {
      const r = await enviar(`${s.url}/${CLAVE}`, { method: 'POST', headers: firmar(cuerpo), body: cuerpo });
      assert.equal(r.status, 500);
    } finally {
      await s.cerrar();
    }
  });
});

describe('códigos por WhatsApp: espera y tope (almacén atómico del correo, #34)', () => {
  const VICTIMA = ESTUDIANTE_EJEMPLO.telefono;

  it('llamar seguido con el número de la víctima no le manda un código por llamada', async () => {
    const almacen = almacenMemoria();
    let reloj = Date.parse('2026-11-23T15:00:00Z');
    const enviados: string[] = [];
    const { p, cmds } = espia();
    const m = crearManejador({
      almacen, proveedor: p, credenciales: () => CREDS, ajustes: async () => ({ ...AJUSTES_DEFECTO, activo: true }),
      programador: null, puenteMs: 200, log: () => undefined, ahora: () => new Date(reloj),
      depsTurno: (l): DepsTurno => ({
        academico: academicoSimulado(ESTUDIANTE_EJEMPLO, { numeroVinculado: true }), agenda: null, ia: null,
        enviarCodigo: async (tel) => { enviados.push(tel); return true; },
        secreto: 's', ahora: () => new Date(reloj), telefonoLlamante: l.telefono, asesoresEnVivo: false,
      }),
    });
    const llamar = async (callId: string) => {
      await m.procesarEvento(ev('incoming', { callId, from: `+${VICTIMA}` }));
      await m.procesarEvento(ev('answered', { callId }));
      await m.procesarEvento(ev('speech', { callId, transcript: 'quiero mi turno', isFinal: true }));
      return cmds.filter((c) => c.callId === callId && c.accion === 'speak').at(-1)!.texto!;
    };
    assert.match(await llamar('c1'), /código de seis dígitos/);
    assert.match(await llamar('c2'), /hace poco/);
    assert.equal(enviados.length, 1);
    for (let i = 3; i <= 7; i++) { reloj += 61_000; await llamar(`c${i}`); }
    assert.equal(enviados.length, 5, 'tope de 5 por hora');
    assert.match(cmds.filter((c) => c.callId === 'c7' && c.accion === 'speak').at(-1)!.texto!, /hace poco/);
  });
});

describe('transcripción guardada: sin códigos ni datos académicos', () => {
  it('tapa el código de verificación, el código estudiantil y la cédula dichos por quien llama', () => {
    assert.equal(taparDatosDictados('el código que me llegó es cuatro ocho dos nueve uno tres'), 'el código que me llegó es [dígitos]');
    assert.equal(taparDatosDictados('4-8-2-9-1-3'), '[dígitos]');
    assert.equal(taparDatosDictados('mi código es T cero cero cero uno dos tres cuatro cinco, gracias'), 'mi código es [código estudiantil], gracias');
    assert.equal(taparDatosDictados('es la te 0 0 0 1 2 3 4 5'), 'es la [código estudiantil]');
    assert.equal(taparDatosDictados('T00012345 por favor'), '[código estudiantil] por favor');
    assert.equal(taparDatosDictados('mi cédula es 1.045.678.912'), 'mi cédula es [dígitos]');
    assert.equal(taparDatosDictados('¿piden 2 cartas y 3 semestres de experiencia?'), '¿piden 2 cartas y 3 semestres de experiencia?');
  });

  it('en la llamada: el código dictado y lo leído del académico no quedan en la transcripción', async () => {
    const almacen = almacenMemoria();
    const { p } = espia();
    const academico = academicoSimulado(ESTUDIANTE_EJEMPLO, { numeroVinculado: true });
    const leido = await academico.consultar(ESTUDIANTE_EJEMPLO.telefono, 'turno');
    const m = crearManejador({
      almacen, proveedor: p, credenciales: () => CREDS, ajustes: async () => ({ ...AJUSTES_DEFECTO, activo: true }),
      programador: null, puenteMs: 200, log: () => undefined,
      depsTurno: (l): DepsTurno => ({
        academico, agenda: null, ia: null, enviarCodigo: async () => true, generarCodigo: () => '482913',
        secreto: 's', ahora: () => new Date(), telefonoLlamante: l.telefono, asesoresEnVivo: false,
      }),
    });
    const callId = 'tr1';
    await m.procesarEvento(ev('incoming', { callId, from: `+${ESTUDIANTE_EJEMPLO.telefono}` }));
    await m.procesarEvento(ev('answered', { callId }));
    await m.procesarEvento(ev('speech', { callId, transcript: 'quiero mi turno, mi código es T cero cero cero uno dos tres cuatro cinco', isFinal: true }));
    await m.procesarEvento(ev('speech', { callId, transcript: 'cuatro ocho dos nueve uno tres', isFinal: true }));
    const l = (await almacen.porProveedor('telnyx', callId))!;
    assert.equal(l.resultado, 'datos_estudiante', 'sí leyó el turno');
    const texto = (await almacen.transcripcion(l.id)).map((x) => x.t).join('\n');
    assert.doesNotMatch(texto, /cuatro ocho dos|482913|T cero cero|T00012345/);
    assert.match(texto, /\[código estudiantil\]/);
    assert.match(texto, /\[datos académicos leídos: turno\]/);
    assert.ok(leido.ok && !texto.includes(leido.paraVoz), 'lo leído no se guarda');
    await m.procesarEvento(ev('hangup', { callId, durationSeconds: 40 }));
    assert.equal((await almacen.porProveedor('telnyx', callId))!.dialogo.ultimaRespuesta, null, 'al colgar no queda lo último dicho');
  });
});
