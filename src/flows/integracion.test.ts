// Prueba cruzada de la integración (22-nov-2026) en WhatsApp, con el código REAL de las ramas:
// - paso a TI con el bloque de identidad (seguridad) Y la oferta de cita (agenda) en la misma conversación;
// - el menú con «Mi semestre» (académico) y «agendar» (agenda) a la vez, y la agenda fuera de los pasos sensibles.
// Solo se reemplaza la infraestructura: Redis (memoria), Chatwoot, la sesión, el vínculo de identidad y el envío.
// Se corre con --experimental-test-module-mocks (tools/run-tests.cjs lo pasa).
import { before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

// La agenda viene APAGADA por defecto (AGENDA_ACTIVA). Esta prueba cruza agenda + identidad, así que la enciende a
// propósito antes de cargar la configuración (todo se importa después, en before).
process.env.AGENDA_ACTIVA = 'true';

// ── Redis en memoria para lo que abre su propio cliente (estado del flujo de agenda) ──
class RedisMemoria {
  static datos = new Map<string, string>();
  constructor() {
    return new Proxy(this, {
      get(obj, prop) {
        if (prop in obj) return (obj as unknown as Record<string | symbol, unknown>)[prop];
        if (prop === 'then') return undefined;
        return () => { throw new Error(`RedisMemoria: ${String(prop)} no implementado`); };
      },
    });
  }
  async get(k: string) { return RedisMemoria.datos.get(k) ?? null; }
  async set(k: string, v: string) { RedisMemoria.datos.set(k, v); return 'OK'; }
  async del(...ks: string[]) { let n = 0; for (const k of ks) if (RedisMemoria.datos.delete(k)) n++; return n; }
  on() { return this; }
  once() { return this; }
  disconnect() {}
  async quit() { return 'OK'; }
}
// mock.module existe desde Node 22.3 y con --experimental-test-module-mocks; sin él (Node anterior a 22.3) se salta.
const SIN_MOCKS = typeof (mock as { module?: unknown }).module !== 'function'
  ? 'necesita Node 22.3+ con --experimental-test-module-mocks' : false;
if (!SIN_MOCKS) mock.module('ioredis', { defaultExport: RedisMemoria });

const ANA_TEL = '573001112233';
const ANA_EMAIL = 'ana.perez@utb.edu.co';
const AHORA = Date.parse('2026-11-23T08:00:00-05:00');

type Enviado = { tipo: 'texto' | 'botones' | 'lista'; to: string; msg: Record<string, unknown> };
const enviados: Enviado[] = [];
const conversaciones: Array<Record<string, unknown>> = [];
const sesiones = new Map<string, { step: string; data: Record<string, string> }>();

let iniciarConversacionAsesor: typeof import('./agentHandoff').iniciarConversacionAsesor;
let handleMessage: typeof import('./index').handleMessage;
let sendMenuPregrado: typeof import('./shared').sendMenuPregrado;
let sendMenuPosgrado: typeof import('./shared').sendMenuPosgrado;
let sendMenuAcademico: typeof import('./academico').sendMenuAcademico;
let config: typeof import('../config').config;

before(async () => {
  if (SIN_MOCKS) return;
  const [sesion, identidad, metricas, chatwoot, atencion, agendaSvc, fakes] = await Promise.all([
    import('../services/session'), import('../services/identityService'), import('../services/metrics'),
    import('../services/chatwootService'), import('../services/atencionEquipoService'), import('../services/agendaService'),
    import('../services/agenda.fakes.test'),
  ]);
  mock.module('../services/session', { namedExports: {
    ...sesion,
    getSession: async (t: string) => sesiones.get(t) ?? null,
    setSession: async (t: string, s: { step: string; data: Record<string, string> }) => { sesiones.set(t, s); },
    deleteSession: async (t: string) => { sesiones.delete(t); },
    claimMessageId: async () => true,
  } });
  const identidadAna = { email: ANA_EMAIL, verifiedAt: AHORA, codigo: 'T00012345', codigoVerificado: true, nombre: 'Ana Pérez' };
  mock.module('../services/identityService', { namedExports: {
    ...identidad,
    getIdentity: async (t: string) => (t === ANA_TEL ? identidadAna : null),
    isVerified: async (t: string) => t === ANA_TEL,
  } });
  mock.module('../services/metrics', { namedExports: { ...metricas, track: async () => {} } });
  mock.module('../services/chatwootService', { namedExports: {
    ...chatwoot,
    getOrCreateContact: async () => ({ sourceId: 'src-1', contactId: 1 }),
    createConversation: async (o: Record<string, unknown>) => { conversaciones.push(o); return 77; },
  } });
  mock.module('../services/atencionEquipoService', { namedExports: {
    ...atencion,
    dentroDeHorarioAsync: async () => false,
    textoProximaAtencion: async () => 'lunes 8:00 a. m.',
  } });
  // Agenda REAL (crearAgenda) sobre el Redis falso de sus pruebas, con horarios para las tres áreas.
  const mundo = fakes.crearMundo({ ahoraMs: AHORA + 60_000 });
  const ag = agendaSvc.crearAgenda(mundo.deps);
  await ag.guardarDisponibilidad('laura', fakes.dispSemana(['posgrados', 'pregrado']));
  await ag.guardarDisponibilidad('mario', fakes.dispSemana(['ti']));
  mock.module('../services/agendaService', { namedExports: { ...agendaSvc, agendaServicio: ag, agenda: ag } });

  const shared = await import('./shared');
  const registrar = (tipo: Enviado['tipo']) => async (msg: Record<string, unknown>) => { enviados.push({ tipo, to: String(msg.to), msg }); };
  mock.method(shared.messaging, 'sendText', registrar('texto'));
  mock.method(shared.messaging, 'sendButtons', registrar('botones'));
  mock.method(shared.messaging, 'sendList', registrar('lista'));
  sendMenuPregrado = shared.sendMenuPregrado;
  sendMenuPosgrado = shared.sendMenuPosgrado;
  ({ sendMenuAcademico } = await import('./academico'));
  ({ config } = await import('../config'));
  ({ iniciarConversacionAsesor } = await import('./agentHandoff'));
  ({ handleMessage } = await import('./index'));
}, { timeout: 180_000 }); // cargar todo el grafo de flujos tarda con el PC ocupado

beforeEach(() => { enviados.length = 0; conversaciones.length = 0; sesiones.clear(); RedisMemoria.datos.clear(); });

const ids = (e: Enviado): string[] => {
  const m = e.msg as { buttons?: Array<{ id: string }>; sections?: Array<{ rows: Array<{ id: string }> }> };
  return [...(m.buttons ?? []).map((b) => b.id), ...(m.sections ?? []).flatMap((s) => s.rows.map((r) => r.id))];
};
const deAgenda = (e: Enviado) => ids(e).some((i) => i.startsWith('ag:'));

describe('paso a TI: identidad (seguridad) + oferta de cita (agenda) juntos', { skip: SIN_MOCKS }, () => {
  it('correo vinculado: el asesor ve el correo verificado y la persona recibe la oferta de agendar', async () => {
    await iniciarConversacionAsesor(ANA_TEL, {
      area: 'ti', plataforma: 'Savio', descripcion: 'No puedo entrar',
      verifEmail: ANA_EMAIL, verifCodigo: 'T00012345', verifCedula: '1045678901',
    }, { aiNoResolvio: true, conVerificacionIdentidad: true });

    assert.equal(conversaciones.length, 1, 'se creó la conversación en Chatwoot');
    const c = conversaciones[0] as { initialMessage: string; labels: string[]; customAttributes: Record<string, string> };
    assert.match(c.initialMessage, /Correo verificado con código/);
    // Ana tiene el código comprobado por académico en su vínculo: el asesor lo ve así, no como «lo escribió».
    assert.match(c.initialMessage, /Código: T00012345 \(comprobado por académico\)/);
    assert.doesNotMatch(c.initialMessage, /Código y cédula: los escribió la persona/);
    assert.ok(c.labels.includes('correo-verificado'));
    assert.equal(c.customAttributes.email_verificado, ANA_EMAIL);
    assert.equal(c.customAttributes.codigo_declarado, 'T00012345');
    assert.equal(c.customAttributes.cedula_verificada, undefined, 'ya no se dice «verificada» de lo que escribió');

    const oferta = enviados.findIndex((e) => e.tipo === 'botones' && ids(e).includes('ag:ofrecer'));
    const registrado = enviados.findIndex((e) => e.tipo === 'texto' && /quedó registrado/.test(String(e.msg.text)));
    assert.ok(registrado >= 0, 'avisa que el mensaje quedó registrado');
    assert.ok(oferta > registrado, 'y DESPUÉS ofrece agendar');
    assert.equal(sesiones.get(ANA_TEL)?.step, 'with_agent', 'la persona sigue con el asesor');
  });

  it('correo distinto al vinculado: sin verificar, y la oferta de cita sigue saliendo', async () => {
    await iniciarConversacionAsesor('573009990000', {
      area: 'ti', plataforma: 'Correo', descripcion: 'Olvidé la clave', verifEmail: ANA_EMAIL, verifCodigo: 'T1', verifCedula: '1',
    }, { conVerificacionIdentidad: true });
    const c = conversaciones[0] as { labels: string[]; customAttributes: Record<string, string> };
    assert.ok(c.labels.includes('identidad-sin-verificar'));
    assert.equal(c.customAttributes.email_verificado, '');
    assert.ok(enviados.some((e) => ids(e).includes('ag:ofrecer')));
  });
});

// Interruptores académicos: se leen en cada llamada, así que cada prueba los fija y los deja como estaban.
const INTERRUPTORES = ['TOOLI_NOTAS_SSO_ENABLED', 'TOOLI_ACADEMIC_LOOKUP_ENABLED', 'TOOLI_HORARIO_ENABLED', 'TOOLI_SAVIO_ENABLED', 'SAVIO_WS_TOKEN'];
async function conEntorno(valores: Record<string, string>, prueba: () => Promise<void>): Promise<void> {
  const antes = Object.fromEntries(INTERRUPTORES.map((k) => [k, process.env[k]]));
  for (const k of INTERRUPTORES) delete process.env[k];
  Object.assign(process.env, valores);
  try { await prueba(); } finally {
    for (const k of INTERRUPTORES) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; }
  }
}
const textos = () => enviados.map((e) => String(e.msg.text ?? `${e.msg.title}\n${e.msg.description}`)).join('\n---\n');

