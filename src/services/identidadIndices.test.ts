// Índices de búsqueda por código y cédula (issue #38 y revisión del 23-nov): clave propia, respaldo a la vieja
// mientras se migra, migración idempotente, índice de cédula confirmado y borrado al revocar, y soltar un código.
// identityService abre Redis al importarse: aquí 'ioredis' es un Redis en memoria y sus `eval` son un PORT en JS de
// los scripts Lua (como agenda.fakes.test.ts). El Lua de verdad se prueba en identidadFuerte.redis.test.ts.
import { before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

class RedisMemoria {
  static datos = new Map<string, string>();
  static vence = new Map<string, number>();
  static scripts: Record<string, (keys: string[], argv: string[]) => unknown> = {};
  constructor() {
    return new Proxy(this, {
      get(obj, prop) {
        if (prop in obj) return (obj as unknown as Record<string | symbol, unknown>)[prop];
        if (prop === 'then') return undefined;
        return () => { throw new Error(`RedisMemoria: ${String(prop)} no implementado`); };
      },
    });
  }
  static vivo(k: string) {
    const v = RedisMemoria.vence.get(k);
    if (v !== undefined && v <= Date.now()) { RedisMemoria.datos.delete(k); RedisMemoria.vence.delete(k); }
    return RedisMemoria.datos.has(k);
  }
  static poner(k: string, v: string, args: Array<string | number>) {
    const a = args.map(String);
    if (a.includes('NX') && RedisMemoria.vivo(k)) return null;
    const ex = a.indexOf('EX');
    const keep = a.includes('KEEPTTL');
    RedisMemoria.datos.set(k, v);
    if (ex >= 0) RedisMemoria.vence.set(k, Date.now() + Number(a[ex + 1]) * 1000);
    else if (!keep) RedisMemoria.vence.delete(k);
    return 'OK';
  }
  static ttl(k: string) {
    if (!RedisMemoria.vivo(k)) return -2;
    const v = RedisMemoria.vence.get(k);
    return v === undefined ? -1 : Math.ceil((v - Date.now()) / 1000);
  }
  async get(k: string) { return RedisMemoria.vivo(k) ? RedisMemoria.datos.get(k)! : null; }
  async set(k: string, v: string, ...args: Array<string | number>) { return RedisMemoria.poner(k, v, args); }
  async setex(k: string, ttl: number, v: string) { return RedisMemoria.poner(k, v, ['EX', ttl]); }
  async del(...ks: string[]) { let n = 0; for (const k of ks) { if (RedisMemoria.vivo(k)) n++; RedisMemoria.datos.delete(k); RedisMemoria.vence.delete(k); } return n; }
  async ttl(k: string) { return RedisMemoria.ttl(k); }
  async scan(_cursor: string, _m: string, patron: string) {
    const prefijo = patron.replace(/\*$/, '');
    return ['0', [...RedisMemoria.datos.keys()].filter((k) => k.startsWith(prefijo) && RedisMemoria.vivo(k))];
  }
  async eval(script: string, numKeys: number, ...args: Array<string | number>) {
    const fn = RedisMemoria.scripts[script];
    if (!fn) throw new Error('script Lua sin doble');
    const a = args.map(String);
    return fn(a.slice(0, numKeys), a.slice(numKeys));
  }
  on() { return this; }
  once() { return this; }
  disconnect() {}
  async quit() { return 'OK'; }
}

const SIN_MOCKS = typeof (mock as { module?: unknown }).module !== 'function'
  ? 'necesita Node 22.3+ con --experimental-test-module-mocks' : false;
if (!SIN_MOCKS) mock.module('ioredis', { defaultExport: RedisMemoria });

type IdSvc = typeof import('./identityService');
let id: IdSvc;
let config: typeof import('../config').config;
let claveBusqueda: typeof import('./academico/identidadAcademica').claveBusqueda;

const R = RedisMemoria;
const leer = (k: string) => (R.vivo(k) ? R.datos.get(k)! : null);

before(async () => {
  if (SIN_MOCKS) return;
  id = await import('./identityService');
  ({ config } = await import('../config'));
  ({ claveBusqueda } = await import('./academico/identidadAcademica'));
  const { SCRIPT_CAS_VINCULO } = await import('./academico/indicesBusqueda');
  const json = (k: string) => { const raw = leer(k); try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
  R.scripts = {
    // Port de ATAR_CODIGO_SCRIPT.
    [id.ATAR_CODIGO_SCRIPT]: (K, A) => {
      const ajeno = (k: string) => {
        const owner = leer(k);
        if (!owner || owner === A[0]) return false;
        const otro = json(`identity:${owner}`);
        return !!otro && otro.codigo === A[2] && otro.email !== A[3];
      };
      if (ajeno(K[0]) || (K[3] !== K[0] && ajeno(K[3]))) return 'en_uso';
      const cur = json(K[1]);
      if (!cur || cur.email !== A[3]) return 'sin_identidad';
      const ttl = R.ttl(K[1]);
      if (ttl < 1) return 'sin_identidad';
      R.poner(K[1], A[1], ['EX', ttl]);
      R.poner(K[0], A[0], ['EX', ttl]);
      if (K[2] !== K[0]) R.poner(K[2], A[0], ['EX', ttl]);
      if (K[3] !== K[0] && leer(K[3]) === A[0]) { R.datos.delete(K[3]); R.vence.delete(K[3]); }
      return 'ok';
    },
    // Port de REVOKE_IDENTITY_SCRIPT.
    [id.REVOKE_IDENTITY_SCRIPT]: (K, A) => {
      const cur = json(K[0]);
      if (!leer(K[0])) return 'missing';
      if (!cur || cur.email !== A[1]) return 'changed';
      if (leer(K[1]) === A[0]) R.datos.delete(K[1]);
      for (const k of [K[0], K[2]]) { R.datos.delete(k); R.vence.delete(k); }
      return 'ok';
    },
    // Port de SOLTAR_CODIGO_SCRIPT (si existe: antes de este arreglo no había forma de soltar un código).
    ...(id.SOLTAR_CODIGO_SCRIPT ? { [id.SOLTAR_CODIGO_SCRIPT]: (K: string[], A: string[]) => {
      if (leer(K[0]) !== A[1]) return 'cambio';
      R.poner(K[0], A[2], ['KEEPTTL']);
      for (const k of K.slice(1)) if (leer(k) === A[0]) { R.datos.delete(k); R.vence.delete(k); }
      return 'ok';
    } } : {}),
    [SCRIPT_CAS_VINCULO]: (K, A) => {
      if (leer(K[0]) !== A[0]) return 0;
      R.poner(K[0], A[1], ['KEEPTTL']);
      return 1;
    },
  };
}, { timeout: 120_000 });

const CLAVE_AES = randomBytes(32).toString('hex');
const PROPIA = 'clave-de-busqueda-propia-de-prueba-de-32-o-mas';
const ANA = '573001112233';
const LUIS = '573004445566';
const CODIGO = 'T00012345';
const CEDULA = '1045678901';

beforeEach(() => {
  R.datos.clear(); R.vence.clear();
  delete process.env.TOOLI_BUSQUEDA_CLAVE;
  process.env.TOOLI_ACADEMICO_CLAVE = CLAVE_AES;
});

const emailKey = (e: string) => `identity-email:${createHash('sha256').update(e).digest('hex')}`;
function vincular(tel: string, email: string) {
  R.poner(`identity:${tel}`, JSON.stringify({ email, verifiedAt: Date.now() }), ['EX', 3600]);
  R.poner(emailKey(email), tel, ['EX', 3600]);
}
const atar = (tel: string, codigo = CODIGO, cedula = CEDULA) =>
  id.guardarCodigoEstudiantil(tel, { codigo, verificado: true, fuente: 'iceberg', nombre: 'ANA PEREZ', cedula });
const indices = (tipo: 'codigo' | 'cedula') => [...R.datos.keys()].filter((k) => k.startsWith(`identity-${tipo}:`) && R.vivo(k));

describe('#38: índices con clave propia (TOOLI_BUSQUEDA_CLAVE)', { skip: SIN_MOCKS }, () => {
  it('rotar la clave AES o JWT_SECRET ya no deja huérfanos los índices ni rompe «un código, un correo»', async () => {
    process.env.TOOLI_BUSQUEDA_CLAVE = PROPIA;
    vincular(ANA, 'ana.perez@utb.edu.co');
    assert.equal(await atar(ANA), 'ok');
    const jwt = config.auth.jwtSecret;
    try {
      process.env.TOOLI_ACADEMICO_CLAVE = randomBytes(32).toString('hex');
      (config.auth as { jwtSecret: string }).jwtSecret = 'otro-jwt-secreto-rotado-de-al-menos-32-chars';
      assert.equal((await id.buscarIdentidadPorCodigo(CODIGO))?.telefono, ANA);
      vincular(LUIS, 'luis.gomez@utb.edu.co');
      assert.equal(await atar(LUIS), 'en_uso', 'el mismo código no se ata a un segundo correo');
    } finally {
      (config.auth as { jwtSecret: string }).jwtSecret = jwt;
    }
  });

  it('lo atado con la clave de antes se sigue encontrando al activar la nueva, y sigue siendo de un solo correo', async () => {
    vincular(ANA, 'ana.perez@utb.edu.co');
    assert.equal(await atar(ANA), 'ok');
    assert.deepEqual(indices('codigo'), [claveBusqueda('codigo', CODIGO, CLAVE_AES)], 'sin clave propia: como antes');
    process.env.TOOLI_BUSQUEDA_CLAVE = PROPIA;
    assert.equal((await id.buscarIdentidadPorCodigo(CODIGO))?.telefono, ANA, 'respaldo a la clave vieja');
    assert.equal((await id.buscarIdentidadPorCedula(CEDULA))?.telefono, ANA);
    vincular(LUIS, 'luis.gomez@utb.edu.co');
    assert.equal(await atar(LUIS), 'en_uso', 'el índice viejo también cuenta para «un código, un correo»');
  });

  it('la migración pasa los índices a la clave nueva, borra los viejos y es idempotente', async () => {
    vincular(ANA, 'ana.perez@utb.edu.co');
    vincular(LUIS, 'luis.gomez@utb.edu.co');
    assert.equal(await atar(ANA), 'ok');
    assert.equal(await atar(LUIS, 'T00099999', '73123456'), 'ok');
    const antes = new Map(R.datos);
    process.env.TOOLI_BUSQUEDA_CLAVE = PROPIA;

    const simulacro = await id.migrarIndicesDeBusqueda({ aplicar: false });
    assert.deepEqual(simulacro, { revisados: 2, codigos: 2, cedulas: 2, cedulasPendientes: 0, conflictos: 0 });
    assert.deepEqual(new Map(R.datos), antes, 'sin --aplicar no escribe nada');

    assert.deepEqual(await id.migrarIndicesDeBusqueda({ aplicar: true }), simulacro);
    const segunda = await id.migrarIndicesDeBusqueda({ aplicar: true });
    assert.deepEqual(segunda, { revisados: 2, codigos: 0, cedulas: 0, cedulasPendientes: 0, conflictos: 0 }, 'idempotente');

    assert.equal(indices('codigo').includes(claveBusqueda('codigo', CODIGO, CLAVE_AES)), false, 'el viejo se borró');
    assert.equal(indices('codigo').length, 2);
    assert.equal(indices('cedula').length, 2);
    // Ya no depende de la clave vieja: se cambia y todo se sigue encontrando.
    const ttlVinculo = R.ttl(`identity:${ANA}`);
    process.env.TOOLI_ACADEMICO_CLAVE = randomBytes(32).toString('hex');
    assert.equal((await id.buscarIdentidadPorCodigo(CODIGO))?.telefono, ANA);
    assert.equal((await id.buscarIdentidadPorCedula(CEDULA))?.telefono, ANA);
    assert.equal((await id.buscarIdentidadPorCedula('73123456'))?.telefono, LUIS);
    assert.ok(R.ttl(`identity:${ANA}`) <= ttlVinculo && R.ttl(`identity:${ANA}`) > 0, 'el vínculo conserva su vencimiento');
  });
});

describe('#13: el índice de cédula se confirma y se borra al revocar', { skip: SIN_MOCKS }, () => {
  it('un índice de cédula que ya no es del vínculo no devuelve a nadie', async () => {
    vincular(ANA, 'ana.perez@utb.edu.co');
    assert.equal(await atar(ANA), 'ok');
    const viejo = claveBusqueda('cedula', CEDULA, CLAVE_AES);
    assert.equal(await atar(ANA, 'T00077777', '22334455'), 'ok', 'cambió de código y de cédula');
    assert.equal(leer(viejo), null, 'el índice de la cédula anterior se suelta');
    // Aunque quedara un índice viejo apuntando aquí (p. ej. de antes de este arreglo), no se confirma.
    R.poner(viejo, ANA, ['EX', 3600]);
    assert.equal(await id.buscarIdentidadPorCedula(CEDULA), null);
    assert.equal((await id.buscarIdentidadPorCedula('22334455'))?.telefono, ANA);
  });

  it('sin código comprobado, la cédula no encuentra a nadie', async () => {
    vincular(ANA, 'ana.perez@utb.edu.co');
    assert.equal(await id.guardarCodigoEstudiantil(ANA, { codigo: CODIGO, verificado: false, fuente: 'declarado', cedula: CEDULA }), 'ok');
    assert.equal(await id.buscarIdentidadPorCedula(CEDULA), null);
  });

  it('revocar el vínculo borra los índices de código y de cédula', async () => {
    vincular(ANA, 'ana.perez@utb.edu.co');
    assert.equal(await atar(ANA), 'ok');
    assert.equal(indices('cedula').length, 1);
    await id.revokeIdentity(ANA);
    assert.deepEqual(indices('codigo'), []);
    assert.deepEqual(indices('cedula'), [], 'antes quedaba el de la cédula apuntando al número');
    assert.equal(await id.buscarIdentidadPorCedula(CEDULA), null);
  });
});

describe('soltar un código atado por quien no es su dueño', { skip: SIN_MOCKS }, () => {
  it('el dueño real recibía «en_uso» sin salida: TI suelta el código y entonces el dueño lo puede atar', async () => {
    vincular(LUIS, 'luis.gomez@utb.edu.co');
    assert.equal(await atar(LUIS), 'ok', 'Luis conocía el código y la cédula de Ana');
    vincular(ANA, 'ana.perez@utb.edu.co');
    assert.equal(await atar(ANA), 'en_uso');

    assert.equal(typeof id.soltarCodigoEstudiantil, 'function', 'hace falta una forma de soltarlo');
    const simulacro = await id.soltarCodigoEstudiantil(CODIGO, { aplicar: false });
    assert.deepEqual(simulacro, { estado: 'simulado', telefono: LUIS, email: 'luis.gomez@utb.edu.co' });
    assert.equal((await id.buscarIdentidadPorCodigo(CODIGO))?.telefono, LUIS, 'el simulacro no cambia nada');

    const ttl = R.ttl(`identity:${LUIS}`);
    assert.deepEqual(await id.soltarCodigoEstudiantil(CODIGO, { aplicar: true }), { estado: 'listo', telefono: LUIS, email: 'luis.gomez@utb.edu.co' });
    const luis = await id.getIdentity(LUIS);
    assert.equal(luis?.email, 'luis.gomez@utb.edu.co', 'el vínculo de correo de Luis sigue');
    assert.equal(luis?.codigo, undefined);
    assert.equal(luis?.cedulaCifrada, undefined);
    assert.ok(R.ttl(`identity:${LUIS}`) <= ttl && R.ttl(`identity:${LUIS}`) > 0, 'sin tocar su vencimiento');
    assert.deepEqual(indices('codigo'), []);
    assert.deepEqual(indices('cedula'), []);

    assert.equal(await atar(ANA), 'ok', 'ahora Ana lo ata');
    assert.equal((await id.buscarIdentidadPorCodigo(CODIGO))?.telefono, ANA);
    assert.deepEqual(await id.soltarCodigoEstudiantil('T00000001', { aplicar: true }), { estado: 'no_encontrado' });
    assert.deepEqual(await id.soltarCodigoEstudiantil('basura', { aplicar: true }), { estado: 'formato' });
  });
});

