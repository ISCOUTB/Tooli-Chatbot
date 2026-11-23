// Revisión de seguridad y robustez de la línea de voz (23-nov-2026): issues #33, #34, #35 y los defectos del bot de
// llamadas que encontró la revisión (tope duro, transferencia, webhook, turnos descartados, retención, costo, Redis).
// Cada bloque nació como prueba que FALLABA con el código de antes; aquí se exige el comportamiento arreglado.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { AcademicoApi } from '../contratos/academico';
import { AJUSTES_DEFECTO, type AjustesVoz } from './ajustes';
import { almacenMemoria } from './almacen';
import type { DepsTurno } from './dialogo';
import type { ClienteIa } from './entender';
import { crearManejador, type DepsManejador, type Programador } from './manejador';
import { telnyxProvider } from './proveedor/telnyx';
import type { ProviderCredentials, VoiceEvent, VoiceProvider } from './proveedor/tipos';
import { ESTUDIANTE_EJEMPLO, academicoSimulado, agendaSimulada } from './simulados';
import type { LineaTranscripcion } from './tipos';
import { vistaTranscripcion } from './vista';

export type Cmd = { accion: string; callId: string; texto?: string; interrumpir?: boolean; a?: string; limiteSeg?: number; pata?: string };

export function espia(opts: { fallarSpeak?: () => boolean; fallarTransfer?: () => boolean } = {}) {
  const cmds: Cmd[] = [];
  const p: VoiceProvider = {
    ...telnyxProvider,
    id: 'telnyx',
    answer: async (_c, callId) => { cmds.push({ accion: 'answer', callId }); },
    speak: async (_c, callId, texto, o) => {
      if (opts.fallarSpeak?.()) throw new Error('Telnyx speak respondió 422');
      cmds.push({ accion: 'speak', callId, texto, interrumpir: o.interrumpir !== false });
    },
    stopSpeaking: async (_c, callId) => { cmds.push({ accion: 'stop', callId }); },
    startListening: async (_c, callId) => { cmds.push({ accion: 'listen', callId }); },
    transfer: async (_c, callId, a, _id, o) => {
      if (opts.fallarTransfer?.()) throw new Error('Telnyx transfer respondió 422');
      cmds.push({ accion: 'transfer', callId, a, limiteSeg: o?.limiteSeg, pata: o?.estadoPata });
    },
    hangup: async (_c, callId) => { cmds.push({ accion: 'hangup', callId }); },
    startRecording: async (_c, callId) => { cmds.push({ accion: 'record', callId }); },
    // Nunca a la red en las pruebas: sin estado del proveedor salvo que la prueba lo ponga.
    estadoLlamada: async () => null,
    stopListening: async (_c, callId) => { cmds.push({ accion: 'stop_listen', callId }); },
  } as VoiceProvider;
  return { p, cmds };
}

export const CREDS: ProviderCredentials = { apiKey: 'k', publicKey: 'p', connectionId: null };
let n = 0;
export const ev = (kind: VoiceEvent['kind'], extra: Partial<VoiceEvent> = {}): VoiceEvent => ({
  eventId: `s${++n}`, kind, rawType: `call.${kind}`, callId: 'cc1', from: `+${ESTUDIANTE_EJEMPLO.telefono}`, to: '+576050000000',
  direction: 'incoming', occurredAt: null, ...extra,
});

export function montar(over: {
  ajustes?: Partial<AjustesVoz>; ia?: ClienteIa | null; academico?: AcademicoApi | null; fallarSpeak?: () => boolean; fallarTransfer?: () => boolean;
  asesoresEnVivo?: boolean; turno?: Partial<DepsTurno>; manejador?: Partial<DepsManejador>; inicio?: number;
} = {}) {
  let reloj = over.inicio ?? Date.parse('2026-11-23T15:00:00Z');
  const almacen = almacenMemoria(() => reloj);
  const { p, cmds } = espia({ fallarSpeak: over.fallarSpeak, fallarTransfer: over.fallarTransfer });
  const ajustes: AjustesVoz = { ...AJUSTES_DEFECTO, activo: true, ...over.ajustes };
  const codigos: { telefono: string; codigo: string }[] = [];
  const timers: { ms: number; fn: () => void; vivo: boolean }[] = [];
  const programador: Programador = { en(ms, fn) { const t = { ms, fn, vivo: true }; timers.push(t); return () => { t.vivo = false; }; } };
  const academico = over.academico === undefined ? academicoSimulado(ESTUDIANTE_EJEMPLO, { numeroVinculado: true }) : over.academico;
  let siguiente = 482913;
  const m = crearManejador({
    almacen,
    proveedor: p,
    credenciales: () => CREDS,
    ajustes: async () => ajustes,
    programador,
    puenteMs: 10_000,
    log: () => undefined,
    ahora: () => new Date(reloj),
    depsTurno: (l): DepsTurno => ({
      academico,
      agenda: agendaSimulada(new Date(reloj)),
      ia: over.ia ?? null,
      enviarCodigo: async (telefono, codigo) => { codigos.push({ telefono, codigo }); return true; },
      generarCodigo: () => String(siguiente++),
      secreto: 'secreto-de-prueba',
      ahora: () => new Date(reloj),
      telefonoLlamante: l.telefono,
      asesoresEnVivo: over.asesoresEnVivo ?? false,
      ...over.turno,
    }),
    ...over.manejador,
  });
  const llamada = async (callId = 'cc1') => (await almacen.porProveedor('telnyx', callId))!;
  const lineas = async (callId = 'cc1') => almacen.transcripcion((await llamada(callId)).id);
  const dichos = (callId = 'cc1') => cmds.filter((c) => c.callId === callId && c.accion === 'speak').map((c) => c.texto!);
  return {
    m, almacen, cmds, codigos, ajustes, llamada, lineas, dichos, timers,
    avanzar: (ms: number) => { reloj += ms; },
    ahora: () => reloj,
  };
}

export type Montaje = ReturnType<typeof montar>;

/** Entra, contesta y termina el saludo (deja la llamada escuchando). */
export async function contestar(x: Montaje, callId = 'cc1', from = `+${ESTUDIANTE_EJEMPLO.telefono}`) {
  await x.m.procesarEvento(ev('incoming', { callId, from }));
  await x.m.procesarEvento(ev('answered', { callId, from }));
  await x.m.procesarEvento(ev('speak_started', { callId }));
  await x.m.procesarEvento(ev('speak_ended', { callId }));
}

export const decir = (x: Montaje, transcript: string, callId = 'cc1') => x.m.procesarEvento(ev('speech', { callId, transcript, isFinal: true }));

/** Pide el turno, dicta el código que llegó al WhatsApp y queda verificada (lee el turno de ejemplo). */
export async function verificar(x: Montaje, callId = 'cc1') {
  await decir(x, 'quiero mi turno', callId);
  const codigo = x.codigos.at(-1)!.codigo;
  await decir(x, codigo.split('').join(' '), callId);
}