describe('datos académicos APAGADOS (por defecto): todo igual que en main', { skip: SIN_MOCKS }, () => {
  it('el estudiante verificado sigue viendo «Cómo inscribirme» y no «Mi semestre»', () => conEntorno({}, async () => {
    for (const enviar of [sendMenuPregrado, sendMenuPosgrado]) {
      enviados.length = 0;
      await enviar(ANA_TEL);
      const filas = ids(enviados[0]);
      assert.ok(filas.includes('9'), 'Cómo inscribirme');
      assert.equal(filas.includes('10'), false, 'sin Mi semestre');
    }
  }));

  it('«mi semestre» y «10» no abren Mi semestre ni la verificación: el menú dice que no reconoce la opción', () => conEntorno({}, async () => {
    for (const [step, texto] of [['menu_pregrado', 'mi semestre'], ['menu_pregrado', '10'], ['menu_posgrado', 'Mi semestre'], ['menu_posgrado', '10']]) {
      for (const tel of [ANA_TEL, '573009990000']) {
        enviados.length = 0;
        sesiones.set(tel, { step, data: {} });
        await handleMessage(tel, texto);
        assert.match(textos(), /No reconocí esa opción/, `${step} «${texto}»`);
        assert.doesNotMatch(textos(), /Mi semestre|Verificación de identidad/, `${step} «${texto}»`);
        assert.notEqual(sesiones.get(tel)?.step, 'semestre_menu');
      }
    }
  }));

  it('«Mi vida académica» no invita a escribir «mi semestre» ni lo atiende', () => conEntorno({}, async () => {
    await sendMenuAcademico(ANA_TEL, 'pregrado');
    assert.doesNotMatch(String(enviados[0].msg.description), /mi semestre/i);
    enviados.length = 0;
    await handleMessage(ANA_TEL, 'mi semestre');
    assert.doesNotMatch(textos(), /📅 Mi semestre|Verificación de identidad/);
  }));
});

