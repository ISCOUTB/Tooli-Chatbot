// Prueba cruzada de la integración (22-nov-2026): la voz contra las funciones REALES de las otras ramas,
// no contra sus simulados. Académico = crearAcademico (núcleo real) con identidad en memoria que imita a
// identityService para el vínculo (el código propio de la voz va al correo y confirmar NO vincula: vale solo para la
// llamada). Agenda =
// crearAgenda (servicio real) sobre el Redis falso de sus pruebas. Ambos entran por conectarContratosVoz,
// el mismo cableado que llama src/index.ts al arrancar.
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AcademicoApi } from '../contratos/academico';
import type { AgendaApi } from '../contratos/agenda';
import { crearAcademico, type DepsNucleo, type IdentidadVigente, type PendienteVoz } from '../services/academico/nucleo';
import type { TurnoDato } from '../services/academico/tipos';
import { crearAgenda } from '../services/agendaService';
import { crearMundo, dispSemana, USUARIOS_BASE } from '../services/agenda.fakes.test';
import { conectarContratosVoz } from './contratos';
import { correrTurno, TEXTO_RECIBO_WHATSAPP, type DepsTurno, type ResultadoTurno } from './dialogo';
import { contratosRegistrados, registrarAcademico, registrarAgenda } from './servicio';
import { DIALOGO_VACIO } from './tipos';

const AHORA = new Date('2026-11-23T08:00:00-05:00'); // lunes 8 am en Colombia (el reloj del mundo de la agenda)
const ANA_TEL = '573001112233';
const LUIS_TEL = '573004445566';
const LLAMA = '576056505050'; // fijo desde el que llama Ana: no está vinculado a nadie
const ANA: IdentidadVigente = { email: 'ana.perez@utb.edu.co', codigo: 'T00012345', codigoVerificado: true, nombre: 'Ana Pérez', nivel: 'pregrado' };
const LUIS: IdentidadVigente = { email: 'luis.gomez@utb.edu.co', codigo: 'T00099999', codigoVerificado: true, nombre: 'Luis Gómez' };

const TURNOS: Record<string, TurnoDato> = {
  T00012345: { codigo: 'T00012345', nombre: 'Ana Pérez', programa: 'Ingeniería', turno: '42', fecha: '2026-12-15', hora: '14:30' },
  T00099999: { codigo: 'T00099999', nombre: 'Luis Gómez', programa: 'Derecho', turno: '7', fecha: '2026-12-10', hora: '08:00' },
};

/** Académico real (núcleo con la verificación de voz real) con la identidad y los pendientes en memoria. */
function academicoEnMemoria() {
  const vinculos = new Map<string, IdentidadVigente>([[ANA_TEL, ANA], [LUIS_TEL, LUIS]]);
  const pendientes = new Map<string, PendienteVoz>();
  const correos: { email: string; codigo: string }[] = [];
  const turnosLeidos: string[] = [];
  const cedulas = new Map<string, string>([[ANA_TEL, '1045678901']]);
  const deps: DepsNucleo = {
    identidad: {
      obtener: async (t) => vinculos.get(t) ?? null,
      porCodigo: async (c) => { const t = [...vinculos.keys()].find((k) => vinculos.get(k)!.codigo === c); return t ? { telefono: t, email: vinculos.get(t)!.email } : null; },
      porCedula: async () => null,
    },
    existeCodigoEnFuente: async () => false,
    // Como en identityService: la cédula cifrada está atada al número y no viaja al vincular otro.
    cedulaDe: async (t) => cedulas.get(t) ?? null,
    interruptores: { notas: () => false, recibo: () => true, turno: () => true, horario: () => false, cursos: () => false },
    proveedores: {
      turno: { consultar: async (c) => { turnosLeidos.push(c); return TURNOS[c] ?? null; } },
      recibo: { consultar: async () => ({ estado: 'sin_recibos' as const }) },
    },
    permitirBusqueda: async () => true,
    regla: () => ({ notaMinima: 3, notaMaxima: 5, pesosCortes: [30, 30, 40], sinConfirmar: true }),
    ahora: () => AHORA,
    verificacion: {
      enviarCorreo: async (email, codigo) => { correos.push({ email, codigo }); },
      pendientes: {
        leer: async (t) => (pendientes.has(t) ? { ...pendientes.get(t)! } : null),
        guardar: async (t, p) => { pendientes.set(t, { ...p }); },
        borrar: async (t) => { pendientes.delete(t); },
      },
      secreto: 'secreto-de-prueba',
      generarCodigo: () => String(100000 + (correos.length + 1) * 7919).slice(0, 6),
    },
  };
  return { api: crearAcademico(deps), correos, turnosLeidos, vinculos };
}