const TURNO_EJEMPLO = 'tu turno de inscripción es el lunes a las 9 de la mañana';

describe('#33: «repítemelo» no deja las notas en claro', () => {
  it('repetir lo leído guarda en la transcripción el marcador, no los datos', async () => {
    const x = montar();
    await contestar(x);
    await verificar(x);
    assert.match(x.dichos().at(-1)!, /turno de inscripción es el lunes/, 'sí leyó el turno');
    await decir(x, 'repítemelo');
    assert.match(x.dichos().at(-1)!, /turno de inscripción es el lunes/, 'lo repite en voz');
    const texto = (await x.lineas()).map((l) => l.t).join('\n');
    assert.doesNotMatch(texto.toLowerCase(), new RegExp(TURNO_EJEMPLO));
    assert.equal((await x.lineas()).filter((l) => l.t === '[datos académicos leídos: turno]').length, 2);
  });

  it('«¿aló?» después de leer datos no repite los datos', async () => {
    const x = montar();
    await contestar(x);
    await verificar(x);
    await decir(x, '¿aló?');
    assert.doesNotMatch(x.dichos().at(-1)!, /turno de inscripción/);
    assert.doesNotMatch((await x.lineas()).map((l) => l.t).join('\n').toLowerCase(), new RegExp(TURNO_EJEMPLO));
  });

  it('la vista tapa las líneas del bot que traen datos académicos (registros viejos)', () => {
    const at = '2026-11-23T15:00:00Z';
    const lineas: LineaTranscripcion[] = [
      { r: 'a', t: '¡Listo, quedaste verificado! Tu turno de matrícula es el número cuarenta y dos. Te toca el quince de diciembre.', at },
      { r: 'a', t: 'Estas son tus notas: Cálculo, cuatro punto dos. Tu promedio es cuatro.', at },
      { r: 'a', t: 'Tu recibo de matrícula está listo. matrícula ordinaria: paga hasta el diez de enero, por ocho millones de pesos.', at },
      { r: 'a', t: 'Hoy lunes tienes Cálculo de las siete a las nueve de la mañana.', at },
      { r: 'a', t: 'Estás inscrito en tres cursos en Savio.', at },
      { r: 'a', t: 'La maestría en finanzas cuesta 17 millones 900 mil pesos por semestre.', at },
    ];
    const v = vistaTranscripcion(lineas, false).map((l) => l.t);
    for (const t of v.slice(0, 5)) assert.equal(t, '[datos académicos leídos]');
    assert.match(v[5], /17 millones 900 mil pesos/, 'la información de posgrados sí se ve');
    assert.deepEqual(vistaTranscripcion(lineas, true).map((l) => l.t), lineas.map((l) => l.t), 'la simulada se ve completa');
  });
});

describe('#34: el código por WhatsApp desde la voz pasa por el almacén atómico del correo', () => {
  const VICTIMA = ESTUDIANTE_EJEMPLO.telefono;
  /** Una llamada desde el número de la víctima que pide el turno; devuelve lo último que dijo la línea. */
  async function pedirCodigo(x: Montaje, callId: string) {
    await x.m.procesarEvento(ev('incoming', { callId, from: `+${VICTIMA}` }));
    await x.m.procesarEvento(ev('answered', { callId }));
    await decir(x, 'quiero mi turno', callId);
    return x.dichos(callId).at(-1)!;
  }
  const colgar = (x: Montaje, callId: string) => x.m.procesarEvento(ev('hangup', { callId, durationSeconds: 20 }));

  it('tope diario: a lo sumo 10 códigos por día al mismo WhatsApp (antes, 5 por hora sin tope de día)', async () => {
    const x = montar({ ajustes: { maxLlamadasNumeroDia: 1000 } as Partial<AjustesVoz> });
    for (let i = 0; i < 14; i++) {
      await pedirCodigo(x, `d${i}`);
      await colgar(x, `d${i}`);
      x.avanzar(61 * 60_000);
    }
    assert.equal(x.codigos.length, 10);
  });

  it('agotar los intentos dos veces en una hora bloquea la verificación por voz de ese número', async () => {
    const x = montar({ ajustes: { maxLlamadasNumeroDia: 1000 } as Partial<AjustesVoz> });
    for (let ronda = 0; ronda < 2; ronda++) {
      assert.match(await pedirCodigo(x, `b${ronda}`), /código de seis dígitos/);
      for (const malo of ['111111', '222222', '333333']) await decir(x, malo, `b${ronda}`);
      assert.match(x.dichos(`b${ronda}`).at(-1)!, /ya no puedo intentarlo más/);
      await colgar(x, `b${ronda}`);
      x.avanzar(61_000);
    }
    const tercera = await pedirCodigo(x, 'b2');
    assert.match(tercera, /demasiados intentos/);
    assert.equal(x.codigos.length, 2, 'no sale un tercer código');
  });

  it('con un número falsificado, en 24 h no se pueden probar más de 30 códigos (antes, 360)', async () => {
    const x = montar({ ajustes: { maxLlamadasNumeroDia: 1000 } as Partial<AjustesVoz> });
    let conjeturas = 0;
    for (let i = 0; i < 144; i++) { // cada 10 min durante 24 h
      const callId = `g${i}`;
      if (/código de seis dígitos/.test(await pedirCodigo(x, callId))) {
        for (const malo of ['111111', '222222', '333333']) {
          await decir(x, malo, callId);
          if (/no coincide/.test(x.dichos(callId).at(-1)!)) conjeturas++;
        }
      }
      await colgar(x, callId);
      x.avanzar(10 * 60_000);
    }
    assert.ok(conjeturas <= 30, `se probaron ${conjeturas} códigos`);
  });

  it('R6: dos códigos equivocados dictados casi juntos cuentan los dos intentos', async () => {
    const x = montar();
    await contestar(x);
    await decir(x, 'quiero mi turno');
    await Promise.all([decir(x, '111111'), decir(x, '222222')]);
    await decir(x, '333333');
    assert.match(x.dichos().at(-1)!, /ya no puedo intentarlo más/, 'el tercer intento ya es el último');
  });
});

