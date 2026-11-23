import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
import { crearSimuladorWhatsappRouter, type DepsSimuladorWhatsapp } from './simuladorWhatsappRouter';
import { buzon, enSimulacion, esNumeroSimulado, telefonoEnSimulacion } from '../../services/simulacion';

let server: Server;
let base: string;
let router: express.Router;

before(async () => {
  const app = express();
  app.use(express.json());
  // Sustituye a requireAuth: la identidad llega en una cabecera.
  app.use((req, _res, next) => {
    const [username, role] = String(req.headers['x-user'] ?? '').split(':');
    (req as unknown as { user: unknown }).user = { username, role, fullName: username };
    next();
  });
  app.use('/api/tools', (req, res, next) => router(req, res, next));
  await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/tools`;
});
after(() => { server.close(); });

let manejados: Array<{ telefono: string; texto: string; enSim: boolean; telCtx: string | null }>;
let limpiados: string[];
let perfiles: Array<{ telefono: string; perfil: string }>;
let auditoria: string[];
let permitir: boolean;
let pasos: Map<string, string>;
let iaDisponible: boolean;

beforeEach(() => {
  manejados = []; limpiados = []; perfiles = []; auditoria = []; permitir = true; pasos = new Map(); iaDisponible = false;
  const deps: DepsSimuladorWhatsapp = {
    async manejar(telefono, texto) {
      manejados.push({ telefono, texto, enSim: enSimulacion(), telCtx: telefonoEnSimulacion() });
      // Lo que «responde el bot»: llega al buzón como si lo hubiera mandado el adaptador.
      buzon.anotar(telefono, { tipo: 'texto', texto: `eco: ${texto}` });
      pasos.set(telefono, 'reco_nombre');
    },
    paso: async (t) => pasos.get(t) ?? null,
    async limpiar(t) { limpiados.push(t); pasos.delete(t); },
    async prepararPerfil(telefono, perfil) { perfiles.push({ telefono, perfil }); },
    limite: async () => ({ allowed: permitir, retryAfterSec: 30 }),
    audit: async (u, a) => { auditoria.push(`${u}:${a}`); },
    estado: () => ({ ia: iaDisponible, adaptador: 'meta', conversacional: true, agenda: false, miSemestre: false, flyers: true, eventoPosgrados: false }),
  };
  router = crearSimuladorWhatsappRouter(deps);
});

async function llamar(quien: string, metodo: string, ruta: string, cuerpo?: unknown) {
  const r = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', 'x-user': quien },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
}
const ADMIN = 'ana:admin';
const ASESOR = 'luis:asesor';

async function nueva(perfil = 'nuevo') {
  const r = await llamar(ADMIN, 'POST', '/simulador-whatsapp/conversaciones', { perfil });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.telefono as string;
}

describe('simulador de WhatsApp: acceso', () => {
  it('solo el administrador lo usa: un asesor recibe 403 en todas las rutas y no se ejecuta nada', async () => {
    const tel = '570000111222';
    for (const [m, ruta, cuerpo] of [
      ['GET', '/simulador-whatsapp/estado'],
      ['POST', '/simulador-whatsapp/conversaciones', { perfil: 'nuevo' }],
      ['POST', '/simulador-whatsapp/mensajes', { telefono: tel, texto: 'hola' }],
      ['GET', `/simulador-whatsapp/mensajes?telefono=${tel}`],
      ['DELETE', `/simulador-whatsapp/conversaciones/${tel}`],
    ] as Array<[string, string, unknown?]>) {
      assert.equal((await llamar(ASESOR, m, ruta, cuerpo)).status, 403, `${m} ${ruta}`);
      assert.equal((await llamar('', m, ruta, cuerpo)).status, 403, `sin rol: ${m} ${ruta}`);
    }
    assert.deepEqual(manejados, []);
    assert.deepEqual(limpiados, []);
  });

  it('el estado dice si hay IA (sin OPENAI_API_KEY el bot responde por reglas)', async () => {
    const r = await llamar(ADMIN, 'GET', '/simulador-whatsapp/estado');
    assert.equal(r.status, 200);
    assert.equal(r.json.ia, false);
    assert.match(r.json.prefijo, /^570000$/);
  });
});

describe('simulador de WhatsApp: conversación', () => {
  it('una conversación nueva tiene un número de la zona de pruebas y prepara el perfil elegido', async () => {
    const tel = await nueva('estudiante');
    assert.ok(esNumeroSimulado(tel), tel);
    assert.deepEqual(perfiles, [{ telefono: tel, perfil: 'estudiante' }]);
    assert.deepEqual(auditoria, ['ana:simulador_whatsapp_iniciado']);
  });

  it('cada mensaje corre el flujo DENTRO de la zona de pruebas y devuelve lo que el bot respondió y el paso', async () => {
    const tel = await nueva();
    const r = await llamar(ADMIN, 'POST', '/simulador-whatsapp/mensajes', { telefono: tel, texto: '  Hola  ' });
    assert.equal(r.status, 200);
    assert.deepEqual(manejados, [{ telefono: tel, texto: 'Hola', enSim: true, telCtx: tel }]);
    assert.deepEqual(r.json.mensajes.map((m: { texto: string }) => m.texto), ['eco: Hola']);
    assert.equal(r.json.paso, 'reco_nombre');
    // Lo entregado sale del buzón: la consulta siguiente no lo repite.
    const despues = await llamar(ADMIN, 'GET', `/simulador-whatsapp/mensajes?telefono=${tel}`);
    assert.deepEqual(despues.json.mensajes, []);
  });

  it('valida con zod: número real, texto vacío o demasiado largo, perfil desconocido → 400 sin ejecutar nada', async () => {
    const casos: Array<[string, string, unknown]> = [
      ['POST', '/simulador-whatsapp/mensajes', { telefono: '573001234567', texto: 'hola' }],
      ['POST', '/simulador-whatsapp/mensajes', { telefono: '570000111222', texto: '   ' }],
      ['POST', '/simulador-whatsapp/mensajes', { telefono: '570000111222', texto: 'x'.repeat(1025) }],
      ['POST', '/simulador-whatsapp/mensajes', { telefono: '570000111222', texto: 'hola', extra: 1 }],
      ['POST', '/simulador-whatsapp/conversaciones', { perfil: 'hacker' }],
      ['GET', '/simulador-whatsapp/mensajes?telefono=573001234567', undefined],
      ['DELETE', '/simulador-whatsapp/conversaciones/573001234567', undefined],
    ];
    for (const [m, ruta, cuerpo] of casos) assert.equal((await llamar(ADMIN, m, ruta, cuerpo)).status, 400, `${m} ${ruta} ${JSON.stringify(cuerpo)}`);
    assert.deepEqual(manejados, []);
    assert.deepEqual(limpiados, []);
  });

  it('con límite de tasa: pasado el tope responde 429 y no corre el flujo', async () => {
    const tel = await nueva();
    permitir = false;
    const r = await llamar(ADMIN, 'POST', '/simulador-whatsapp/mensajes', { telefono: tel, texto: 'hola' });
    assert.equal(r.status, 429);
    assert.equal(r.json.retryAfterSec, 30);
    assert.deepEqual(manejados, []);
    assert.equal((await llamar(ADMIN, 'POST', '/simulador-whatsapp/conversaciones', { perfil: 'nuevo' })).status, 429);
  });

  it('«Empezar de nuevo» borra la sesión simulada y lo pendiente en el buzón', async () => {
    const tel = await nueva();
    assert.deepEqual(limpiados, [tel], 'empieza limpio aunque el número aleatorio ya se hubiera usado');
    limpiados.length = 0;
    buzon.anotar(tel, { tipo: 'texto', texto: 'quedó pendiente' });
    const r = await llamar(ADMIN, 'DELETE', `/simulador-whatsapp/conversaciones/${tel}`);
    assert.equal(r.status, 200);
    assert.deepEqual(limpiados, [tel]);
    assert.deepEqual(buzon.sacar(tel), []);
  });

  it('si el flujo falla, responde 500 sin detalles y entrega lo que alcanzó a mandar', async () => {
    const tel = await nueva();
    router = crearSimuladorWhatsappRouter({
      manejar: async (t) => { buzon.anotar(t, { tipo: 'texto', texto: 'antes del fallo' }); throw new Error('boom 573001234567'); },
      paso: async () => null, limpiar: async () => {}, prepararPerfil: async () => {},
      limite: async () => ({ allowed: true, retryAfterSec: 0 }), audit: async () => {},
      estado: () => ({ ia: false, adaptador: 'meta', conversacional: false, agenda: false, miSemestre: false, flyers: false, eventoPosgrados: false }),
    });
    const r = await llamar(ADMIN, 'POST', '/simulador-whatsapp/mensajes', { telefono: tel, texto: 'hola' });
    assert.equal(r.status, 500);
    assert.doesNotMatch(JSON.stringify(r.json), /boom|573001234567/);
    assert.deepEqual(r.json.mensajes.map((m: { texto: string }) => m.texto), ['antes del fallo']);
  });
});