async function agendaEnMemoria() {
  const mundo = crearMundo({ ahoraMs: AHORA.getTime() });
  const ag = crearAgenda(mundo.deps);
  await ag.guardarDisponibilidad('laura', dispSemana(['posgrados']));
  return ag;
}

/** Agenda real con un asesor por área: laura (posgrados), pedro (pregrado), mario (TI). */
async function agendaTresAreas() {
  const mundo = crearMundo({ ahoraMs: AHORA.getTime(), usuarios: [...USUARIOS_BASE, { username: 'pedro', fullName: 'Pedro Ruiz', role: 'asesor' }] });
  const ag = crearAgenda(mundo.deps);
  await ag.guardarDisponibilidad('laura', dispSemana(['posgrados']));
  await ag.guardarDisponibilidad('pedro', dispSemana(['pregrado']));
  await ag.guardarDisponibilidad('mario', dispSemana(['ti']));
  return ag;
}

function depsDesdeRegistro(over: Partial<DepsTurno> = {}) {
  const { academico, agenda } = contratosRegistrados();
  const whatsapp: { telefono: string; texto: string }[] = [];
  const codigosWhatsApp: { telefono: string; codigo: string }[] = [];
  const d: DepsTurno = {
    academico, agenda, ia: null,
    enviarCodigo: async (telefono, codigo) => { codigosWhatsApp.push({ telefono, codigo }); return true; },
    enviarWhatsApp: async (telefono, texto) => { whatsapp.push({ telefono, texto }); return true; },
    secreto: 'secreto-de-prueba', ahora: () => AHORA, telefonoLlamante: LLAMA,
    asesoresEnVivo: false, ...over,
  };
  return { d, whatsapp, codigosWhatsApp };
}

async function conversar(frases: string[], d: DepsTurno): Promise<ResultadoTurno[]> {
  const out: ResultadoTurno[] = [];
  let s = DIALOGO_VACIO;
  for (const f of frases) { const r = await correrTurno(f, s, d); out.push(r); s = r.estado; }
  return out;
}

afterEach(() => { registrarAcademico(null); registrarAgenda(null); });

