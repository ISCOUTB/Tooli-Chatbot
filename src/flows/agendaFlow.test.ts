import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';
import { crearAgenda, AgendaServicio } from '../services/agendaService';
import { MundoFake, crearMundo, dispSemana } from '../services/agenda.fakes.test';
import { EstadoFlujoAgenda, FlujoAgenda, areaDeSesion, crearFlujoAgenda, intencionAgenda } from './agendaFlow';

const bog = (iso: string) => Date.parse(`${iso}-05:00`);
const TEL = '573001234567';
const TEL2 = '573009876543';

interface Enviado { tipo: 'texto' | 'botones' | 'lista'; to: string; texto: string; ids: string[]; filas: Array<{ id: string; title: string; description?: string }> }

let mundo: MundoFake;
let agenda: AgendaServicio;
let flujo: FlujoAgenda;
let enviados: Enviado[];
let estados: Map<string, EstadoFlujoAgenda>;
let activa: boolean;

async function preparar() {
  mundo = crearMundo();
  agenda = crearAgenda(mundo.deps);
  await agenda.guardarDisponibilidad('laura', dispSemana(['posgrados', 'pregrado']));
  await agenda.guardarDisponibilidad('mario', dispSemana(['ti']));
  enviados = [];
  estados = new Map();
  activa = true;
  flujo = crearFlujoAgenda({
    agenda,
    mensajes: {
      sendText: async (m) => { enviados.push({ tipo: 'texto', to: m.to, texto: m.text ?? '', ids: [], filas: [] }); },
      sendButtons: async (m) => { enviados.push({ tipo: 'botones', to: m.to, texto: `${m.title}\n${m.description}`, ids: m.buttons.map((b) => b.id), filas: [] }); },
      sendList: async (m) => {
        const filas = m.sections.flatMap((s) => s.rows);
        enviados.push({ tipo: 'lista', to: m.to, texto: `${m.title}\n${m.description}`, ids: filas.map((f) => f.id), filas });
      },
    },
    estado: {
      get: async (t) => estados.get(t) ?? null,
      set: async (t, e) => { estados.set(t, structuredClone(e)); },
      del: async (t) => { estados.delete(t); },
    },
    ahora: () => mundo.reloj.ahora,
    activa: () => activa,
  });
}

const ultimo = () => enviados[enviados.length - 1];
const SESION_POSGRADO = { step: 'with_agent', data: { conversationId: '55', area: 'posgrados', nombre: 'Ana Ruiz' } };
const SESION_MENU = { step: 'menu', data: {} };

describe('reconocer lo que escribe la persona', () => {
  it('detecta agendar, mis citas, cancelar y reprogramar', () => {
    const casos: Array<[string, string | null]> = [
      ['agendar', 'agendar'], ['Quiero agendar una cita', 'agendar'], ['necesito una cita con un asesor', 'agendar'],
      ['me gustaría reservar una cita', 'agendar'], ['AGENDA', 'agendar'], ['cita con un asesor', 'agendar'],
      ['mis citas', 'mis_citas'], ['¿Cuándo es mi cita?', 'mis_citas'], ['ver mis citas', 'mis_citas'],
      ['cancelar cita', 'cancelar'], ['quiero cancelar mi cita', 'cancelar'],
      ['reprogramar', 'reprogramar'], ['quiero reprogramar mi cita', 'reprogramar'], ['cambiar mi cita', 'reprogramar'],
    ];
    for (const [texto, esperado] of casos) assert.equal(intencionAgenda(texto), esperado, texto);
  });

  it('no secuestra conversaciones que no son de la agenda', () => {
    for (const texto of ['hola', 'quiero hablar con un asesor', 'cuánto cuesta la maestría?', 'asesor', 'menu', '1',
      'quiero información sobre el posgrado en gerencia', 'tengo una cita médica y no puedo ir a clase', '']) {
      assert.equal(intencionAgenda(texto), null, texto);
    }
    // Un mensaje larguísimo tampoco.
    assert.equal(intencionAgenda(`quiero una cita ${'palabra '.repeat(20)}`), null);
  });

  it('deduce el área de la sesión del bot', () => {
    assert.equal(areaDeSesion({ step: 'with_agent', data: { area: 'ti' } }), 'ti');
    assert.equal(areaDeSesion({ step: 'with_agent', data: { area: 'posgrados' } }), 'posgrados');
    assert.equal(areaDeSesion({ step: 'x', data: { area: 'admisiones', originArea: 'posgrado' } }), 'posgrados');
    assert.equal(areaDeSesion({ step: 'x', data: { area: 'admisiones' } }), 'pregrado');
    assert.equal(areaDeSesion({ step: 'menu', data: {} }), null);
    assert.equal(areaDeSesion(null), null);
  });
});