describe('«Mi semestre» con alguna integración encendida', { skip: SIN_MOCKS }, () => {
  it('solo ofrece lo que está encendido (nada de «Por ahora no consulto…»)', () => conEntorno({ TOOLI_NOTAS_SSO_ENABLED: '1' }, async () => {
    sesiones.set(ANA_TEL, { step: 'menu_pregrado', data: {} });
    await handleMessage(ANA_TEL, 'mi semestre');
    const lista = enviados.find((e) => e.tipo === 'lista' && e.msg.title === '📅 Mi semestre');
    assert.ok(lista, textos());
    assert.deepEqual(ids(lista!).sort(), ['0', '1', '6'], 'notas, ¿cuánto necesito? y volver');
  }));

  it('sin correo configurado (RESEND_API_KEY) no abre una verificación que no puede mandar el código', () => conEntorno({ TOOLI_NOTAS_SSO_ENABLED: '1' }, async () => {
    const correo = config.mail as { apiKey: string };
    const antes = correo.apiKey;
    try {
      correo.apiKey = '';
      sesiones.set('573009990000', { step: 'menu_pregrado', data: {} });
      await handleMessage('573009990000', 'mi semestre');
      assert.doesNotMatch(textos(), /Verificación de identidad/);
      assert.match(textos(), /todavía no está disponible/);
      assert.notEqual(sesiones.get('573009990000')?.step, 'verif_email');

      enviados.length = 0;
      correo.apiKey = 'clave-de-prueba';
      sesiones.set('573009990000', { step: 'menu_pregrado', data: {} });
      await handleMessage('573009990000', 'mi semestre');
      assert.match(textos(), /Verificación de identidad/, 'con correo, sí verifica');
    } finally {
      correo.apiKey = antes;
    }
  }));
});