describe('voz + datos académicos reales', () => {
  it('llama desde otro número: el código va al correo, verifica y lee el turno de ESA estudiante y de nadie más', async () => {
    const mem = academicoEnMemoria();
    conectarContratosVoz({ academico: mem.api, agenda: await agendaEnMemoria(), agendaActiva: true });
    const { d, codigosWhatsApp } = depsDesdeRegistro();

    const [r1, r2] = await conversar(['quiero mi turno', 'te cero cero cero uno dos tres cuatro cinco'], d);
    assert.equal(r1.estado.fase, 'pide_codigo_estudiantil');
    assert.match(r2.respuesta, /correo institucional/);
    assert.deepEqual(mem.correos.map((c) => c.email), [ANA.email], 'el código fue al correo de Ana');
    assert.equal(codigosWhatsApp.length, 0, 'nunca se manda nada al teléfono enmascarado');
    assert.equal(JSON.stringify(r2.estado).includes(mem.correos[0].codigo), false, 'la voz no guarda el código');
    assert.equal(mem.turnosLeidos.length, 0, 'antes de verificar no se consulta nada');

    const dictado = mem.correos[0].codigo.split('').join(' ');
    const r3 = await correrTurno(dictado, r2.estado, d);
    assert.match(r3.respuesta, /quedaste verificado/);
    assert.match(r3.respuesta, /turno de matrícula es el número cuarenta y dos/);
    assert.equal(r3.estado.verificado, ANA_TEL, 'se consulta con el vínculo real de Ana, nunca con el número que llama');
    assert.doesNotMatch(r3.respuesta, /3001112233|2 2 3 3|dos dos tres tres/, 'el teléfono del vínculo no se dice por voz');
    assert.deepEqual(mem.turnosLeidos, ['T00012345'], 'solo se leyó el turno de Ana');
    assert.doesNotMatch(r3.respuesta, /siete|Luis/);
  });

  it('verificarse por voz desde otro número deja intacto el vínculo de WhatsApp original', async () => {
    const mem = academicoEnMemoria();
    conectarContratosVoz({ academico: mem.api, agendaActiva: false });
    const { d } = depsDesdeRegistro();
    const antes = JSON.stringify([...mem.vinculos]);
    const [, r2] = await conversar(['quiero mi turno', 'T00012345'], d);
    const r3 = await correrTurno(mem.correos[0].codigo, r2.estado, d);
    assert.match(r3.respuesta, /quedaste verificado/);
    assert.equal(JSON.stringify([...mem.vinculos]), antes, 'nadie se vinculó ni se desvinculó');
    assert.equal(mem.vinculos.has(LLAMA), false, 'el fijo no quedó vinculado');
    assert.equal(await mem.api.estudianteDe(LLAMA), null);
    // Otra llamada desde el mismo fijo empieza de cero: no hereda la verificación.
    const otra = await conversar(['quiero mi turno'], d);
    assert.equal(otra[0].estado.fase, 'pide_codigo_estudiantil');
    assert.deepEqual(mem.turnosLeidos, ['T00012345'], 'la segunda llamada no leyó nada');
  });

  it('H5: con el número de la víctima y la opción vieja encendida NO se lee nada sin el código', async () => {
    const mem = academicoEnMemoria();
    conectarContratosVoz({ academico: mem.api, agendaActiva: false });
    const confia = depsDesdeRegistro({ telefonoLlamante: ANA_TEL });
    const [r1] = await conversar(['quiero mi turno'], { ...confia.d, confiarEnNumero: true } as DepsTurno);
    assert.equal(r1.estado.fase, 'pide_otp');
    assert.doesNotMatch(r1.respuesta, /cuarenta y dos/);
    assert.deepEqual(mem.turnosLeidos, [], 'no se leyó ningún turno');
  });

  it('número ya vinculado: con el código del WhatsApp lee sus datos sin tocar ningún vínculo', async () => {
    const mem = academicoEnMemoria();
    conectarContratosVoz({ academico: mem.api, agendaActiva: false });
    const antes = JSON.stringify([...mem.vinculos]);
    const noConfia = depsDesdeRegistro({ telefonoLlamante: ANA_TEL });
    const [r2] = await conversar(['quiero mi turno'], noConfia.d);
    assert.equal(r2.estado.fase, 'pide_otp');
    const r3 = await correrTurno(noConfia.codigosWhatsApp[0].codigo, r2.estado, noConfia.d);
    assert.match(r3.respuesta, /cuarenta y dos/);
    assert.equal(JSON.stringify([...mem.vinculos]), antes);
    assert.equal(mem.correos.length, 0, 'por este camino no se pide código al correo');
  });

  it('un segundo llamante que dicta el código de otra llamada no hereda nada', async () => {
    const mem = academicoEnMemoria();
    conectarContratosVoz({ academico: mem.api, agendaActiva: false });
    const { d: dAna } = depsDesdeRegistro();
    const { d: dOtro } = depsDesdeRegistro({ telefonoLlamante: '573209998877' });
    await conversar(['quiero mi turno', 'T00012345'], dAna);
    const codigoAna = mem.correos[0].codigo;
    const [, o2] = await conversar(['quiero mi turno', 'T00012345'], dOtro);
    assert.notEqual(mem.correos[1].codigo, codigoAna);
    let s = o2.estado;
    for (let i = 0; i < 3; i++) {
      const r = await correrTurno(codigoAna, s, dOtro);
      assert.equal(r.estado.verificado, null);
      assert.doesNotMatch(r.respuesta, /verificado|cuarenta y dos/);
      s = r.estado;
    }
    assert.equal(s.fase, 'ofrece_asesor', 'a los 3 intentos deja de probar');
    assert.equal(mem.turnosLeidos.length, 0, 'no se leyó ningún dato');
  });

  it('código vencido: no verifica ni consulta', async () => {
    const mem = academicoEnMemoria();
    conectarContratosVoz({ academico: mem.api, agendaActiva: false });
    let ahora = AHORA.getTime();
    const { d } = depsDesdeRegistro({ ahora: () => new Date(ahora) });
    const [, r2] = await conversar(['quiero mi turno', 'T00012345'], d);
    ahora += 11 * 60_000;
    const r3 = await correrTurno(mem.correos[0].codigo, r2.estado, d);
    assert.match(r3.respuesta, /venció/);
    assert.equal(r3.estado.verificado, null);
    assert.equal(mem.turnosLeidos.length, 0);
  });

  it('código dictado equivocado: no verifica ni consulta', async () => {
    const mem = academicoEnMemoria();
    conectarContratosVoz({ academico: mem.api, agendaActiva: false });
    const { d } = depsDesdeRegistro();
    const [, r2] = await conversar(['quiero mi turno', 'T00012345'], d);
    const r3 = await correrTurno('uno uno uno uno uno uno', r2.estado, d);
    assert.match(r3.respuesta, /no coincide/);
    assert.equal(r3.estado.verificado, null);
    assert.equal(mem.turnosLeidos.length, 0);
  });

  it('recibo sin cédula guardada: lo dice, no la pide por voz y ofrece seguir por WhatsApp', async () => {
    const mem = academicoEnMemoria();
    conectarContratosVoz({ academico: mem.api, agendaActiva: false });
    const { d, whatsapp } = depsDesdeRegistro();
    // Luis no tiene cédula guardada (Ana sí: con su vínculo real el recibo ya no pide nada).
    const [, r2] = await conversar(['mi recibo', 'T00099999'], d);
    const r3 = await correrTurno(mem.correos[0].codigo, r2.estado, d);
    assert.match(r3.respuesta, /cédula/);
    assert.match(r3.respuesta, /WhatsApp/);
    assert.equal(r3.estado.fase, 'ofrece_whatsapp_recibo');
    const r4 = await correrTurno('sí, por favor', r3.estado, d);
    assert.match(r4.respuesta, /te escribí por WhatsApp/);
    assert.deepEqual(whatsapp, [{ telefono: LLAMA, texto: TEXTO_RECIBO_WHATSAPP }]);
    assert.doesNotMatch(TEXTO_RECIBO_WHATSAPP, /\d{6,}/, 'el WhatsApp no lleva datos del estudiante');
  });

  it('el cableado registra la implementación real con la verificación por correo', () => {
    conectarContratosVoz();
    const { academico, agenda } = contratosRegistrados();
    assert.ok(academico, 'académico registrado');
    assert.equal(typeof academico!.iniciarVerificacionPorDato, 'function');
    assert.equal(typeof academico!.confirmarVerificacion, 'function');
    // .env.test no define AGENDA_ACTIVA: así queda el valor por defecto, que debe ser APAGADA.
    assert.equal(agenda, null, 'sin AGENDA_ACTIVA=true la voz no registra la agenda');
    conectarContratosVoz({ agendaActiva: true });
    assert.ok(contratosRegistrados().agenda, 'encendida a propósito, sí');
  });

  it('con la agenda apagada por defecto, pedir un asesor fuera de horario no ofrece citas', async () => {
    conectarContratosVoz({ academico: academicoEnMemoria().api, agenda: await agendaEnMemoria() });
    const { d } = depsDesdeRegistro();
    const [r1] = await conversar(['quiero hablar con un asesor'], d);
    assert.equal(r1.estado.fase, 'ofrece_devolucion', r1.respuesta);
    assert.doesNotMatch(r1.respuesta, /agendar|espacio/);
  });
});

