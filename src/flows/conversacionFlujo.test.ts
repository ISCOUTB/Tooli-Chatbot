// Conversaciones de punta a punta del flujo conversacional de posgrados, con el código REAL de los flujos
// (handleMessage → handleConversacion). Solo se reemplaza la infraestructura: Redis, la sesión, el perfil,
// la constancia de autorización, el CRM, la hoja de registros, la IA y el envío.
// Reproduce lo que vio el dueño probando el bot (nov-2026): el bot volvía a pedir la carrera que la persona
// ya había dicho y no dejaba cambiar el nombre.
// Se corre con --experimental-test-module-mocks (tools/run-tests.cjs lo pasa).
import { before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

// El paso raíz conversacional se enciende antes de cargar la configuración (todo se importa en before).
process.env.FLUJO_CONVERSACIONAL = 'true';

/** Redis que no hace nada: los servicios que sí importan aquí están reemplazados abajo. */
class RedisMudo {
  constructor() {
    return new Proxy(this, {
      get(obj, prop) {
        if (prop in obj) return (obj as unknown as Record<string | symbol, unknown>)[prop];
        if (prop === 'then') return undefined;
        if (prop === 'multi' || prop === 'pipeline') return () => cadena();
        return async () => null;
      },
    });
  }
  on() { return this; }
  once() { return this; }
  disconnect() {}
  async quit() { return 'OK'; }
}
function cadena(): unknown {
  const c: Record<string, unknown> = new Proxy({}, {
    get: (_o, prop) => (prop === 'exec' ? async () => [] : prop === 'then' ? undefined : () => c),
  });
  return c;
}

const SIN_MOCKS = typeof (mock as { module?: unknown }).module !== 'function'
  ? 'necesita Node 22.3+ con --experimental-test-module-mocks' : false;
if (!SIN_MOCKS) mock.module('ioredis', { defaultExport: RedisMudo });

type Enviado = { tipo: 'texto' | 'botones' | 'lista'; texto: string; ids: string[] };
const enviados: Enviado[] = [];
const sesiones = new Map<string, { step: string; data: Record<string, string> }>();
const perfiles = new Map<string, Record<string, string>>();
const decisiones = new Map<string, 'si' | 'no'>();
const notas: Array<{ tel: string; texto: string }> = [];
const filasActualizadas: Array<{ fila: number; nombre: string }> = [];
const preguntasIa: string[] = [];

let handleMessage: typeof import('./index').handleMessage;

before(async () => {
  if (SIN_MOCKS) return;
  const [sesion, metricas, perfil, consentimiento, campana, seguimiento, crm, registro, noRec, incid, ia, fotos] = await Promise.all([
    import('../services/session'), import('../services/metrics'), import('../services/perfilService'),
    import('../services/consentimientoService'), import('../services/campanaService'), import('../services/seguimientoService'),
    import('../services/crmService'), import('../services/registroService'), import('../services/noReconocidoService'),
    import('../services/incidenciasService'), import('../services/aiAssistant'), import('./fotosPrograma'),
  ]);
  mock.module('../services/session', { namedExports: {
    ...sesion,
    getSession: async (t: string) => sesiones.get(t) ?? null,
    setSession: async (t: string, s: { step: string; data: Record<string, string> }) => { sesiones.set(t, structuredClone(s)); },
    deleteSession: async (t: string) => { sesiones.delete(t); },
    claimMessageId: async () => true,
  } });
  mock.module('../services/metrics', { namedExports: { ...metricas, track: async () => {} } });
  const guardar = async (t: string, d: Record<string, string>) => {
    const p = perfil.perfilDeDatos(d);
    if (Object.keys(p).length) perfiles.set(t, p); else perfiles.delete(t);
  };
  mock.module('../services/perfilService', { namedExports: {
    ...perfil,
    leerPerfil: async (t: string) => perfiles.get(t) ?? null,
    guardarPerfil: guardar,
    completarPerfil: async (t: string, c: Record<string, string>) => {
      const junto = { ...(perfiles.get(t) ?? {}), ...c };
      if (junto.datos === 'si') await guardar(t, junto);
    },
    conLoRecordado: async (_t: string, d: Record<string, string>) => d,
  } });
  mock.module('../services/consentimientoService', { namedExports: {
    ...consentimiento,
    decisionGuardada: async (t: string) => decisiones.get(t) ?? null,
    registrarDecision: async (t: string, d: 'si' | 'no') => { decisiones.set(t, d); },
  } });
  mock.module('../services/campanaService', { namedExports: {
    ...campana,
    estaDadoDeBaja: async () => false, darDeBaja: async () => {}, quitarBaja: async () => {},
    leerContextoCampana: async () => null, borrarContextoCampana: async () => {}, guardarContextoCampana: async () => {},
  } });
  mock.module('../services/seguimientoService', { namedExports: {
    ...seguimiento, programarSeguimiento: async () => {}, cancelarSeguimiento: async () => {},
  } });
  mock.module('../services/crmService', { namedExports: {
    ...crm,
    agregarNota: async (tel: string, texto: string) => { notas.push({ tel, texto }); return { etiquetas: [], notas: [] }; },
    getFicha: async () => ({ etiquetas: [], notas: [] }),
    setEtiquetas: async () => ({ etiquetas: [], notas: [] }),
  } });
  mock.module('../services/registroService', { namedExports: {
    ...registro,
    guardarRegistroProspecto: async () => 7,
    actualizarRegistroProspecto: async (fila: number, d: { nombre: string }) => { filasActualizadas.push({ fila, nombre: d.nombre }); },
  } });
  mock.module('../services/noReconocidoService', { namedExports: { ...noRec, registrarNoReconocido: async () => {} } });
  mock.module('../services/incidenciasService', { namedExports: { ...incid, registrarIncidencia: async () => {} } });
  mock.module('../services/aiAssistant', { namedExports: {
    ...ia,
    preguntarAI: async (_area: string, pregunta: string) => {
      preguntasIa.push(pregunta);
      return { answer: 'Respuesta de la IA.\nSUGERENCIAS: ¿Hay becas? | ¿Cuándo inician?', usedTool: false };
    },
  } });
  mock.module('./fotosPrograma', { namedExports: { ...fotos, enviarFlyerPrograma: async () => false, esperarFlyers: async () => {} } });

  const shared = await import('./shared');
  const registrar = (tipo: Enviado['tipo']) => async (msg: Record<string, unknown>) => {
    const m = msg as { text?: string; description?: string; body?: string; buttons?: Array<{ id: string }> };
    enviados.push({ tipo, texto: String(m.text ?? m.description ?? m.body ?? ''), ids: (m.buttons ?? []).map((b) => b.id) });
  };
  mock.method(shared.messaging, 'sendText', registrar('texto'));
  mock.method(shared.messaging, 'sendButtons', registrar('botones'));
  mock.method(shared.messaging, 'sendList', registrar('lista'));
  ({ handleMessage } = await import('./index'));
}, { timeout: 180_000 });

beforeEach(() => {
  enviados.length = 0; sesiones.clear(); perfiles.clear(); decisiones.clear();
  notas.length = 0; filasActualizadas.length = 0; preguntasIa.length = 0;
});

const TEL = '573005550101';
const PIDE_CARRERA = /qué carrera|escríbeme tu carrera|qué estudiaste/i;
const PIDE_NIVEL = /qué nivel de posgrado/i;
const PIDE_RELACION = /relación con la UTB/i;

/** Escribe un mensaje y devuelve lo que contestó el bot en ese turno. */
async function escribir(texto: string, tel = TEL): Promise<string[]> {
  const desde = enviados.length;
  await handleMessage(tel, texto);
  return enviados.slice(desde).map((e) => e.texto);
}
const ultimo = (r: string[]) => r[r.length - 1] ?? '';
const datos = (tel = TEL) => sesiones.get(tel)?.data ?? {};

/** Saluda, autoriza datos y da su nombre: queda en «¿Ya tienes un posgrado en mente?». */
async function empezar(nombre = 'Pedro', tel = TEL): Promise<void> {
  await escribir('hola', tel);
  await escribir('sí', tel);
  const r = await escribir(nombre, tel);
  assert.match(ultimo(r), /posgrado en mente/i, `debía preguntar si tiene un posgrado en mente: ${JSON.stringify(r)}`);
}

describe('la conversación real: no vuelve a pedir lo que ya dijo', { skip: SIN_MOCKS }, () => {
  it('«No, estudio ingeniería de sistemas» y luego «estudio en la UTB»: nunca pide la carrera', async () => {
    await empezar();
    const r1 = await escribir('No, estudio ingeniería de sistemas');
    assert.ok(r1.some((t) => /Ingeniería de Sistemas/i.test(t) && /✅/.test(t)), `confirma la carrera: ${JSON.stringify(r1)}`);
    assert.match(ultimo(r1), PIDE_RELACION, 'sin decir dónde estudia, pregunta la relación con la UTB');
    const r2 = await escribir('estudio en la UTB');
    assert.ok(!r2.some((t) => PIDE_CARRERA.test(t)), `no vuelve a pedir la carrera: ${JSON.stringify(r2)}`);
    assert.match(ultimo(r2), PIDE_NIVEL);
    assert.equal(datos().relacion, 'estudiante_utb');
    assert.equal(datos().modo, 'elegir', 'el «no» a tener un programa en mente es «ayúdame a elegir»');
    assert.ok(!enviados.some((e) => PIDE_CARRERA.test(e.texto)), 'en toda la conversación');
  });

  it('con «estudio sistemas en la UTB» de una vez se salta la relación y la carrera', async () => {
    await empezar();
    const r = await escribir('no, estudio sistemas en la utb');
    assert.match(ultimo(r), PIDE_NIVEL, JSON.stringify(r));
    assert.ok(!enviados.some((e) => PIDE_CARRERA.test(e.texto) || PIDE_RELACION.test(e.texto)));
  });

  it('«ya te dije que estudio sistemas» mientras pide la carrera: la toma, no la IA', async () => {
    await empezar();
    await escribir('ayúdame a elegir');
    await escribir('soy egresado');
    const r = await escribir('ya te dije que estudio sistemas');
    assert.match(ultimo(r), PIDE_NIVEL, JSON.stringify(r));
    assert.equal(preguntasIa.length, 0);
  });

  it('«no, soy de otra universidad, estudié derecho» contesta la relación y la carrera', async () => {
    await empezar();
    await escribir('ayúdame a elegir');
    const r = await escribir('no, soy de otra universidad, estudié derecho');
    assert.equal(datos().relacion, 'externo');
    assert.match(ultimo(r), PIDE_NIVEL, JSON.stringify(r));
    assert.ok(!enviados.some((e) => PIDE_CARRERA.test(e.texto)));
  });

  it('«sí, soy egresado de industrial» a la relación: egresado con la carrera, sigue al nivel', async () => {
    await empezar();
    await escribir('ayúdame a elegir');
    const r = await escribir('sí, soy egresado de industrial');
    assert.equal(datos().relacion, 'egresado_utb');
    assert.match(ultimo(r), PIDE_NIVEL, JSON.stringify(r));
  });

  it('una corrección («no, me equivoqué, estudio civil») cambia la carrera y lo confirma', async () => {
    await empezar();
    await escribir('No, estudio ingeniería de sistemas');
    const antes = datos().pregradoId;
    const r = await escribir('no, me equivoqué, estudio civil');
    assert.notEqual(datos().pregradoId, antes);
    assert.ok(r.some((t) => /Ingeniería Civil/i.test(t)), JSON.stringify(r));
    assert.match(ultimo(r), PIDE_RELACION, 'la relación todavía falta');
  });
});

describe('el primer mensaje también cuenta', { skip: SIN_MOCKS }, () => {
  it('«Hola, me llamo Laura y estudio derecho en la UTB»: no pide el nombre ni la carrera, ni va a la IA', async () => {
    await escribir('Hola, me llamo Laura y estudio derecho en la UTB');
    const r = await escribir('sí');
    assert.equal(datos().nombre, 'Laura');
    assert.equal(datos().relacion, 'estudiante_utb');
    assert.equal(datos().pregradoId, 'derecho');
    assert.ok(!r.some((t) => /cómo te llamas/i.test(t)), JSON.stringify(r));
    assert.ok(r.some((t) => /Anoté \*Derecho\*/.test(t)), 'confirma la carrera');
    assert.match(ultimo(r), PIDE_NIVEL, `relación y carrera ya están: sigue el nivel ${JSON.stringify(r)}`);
    assert.equal(preguntasIa.length, 0);
  });

  it('una pregunta con datos va a la IA y los datos igual quedan', async () => {
    await empezar();
    await escribir('soy egresado de sistemas de la UTB, ¿cuánto cuesta la maestría en ciberseguridad?');
    assert.equal(preguntasIa.length, 1);
    assert.equal(datos().relacion, 'egresado_utb');
    assert.equal(datos().pregradoId, 'ingenieria-de-sistemas-y-computacion');
  });
});

describe('nombrar un programa sin signo de pregunta va a la IA', { skip: SIN_MOCKS }, () => {
  for (const frase of [
    'busco la maestría en ingeniería de sistemas',
    'estoy interesado en la especialización en gerencia de proyectos',
    'Me llamó la atención la maestría en finanzas',
  ]) {
    it(`«${frase}» ante «¿Ya tienes un posgrado en mente?» lo responde la IA`, async () => {
      await empezar('Pedro');
      const r = await escribir(frase);
      assert.deepEqual(preguntasIa, [frase], `la IA recibe el mensaje: ${JSON.stringify(r)}`);
      assert.ok(r.some((t) => /Respuesta de la IA/.test(t)), JSON.stringify(r));
      assert.equal(datos().nombre, 'Pedro', 'no es un cambio de nombre');
      assert.doesNotMatch(ultimo(r), /posgrado en mente/i, 'ya dijo qué programa busca');
    });
  }

  it('el primer mensaje «Hola, busco la maestría en finanzas» lo responde la IA al autorizar y dar el nombre', async () => {
    await escribir('Hola, busco la maestría en finanzas');
    await escribir('sí');
    const r = await escribir('Pedro');
    assert.deepEqual(preguntasIa, ['Hola, busco la maestría en finanzas'], JSON.stringify(r));
    assert.ok(r.some((t) => /Respuesta de la IA/.test(t)), JSON.stringify(r));
    assert.ok(!r.some((t) => /posgrado en mente/i.test(t)), `no pregunta si tiene un posgrado en mente: ${JSON.stringify(r)}`);
    assert.equal(datos().nivel, 'maestria', 'el nivel dicho igual queda');
  });

  it('«busco una maestría» o «estudio derecho» siguen sin la IA', async () => {
    await empezar('Pedro');
    await escribir('busco una maestría');
    await escribir('estudio derecho');
    assert.equal(preguntasIa.length, 0);
  });
});

describe('sabe qué busca', { skip: SIN_MOCKS }, () => {
  for (const frase of ['no, una especialización', 'quiero una especialización', 'Especialización', 'no, busco una especializacion']) {
    it(`«${frase}» fija el nivel y el modo elegir, sin volver a preguntar el nivel`, async () => {
      await empezar();
      const r = await escribir(frase);
      assert.equal(datos().nivel, 'especializacion');
      assert.equal(datos().nivelListo, '1');
      assert.equal(datos().modo, 'elegir');
      assert.match(ultimo(r), PIDE_RELACION, JSON.stringify(r));
      await escribir('egresado de la utb');
      const r3 = await escribir('Ingeniería Industrial');
      assert.ok(!enviados.some((e) => PIDE_NIVEL.test(e.texto)), 'nunca pregunta el nivel');
      assert.ok(!r3.some((t) => PIDE_NIVEL.test(t)));
    });
  }

  it('«no, un posgrado» elige sin fijar nivel (el nivel se pregunta después)', async () => {
    await empezar();
    await escribir('no, un posgrado');
    assert.equal(datos().modo, 'elegir');
    assert.notEqual(datos().nivelListo, '1');
    assert.equal(preguntasIa.length, 0, 'no es una pregunta para la IA');
  });
});

describe('cambiar el nombre en cualquier momento', { skip: SIN_MOCKS }, () => {
  it('«ese no es mi nombre, soy Laura»: sesión, perfil, nota en el CRM y la fila de la hoja', async () => {
    await empezar('Pedro');
    const r = await escribir('ese no es mi nombre, soy Laura');
    assert.equal(datos().nombre, 'Laura');
    assert.equal(perfiles.get(TEL)?.nombre, 'Laura');
    assert.ok(notas.some((n) => /Pedro/.test(n.texto) && /Laura/.test(n.texto)), JSON.stringify(notas));
    assert.deepEqual(filasActualizadas, [{ fila: 7, nombre: 'Laura' }]);
    assert.ok(r.some((t) => /Laura/.test(t)), JSON.stringify(r));
    assert.match(ultimo(r), /posgrado en mente/i, 'sigue con lo que estaba pendiente');
  });

  for (const [frase, nombre] of [
    ['me llamo Laura', 'Laura'], ['mi nombre es Laura Gómez', 'Laura Gómez'], ['cámbiame el nombre a Laura', 'Laura'],
    ['no me llamo Pedro, me llamo Laura', 'Laura'], ['Me llamo laura', 'laura'],
  ] as const) {
    it(`«${frase}» cambia el nombre`, async () => {
      await empezar('Pedro');
      await escribir(frase);
      assert.equal(datos().nombre, nombre);
      assert.equal(preguntasIa.length, 0);
    });
  }

  it('«quiero cambiar mi nombre» pregunta cuál y después sigue donde iba', async () => {
    await empezar('Pedro');
    await escribir('ayúdame a elegir');
    const r1 = await escribir('quiero cambiar mi nombre');
    assert.match(ultimo(r1), /nombre/i);
    assert.equal(datos().nombre, 'Pedro');
    const r2 = await escribir('Laura Gómez');
    assert.equal(datos().nombre, 'Laura Gómez');
    assert.match(ultimo(r2), PIDE_RELACION, JSON.stringify(r2));
  });

  for (const frase of ['me llamó la atención la maestría', '¿cómo se llama el programa?', 'me llamaron ayer']) {
    it(`«${frase}» no es un cambio de nombre`, async () => {
      await empezar('Pedro');
      await escribir(frase);
      assert.equal(datos().nombre, 'Pedro');
      assert.equal(notas.filter((n) => /nombre/i.test(n.texto)).length, 0);
    });
  }

  it('una pregunta en vez del nombre nuevo se responde y el nombre sigue igual', async () => {
    await empezar('Pedro');
    await escribir('quiero cambiar mi nombre');
    await escribir('¿cuánto cuesta la maestría?');
    assert.equal(preguntasIa.length, 1);
    assert.equal(datos().nombre, 'Pedro');
    assert.notEqual(datos().pendiente, 'nombre_nuevo');
  });

  for (const cancelar of ['olvídalo', 'mejor no', 'no', 'cancelar', 'déjalo así']) {
    it(`«${cancelar}» al pedir el nombre nuevo sale del paso y conserva el nombre`, async () => {
      await empezar('Pedro');
      await escribir('quiero cambiar mi nombre');
      const r = await escribir(cancelar);
      assert.equal(datos().nombre, 'Pedro', JSON.stringify(r));
      assert.notEqual(datos().pendiente, 'nombre_nuevo', JSON.stringify(r));
      assert.ok(!r.some((t) => /escríbeme solo tu nombre/i.test(t)), `no insiste: ${JSON.stringify(r)}`);
      assert.ok(r.some((t) => /Pedro/.test(t)), `dice con qué nombre sigue: ${JSON.stringify(r)}`);
      assert.match(ultimo(r), /posgrado en mente/i, 'sigue con lo que estaba pendiente');
      assert.equal(notas.filter((n) => /Cambió su nombre/.test(n.texto)).length, 0);
      assert.equal(filasActualizadas.length, 0);
      // Lo siguiente ya no es el nombre.
      await escribir('no');
      assert.equal(datos().nombre, 'Pedro');
    });
  }

  it('sin autorización de datos no se anota nada en el CRM', async () => {
    await escribir('hola');
    await escribir('no');
    await escribir('me llamo Laura');
    assert.equal(notas.length, 0);
    assert.equal(filasActualizadas.length, 0);
    assert.equal(perfiles.get(TEL)?.nombre, undefined);
  });
});
