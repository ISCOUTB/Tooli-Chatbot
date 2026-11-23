// Revisión de seguridad y robustez de la línea de voz (23-nov-2026): issues #33, #34, #35 y los defectos del bot de
// llamadas que encontró la revisión (tope duro, transferencia, webhook, turnos descartados, retención, costo, Redis).
// Cada bloque nació como prueba que FALLABA con el código de antes; aquí se exige el comportamiento arreglado.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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

export type Cmd = { accion: string; callId: string; texto?: string; interrumpir?: boolean; a?: string; limiteSeg?: number };

export function espia(opts: { fallarSpeak?: () => boolean } = {}) {
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
    transfer: async (_c, callId, a) => { cmds.push({ accion: 'transfer', callId, a }); },
    hangup: async (_c, callId) => { cmds.push({ accion: 'hangup', callId }); },
    startRecording: async (_c, callId) => { cmds.push({ accion: 'record', callId }); },
  };
  return { p, cmds };
}

export const CREDS: ProviderCredentials = { apiKey: 'k', publicKey: 'p', connectionId: null };
let n = 0;
export const ev = (kind: VoiceEvent['kind'], extra: Partial<VoiceEvent> = {}): VoiceEvent => ({
  eventId: `s${++n}`, kind, rawType: `call.${kind}`, callId: 'cc1', from: `+${ESTUDIANTE_EJEMPLO.telefono}`, to: '+576050000000',
  direction: 'incoming', occurredAt: null, ...extra,
});

export function montar(over: {
  ajustes?: Partial<AjustesVoz>; ia?: ClienteIa | null; academico?: AcademicoApi | null; fallarSpeak?: () => boolean;
  asesoresEnVivo?: boolean; turno?: Partial<DepsTurno>; manejador?: Partial<DepsManejador>; inicio?: number;
} = {}) {
  let reloj = over.inicio ?? Date.parse('2026-11-23T15:00:00Z');
  const almacen = almacenMemoria(() => reloj);
  const { p, cmds } = espia({ fallarSpeak: over.fallarSpeak });
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