describe('voz + agenda real', () => {
  it('sin asesores en vivo: ofrece franjas reales, reserva y la cita aparece en citasDe', async () => {
    const ag = await agendaEnMemoria();
    conectarContratosVoz({ academico: academicoEnMemoria().api, agenda: ag, agendaActiva: true });
    const { d } = depsDesdeRegistro();
    const [r1, r2, r3] = await conversar(['quiero hablar con un asesor', 'la primera', 'sí'], d);
    assert.equal(r1.estado.fase, 'elige_franja', r1.respuesta);
    assert.match(r1.respuesta, /te puedo agendar/);
    assert.equal(r2.estado.fase, 'confirma_franja');
    assert.equal(r3.resultado, 'cita', r3.respuesta);
    const citas = await (ag as AgendaApi).citasDe(LLAMA);
    assert.equal(citas.length, 1);
    assert.equal(citas[0].canal, 'voz');
    assert.equal(citas[0].asesor, 'laura');
    assert.equal(citas[0].id, r3.cita?.id);
  });
});

describe('voz + agenda: el área de la cita según de dónde viene la persona', () => {
  async function agendarCon(frases: string[], over: Partial<DepsTurno>) {
    const ag = await agendaTresAreas();
    const mem = academicoEnMemoria();
    conectarContratosVoz({ academico: mem.api, agenda: ag, agendaActiva: true });
    const { d } = depsDesdeRegistro(over);
    const rs = await conversar([...frases, 'la primera', 'sí'], d);
    const ultima = rs[rs.length - 1];
    assert.equal(ultima.resultado, 'cita', rs.map((r) => r.respuesta).join(' | '));
    return ultima.cita!;
  }

  it('estudiante verificado de pregrado → «pregrado»', async () => {
    const cita = await agendarCon(['quiero mi turno', '4 8 2 9 1 3', 'quiero hablar con un asesor'], { telefonoLlamante: ANA_TEL, generarCodigo: () => '482913' });
    assert.equal(cita.area, 'pregrado');
    assert.equal(cita.asesor, 'pedro');
  });

  it('pidió soporte técnico → «ti»', async () => {
    const cita = await agendarCon(['olvidé mi contraseña del correo, quiero hablar con un asesor'], {});
    assert.equal(cita.area, 'ti');
    assert.equal(cita.asesor, 'mario');
  });

  it('nadie verificado y sin soporte → «posgrados»', async () => {
    const cita = await agendarCon(['quiero hablar con un asesor'], {});
    assert.equal(cita.area, 'posgrados');
    assert.equal(cita.asesor, 'laura');
  });

  it('verificado pero sin nivel pregrado → «posgrados»', async () => {
    const cita = await agendarCon(['quiero mi turno', '4 8 2 9 1 3', 'quiero hablar con un asesor'], { telefonoLlamante: LUIS_TEL, generarCodigo: () => '482913' });
    assert.equal(cita.area, 'posgrados');
  });
});

// Para que TypeScript compruebe que el núcleo real cumple el contrato ampliado.
const _contrato: (a: ReturnType<typeof crearAcademico>) => AcademicoApi = (a) => a;
void _contrato;