describe('WhatsApp de punta a punta', () => {
  beforeEach(preparar);

  it('fuera de horario: ofrece agendar, muestra 3 franjas, confirma y manda la confirmación con fecha en palabras', async () => {
    assert.equal(await flujo.ofrecerTrasHandoff(TEL, 'posgrados', 'fuera_horario'), true);
    assert.deepEqual(ultimo().ids, ['ag:ofrecer', 'ag:no']);
    assert.match(ultimo().texto, /fuera del horario/);

    // Toca «Agendar cita»: la sesión sigue siendo con_agent y no se toca.
    assert.equal(await flujo.atender(TEL, 'ag:ofrecer', SESION_POSGRADO), true);
    const lista = ultimo();
    assert.equal(lista.tipo, 'lista');
    assert.deepEqual(lista.ids, ['ag:s:0', 'ag:s:1', 'ag:s:2', 'ag:mas', 'ag:no']);
    assert.deepEqual(lista.filas.slice(0, 3).map((f) => f.title), ['lun 23 nov · 10:00 a. m.', 'mar 24 nov · 9:00 a. m.', 'mié 25 nov · 9:00 a. m.']);
    assert.ok(lista.filas.every((f) => f.title.length <= 24 && (f.description ?? '').length <= 72));
    assert.match(lista.filas[0].description!, /Laura Pérez/);
    assert.equal(estados.get(TEL)?.paso, 'franja');

    // Elige la 2.ª: pide confirmación con botones.
    assert.equal(await flujo.atender(TEL, 'ag:s:1', SESION_POSGRADO), true);
    assert.equal(ultimo().tipo, 'botones');
    assert.deepEqual(ultimo().ids, ['ag:ok', 'ag:otra', 'ag:no']);
    assert.match(ultimo().texto, /martes 24 de noviembre a las 9:00 a\. m\./);
    assert.deepEqual(await agenda.citasDe(TEL), [], 'todavía no hay cita: falta confirmar');

    assert.equal(await flujo.atender(TEL, 'ag:ok', SESION_POSGRADO), true);
    const conf = ultimo().texto;
    assert.match(conf, /Tu cita quedó confirmada/);
    assert.match(conf, /mañana martes 24 de noviembre a las 9:00 a\. m\./);
    assert.match(conf, /Laura Pérez/);
    assert.match(conf, /Posgrados/);
    assert.match(conf, /30 min/);
    assert.match(conf, /\*cancelar cita\*/);
    assert.match(conf, /\*reprogramar\*/);
    assert.equal(estados.has(TEL), false, 'el flujo termina');
    const citas = await agenda.citasDe(TEL);
    assert.equal(citas.length, 1);
    assert.equal(citas[0].canal, 'whatsapp');
    assert.equal(citas[0].nombre, 'Ana Ruiz', 'toma el nombre de la sesión');
    assert.equal(mundo.recordatorios.length, 2, 'recordatorio de 24 h y de 1 h');
  });

  it('«agendar» sin área conocida pregunta el área y luego ofrece horarios', async () => {
    assert.equal(await flujo.atender(TEL, 'Quiero agendar una cita', SESION_MENU), true);
    assert.deepEqual(ultimo().ids, ['ag:a:posgrados', 'ag:a:pregrado', 'ag:a:ti']);
    assert.equal(await flujo.atender(TEL, 'ag:a:ti', SESION_MENU), true);
    assert.equal(ultimo().tipo, 'lista');
    assert.match(ultimo().filas[0].description!, /Mario Gómez/, 'TI la atiende Mario');
    assert.match(ultimo().texto, /Soporte TI/);
  });

  it('con un asesor humano en el chat, escribir «agendar» NO se lo roba: sigue para el asesor', async () => {
    assert.equal(await flujo.atender(TEL, 'agendar', SESION_POSGRADO), false);
    assert.equal(await flujo.atender(TEL, 'mis citas', SESION_POSGRADO), false);
    assert.deepEqual(enviados, []);
  });

  it('con el asesor en el chat, un texto cualquiera en mitad del flujo suelta el flujo y llega al asesor', async () => {
    await flujo.atender(TEL, 'ag:ofrecer', SESION_POSGRADO);
    assert.equal(estados.has(TEL), true);
    assert.equal(await flujo.atender(TEL, 'hola, una pregunta sobre mi caso', SESION_POSGRADO), false);
    assert.equal(estados.has(TEL), false);
  });

  it('fuera del chat con asesor, un texto raro dentro del flujo repite la instrucción en vez de perderse', async () => {
    await flujo.atender(TEL, 'agendar', { step: 'menu', data: { area: 'posgrados' } });
    assert.equal(await flujo.atender(TEL, 'blablabla', SESION_MENU), true);
    assert.match(ultimo().texto, /No te entendí/);
    assert.equal(estados.get(TEL)?.paso, 'franja');
  });

  it('se puede elegir escribiendo el número', async () => {
    await flujo.atender(TEL, 'agendar', { step: 'menu', data: { area: 'posgrados' } });
    await flujo.atender(TEL, '3', SESION_MENU);
    assert.match(ultimo().texto, /miércoles 25 de noviembre/);
    await flujo.atender(TEL, 'si', SESION_MENU);
    assert.equal((await agenda.citasDe(TEL))[0].inicio, '2026-11-25T09:00:00-05:00');
  });

  it('«menu» abandona el flujo y deja que el bot lo atienda', async () => {
    await flujo.atender(TEL, 'agendar', { step: 'menu', data: { area: 'posgrados' } });
    assert.equal(await flujo.atender(TEL, 'menu', SESION_MENU), false);
    assert.equal(estados.has(TEL), false);
  });

  it('«ver más horarios» sigue desde donde iba, sin repetir', async () => {
    await flujo.atender(TEL, 'agendar', { step: 'menu', data: { area: 'posgrados' } });
    const primeros = ultimo().filas.slice(0, 3).map((f) => f.title);
    await flujo.atender(TEL, 'ag:mas', SESION_MENU);
    const siguientes = ultimo().filas.slice(0, 3).map((f) => f.title);
    assert.equal(siguientes.length, 3);
    assert.equal(siguientes.some((t) => primeros.includes(t)), false);
  });

  it('«ver más horarios» recorre toda la ventana sin saltarse días ni repetir', async () => {
    // Laura: lunes a viernes, 12 citas al día, ventana de 14 días (del lun 23 nov al dom 6 dic).
    await flujo.atender(TEL, 'agendar', { step: 'menu', data: { area: 'posgrados' } });
    const vistas: string[] = [];
    const anotar = () => { for (const f of estados.get(TEL)?.franjas ?? []) vistas.push(f.inicio); };
    anotar();
    const dias = () => [...new Set(vistas.map((i) => i.slice(0, 10)))].sort();
    for (let pagina = 0; pagina < 6; pagina++) {
      await flujo.atender(TEL, 'ag:mas', SESION_MENU);
      assert.equal(ultimo().tipo, 'lista', `página ${pagina + 2}: ${ultimo().texto}`);
      anotar();
    }
    assert.deepEqual(dias(), [
      '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27',
      '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04',
    ], 'en 7 páginas aparecen todos los días hábiles de la ventana');
    assert.equal(new Set(vistas).size, vistas.length, 'ninguna franja se repite');

    // Siguiendo, aparecen también las horas que quedaron atrás; al final, y solo al final, dice que no hay más.
    const total = (await agenda.franjasLibres({ area: 'posgrados', max: 1000 })).length;
    for (let i = 0; i < 100 && ultimo().tipo === 'lista'; i++) {
      await flujo.atender(TEL, 'ag:mas', SESION_MENU);
      if (ultimo().tipo === 'lista') anotar();
    }
    assert.match(ultimo().texto, /Ya no tengo más horarios/);
    assert.equal(new Set(vistas).size, total, 'se ofrecieron todas las franjas de la ventana');
  });

  it('«otro horario» al confirmar vuelve a la lista; «no agendar» cierra sin reservar', async () => {
    await flujo.atender(TEL, 'agendar', { step: 'menu', data: { area: 'posgrados' } });
    await flujo.atender(TEL, 'ag:s:0', SESION_MENU);
    await flujo.atender(TEL, 'ag:otra', SESION_MENU);
    assert.equal(ultimo().tipo, 'lista');
    await flujo.atender(TEL, 'ag:s:0', SESION_MENU);
    await flujo.atender(TEL, 'ag:no', SESION_MENU);
    assert.match(ultimo().texto, /no agendé nada/);
    assert.deepEqual(await agenda.citasDe(TEL), []);
    assert.equal(estados.has(TEL), false);
  });

  it('si reservar falla, el log no lleva el teléfono ni el correo que traiga el error', async () => {
    await flujo.atender(TEL, 'agendar', { step: 'menu', data: { area: 'posgrados' } });
    await flujo.atender(TEL, 'ag:s:1', SESION_MENU);
    mock.method(agenda, 'reservar', async () => { throw new Error(`fallo al guardar cita de ${TEL} (ana.ruiz@utb.edu.co)`); });
    const logs: string[] = [];
    const espia = mock.method(console, 'error', (...args: unknown[]) => { logs.push(args.map(String).join(' ')); });
    try {
      await flujo.atender(TEL, 'ag:ok', SESION_MENU);
    } finally {
      espia.mock.restore();
      mock.restoreAll();
    }
    assert.match(ultimo().texto, /No pude agendar tu cita/);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /\[agenda\] fallo al reservar por WhatsApp: \[Error\]/);
    assert.doesNotMatch(logs[0], new RegExp(TEL));
    assert.doesNotMatch(logs[0], /ana\.ruiz@/);
    assert.match(logs[0], /\*\*\*\*4567/);
  });

  it('si alguien se lleva la hora entre la oferta y la confirmación, avisa y ofrece otras', async () => {
    await flujo.atender(TEL, 'agendar', { step: 'menu', data: { area: 'posgrados' } });
    await flujo.atender(TEL, 'ag:s:1', SESION_MENU);   // martes 9:00 con Laura
    // Otra persona reserva esa hora justo antes.
    const tomada = estados.get(TEL)!.elegida!;
    assert.equal((await agenda.reservar({ telefono: TEL2, area: 'posgrados', franja: tomada, canal: 'voz' })).ok, true);
    await flujo.atender(TEL, 'ag:ok', SESION_MENU);
    const textos = enviados.slice(-2);
    assert.match(textos[0].texto, /se acaba de ocupar/);
    assert.equal(textos[1].tipo, 'lista');
    assert.deepEqual(await agenda.citasDe(TEL), [], 'no quedó con la cita de otro');
    assert.equal((await agenda.citasDe(TEL2)).length, 1);
  });

  it('sin horarios disponibles lo dice y no deja el flujo abierto', async () => {
    await agenda.guardarDisponibilidad('laura', dispSemana(['posgrados'], { activo: false }));
    assert.equal(await flujo.ofrecerTrasHandoff(TEL, 'posgrados', 'sin_asesor'), false, 'no ofrece lo que no hay');
    await flujo.atender(TEL, 'agendar', { step: 'menu', data: { area: 'posgrados' } });
    assert.match(ultimo().texto, /no hay horarios disponibles/);
    assert.equal(estados.has(TEL), false);
  });

  it('al llegar al límite de citas lo explica y apunta a «mis citas»', async () => {
    for (const h of ['09:00', '09:30']) {
      await agenda.reservar({ telefono: TEL, area: 'posgrados', canal: 'whatsapp', franja: { asesor: 'laura', asesorNombre: 'x', inicio: `2026-11-24T${h}:00-05:00`, fin: `2026-11-24T${h === '09:00' ? '09:30' : '10:00'}:00-05:00` } });
    }
    await flujo.atender(TEL, 'agendar', { step: 'menu', data: { area: 'posgrados' } });
    assert.match(enviados.find((e) => /Ya tienes 2 citas/.test(e.texto))!.texto, /mis citas/);
    await flujo.atender(TEL, 'ag:s:2', SESION_MENU);
    await flujo.atender(TEL, 'ag:ok', SESION_MENU);
    assert.match(ultimo().texto, /máximo de citas/);
    assert.equal((await agenda.citasDe(TEL)).length, 2);
  });

  it('mis citas lista solo las del propio teléfono', async () => {
    await flujo.atender(TEL, 'agendar', { step: 'menu', data: { area: 'posgrados' } });
    await flujo.atender(TEL, 'ag:s:1', SESION_MENU);
    await flujo.atender(TEL, 'ag:ok', SESION_MENU);
    await flujo.atender(TEL, 'mis citas', SESION_MENU);
    assert.match(ultimo().texto, /Tus citas/);
    assert.match(ultimo().texto, /martes 24 de noviembre/);
    await flujo.atender(TEL2, 'mis citas', SESION_MENU);
    assert.match(ultimo().texto, /No tienes citas agendadas/);
    assert.equal(ultimo().to, TEL2);
  });

  it('cancelar por WhatsApp: pide confirmación, cancela, libera la hora y cancela los recordatorios', async () => {
    await flujo.atender(TEL, 'agendar', { step: 'menu', data: { area: 'posgrados' } });
    await flujo.atender(TEL, 'ag:s:1', SESION_MENU);
    await flujo.atender(TEL, 'ag:ok', SESION_MENU);
    const id = (await agenda.citasDe(TEL))[0].id;

    await flujo.atender(TEL, 'cancelar cita', SESION_MENU);
    assert.deepEqual(ultimo().ids, ['ag:cok', 'ag:no']);
    await flujo.atender(TEL, 'ag:no', SESION_MENU);
    assert.match(ultimo().texto, /sigue en pie/);
    assert.equal((await agenda.citasDe(TEL)).length, 1);

    await flujo.atender(TEL, 'cancelar cita', SESION_MENU);
    await flujo.atender(TEL, 'ag:cok', SESION_MENU);
    assert.match(ultimo().texto, /Cancelé tu cita del mañana martes 24 de noviembre|Cancelé tu cita del martes 24 de noviembre/);
    assert.equal((await agenda.obtenerCita(id))?.estado, 'cancelada');
    assert.ok(mundo.recordatorios.every((r) => r.cancelado));
    // La hora vuelve a estar libre.
    assert.equal((await agenda.franjasLibres({ area: 'posgrados', desde: new Date(bog('2026-11-24T00:00:00')), dias: 1 }))[0].inicio, '2026-11-24T09:00:00-05:00');
  });

  it('cancelar sin citas lo dice, y nadie puede cancelar la cita de otro por WhatsApp', async () => {
    await flujo.atender(TEL, 'agendar', { step: 'menu', data: { area: 'posgrados' } });
    await flujo.atender(TEL, 'ag:s:1', SESION_MENU);
    await flujo.atender(TEL, 'ag:ok', SESION_MENU);
    await flujo.atender(TEL2, 'cancelar cita', SESION_MENU);
    assert.match(ultimo().texto, /No tienes citas agendadas/);
    assert.equal((await agenda.citasDe(TEL)).length, 1);
  });

  it('con dos citas, cancelar pregunta cuál', async () => {
    for (const [h, f] of [['09:00', '09:30'], ['10:00', '10:30']]) {
      await agenda.reservar({ telefono: TEL, area: 'posgrados', canal: 'whatsapp', franja: { asesor: 'laura', asesorNombre: 'x', inicio: `2026-11-24T${h}:00-05:00`, fin: `2026-11-24T${f}:00-05:00` } });
    }
    await flujo.atender(TEL, 'cancelar cita', SESION_MENU);
    assert.equal(ultimo().tipo, 'lista');
    assert.deepEqual(ultimo().ids, ['ag:c:0', 'ag:c:1']);
    await flujo.atender(TEL, 'ag:c:1', SESION_MENU);
    await flujo.atender(TEL, 'ag:cok', SESION_MENU);
    const quedan = await agenda.citasDe(TEL);
    assert.equal(quedan.length, 1);
    assert.equal(quedan[0].inicio, '2026-11-24T09:00:00-05:00');
  });

  it('reprogramar por WhatsApp mueve la cita a la nueva hora', async () => {
    await flujo.atender(TEL, 'agendar', { step: 'menu', data: { area: 'posgrados' } });
    await flujo.atender(TEL, 'ag:s:1', SESION_MENU);
    await flujo.atender(TEL, 'ag:ok', SESION_MENU);
    const vieja = (await agenda.citasDe(TEL))[0];

    await flujo.atender(TEL, 'quiero reprogramar mi cita', SESION_MENU);
    assert.equal(ultimo().tipo, 'lista', 'ofrece nuevos horarios del mismo área');
    assert.match(ultimo().texto, /Nuevo horario/);
    await flujo.atender(TEL, 'ag:s:2', SESION_MENU);
    await flujo.atender(TEL, 'ag:ok', SESION_MENU);
    assert.match(ultimo().texto, /Cambiamos tu cita/);
    const ahora = await agenda.citasDe(TEL);
    assert.equal(ahora.length, 1);
    assert.notEqual(ahora[0].inicio, vieja.inicio);
    assert.equal((await agenda.obtenerCita(vieja.id))?.estado, 'cancelada');
  });

  it('pedir cancelar en pleno agendado cambia de tema', async () => {
    await agenda.reservar({ telefono: TEL, area: 'posgrados', canal: 'whatsapp', franja: { asesor: 'laura', asesorNombre: 'x', inicio: '2026-11-24T09:00:00-05:00', fin: '2026-11-24T09:30:00-05:00' } });
    await flujo.atender(TEL, 'agendar', { step: 'menu', data: { area: 'posgrados' } });
    await flujo.atender(TEL, 'cancelar cita', SESION_MENU);
    assert.deepEqual(ultimo().ids, ['ag:cok', 'ag:no']);
  });

  it('un botón viejo sin flujo activo responde que venció; ag:no suelto es amable', async () => {
    assert.equal(await flujo.atender(TEL, 'ag:ok', SESION_MENU), true);
    assert.match(ultimo().texto, /venció/);
    assert.equal(await flujo.atender(TEL, 'ag:no', SESION_POSGRADO), true);
    assert.match(ultimo().texto, /Sin problema/);
  });

  it('apagada con AGENDA_ACTIVA=false no toca nada', async () => {
    activa = false;
    assert.equal(await flujo.atender(TEL, 'agendar', SESION_MENU), false);
    assert.equal(await flujo.atender(TEL, 'ag:ofrecer', SESION_POSGRADO), false);
    assert.equal(await flujo.ofrecerTrasHandoff(TEL, 'posgrados', 'fuera_horario'), false);
    assert.deepEqual(enviados, []);
  });

  it('reprogramar solo promete «te avisaremos» si de verdad quedó un recordatorio', async () => {
    mundo.adaptador.valor = 'meta';
    mundo.entrantes.set(TEL, mundo.reloj.ahora);
    await flujo.atender(TEL, 'agendar', { step: 'menu', data: { area: 'posgrados' } });
    await flujo.atender(TEL, 'ag:s:1', SESION_MENU);
    await flujo.atender(TEL, 'ag:ok', SESION_MENU);
    // Nueva hora a más de 24 h del último mensaje: con Meta no sale ningún recordatorio.
    await flujo.atender(TEL, 'reprogramar', SESION_MENU);
    await flujo.atender(TEL, 'ag:s:2', SESION_MENU);
    await flujo.atender(TEL, 'ag:ok', SESION_MENU);
    assert.match(ultimo().texto, /Cambiamos tu cita/);
    assert.equal(mundo.recordatorios.filter((r) => !r.cancelado).length, 0);
    assert.doesNotMatch(ultimo().texto, /avisaremos/i);

    // Con Evolution (sin ventana) sí se programa y se dice.
    mundo.adaptador.valor = 'evolution';
    await flujo.atender(TEL, 'reprogramar', SESION_MENU);
    await flujo.atender(TEL, 'ag:s:2', SESION_MENU);
    await flujo.atender(TEL, 'ag:ok', SESION_MENU);
    assert.ok(mundo.recordatorios.some((r) => !r.cancelado));
    assert.match(ultimo().texto, /Te avisaremos antes de la hora/);
  });

  it('con Meta, la confirmación no promete un recordatorio que no se programó', async () => {
    mundo.adaptador.valor = 'meta';
    await flujo.atender(TEL, 'agendar', { step: 'menu', data: { area: 'posgrados' } });
    await flujo.atender(TEL, 'ag:s:2', SESION_MENU);
    await flujo.atender(TEL, 'ag:ok', SESION_MENU);
    assert.doesNotMatch(ultimo().texto, /recordatorio/i);
    assert.equal(mundo.recordatorios.length, 0);
  });
});
