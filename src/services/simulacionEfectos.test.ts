// Efectos externos del flujo con una conversación SIMULADA: ninguno escribe fuera.
// Redis se reemplaza por un espía que anota cada comando (y nunca abre un socket);
// Sheets, HubSpot, Chatwoot y el correo no se llegan a llamar porque el guardia va primero.
// Se corre con --experimental-test-module-mocks (tools/run-tests.cjs lo pasa).
import { before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

const comandos: string[] = [];
const argumentos: unknown[][] = [];
class RedisEspia {
  enCadena: boolean;
  constructor(...args: unknown[]) {
    this.enCadena = args[0] === true; // new Redis(url, opciones) nunca pasa true
    const proxy: RedisEspia = new Proxy(this, {
      get(obj, prop) {
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        if (prop in obj) return (obj as unknown as Record<string | symbol, unknown>)[prop];
        return (...args: unknown[]) => {
          comandos.push(String(prop));
          argumentos.push(args);
          // pipeline()/multi() encadenan: devuelven otro espía con exec().
          if (prop === 'pipeline' || prop === 'multi') return new RedisEspia(true);
          if (prop === 'exec') return Promise.resolve([]);
          if (obj.enCadena) return proxy;
          return Promise.resolve(prop === 'set' || prop === 'setex' ? 'OK' : null);
        };
      },
    });
    return proxy;
  }
  on() { return this; }
  once() { return this; }
  disconnect() {}
  async quit() { return 'OK'; }
}
const SIN_MOCKS = typeof (mock as { module?: unknown }).module !== 'function'
  ? 'necesita Node 22.3+ con --experimental-test-module-mocks' : false;
if (!SIN_MOCKS) mock.module('ioredis', { defaultExport: RedisEspia });

const SIM = '570000222333';
type Sim = typeof import('./simulacion');
let sim: Sim;

before(async () => {
  if (SIN_MOCKS) return;
  sim = await import('./simulacion');
}, { timeout: 120_000 });

beforeEach(() => { comandos.length = 0; argumentos.length = 0; sim?.buzon.borrar(SIM); });

const notas = () => sim.buzon.sacar(SIM).filter((m) => m.tipo === 'nota') as Array<{ servicio: string; texto: string }>;
const enSim = <T>(fn: () => Promise<T>) => sim.enZonaDePruebas(SIM, fn);

describe('efectos externos en una conversación simulada', { skip: SIN_MOCKS }, () => {
  it('las métricas del panel no cuentan la conversación simulada (y fuera del simulador sí)', async () => {
    const { track } = await import('./metrics');
    await enSim(() => track('reco_resultados', { area: 'posgrados' }));
    assert.deepEqual(comandos, [], 'nada a Redis');
    await track('reco_resultados');
    assert.ok(comandos.includes('hincrby'), 'control: fuera del simulador la métrica sí se escribe');
  });

  it('Google Sheets de prospectos: no escribe ni falla, y deja nota', async () => {
    const reg = await import('./registroService');
    const fila = await enSim(() => reg.guardarRegistroProspecto({ nombre: 'Laura', email: '', whatsapp: SIM, programa: 'MBA' }));
    assert.equal(fila, null);
    await enSim(() => reg.actualizarRegistroProspecto(7, { nombre: 'Laura', email: '', whatsapp: SIM, programa: 'MBA' }));
    await enSim(() => reg.actualizarNombreProspecto(7, 'Laura'));
    assert.equal(notas().filter((n) => /Sheets/.test(n.servicio)).length, 3);
  });

  it('HubSpot, Chatwoot y el CRM del panel: nada sale; Chatwoot da un id de mentira (-1)', async () => {
    const hub = await import('./hubspotService');
    const cw = await import('./chatwootService');
    const crm = await import('./crmService');
    await enSim(() => hub.upsertContactoHubspot({ email: 'l@x.co', nombre: 'Laura', whatsapp: SIM, posgradoInteres: 'MBA', interesFinanciacion: '', consentimiento: true }));
    const contacto = await enSim(() => cw.getOrCreateContact(SIM, 'Laura'));
    const id = await enSim(() => cw.createConversation({ sourceId: contacto.sourceId, contactId: contacto.contactId, initialMessage: 'hola' } as Parameters<typeof cw.createConversation>[0]));
    assert.equal(id, -1);
    await enSim(() => cw.sendIncomingMessage(-1, 'sigo aquí'));
    await enSim(() => crm.agregarNota(SIM, 'nota del bot', 'bot'));
    await enSim(() => crm.setEtiquetas(SIM, ['bot-conversacion'], 'bot'));
    assert.deepEqual(comandos.filter((c) => c !== 'get'), [], 'el CRM solo lee');
    const servicios = notas().map((n) => n.servicio);
    for (const s of ['HubSpot', 'Chatwoot', 'CRM']) assert.ok(servicios.some((x) => x.includes(s)), `${s}: ${servicios}`);
  });

  it('seguimientos, incidencias y «no reconocido» no se programan ni se guardan', async () => {
    const seg = await import('./seguimientoService');
    const inc = await import('./incidenciasService');
    const nr = await import('./noReconocidoService');
    await enSim(() => seg.programarSeguimiento(SIM, 'tiene_programa'));
    await enSim(() => inc.registrarIncidencia('crm', 'falló algo'));
    await enSim(() => nr.registrarNoReconocido('menu', 'asdf'));
    assert.deepEqual(comandos, []);
    assert.ok(notas().some((n) => /asdf/.test(n.texto)), 'quien prueba ve qué no entendió el bot');
  });

  it('las preguntas a la IA del simulador no entran al ranking del panel ni a la caché de respuestas', async () => {
    const faq = await import('./respuestasFrecuentes');
    await enSim(() => faq.contarPregunta('¿Cuánto cuesta la maestría en finanzas?'));
    await enSim(() => faq.guardarRespuesta('ia:resp:prueba', { answer: 'Cuesta…' }));
    assert.deepEqual(comandos, []);
    await faq.guardarRespuesta('ia:resp:prueba', { answer: 'Cuesta…' });
    assert.ok(comandos.includes('set'), 'control: fuera del simulador sí se guarda');
  });

  it('el correo con el código no se manda: el código aparece en la conversación', async () => {
    const mail = await import('./mailService');
    await enSim(() => mail.sendOtpEmail('ana@utb.edu.co', '123456'));
    const n = notas();
    assert.equal(n.length, 1);
    assert.match(n[0].texto, /123456/);
    await assert.doesNotReject(enSim(() => mail.enviarCorreo({ to: 'x@utb.edu.co', subject: 's', html: 'h', text: 't' })));
  });

  it('verificar el correo en el simulador usa un correo ficticio: nunca toma el vínculo de un estudiante real', async () => {
    const id = await import('./identityService');
    await enSim(() => id.startVerification(SIM, 'ana.perez@utb.edu.co'));
    const guardado = argumentos[comandos.indexOf('setex')];
    assert.ok(guardado, 'guarda el código pendiente');
    assert.ok(String(guardado[2]).includes(sim.correoSimulado(SIM)), String(guardado[2]));
    assert.doesNotMatch(JSON.stringify(argumentos), /ana\.perez/, 'el correo real no se guarda en ningún lado');
    assert.match(notas().map((n) => n.texto).join('\n'), /\d{6}/, 'el código se ve en la conversación');
  });

  it('el portal de notas y el código estudiantil no se consultan con datos reales', async () => {
    const notasSvc = await import('./notasService');
    const r = await enSim(() => notasSvc.startNotasLogin(SIM, 'ana@utb.edu.co', 'clave'));
    assert.equal(r.status, 'error');
    const { vincularCodigoEstudiantil } = await import('./academico/servicio');
    const v = await enSim(() => vincularCodigoEstudiantil(SIM, 'T00012345', '1045678901'));
    assert.equal(v.estado, 'apagado');
    // Sin la nota, el «error» y el «apagado» podrían venir de otra parte (sin navegador, interruptores apagados).
    const servicios = notas().map((n) => n.servicio).join(' | ');
    assert.match(servicios, /notas/i);
    assert.match(servicios, /código estudiantil/i);
  });
});