describe('menú de WhatsApp: «Mi semestre» y «agendar» a la vez', { skip: SIN_MOCKS }, () => {
  it('el menú muestra Mi semestre; «agendar» abre la agenda y «mi semestre» sale de ella y abre Mi semestre', () => conEntorno({ TOOLI_NOTAS_SSO_ENABLED: '1' }, async () => {
    await sendMenuPregrado(ANA_TEL);
    const filas = ids(enviados[0]);
    assert.ok(filas.includes('10'), 'Mi semestre en el menú del estudiante verificado');
    assert.ok(filas.includes('6'), 'Hablar con asesor sigue');

    enviados.length = 0;
    sesiones.set(ANA_TEL, { step: 'menu_pregrado', data: { originArea: 'pregrado' } });
    await handleMessage(ANA_TEL, 'agendar');
    assert.ok(enviados.some(deAgenda), `la agenda respondió: ${JSON.stringify(enviados.map((e) => e.msg))}`);

    enviados.length = 0;
    await handleMessage(ANA_TEL, 'mi semestre');
    const lista = enviados.find((e) => e.tipo === 'lista');
    assert.equal(lista?.msg.title, '📅 Mi semestre', `respuesta: ${JSON.stringify(enviados.map((e) => e.msg))}`);
    assert.equal(enviados.some(deAgenda), false);
    assert.equal(sesiones.get(ANA_TEL)?.step, 'semestre_menu');
  }));

  it('en un paso de cédula o contraseña, «quiero una cita» es del paso, no de la agenda', async () => {
    for (const step of ['vincular_cedula', 'notas_password']) {
      enviados.length = 0;
      sesiones.set(ANA_TEL, { step, data: { originArea: 'pregrado' } });
      await handleMessage(ANA_TEL, 'quiero una cita');
      assert.equal(enviados.some(deAgenda), false, `${step}: la agenda no leyó el texto`);
      assert.equal(RedisMemoria.datos.size, 0, `${step}: no quedó flujo de agenda abierto`);
    }
  });
});