describe('#34: la huella del código usa la clave usable de la voz, no JWT_SECRET tal cual', () => {
  it('con un JWT_SECRET público fuera de pruebas, la voz no verifica (no manda código)', async () => {
    const { config } = await import('../config');
    const { depsTurnoReales } = await import('./servicio');
    const antes = { secreto: config.auth.jwtSecret, entorno: process.env.NODE_ENV };
    const l = { telefono: VICTIMA_DE_EJEMPLO } as Parameters<typeof depsTurnoReales>[0];
    try {
      process.env.NODE_ENV = 'production';
      (config.auth as { jwtSecret: string }).jwtSecret = 'cambia-este-secreto-largo-para-jwt-tooli-2026';
      assert.equal(depsTurnoReales(l, AJUSTES_DEFECTO).secreto, '', 'una clave pública no firma códigos');
      const x = montar({ turno: { secreto: depsTurnoReales(l, AJUSTES_DEFECTO).secreto } });
      await contestar(x);
      await decir(x, 'quiero mi turno');
      assert.equal(x.codigos.length, 0);
      assert.match(x.dichos().at(-1)!, /No pude enviarte el código/);
    } finally {
      (config.auth as { jwtSecret: string }).jwtSecret = antes.secreto;
      process.env.NODE_ENV = antes.entorno;
    }
    assert.equal(depsTurnoReales(l, AJUSTES_DEFECTO).secreto, antes.secreto, 'en pruebas, la de .env.test');
  });
});

const VICTIMA_DE_EJEMPLO = ESTUDIANTE_EJEMPLO.telefono;

describe('#35 R4: sin número que llama no se ofrece verificación', () => {
  it('Telnyx manda «anonymous» o un URI SIP sin número: la llamada queda sin teléfono', async () => {
    const { telefonoDeOrigen } = await import('./manejador');
    for (const from of ['anonymous', 'Anonymous', '+anonymous', 'sip:anonymous@anonymous.invalid', 'sip:anonymous@192.168.10.20', 'Restricted', 'unknown', '', null]) {
      assert.equal(telefonoDeOrigen(from), '', String(from));
    }
    assert.equal(telefonoDeOrigen('+573001112233'), '573001112233');
    assert.equal(telefonoDeOrigen('sip:+573001112233@sip.telnyx.com'), '573001112233');
    assert.equal(telefonoDeOrigen('sip:prueba@tooli.sip.telnyx.com'), '', 'un usuario SIP sin número no es un teléfono');
  });

  it('una llamada anónima que pide sus notas no recibe código ni gasta cupos de búsqueda', async () => {
    let inicios = 0;
    const base = academicoSimulado();
    const academico: AcademicoApi = {
      ...base,
      iniciarVerificacionPorDato: async () => { inicios++; return { estado: 'enviado', emailEnmascarado: 'x' }; },
      confirmarVerificacion: async () => ({ ok: false, motivo: 'vencido' }),
    };
    const x = montar({ academico });
    await contestar(x, 'cc1', 'anonymous');
    assert.equal((await x.llamada()).telefono, '');
    await decir(x, 'quiero mis notas, mi código es T00012345');
    await decir(x, 'T00012345');
    assert.equal(inicios, 0, 'no se pidió ningún código al correo');
    assert.equal(x.codigos.length, 0, 'ni al WhatsApp');
    assert.match(x.dichos().join(' '), /no me aparece el número/i);
  });

  it('el núcleo académico no verifica (ni gasta el cupo global) con un número que llama vacío', async () => {
    const { crearAcademico } = await import('../services/academico/nucleo');
    let busquedas = 0;
    const api = crearAcademico({
      identidad: { obtener: async () => null, porCodigo: async () => ({ telefono: '573001112233', email: 'a@utb.edu.co' }), porCedula: async () => null },
      existeCodigoEnFuente: async () => false, cedulaDe: async () => null,
      interruptores: { notas: () => true, recibo: () => true, turno: () => true, horario: () => true, cursos: () => true },
      proveedores: {}, permitirBusqueda: async () => { busquedas++; return true; },
      regla: () => ({ notaMinima: 3, notaMaxima: 5, pesosCortes: [30, 30, 40], sinConfirmar: true }), ahora: () => new Date(),
      verificacion: { enviarCorreo: async () => undefined, pendientes: { leer: async () => null, guardar: async () => undefined, borrar: async () => undefined }, secreto: 'secreto-de-prueba' },
    });
    assert.deepEqual(await api.iniciarVerificacionPorDato!('', { codigo: 'T00012345' }), { estado: 'error' });
    assert.equal(busquedas, 0);
    assert.deepEqual(await api.confirmarVerificacion!('', '123456'), { ok: false, motivo: 'vencido' });
  });
});

describe('#35 R3 y punto 13: se tapa con el mismo lector que entiende los dictados', () => {
  it('grupos con «y», pares y centenas: se entienden y se tapan igual', async () => {
    const { codigoEstudiantilDictado, digitosDictados, taparDatosDictados } = await import('./texto');
    assert.equal(codigoEstudiantilDictado('T 000 y 123 y 45'), 'T00012345');
    assert.equal(taparDatosDictados('mi código es T 000 y 123 y 45'), 'mi código es [código estudiantil]');
    assert.equal(taparDatosDictados('el código es 482 y 913'), 'el código es [dígitos]');
    assert.equal(digitosDictados('doce quince veinte'), '121520');
    assert.equal(taparDatosDictados('doce quince veinte'), '[dígitos]');
    assert.equal(digitosDictados('cuarenta y ocho, veintinueve, trece'), '482913');
    assert.equal(taparDatosDictados('cuarenta y ocho, veintinueve, trece'), '[dígitos]');
    assert.equal(digitosDictados('cuatrocientos ochenta y dos, novecientos trece'), '482913');
    assert.equal(taparDatosDictados('es cuatrocientos ochenta y dos novecientos trece'), 'es [dígitos]');
    assert.equal(codigoEstudiantilDictado('te cero cero cero, doce, treinta y cuatro, cinco'), 'T00012345');
    // Lo que no es un dictado queda igual.
    for (const t of ['¿piden 2 cartas y 3 semestres de experiencia?', 'a las doce y media', 'tengo treinta y cinco años', 'llego a las once y cuarenta', 'te doy mi número después']) {
      assert.equal(taparDatosDictados(t), t);
    }
  });

  it('el código de 6 dígitos dictado en pares se acepta y no queda en la transcripción', async () => {
    const x = montar();
    await contestar(x);
    await decir(x, 'quiero mi turno');
    assert.equal(x.codigos.at(-1)!.codigo, '482913');
    await decir(x, 'cuarenta y ocho, veintinueve, trece');
    assert.match(x.dichos().at(-1)!, /quedaste verificado/);
    assert.doesNotMatch((await x.lineas()).map((l) => l.t).join('\n'), /cuarenta|veintinueve|trece/);
  });

  it('el código partido en dos frases finales se acepta y ninguna parte queda en claro', async () => {
    const x = montar();
    await contestar(x);
    await decir(x, 'quiero mi turno');
    await decir(x, 'cuatro ocho dos');
    await decir(x, 'nueve uno tres');
    assert.match(x.dichos().at(-1)!, /quedaste verificado/);
    assert.doesNotMatch((await x.lineas()).map((l) => l.t).join('\n'), /cuatro|ocho|nueve|uno tres/);
  });

  it('la vista tapa un dictado partido entre dos líneas seguidas de quien llama', () => {
    const at = '2026-11-23T15:00:00Z';
    const v = vistaTranscripcion([
      { r: 'c', t: 'mi cédula es uno cero cuatro', at },
      { r: 'a', t: 'Perdona, no te entendí.', at },
      { r: 'c', t: 'cinco seis siete ocho', at },
      { r: 'c', t: 'tengo 2', at },
      { r: 'c', t: 'hijos', at },
    ], false).map((l) => l.t);
    assert.deepEqual(v, ['mi cédula es [dígitos]', 'Perdona, no te entendí.', '[dígitos]', 'tengo 2', 'hijos']);
  });
});

