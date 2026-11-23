// Simulador de WhatsApp de punta a punta con el flujo REAL (handleMessage) y el adaptador REAL envuelto en la zona
// de pruebas (shared.messaging). Solo se reemplaza la infraestructura: Redis (memoria) y el envío del adaptador real
// (espías en los prototipos de Meta y Evolution, que fallan la prueba si un número simulado llega hasta ellos).
// Se corre con --experimental-test-module-mocks (tools/run-tests.cjs lo pasa).
import { before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

class RedisMemoria {
  static datos = new Map<string, string>();
  constructor() {
    return new Proxy(this, {
      get(obj, prop) {
        if (prop in obj) return (obj as unknown as Record<string | symbol, unknown>)[prop];
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        return () => { throw new Error(`RedisMemoria: ${String(prop)} no implementado`); };
      },
    });
  }
  async get(k: string) { return RedisMemoria.datos.get(k) ?? null; }
  async set(k: string, v: string) { RedisMemoria.datos.set(k, v); return 'OK'; }
  async setex(k: string, _ttl: number, v: string) { RedisMemoria.datos.set(k, v); return 'OK'; }
  async del(...ks: string[]) { let n = 0; for (const k of ks) if (RedisMemoria.datos.delete(k)) n++; return n; }
  async exists(...ks: string[]) { return ks.filter((k) => RedisMemoria.datos.has(k)).length; }
  async expire() { return 1; }
  async incr(k: string) { const n = Number(RedisMemoria.datos.get(k) ?? 0) + 1; RedisMemoria.datos.set(k, String(n)); return n; }
  async lrange() { return []; }
  async lpush() { return 1; }
  async ltrim() { return 'OK'; }
  async sismember() { return 0; }
  on() { return this; }
  once() { return this; }
  disconnect() {}
  async quit() { return 'OK'; }
}
const SIN_MOCKS = typeof (mock as { module?: unknown }).module !== 'function'
  ? 'necesita Node 22.3+ con --experimental-test-module-mocks' : false;
if (!SIN_MOCKS) mock.module('ioredis', { defaultExport: RedisMemoria });

const SIM = '570000444555';
const REAL = '573004445556';
const METODOS = ['sendText', 'sendButtons', 'sendList', 'sendDocument', 'sendImage', 'sendMediaFromUrl'] as const;
const alAdaptadorReal: Array<{ metodo: string; to: string }> = [];

let handleMessage: typeof import('./index').handleMessage;
let sim: typeof import('../services/simulacion');

before(async () => {
  if (SIN_MOCKS) return;
  const [{ MetaCloudAdapter }, { EvolutionAPIAdapter }] = await Promise.all([
    import('../adapters/messaging/MetaCloudAdapter'), import('../adapters/messaging/EvolutionAPIAdapter'),
  ]);
  // Espías en los adaptadores REALES: nada sale a la red y se ve a quién se le habría mandado.
  for (const Clase of [MetaCloudAdapter, EvolutionAPIAdapter]) {
    for (const metodo of METODOS) {
      mock.method(Clase.prototype, metodo, async (msg: { to: string }) => { alAdaptadorReal.push({ metodo, to: msg.to }); });
    }
  }
  sim = await import('../services/simulacion');
  ({ handleMessage } = await import('./index'));
}, { timeout: 180_000 }); // cargar todo el grafo de flujos tarda con el PC ocupado

beforeEach(() => { alAdaptadorReal.length = 0; RedisMemoria.datos.clear(); sim?.buzon.borrar(SIM); });

describe('simulador de WhatsApp con el flujo real', { skip: SIN_MOCKS }, () => {
  it('un número simulado recorre el flujo real y NADA llega al adaptador real: la respuesta queda en el buzón', async () => {
    await sim.enZonaDePruebas(SIM, () => handleMessage(SIM, 'hola'));
    assert.deepEqual(alAdaptadorReal, []);
    const recibidos = sim.buzon.sacar(SIM).filter((m) => m.tipo !== 'nota');
    assert.ok(recibidos.length > 0, 'el bot respondió');
    assert.ok(recibidos.some((m) => m.tipo === 'lista' || m.tipo === 'botones'), JSON.stringify(recibidos));
    assert.ok(RedisMemoria.datos.has(`session:${SIM}`), 'la sesión simulada vive en Redis como cualquier otra');
  });

  it('aun SIN la zona de pruebas (un temporizador, un recordatorio), un número simulado no sale', async () => {
    await handleMessage(SIM, 'hola');
    assert.deepEqual(alAdaptadorReal, []);
    assert.ok(sim.buzon.sacar(SIM).length > 0);
  });

  it('en el chat con la IA caída, «quiero hablar con un asesor» pasa al asesor sin pedir que escriba «asesor»', async () => {
    for (const t of ['hola', 'Soy egresado UTB', 'Ingeniería de Sistemas', 'maestría', '¿tiene clases los sábados?']) {
      await sim.enZonaDePruebas(SIM, () => handleMessage(SIM, t));
    }
    const antes = JSON.stringify(sim.buzon.sacar(SIM));
    assert.match(antes, /no está disponible/, 'sin OPENAI_API_KEY la IA está caída');
    await sim.enZonaDePruebas(SIM, () => handleMessage(SIM, 'quiero hablar con un asesor'));
    const despues = JSON.stringify(sim.buzon.sacar(SIM));
    assert.doesNotMatch(despues, /Escribe \*asesor\*/, despues);
    assert.notEqual(JSON.parse(RedisMemoria.datos.get(`session:${SIM}`) ?? '{}').step, 'chatting_with_ai', despues);
  });

  it('con el flujo clásico (FLUJO_CONVERSACIONAL apagado), pedir un asesor en el menú no queda en «No reconocí»', async () => {
    const { config } = await import('../config');
    assert.equal(config.conversacion.activa, false, 'esta prueba es del flujo clásico');
    await sim.enZonaDePruebas(SIM, () => handleMessage(SIM, 'hola'));
    sim.buzon.sacar(SIM);
    await sim.enZonaDePruebas(SIM, () => handleMessage(SIM, 'quiero hablar con un asesor'));
    const r = JSON.stringify(sim.buzon.sacar(SIM));
    assert.doesNotMatch(r, /No reconoc/, r);
    assert.notEqual(JSON.parse(RedisMemoria.datos.get(`session:${SIM}`) ?? '{}').step, 'menu', r);
  });

  it('un número real NUNCA se captura: el mismo mensaje sale por el adaptador real', async () => {
    await handleMessage(REAL, 'hola');
    assert.ok(alAdaptadorReal.length > 0);
    assert.ok(alAdaptadorReal.every((l) => l.to === REAL));
    assert.deepEqual(sim.buzon.sacar(REAL), []);
  });
});
