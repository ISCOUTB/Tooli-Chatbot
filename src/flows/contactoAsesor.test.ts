// Punta a punta del canal de contacto con el asesor de Posgrados (23-nov-2026): la persona elige
// 💬 este chat, 📞 llamada (número y franja, o cita con la agenda encendida) o 📧 correo, con botón o
// escribiendo. Se mira lo que llega al asesor (Chatwoot), al CRM, a la hoja y a HubSpot.
// Solo se reemplaza la infraestructura (Redis, Chatwoot, CRM, hoja, HubSpot, la IA, la agenda y el envío).
// Se corre con --experimental-test-module-mocks (tools/run-tests.cjs lo pasa).
import { before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

// El inicio conversacional enciende los atajos (saludo, BAJA, preguntas) en los pasos del flujo.
process.env.FLUJO_CONVERSACIONAL = 'true';

class RedisMemoria {
  constructor() {
    return new Proxy(this, {
      get(obj, prop) {
        if (prop in obj) return (obj as unknown as Record<string | symbol, unknown>)[prop];
        if (prop === 'then') return undefined;
        return () => { throw new Error(`RedisMemoria: ${String(prop)} no implementado`); };
      },
    });
  }
  async get() { return null; }
  on() { return this; }
  once() { return this; }
  disconnect() {}
  async quit() { return 'OK'; }
}
const SIN_MOCKS = typeof (mock as { module?: unknown }).module !== 'function'
  ? 'necesita Node 22.3+ con --experimental-test-module-mocks' : false;
if (!SIN_MOCKS) mock.module('ioredis', { defaultExport: RedisMemoria });

const TEL = '573001112233';
const BSUID = 'CO.ABC123xyz';

type Enviado = { tipo: 'texto' | 'botones' | 'lista'; to: string; msg: Record<string, unknown> };
type Conversacion = { initialMessage: string; labels: string[]; customAttributes: Record<string, string> };
const enviados: Enviado[] = [];
const conversaciones: Conversacion[] = [];
const sesiones = new Map<string, { step: string; data: Record<string, string> }>();
const perfiles = new Map<string, Record<string, string>>();
const notas: string[] = [];
const etiquetasCrm: string[][] = [];
const filasHoja: Array<Record<string, unknown>> = [];
const hubspot: Array<Record<string, unknown>> = [];
const agenda: Array<{ text: string; session: { step: string; data?: Record<string, string> } | null }> = [];
const preguntasIa: string[] = [];
let fueraDeHorario = false;

let handleMessage: typeof import('./index').handleMessage;
let config: typeof import('../config').config;

before(async () => {
  if (SIN_MOCKS) return;
  const [sesion, metricas, chatwoot, atencion, perfil, consentimiento, crm, registro, hub, incidencias, noReco, ia, campana] = await Promise.all([
    import('../services/session'), import('../services/metrics'), import('../services/chatwootService'),
    import('../services/atencionEquipoService'), import('../services/perfilService'), import('../services/consentimientoService'),
    import('../services/crmService'), import('../services/registroService'), import('../services/hubspotService'),
    import('../services/incidenciasService'), import('../services/noReconocidoService'), import('../services/aiAssistant'),
    import('../services/campanaService'),
  ]);
  mock.module('../services/session', { namedExports: {
    ...sesion,
    getSession: async (t: string) => sesiones.get(t) ?? null,
    setSession: async (t: string, s: { step: string; data: Record<string, string> }) => { sesiones.set(t, s); },
    deleteSession: async (t: string) => { sesiones.delete(t); },
    claimMessageId: async () => true,
  } });
  mock.module('../services/metrics', { namedExports: { ...metricas, track: async () => {} } });
  mock.module('../services/chatwootService', { namedExports: {
    ...chatwoot,
    getOrCreateContact: async () => ({ sourceId: 'src-1', contactId: 1 }),
    createConversation: async (o: Conversacion) => { conversaciones.push(o); return 91; },
  } });
  mock.module('../services/atencionEquipoService', { namedExports: {
    ...atencion,
    dentroDeHorarioAsync: async () => !fueraDeHorario,
    textoProximaAtencion: async () => 'lunes 8:00 a. m.',
  } });
  // Perfil en memoria con la misma regla del real: sin autorización no se guarda nada.
  mock.module('../services/perfilService', { namedExports: {
    ...perfil,
    leerPerfil: async (t: string) => perfiles.get(t) ?? null,
    guardarPerfil: async (t: string, d: Record<string, string>) => { perfiles.set(t, perfil.perfilDeDatos(d)); },
    completarPerfil: async (t: string, campos: Record<string, string>) => {
      const junto = { ...(perfiles.get(t) ?? {}), ...Object.fromEntries(Object.entries(campos).filter(([, v]) => v)) };
      if (junto.datos === 'si') perfiles.set(t, perfil.perfilDeDatos(junto));
    },
    conLoRecordado: async (_t: string, d: Record<string, string>) => d,
  } });
  mock.module('../services/consentimientoService', { namedExports: {
    ...consentimiento, registrarDecision: async () => {}, decisionGuardada: async () => null,
  } });
  mock.module('../services/crmService', { namedExports: {
    ...crm,
    agregarNota: async (_p: string, texto: string) => { notas.push(texto); return {}; },
    getFicha: async () => ({ etiquetas: [] }),
    setEtiquetas: async (_p: string, e: string[]) => { etiquetasCrm.push(e); return {}; },
  } });
  mock.module('../services/registroService', { namedExports: {
    ...registro,
    guardarRegistroProspecto: async (r: Record<string, unknown>) => { filasHoja.push(r); return 5; },
    actualizarRegistroProspecto: async (_f: number, r: Record<string, unknown>) => { filasHoja.push(r); },
  } });
  mock.module('../services/hubspotService', { namedExports: {
    ...hub, upsertContactoHubspot: async (l: Record<string, unknown>) => { hubspot.push(l); },
  } });
  mock.module('../services/incidenciasService', { namedExports: { ...incidencias, registrarIncidencia: async () => {} } });
  mock.module('../services/noReconocidoService', { namedExports: { ...noReco, registrarNoReconocido: async () => {} } });
  mock.module('../services/campanaService', { namedExports: {
    ...campana, darDeBaja: async () => {}, leerContextoCampana: async () => null, borrarContextoCampana: async () => {},
  } });
  mock.module('../services/aiAssistant', { namedExports: {
    ...ia,
    preguntarAI: async (_a: string, texto: string) => { preguntasIa.push(texto); return { answer: 'Respuesta de la IA.' }; },
  } });
  // La agenda real necesita Redis: aquí solo se mira quién la llama y con qué.
  mock.module('./agendaFlowRuntime', { namedExports: {
    atenderAgenda: async (_f: string, text: string, session: { step: string; data?: Record<string, string> } | null) => {
      agenda.push({ text, session });
      return text === 'ag:ofrecer';
    },
    hayAsesorLibre: async () => true,
    ofrecerAgendaTrasHandoff: async () => {},
  } });

  const shared = await import('./shared');
  const registrar = (tipo: Enviado['tipo']) => async (msg: Record<string, unknown>) => { enviados.push({ tipo, to: String(msg.to), msg }); };
  mock.method(shared.messaging, 'sendText', registrar('texto'));
  mock.method(shared.messaging, 'sendButtons', registrar('botones'));
  mock.method(shared.messaging, 'sendList', registrar('lista'));
  ({ handleMessage } = await import('./index'));
  ({ config } = await import('../config'));
}, { timeout: 180_000 });

beforeEach(() => {
  enviados.length = 0; conversaciones.length = 0; sesiones.clear(); perfiles.clear(); notas.length = 0;
  etiquetasCrm.length = 0; filasHoja.length = 0; hubspot.length = 0; agenda.length = 0; preguntasIa.length = 0;
  fueraDeHorario = false;
  if (config) config.agenda.activa = false;
});

// ── Ayudas ──────────────────────────────────────────────────────────────────

const textos = () => enviados.map((e) => String(e.msg.text ?? e.msg.description ?? ''));
const todo = () => textos().join('\n---\n');
const ids = (e: Enviado): string[] => {
  const m = e.msg as { buttons?: Array<{ id: string }>; sections?: Array<{ rows: Array<{ id: string }> }> };
  return [...(m.buttons ?? []).map((b) => b.id), ...(m.sections ?? []).flatMap((s) => s.rows.map((r) => r.id))];
};
const ultimo = () => enviados[enviados.length - 1];
const paso = (t = TEL) => sesiones.get(t)?.step;
const alAsesor = () => {
  assert.equal(conversaciones.length, 1, `se abrió una conversación con el asesor; enviados: ${todo()}`);
  return conversaciones[0];
};

/** Quien viene de ver recomendaciones y autoriza sus datos en el momento. */
async function autoriza(data: Record<string, string> = {}, tel = TEL): Promise<void> {
  sesiones.set(tel, { step: 'reco_consentimiento', data: { relacion: 'egresado_utb', pregradoId: 'ing-industrial', nivel: 'maestria', ...data } });
  await handleMessage(tel, 'si');
}

async function decir(...mensajes: string[]): Promise<void> {
  for (const m of mensajes) await handleMessage(TEL, m);
}

// ── Los tres canales ────────────────────────────────────────────────────────

describe('canal de contacto: la persona elige cómo la contacta el asesor', { skip: SIN_MOCKS }, () => {
  it('al autorizar ve exactamente tres botones: chat, llamada y correo; nada se conecta todavía', async () => {
    await autoriza();
    const pregunta = ultimo();
    assert.equal(pregunta.tipo, 'botones');
    assert.deepEqual(ids(pregunta), ['contacto_chat', 'contacto_llamada', 'contacto_correo']);
    assert.match(String(pregunta.msg.description), /Cómo prefieres que te contacte/);
    assert.equal(conversaciones.length, 0);
    assert.equal(paso(), 'reco_contacto');
  });

  it('💬 por este chat: pide el nombre una sola vez y conecta; el asesor ve que prefiere el chat', async () => {
    await autoriza();
    await decir('contacto_chat');
    assert.match(ultimo().msg.text as string, /Anotado: 💬 por este chat[\s\S]*nombre completo/);
    assert.equal(paso(), 'reco_nombre');
    enviados.length = 0;
    await decir('Ana Pérez');
    assert.match(textos()[0], /te escribirá por aquí mismo/);
    const c = alAsesor();
    assert.match(c.initialMessage, /💬 Prefiere que le escriban por este chat/);
    assert.match(c.initialMessage, /Autorizó el tratamiento de datos/);
    assert.ok(c.labels.includes('contacto-chat'));
    assert.match(todo(), /te responderá en breve/, 'por chat sigue el aviso de siempre');
    assert.ok(notas.some((n) => n === 'Contacto preferido (bot): 💬 Prefiere que le escriban por este chat'));
    assert.equal(filasHoja[0].nombre, 'Ana Pérez');
    assert.equal(hubspot.length, 0, 'sin correo no va a HubSpot');
    assert.equal(paso(), 'with_agent');
  });

  it('📞 llamada a otro número en la tarde: número, franja y nombre ya conocido; el asesor lo ve claro', async () => {
    await autoriza({ nombre: 'Ana Pérez', datos: 'si' });
    await decir('contacto_llamada');
    assert.deepEqual(ids(ultimo()), ['contacto_tel_este', 'contacto_tel_otro']);
    await decir('contacto_tel_otro');
    assert.match(ultimo().msg.text as string, /Escríbeme el número/);
    await decir('es el 301-555-1234');
    const lista = ultimo();
    assert.equal(lista.tipo, 'lista');
    assert.deepEqual(ids(lista), ['contacto_franja_manana', 'contacto_franja_tarde', 'contacto_franja_noche', 'contacto_franja_cualquiera']);
    assert.doesNotMatch(todo(), /agenda|cita/i, 'con la agenda apagada no se menciona');
    enviados.length = 0;
    await decir('contacto_franja_tarde');
    const c = alAsesor();
    assert.match(c.initialMessage, /📞 Pidió llamada al \+57 301 555 1234 en la tarde/);
    assert.ok(c.labels.includes('contacto-llamada'));
    assert.ok(notas.includes('Contacto preferido (bot): 📞 Pidió llamada al +57 301 555 1234 en la tarde'));
    assert.match(todo(), /te llamará a \*301 555 1234\* en la tarde/);
    assert.doesNotMatch(todo(), /en breve/, 'a quien pidió llamada en la tarde no se le dice "en breve"');
    assert.equal(paso(), 'with_agent');
  });

  it('📞 a este mismo número: el asesor ve el WhatsApp de la persona', async () => {
    await autoriza({ nombre: 'Ana Pérez', datos: 'si' });
    await decir('contacto_llamada', 'contacto_tel_este', 'contacto_franja_cualquiera');
    assert.match(alAsesor().initialMessage, /📞 Pidió llamada al \+573001112233 \(este WhatsApp\), a cualquier hora/);
    assert.match(todo(), /te llamará a este número apenas pueda/);
  });

  it('📞 fuera de horario: la llamada queda para el próximo horario de atención', async () => {
    fueraDeHorario = true;
    await autoriza({ nombre: 'Ana Pérez', datos: 'si' });
    await decir('contacto_llamada', 'contacto_tel_este', 'contacto_franja_manana');
    assert.match(todo(), /te llamará a este número en la mañana, desde el próximo horario de atención \(\*lunes 8:00 a\. m\.\*\)/);
  });

  it('📧 correo: lo pide, lo valida, lo guarda en el lead y en HubSpot', async () => {
    await autoriza({ nombre: 'Ana Pérez', datos: 'si' });
    await decir('contacto_correo');
    assert.match(ultimo().msg.text as string, /A qué correo te escribimos/);
    await decir('ana@');
    assert.match(ultimo().msg.text as string, /no parece válido/);
    assert.equal(conversaciones.length, 0);
    await decir('Es ANA.Perez@Correo.com.');
    const c = alAsesor();
    assert.equal(c.customAttributes.email_prospecto, 'ana.perez@correo.com');
    assert.match(c.initialMessage, /📧 Pidió que le escriban al correo ana\.perez@correo\.com/);
    assert.equal(filasHoja[0].email, 'ana.perez@correo.com');
    assert.equal(hubspot[0]?.email, 'ana.perez@correo.com');
    assert.match(todo(), /te escribirá a \*ana\.perez@correo\.com\* pronto/);
    assert.equal(perfiles.get(TEL)?.correo, 'ana.perez@correo.com', 'queda en el perfil para la próxima vez');
  });

  it('sin autorización no se guarda nada ni se pregunta el canal', async () => {
    sesiones.set(TEL, { step: 'reco_consentimiento', data: {} });
    await decir('no');
    assert.equal(conversaciones.length, 0);
    assert.equal(filasHoja.length, 0);
    assert.equal(perfiles.size, 0);
    assert.ok(!enviados.some((e) => ids(e).includes('contacto_llamada')));
  });
});

// ── Contestar escribiendo ───────────────────────────────────────────────────

describe('canal de contacto: contestar escribiendo', { skip: SIN_MOCKS }, () => {
  it('"mejor una llamada en la tarde a este mismo número" se resuelve de una vez', async () => {
    await autoriza({ nombre: 'Ana Pérez', datos: 'si' });
    await decir('mejor una llamada en la tarde a este mismo número');
    assert.match(alAsesor().initialMessage, /Pidió llamada al \+573001112233 \(este WhatsApp\) en la tarde/);
  });

  it('"¿me pueden llamar al 300 222 3344?" es del paso (no de la IA) y solo falta la franja', async () => {
    await autoriza({ nombre: 'Ana Pérez', datos: 'si' });
    await decir('¿me pueden llamar al 300 222 3344?');
    assert.equal(preguntasIa.length, 0);
    assert.equal(paso(), 'reco_llamada_franja');
    await decir('a las 7 pm');
    assert.match(alAsesor().initialMessage, /Pidió llamada al \+57 300 222 3344 en la noche/);
  });

  it('"a mi correo ana@x.com" trae el correo: no lo vuelve a pedir', async () => {
    await autoriza({ nombre: 'Ana Pérez', datos: 'si' });
    await decir('a mi correo ana@x.com');
    assert.equal(alAsesor().customAttributes.email_prospecto, 'ana@x.com');
  });

  it('"por acá" y "aquí mismo" son este chat', async () => {
    for (const respuesta of ['por acá', 'aquí mismo']) {
      conversaciones.length = 0;
      await autoriza({ nombre: 'Ana Pérez', datos: 'si' });
      await decir(respuesta);
      assert.match(alAsesor().initialMessage, /Prefiere que le escriban por este chat/, respuesta);
    }
  });

  it('pidiendo el correo, "no tengo correo" pasa por este chat y "mejor llámenme" a la llamada', async () => {
    await autoriza({ nombre: 'Ana Pérez', datos: 'si' });
    await decir('contacto_correo', 'no tengo correo');
    assert.match(alAsesor().initialMessage, /por este chat/);

    conversaciones.length = 0;
    await autoriza({ nombre: 'Ana Pérez', datos: 'si' });
    await decir('por correo', 'mejor llámenme');
    assert.equal(paso(), 'reco_llamada_numero');
    assert.equal(conversaciones.length, 0);
  });

  it('un número que no es de Colombia se vuelve a pedir sin perder el paso', async () => {
    await autoriza({ nombre: 'Ana Pérez', datos: 'si' });
    await decir('llamada', 'otro', '12345678');
    assert.match(ultimo().msg.text as string, /no parece de Colombia/);
    assert.equal(paso(), 'reco_llamada_numero');
    await decir('3105556677', 'cuando sea');
    assert.match(alAsesor().initialMessage, /\+57 310 555 6677, a cualquier hora/);
  });

  it('"buenas tardes" en la franja es un saludo, no la tarde', async () => {
    await autoriza({ nombre: 'Ana Pérez', datos: 'si' });
    await decir('llamada', 'a este');
    enviados.length = 0;
    await decir('buenas tardes');
    assert.equal(conversaciones.length, 0);
    assert.equal(paso(), 'reco_llamada_franja');
    assert.match(todo(), /en qué momento del día te llamamos/);
  });

  it('una pregunta suelta se responde y se recuerda el paso; BAJA funciona en medio', async () => {
    await autoriza({ nombre: 'Ana Pérez', datos: 'si' });
    enviados.length = 0;
    await decir('¿cuánto cuesta la maestría?');
    assert.deepEqual(preguntasIa, ['¿cuánto cuesta la maestría?']);
    assert.match(todo(), /elige cómo te contactamos/);
    assert.equal(paso(), 'reco_contacto');
    await decir('BAJA');
    assert.notEqual(paso(), 'reco_contacto');
    assert.equal(conversaciones.length, 0);
  });

  it('lo que no se entiende vuelve a preguntar con ejemplos, con los mismos tres botones', async () => {
    await autoriza();
    enviados.length = 0;
    await decir('mmm no sé');
    assert.match(String(ultimo().msg.description), /No te entendí/);
    assert.deepEqual(ids(ultimo()), ['contacto_chat', 'contacto_llamada', 'contacto_correo']);
  });

  it('"0" en la pregunta del canal vuelve a la ficha o las recomendaciones, sin conectar', async () => {
    await autoriza({ nombre: 'Ana Pérez', datos: 'si', recomendados: 'mba' });
    await decir('0');
    assert.notEqual(paso(), 'reco_contacto');
    assert.equal(conversaciones.length, 0);
  });

  it('un WhatsApp sin teléfono (BSUID) no puede recibir "a este número": se le pide uno', async () => {
    await autoriza({ nombre: 'Ana Pérez', datos: 'si' }, BSUID);
    await handleMessage(BSUID, 'llámenme a este número');
    assert.equal(sesiones.get(BSUID)?.step, 'reco_llamada_numero');
    assert.match(ultimo().msg.text as string, /Escríbeme el número/);
    assert.ok(!ids(ultimo()).includes('contacto_tel_este'));
  });
});

// ── Agenda de asesores ──────────────────────────────────────────────────────

describe('canal de contacto: la cita con la agenda encendida', { skip: SIN_MOCKS }, () => {
  it('la franja ofrece agendar; al elegirla el asesor recibe el lead y la agenda abre Posgrados', async () => {
    config.agenda.activa = true;
    await autoriza({ nombre: 'Ana Pérez', datos: 'si' });
    await decir('llamada', 'a este');
    assert.ok(ids(ultimo()).includes('contacto_franja_cita'));
    agenda.length = 0;
    await decir('quiero agendar una cita');
    assert.ok(!agenda.some((a) => a.text === 'quiero agendar una cita'), 'el texto lo atendió el paso, no la agenda');
    assert.match(alAsesor().initialMessage, /Pidió llamada al \+573001112233 \(este WhatsApp\); está agendando la cita/);
    const abierta = agenda.find((a) => a.text === 'ag:ofrecer');
    assert.equal(abierta?.session?.data?.area, 'posgrados');
    assert.equal(abierta?.session?.data?.nombre, 'Ana Pérez');
    assert.match(todo(), /Elige abajo el día y la hora de tu cita/);
  });

  it('con la agenda apagada, "agendar" en la franja no abre nada y la lista sigue sin cita', async () => {
    await autoriza({ nombre: 'Ana Pérez', datos: 'si' });
    await decir('llamada', 'a este', 'agendar');
    assert.equal(conversaciones.length, 0);
    assert.ok(!agenda.some((a) => a.text === 'ag:ofrecer'));
    assert.ok(!ids(ultimo()).includes('contacto_franja_cita'));
  });
});

// ── La vez pasada ───────────────────────────────────────────────────────────

describe('canal de contacto: quien ya eligió no vuelve a responder lo mismo', { skip: SIN_MOCKS }, () => {
  it('con el correo guardado ofrece "igual que la vez pasada" y conecta sin preguntar nada más', async () => {
    await autoriza({ nombre: 'Ana Pérez', datos: 'si', correo: 'ana@x.com' });
    assert.deepEqual(ids(ultimo()), ['contacto_igual', 'contacto_otro']);
    assert.match(String(ultimo().msg.description), /igual que la vez pasada: 📧 correo a \*ana@x\.com\*/);
    await decir('contacto_igual');
    assert.equal(alAsesor().customAttributes.email_prospecto, 'ana@x.com');
  });

  it('la llamada de la vez pasada (perfil) se repite con un "sí"; "de otra forma" vuelve a los tres canales', async () => {
    // Primera vez: llamada a otro número en la noche.
    await autoriza({ nombre: 'Ana Pérez', datos: 'si' });
    await decir('llámenme al 301 555 1234 en la noche');
    assert.match(alAsesor().initialMessage, /\+57 301 555 1234 en la noche/);
    assert.equal(perfiles.get(TEL)?.contactoTel, '3015551234');

    // Vuelve otro día: la sesión empieza de cero, el perfil lo recuerda.
    conversaciones.length = 0;
    enviados.length = 0;
    await autoriza({ nombre: 'Ana Pérez', datos: 'si' });
    assert.match(String(ultimo().msg.description), /📞 llamada a \*301 555 1234\* en la noche/);
    await decir('sí');
    assert.match(alAsesor().initialMessage, /\+57 301 555 1234 en la noche/);

    conversaciones.length = 0;
    await autoriza({ nombre: 'Ana Pérez', datos: 'si' });
    await decir('contacto_otro');
    assert.deepEqual(ids(ultimo()), ['contacto_chat', 'contacto_llamada', 'contacto_correo']);
  });

  it('la cita no se repite: con la llamada de antes solo se vuelve a preguntar la franja', async () => {
    perfiles.set(TEL, { datos: 'si', nombre: 'Ana', contactoCanal: 'llamada', contactoTel: 'este', contactoFranja: 'cita' });
    await autoriza({ datos: 'si' });
    assert.match(String(ultimo().msg.description), /📞 llamada a este número\?/);
    await decir('dale');
    assert.equal(paso(), 'reco_llamada_franja');
  });
});

// ── Sesiones de antes del cambio ────────────────────────────────────────────

describe('canal de contacto: sesiones viejas', { skip: SIN_MOCKS }, () => {
  it('reco_correo con el nombre dado: el correo conecta como antes', async () => {
    sesiones.set(TEL, { step: 'reco_correo', data: { nombre: 'Luis Gómez', datos: 'si', consentimiento: 'Sí' } });
    await decir('luis@correo.co');
    assert.equal(alAsesor().customAttributes.email_prospecto, 'luis@correo.co');
    assert.equal(hubspot[0]?.email, 'luis@correo.co');
  });

  it('reco_correo: "¿no me pueden contactar por acá?" conecta por este chat', async () => {
    sesiones.set(TEL, { step: 'reco_correo', data: { nombre: 'Luis Gómez', datos: 'si' } });
    await decir('¿no me pueden contactar por acá?');
    assert.match(alAsesor().initialMessage, /por este chat/);
    assert.equal(preguntasIa.length, 0);
  });

  it('reco_nombre sin canal: tras el nombre pregunta el canal', async () => {
    sesiones.set(TEL, { step: 'reco_nombre', data: { datos: 'si' } });
    await decir('Luis Gómez');
    assert.equal(paso(), 'reco_contacto');
    assert.equal(sesiones.get(TEL)?.data.nombre, 'Luis Gómez');
    assert.equal(conversaciones.length, 0);
  });
});