/** Una compuerta: lo que la espera no sigue hasta `abrir()`. */
function compuerta() {
  let abrir: () => void = () => undefined;
  const p = new Promise<void>((r) => { abrir = r; });
  return { esperar: () => p, abrir };
}
const tic = () => new Promise((r) => setTimeout(r, 15));

describe('punto 11: los efectos de un turno descartado no se pierden', () => {
  it('OTP: el código acierta mientras llega un «ok»; queda verificada y se lo dice (no «ya venció»)', async () => {
    const { crearCodigoWhatsAppVoz, pendientesVozEnMemoria } = await import('../services/academico/verificacionVoz');
    const real = crearCodigoWhatsAppVoz(pendientesVozEnMemoria());
    const g = compuerta();
    const lenta = { ...real, confirmar: async (a: Parameters<typeof real.confirmar>[0]) => { const r = await real.confirmar(a); await g.esperar(); return r; } };
    const x = montar({ turno: { codigoWhatsApp: lenta } });
    await contestar(x);
    await decir(x, 'quiero mi turno');
    const codigo = decir(x, x.codigos.at(-1)!.codigo);
    await tic();
    await decir(x, 'ok');
    g.abrir();
    await codigo;
    const l = await x.llamada();
    assert.equal(l.dialogo.verificado, ESTUDIANTE_EJEMPLO.telefono, 'la verificación (que ya consumió el código) quedó guardada');
    assert.match(x.dichos().at(-1)!, /quedaste verificado/);
    await decir(x, 'y mi horario');
    assert.doesNotMatch(x.dichos().at(-1)!, /venció|código/);
  });

  it('cita: queda reservada y la línea dice que quedó agendada (no «se acaba de ocupar»)', async () => {
    const agenda = agendaSimulada(new Date('2026-11-23T15:00:00Z'));
    const g = compuerta();
    let primera = true;
    const lenta = {
      ...agenda,
      reservar: async (a: Parameters<typeof agenda.reservar>[0]) => {
        const r = await agenda.reservar(a);
        if (primera) { primera = false; await g.esperar(); }
        return r;
      },
    };
    const x = montar({ turno: { agenda: lenta } });
    await contestar(x);
    await decir(x, 'quiero un asesor');
    await decir(x, 'la primera');
    const si = decir(x, 'sí');
    await tic();
    await decir(x, 'sí, confirmo');
    g.abrir();
    await si;
    assert.equal(agenda.citas.length, 1);
    const l = await x.llamada();
    assert.equal(l.resultado, 'cita');
    assert.match(x.dichos().at(-1)!, /Quedaste agendado/);
  });

  it('un turno viejo SIN efectos se sigue descartando', async () => {
    let soltar: () => void = () => undefined;
    const ia: ClienteIa = { clasificar: () => new Promise((r) => { soltar = () => r(JSON.stringify({ herramienta: 'listar_programas', nivel: 'maestria' })); }) };
    const x = montar({ ia });
    await contestar(x);
    const viejo = decir(x, 'cuéntame algo bonito');
    await tic();
    await decir(x, 'cuánto vale el MBA');
    soltar();
    assert.equal((await viejo).note, 'turno viejo descartado');
  });
});

describe('punto 12: al colgar no quedan el código dictado ni el teléfono verificado en el registro de 180 días', () => {
  it('el código estudiantil dictado se borra al colgar', async () => {
    const x = montar();
    await contestar(x, 'cc1', '+573005550000');
    await decir(x, 'mi código es T00012345');
    assert.equal((await x.llamada()).dialogo.codigoDictado, 'T00012345', 'durante la llamada sí se recuerda');
    await x.m.procesarEvento(ev('hangup', { durationSeconds: 30 }));
    const l = await x.llamada();
    assert.equal(l.dialogo.codigoDictado, null);
    assert.doesNotMatch(JSON.stringify(l), /T00012345|00012345/);
  });

  it('el teléfono del vínculo verificado se borra al colgar; el panel sigue sabiendo que se verificó', async () => {
    const x = montar();
    await contestar(x);
    await verificar(x);
    await decir(x, 'repítemelo');
    await x.m.procesarEvento(ev('hangup', { durationSeconds: 60 }));
    const l = await x.llamada();
    assert.equal(l.dialogo.verificado, null);
    assert.equal(l.dialogo.ultimaRespuesta, null);
    assert.equal(l.dialogo.ultimaDatos, null);
    assert.equal(l.dialogo.verificacion, null);
    assert.equal(l.dictado, '');
    const { vistaLlamada } = await import('./vista');
    assert.equal(vistaLlamada(l, true).verificado, true);
  });
});

describe('punto 8 y #35 R5: ninguna llamada queda abierta para siempre', () => {
  const iso = (ms: number) => new Date(ms).toISOString();

  it('A: speak_started llega después de speak_ended; el silencio igual se cumple y cuelga', async () => {
    const x = montar();
    await x.m.procesarEvento(ev('incoming'));
    await x.m.procesarEvento(ev('answered'));
    const t0 = x.ahora();
    await x.m.procesarEvento(ev('speak_ended', { occurredAt: iso(t0 + 5000) }));
    await x.m.procesarEvento(ev('speak_started', { occurredAt: iso(t0 + 100) }));
    x.avanzar(6500);
    assert.equal(await x.m.barrerSilencios(), 1, '«¿sigues ahí?» a su hora');
    await x.m.procesarEvento(ev('speak_ended', { occurredAt: iso(x.ahora()) }));
    x.avanzar(7500);
    assert.equal(await x.m.barrerSilencios(), 1, 'despedida');
    await x.m.procesarEvento(ev('speak_ended', { occurredAt: iso(x.ahora()) }));
    assert.equal(x.cmds.at(-1)!.accion, 'hangup');
  });

  it('B: si speak falla (422/5xx), el silencio se arma igual y termina colgando', async () => {
    const x = montar({ fallarSpeak: () => true });
    await x.m.procesarEvento(ev('incoming'));
    await x.m.procesarEvento(ev('answered'));
    x.avanzar(6500);
    assert.equal(await x.m.barrerSilencios(), 1);
    x.avanzar(7500);
    assert.equal(await x.m.barrerSilencios(), 1);
    assert.equal(x.cmds.at(-1)!.accion, 'hangup', 'sin speak_ended, cuelga igual');
  });

  it('tope duro: pasado el máximo de la llamada (+ margen) el barrido cuelga, y si no llega el call.hangup la cierra y devuelve el cupo', async () => {
    const x = montar();
    await contestar(x);
    // Queda «hablando» para siempre: nunca más llega un speak_ended (ni silencio ni aviso de tiempo).
    await x.m.procesarEvento(ev('speak_started'));
    assert.deepEqual(await x.almacen.uso(new Date(x.ahora())), { dia: 10, mes: 10 });
    x.avanzar(10 * 60_000);
    assert.equal(await x.m.barrerPlazos(), 0, 'antes del margen no hace nada');
    x.avanzar(31_000);
    assert.equal(await x.m.barrerPlazos(), 1);
    assert.equal(x.cmds.at(-1)!.accion, 'hangup');
    assert.equal((await x.llamada()).estado, 'activa', 'espera el call.hangup');
    x.avanzar(61_000);
    assert.equal(await x.m.barrerPlazos(), 1);
    const l = await x.llamada();
    assert.equal(l.estado, 'cerrada');
    assert.equal(l.minutosCobrados, 12, 'cobra lo que duró: 11 min 32 s');
    assert.deepEqual(await x.almacen.uso(new Date(x.ahora())), { dia: 12, mes: 12 }, 'lo apartado se cambió por lo cobrado');
    assert.equal(await x.m.barrerPlazos(), 0, 'no queda vigilada');
  });

  it('R5: solo resultados parciales: al llegar al tope avisa una vez y cuelga', async () => {
    const x = montar({ ajustes: { maxMinutosLlamada: 1 } });
    await contestar(x);
    x.avanzar(31_000);
    for (let i = 0; i < 3; i++) await x.m.procesarEvento(ev('speech', { transcript: 'eh', isFinal: false }));
    assert.equal(x.dichos().filter((t) => /Se nos acaba el tiempo/.test(t)).length, 1, 'el aviso se dice una sola vez');
    await x.m.procesarEvento(ev('speak_ended'));
    assert.equal(x.cmds.at(-1)!.accion, 'hangup');
  });
});


describe('punto 10: un evento que falla no se pierde', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pub = Buffer.from(publicKey.export({ format: 'der', type: 'spki' }).subarray(12)).toString('base64');
  const CLAVE = 'clave-larga-de-prueba-0123456789';
  const firmar = (body: string) => {
    const ts = String(Math.floor(Date.now() / 1000));
    return { 'content-type': 'application/json', 'telnyx-timestamp': ts, 'telnyx-signature-ed25519': sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString('base64') };
  };
  function enviar(url: string, body: string): Promise<{ status: number; ms: number }> {
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
      const req = httpRequest(url, { method: 'POST', headers: { ...firmar(body), connection: 'close' }, agent: false }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, ms: Date.now() - t0 }));
      });
      req.on('error', reject);
      req.end(body);
    });
  }
  async function servidor(procesar: (e: VoiceEvent) => Promise<{ handled: boolean; note: string }>, plazoMs?: number) {
    const { crearWebhookVoz } = await import('../routes/voiceWebhook');
    const app = express();
    app.use('/voice', crearWebhookVoz({ clave: () => CLAVE, llavePublica: () => pub, proveedor: telnyxProvider, procesar, log: () => undefined, ...(plazoMs ? { plazoMs } : {}) } as Parameters<typeof crearWebhookVoz>[0]));
    const srv = app.listen(0);
    await new Promise((r) => srv.once('listening', r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/voice/telnyx/${CLAVE}`;
    return { url, cerrar: () => new Promise((r) => { srv.closeAllConnections(); srv.close(r); }) };
  }
  const cuerpo = (id: string, tipo = 'call.initiated') => JSON.stringify({ data: { id, event_type: tipo, payload: { call_control_id: 'w-cc', direction: 'incoming', from: '+573001112233' } } });

  it('si procesar falla responde 5xx (Telnyx reintenta) y el reintento contesta la llamada', async () => {
    const x = montar();
    let caido = true;
    const almacen = x.almacen;
    const reservar = almacen.reservarLlamada.bind(almacen);
    almacen.reservarLlamada = async (args) => { if (caido) throw new Error('Redis caído'); return reservar(args); };
    const s = await servidor((e) => x.m.procesarEvento(e));
    try {
      assert.equal((await enviar(s.url, cuerpo('w1'))).status, 500, 'antes respondía 200 y el evento se perdía');
      caido = false;
      assert.equal((await enviar(s.url, cuerpo('w1'))).status, 200);
      assert.deepEqual(x.cmds.map((c) => c.accion), ['answer'], 'el reintento sí contestó');
    } finally {
      await s.cerrar();
    }
  });

  it('si procesar tarda más que el plazo, responde 2xx a tiempo y termina de procesar', async () => {
    let terminado = false;
    const s = await servidor(async () => { await new Promise((r) => setTimeout(r, 400)); terminado = true; return { handled: true, note: 'lento' }; }, 50);
    try {
      const r = await enviar(s.url, cuerpo('w2'));
      assert.ok(r.status >= 200 && r.status < 300);
      assert.ok(r.ms < 350, `tardó ${r.ms} ms`);
      await new Promise((res) => setTimeout(res, 450));
      assert.equal(terminado, true);
    } finally {
      await s.cerrar();
    }
  });

  it('un call.hangup que llega antes de terminar el incoming no deja la llamada abierta con el cupo apartado', async () => {
    const x = montar();
    assert.equal((await x.m.procesarEvento(ev('hangup', { callId: 'h1', durationSeconds: 0 }))).handled, false);
    await x.m.procesarEvento(ev('incoming', { callId: 'h1' }));
    const l = await x.llamada('h1');
    assert.equal(l.estado, 'cerrada');
    assert.equal(x.cmds.some((c) => c.accion === 'answer'), false, 'no contesta una llamada que ya colgó');
    assert.deepEqual(await x.almacen.uso(new Date(x.ahora())), { dia: 0, mes: 0 }, 'devolvió lo apartado');
  });

  it('reconciliador: una llamada activa cuyo call.hangup se perdió se cierra consultando el estado en Telnyx', async () => {
    const consultas: string[] = [];
    const y = montar({
      manejador: {
        proveedor: {
          ...espia().p,
          estadoLlamada: async (_c: ProviderCredentials, callId: string) => { consultas.push(callId); return { viva: false, duracionSeg: 95 }; },
        } as VoiceProvider,
      },
    });
    await contestar(y);
    y.avanzar(11 * 60_000);
    assert.equal(await y.m.barrerPlazos(), 1);
    const l = await y.llamada();
    assert.deepEqual(consultas, ['cc1'], 'preguntó a Telnyx antes de cerrar');
    assert.equal(l.estado, 'cerrada', 'sin call.hangup: estaba muerta y se cerró sin colgar');
    assert.equal(l.duracionSeg, 95, 'con la duración que dio Telnyx');
    assert.deepEqual(await y.almacen.uso(new Date(y.ahora())), { dia: 2, mes: 2 });
  });
});


describe('punto 9 y 16: después de transferir, el bot deja de atender; si el asesor no contesta, retoma', () => {
  const DESVIO = '+573001112233';
  /** Llamada que pide un asesor en horario y queda transferida. */
  async function transferida(over: Parameters<typeof montar>[0] = {}) {
    const x = montar({ ajustes: { numeroDesvio: DESVIO }, asesoresEnVivo: true, ...over });
    await contestar(x);
    await decir(x, 'quiero hablar con un asesor');
    await x.m.procesarEvento(ev('speak_started'));
    await x.m.procesarEvento(ev('speak_ended'));
    return x;
  }
  const pata = (x: Montaje) => x.cmds.find((c) => c.accion === 'transfer')!.pata!;

  it('al transferir detiene la transcripción y deja la pata saliente atada a la llamada', async () => {
    const x = await transferida();
    const acciones = x.cmds.map((c) => c.accion);
    assert.ok(acciones.indexOf('stop_listen') >= 0 && acciones.indexOf('stop_listen') < acciones.indexOf('transfer'), acciones.join(','));
    assert.ok(pata(x), 'la pata saliente lleva el client_state de la llamada');
    assert.ok((x.cmds.find((c) => c.accion === 'transfer')!.limiteSeg ?? 0) > 0, 'la transferencia tiene tope de duración');
  });

  it('lo que la persona le dice al asesor no dispara turnos, silencios, avisos de tiempo ni un hangup', async () => {
    const x = await transferida({ ajustes: { numeroDesvio: DESVIO, maxMinutosLlamada: 1 } });
    const antes = x.cmds.length;
    const lineas = (await x.lineas()).length;
    await decir(x, 'hola, sí, buenas, quería preguntar por la maestría');
    await x.m.procesarEvento(ev('speech', { transcript: 'eh', isFinal: false }));
    x.avanzar(40_000);
    await decir(x, 'mis notas por favor');
    await x.m.barrerSilencios();
    x.avanzar(20 * 60_000);
    assert.equal(x.cmds.length, antes, `mandó: ${x.cmds.slice(antes).map((c) => c.accion).join(',')}`);
    assert.equal((await x.lineas()).length, lineas, 'la charla con el asesor no se transcribe');
    assert.equal((await x.llamada()).estado, 'activa');
  });

  it('si el asesor no contesta, el bot retoma, avisa y deja la devolución en la cola del panel', async () => {
    const x = await transferida();
    const estadoPata = pata(x);
    await x.m.procesarEvento(ev('incoming', { callId: 'pata-b', direction: 'outgoing', clientState: estadoPata }));
    await x.m.procesarEvento(ev('hangup', { callId: 'pata-b', clientState: estadoPata, hangupCause: 'timeout', durationSeconds: 0 }));
    assert.equal(x.cmds.at(-2)!.accion, 'listen', 'vuelve a escuchar');
    assert.match(x.dichos().at(-1)!, /no pude comunicarte con un asesor/i);
    assert.match(x.dichos().at(-1)!, /te devuelva la llamada/);
    const l = await x.llamada();
    assert.equal(l.resultado, 'devolver_llamada');
    const { pendingCallbacks } = await import('./devoluciones');
    await x.m.procesarEvento(ev('hangup', { durationSeconds: 70 }));
    assert.deepEqual(pendingCallbacks([await x.llamada()], new Date(x.ahora())).map((p) => p.id), [l.id]);
    await decir(x, 'gracias');
  });

  it('si la transferencia falla de una, también retoma', async () => {
    const x = await transferida({ fallarTransfer: () => true });
    assert.match(x.dichos().at(-1)!, /no pude comunicarte con un asesor/i);
    assert.equal((await x.llamada()).resultado, 'devolver_llamada');
  });

  it('si el asesor contestó y colgó, el bot no retoma: cuelga la llamada', async () => {
    const x = await transferida();
    const estadoPata = pata(x);
    await x.m.procesarEvento(ev('answered', { callId: 'pata-b', clientState: estadoPata }));
    await x.m.procesarEvento(ev('hangup', { callId: 'pata-b', clientState: estadoPata, hangupCause: 'normal_clearing', durationSeconds: 300 }));
    assert.equal(x.cmds.at(-1)!.accion, 'hangup');
    assert.doesNotMatch(x.dichos().at(-1)!, /no pude comunicarte/);
    assert.equal((await x.llamada()).resultado, 'transferida');
  });

  it('Telnyx: transcription_stop, client_state de la pata y tope de la transferencia', async () => {
    const { parseTelnyxEvent, transferBody } = await import('./proveedor/telnyx');
    const b = transferBody('+573001112233', 'cmd-1', { limiteSeg: 1800, estadoPata: 'tooli-pata:abc' });
    assert.equal(b.time_limit_secs, 1800);
    assert.equal(Buffer.from(String(b.target_leg_client_state), 'base64').toString('utf8'), 'tooli-pata:abc');
    const e = parseTelnyxEvent(JSON.stringify({ data: { id: 'x', event_type: 'call.hangup', payload: { call_control_id: 'b', client_state: Buffer.from('tooli-pata:abc').toString('base64') } } }));
    assert.equal(e?.clientState, 'tooli-pata:abc');
  });
});

describe('punto 14: costo de la transferencia y tope por número', () => {
  const DESVIO = '+573001112233';
  async function transferidaYContestada() {
    const x = montar({ ajustes: { numeroDesvio: DESVIO }, asesoresEnVivo: true });
    await contestar(x);
    await decir(x, 'quiero hablar con un asesor');
    await x.m.procesarEvento(ev('speak_ended'));
    const estadoPata = x.cmds.find((c) => c.accion === 'transfer')!.pata!;
    await x.m.procesarEvento(ev('answered', { callId: 'pata-b', clientState: estadoPata }));
    return { x, estadoPata };
  }

  it('la pata saliente del asesor se cobra y cuenta en el uso', async () => {
    const { x, estadoPata } = await transferidaYContestada();
    await x.m.procesarEvento(ev('hangup', { callId: 'pata-b', clientState: estadoPata, durationSeconds: 300 }));
    await x.m.procesarEvento(ev('hangup', { durationSeconds: 400 }));
    const l = await x.llamada();
    assert.equal(l.minutosCobrados, 7 + 5, 'entrante (400 s) + pata del asesor (300 s)');
    assert.equal(l.costoUsd, 0.84);
    assert.deepEqual(await x.almacen.uso(new Date(x.ahora())), { dia: 12, mes: 12 });
  });

  it('si la pata cuelga después de la llamada, el costo se corrige con su duración real', async () => {
    const { x, estadoPata } = await transferidaYContestada();
    x.avanzar(400_000);
    await x.m.procesarEvento(ev('hangup', { durationSeconds: 400 }));
    const estimada = (await x.llamada()).minutosCobrados;
    assert.ok(estimada >= 7 + 6, `se estima la pata con el tiempo desde la transferencia (${estimada})`);
    await x.m.procesarEvento(ev('hangup', { callId: 'pata-b', clientState: estadoPata, durationSeconds: 120 }));
    const l = await x.llamada();
    assert.equal(l.minutosCobrados, 7 + 2);
    assert.deepEqual(await x.almacen.uso(new Date(x.ahora())), { dia: 9, mes: 9 });
  });

  it('un solo número no gasta el cupo del día: tope de llamadas por número', async () => {
    const x = montar({ ajustes: { maxLlamadasNumeroDia: 3 } as Partial<AjustesVoz> });
    const notas: string[] = [];
    for (let i = 0; i < 4; i++) {
      notas.push((await x.m.procesarEvento(ev('incoming', { callId: `n${i}`, from: '+573005550000' }))).note);
      await x.m.procesarEvento(ev('hangup', { callId: `n${i}`, durationSeconds: 30 }));
    }
    assert.deepEqual(notas, ['contestada', 'contestada', 'contestada', 'tope de llamadas de ese número']);
    assert.equal(x.cmds.filter((c) => c.callId === 'n3' && c.accion === 'answer').length, 0);
    assert.equal((await x.m.procesarEvento(ev('incoming', { callId: 'otro', from: '+573005550001' }))).note, 'contestada', 'otro número sí entra');
    x.avanzar(86_400_000);
    assert.equal((await x.m.procesarEvento(ev('incoming', { callId: 'n-manana', from: '+573005550000' }))).note, 'contestada', 'al otro día vuelve a entrar');
  });

  it('con la línea apagada o sin cupo, el desvío va con tope de duración', async () => {
    const apagada = montar({ ajustes: { activo: false, numeroDesvio: DESVIO } });
    await apagada.m.procesarEvento(ev('incoming', { callId: 'ap' }));
    assert.equal(apagada.cmds.find((c) => c.accion === 'transfer')?.limiteSeg, 30 * 60);
    const sin = montar({ ajustes: { topeMinutosDia: 0, numeroDesvio: DESVIO } });
    await sin.m.procesarEvento(ev('incoming', { callId: 'sc' }));
    assert.equal(sin.cmds.find((c) => c.accion === 'transfer')?.limiteSeg, 30 * 60);
  });
});

describe('punto 15: llaves y memoria que no crecen sin fin', () => {
  it('el simulador suelta la agenda de una llamada que terminó por cualquier camino (no solo con «colgar»)', async () => {
    const { crearSimulador } = await import('./simulador');
    const sim = crearSimulador({ almacen: almacenMemoria(), ajustes: async () => AJUSTES_DEFECTO, ia: null, secreto: 's' });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await sim.iniciar();
      assert.ok(r.ok);
      if (r.ok) { ids.push(r.llamadaId!); await sim.decir(r.llamadaId!, 'quiero un asesor'); }
    }
    await sim.decir(ids[0], 'chao');
    await sim.silencio(ids[1]);
    await sim.silencio(ids[1]);
    assert.equal(sim._agendas.size, 1, 'solo queda la de la llamada que sigue abierta');
  });

  it('el uso en memoria no revive un día que ya no existe al ajustar', async () => {
    const a = almacenMemoria();
    await a.ajustarUso('2031-01-01', '2031-01', -5);
    await a.ajustarUso('2031-01-01', '2031-01', 3);
    assert.deepEqual(await a.uso(new Date('2031-01-01T15:00:00Z')), { dia: 0, mes: 0 });
  });
});

describe('#35, diseño: el panel dice cuándo la verificación por voz quedó en pausa', () => {
  it('con el tope de códigos por hora alcanzado, la llamada y la API lo indican (pausa de menos de 1 h)', async () => {
    const base = academicoSimulado();
    const academico: AcademicoApi = {
      ...base,
      iniciarVerificacionPorDato: async () => ({ estado: 'espera' }),
      confirmarVerificacion: async () => ({ ok: false, motivo: 'vencido' }),
    };
    const avisos: string[] = [];
    const x = montar({ academico, manejador: { avisarPanel: (a) => avisos.push(a.texto) } });
    await contestar(x, 'cc1', '+573005550000');
    await decir(x, 'quiero mis notas');
    await decir(x, 'T00012345');
    const l = await x.llamada();
    assert.equal(l.verificacionNegada, 'espera');
    const { vistaLlamada } = await import('./vista');
    const v = vistaLlamada(l, false);
    assert.equal(v.verificacionNegada, 'espera');
    assert.match(v.verificacionNegadaTexto!, /menos de 1 h/);
    assert.ok(avisos.some((t) => /verificación por voz/i.test(t)), avisos.join(' | '));
  });

  it('con el tope DIARIO lo dice distinto: «mañana», y el panel lo marca como tope del día (no espera corta)', async () => {
    const base = academicoSimulado();
    const academico: AcademicoApi = {
      ...base,
      iniciarVerificacionPorDato: async () => ({ estado: 'tope_dia' }),
      confirmarVerificacion: async () => ({ ok: false, motivo: 'vencido' }),
    };
    const avisos: string[] = [];
    const x = montar({ academico, manejador: { avisarPanel: (a) => avisos.push(a.texto) } });
    await contestar(x, 'cc1', '+573005550000');
    await decir(x, 'quiero mis notas');
    await decir(x, 'T00012345');
    const dicho = x.dichos().at(-1)!;
    assert.match(dicho, /mañana/, dicho);
    assert.doesNotMatch(dicho, /más tarde/, 'no promete «más tarde» cuando es hasta mañana');
    const l = await x.llamada();
    assert.equal(l.verificacionNegada, 'tope_dia');
    const { vistaLlamada } = await import('./vista');
    const v = vistaLlamada(l, false);
    assert.match(v.verificacionNegadaTexto!, /del día/);
    assert.ok(avisos.some((t) => /tope del día/i.test(t)), avisos.join(' | '));
  });

  it('la espera corta no promete «mañana»', async () => {
    const base = academicoSimulado();
    const academico: AcademicoApi = {
      ...base,
      iniciarVerificacionPorDato: async () => ({ estado: 'espera' }),
      confirmarVerificacion: async () => ({ ok: false, motivo: 'vencido' }),
    };
    const x = montar({ academico });
    await contestar(x, 'cc1', '+573005550000');
    await decir(x, 'quiero mis notas');
    await decir(x, 'T00012345');
    assert.doesNotMatch(x.dichos().at(-1)!, /mañana/);
  });

  it('el bloqueo por intentos también queda marcado', async () => {
    const x = montar({ ajustes: { maxLlamadasNumeroDia: 100 } });
    for (let ronda = 0; ronda < 2; ronda++) {
      await contestar(x, `k${ronda}`);
      await decir(x, 'quiero mi turno', `k${ronda}`);
      for (const malo of ['111111', '222222', '333333']) await decir(x, malo, `k${ronda}`);
      await x.m.procesarEvento(ev('hangup', { callId: `k${ronda}`, durationSeconds: 30 }));
      x.avanzar(61_000);
    }
    await contestar(x, 'k2');
    await decir(x, 'quiero mi turno', 'k2');
    assert.equal((await x.llamada('k2')).verificacionNegada, 'bloqueado');
  });
});

describe('punto 19: la duración del call.hangup sale de start_time y occurred_at (no trae end_time)', () => {
  it('sin end_time: occurred_at − start_time; con end_time, ese; sin nada, null (respaldo: reloj del servidor)', async () => {
    const { parseTelnyxEvent } = await import('./proveedor/telnyx');
    const cuerpo = (payload: Record<string, unknown>, occurred?: string) => JSON.stringify({
      data: { id: 'h', event_type: 'call.hangup', occurred_at: occurred, payload: { call_control_id: 'c', ...payload } },
    });
    assert.equal(parseTelnyxEvent(cuerpo({ start_time: '2026-11-23T15:00:00.000000Z' }, '2026-11-23T15:01:35.500000Z'))?.durationSeconds, 96);
    assert.equal(parseTelnyxEvent(cuerpo({ start_time: '2026-11-23T15:00:00Z', end_time: '2026-11-23T15:00:40Z' }, '2026-11-23T15:00:41Z'))?.durationSeconds, 40);
    assert.equal(parseTelnyxEvent(cuerpo({}, '2026-11-23T15:00:41Z'))?.durationSeconds, null);
    assert.equal(parseTelnyxEvent(cuerpo({ start_time: '2026-11-23T15:00:00Z' }))?.durationSeconds, null);
  });
});

describe('punto 20: el language del speak solo admite es-ES, es-MX y es-US', () => {
  it('un idioma que Telnyx no acepta (es-CO) no se guarda; la voz Azure conserva su propio idioma', async () => {
    const { leerAjustes, AJUSTES_DEFECTO: def } = await import('./ajustes');
    assert.equal(leerAjustes({ idioma: 'es-CO' }).idioma, def.idioma);
    assert.equal(leerAjustes({ voz: 'Azure.es-CO-GonzaloNeural', idioma: 'es-CO' }).idioma, 'es-MX');
    assert.equal(leerAjustes({ voz: 'Azure.es-CO-GonzaloNeural', idioma: 'es-CO' }).voz, 'Azure.es-CO-GonzaloNeural');
    assert.equal(leerAjustes({ idioma: 'es-US' }).idioma, 'es-US');
    assert.equal(leerAjustes({ idioma: 'es-ES' }).idioma, 'es-ES');
    assert.equal(leerAjustes({ ...def, idioma: 'es-CO' }, { ...def, idioma: 'es-CO' }).idioma, 'es-MX', 'un ajuste viejo guardado con es-CO se corrige');
  });
});

describe('punto 18: voz masculina por defecto y textos que cuadran con el género de la voz', () => {
  it('Gonzalo por defecto; Jorge en la lista; cada voz dice su género', async () => {
    const { AJUSTES_DEFECTO: def, VOCES, generoDeVoz } = await import('./ajustes');
    assert.equal(def.voz, 'Azure.es-CO-GonzaloNeural');
    assert.ok(VOCES.some((v) => v.id === 'Azure.es-MX-JorgeNeural' && v.idioma === 'es-MX'));
    assert.ok(VOCES.some((v) => v.id === 'Azure.es-CO-GonzaloNeural'));
    assert.equal(generoDeVoz('Azure.es-CO-GonzaloNeural'), 'm');
    assert.equal(generoDeVoz('Azure.es-MX-JorgeNeural'), 'm');
    assert.equal(generoDeVoz('Azure.es-CO-SalomeNeural'), 'f');
  });

  it('con voz masculina el saludo y «¿eres un robot?» dicen «el asistente»; con Salomé, «la asistente»', async () => {
    const hombre = montar();
    await contestar(hombre);
    assert.match(hombre.dichos()[0], /el asistente virtual/);
    assert.doesNotMatch(hombre.dichos()[0], /la asistente/);
    await decir(hombre, '¿usted es un robot o una persona?');
    assert.match(hombre.dichos().at(-1)!, /el asistente virtual/);
    const mujer = montar({ ajustes: { voz: 'Azure.es-CO-SalomeNeural' } });
    await contestar(mujer);
    assert.match(mujer.dichos()[0], /la asistente virtual/);
    await decir(mujer, '¿usted es un robot o una persona?');
    assert.match(mujer.dichos().at(-1)!, /la asistente virtual/);
  });
});

describe('punto 17: con la línea apagada y sin desvío, contesta, avisa y cuelga (antes solo timbraba)', () => {
  it('contesta, dice que la línea no está disponible y cuelga al terminar; queda para devolver la llamada', async () => {
    const x = montar({ ajustes: { activo: false, numeroDesvio: null } });
    assert.equal((await x.m.procesarEvento(ev('incoming', { from: '+573005550000' }))).note, 'apagada: contesta y avisa');
    assert.deepEqual(x.cmds.map((c) => c.accion), ['answer']);
    await x.m.procesarEvento(ev('answered'));
    assert.match(x.dichos().at(-1)!, /no está disponible/);
    assert.match(x.dichos().at(-1)!, /guasap/);
    assert.equal(x.cmds.some((c) => c.accion === 'listen'), false, 'no escucha ni transcribe');
    await x.m.procesarEvento(ev('speak_ended'));
    assert.equal(x.cmds.at(-1)!.accion, 'hangup');
    await x.m.procesarEvento(ev('hangup', { durationSeconds: 12 }));
    const l = await x.llamada();
    assert.equal(l.resultado, 'linea_apagada');
    assert.equal(l.minutosCobrados, 1);
    const { pendingCallbacks } = await import('./devoluciones');
    assert.deepEqual(pendingCallbacks([l], new Date(x.ahora())).map((p) => p.id), [l.id]);
  });

  it('si el aviso no suena, cuelga igual; y si nada llega, el barrido la cuelga', async () => {
    const x = montar({ ajustes: { activo: false, numeroDesvio: null }, fallarSpeak: () => true });
    await x.m.procesarEvento(ev('incoming'));
    await x.m.procesarEvento(ev('answered'));
    assert.equal(x.cmds.at(-1)!.accion, 'hangup');
    const y = montar({ ajustes: { activo: false, numeroDesvio: null } });
    await y.m.procesarEvento(ev('incoming'));
    await y.m.procesarEvento(ev('answered'));
    y.avanzar(31_000);
    assert.equal(await y.m.barrerPlazos(), 1);
    assert.equal(y.cmds.at(-1)!.accion, 'hangup');
  });
});
