// Verificación por VOZ desde otro número (auditoría de seguridad, 22-nov-2026).
// Antes: confirmar el código usaba checkCode de identityService y MOVÍA el vínculo de WhatsApp del estudiante al número
// que llamaba. Ahora vale solo para la llamada: código propio (HMAC atado a llamante + vínculo), 10 min, 3 intentos, un
// solo uso, y devuelve el teléfono del vínculo real para consultar. Estas pruebas fijan eso en el núcleo y en el cableado
// real de servicio.ts (con Redis en memoria y el correo simulado).
import { before, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { crearAcademico, type DepsNucleo, type IdentidadVigente, type PendienteVoz } from './nucleo';

const ANA_TEL = '573001112233';
const LLAMA = '576056505050';   // fijo desde el que llama Ana
const OTRO = '573209998877';    // un segundo llamante que oyó el código
const ANA: IdentidadVigente = { email: 'ana.perez@utb.edu.co', codigo: 'T00012345', codigoVerificado: true, nombre: 'Ana Pérez' };

function mundo() {
  let reloj = Date.parse('2026-11-23T08:00:00-05:00');
  const vinculos = new Map<string, IdentidadVigente>([[ANA_TEL, { ...ANA }]]);
  const pendientes = new Map<string, PendienteVoz>();
  const correos: { email: string; codigo: string }[] = [];
  const codigos = ['482913', '105577', '730264', '991846'];
  const deps: DepsNucleo = {
    identidad: {
      obtener: async (t) => vinculos.get(t) ?? null,
      porCodigo: async (c) => {
        const t = [...vinculos.keys()].find((k) => vinculos.get(k)!.codigo === c);
        return t ? { telefono: t, email: vinculos.get(t)!.email } : null;
      },
      porCedula: async () => null,
    },
    existeCodigoEnFuente: async () => false,
    cedulaDe: async () => null,
    interruptores: { notas: () => false, recibo: () => false, turno: () => true, horario: () => false, cursos: () => false },
    proveedores: { turno: { consultar: async (c) => ({ codigo: c, nombre: 'Ana Pérez', programa: 'Ingeniería', turno: '42', fecha: '2026-12-15', hora: '14:30' }) } },
    permitirBusqueda: async () => true,
    regla: () => ({ notaMinima: 3, notaMaxima: 5, pesosCortes: [30, 30, 40], sinConfirmar: true }),
    ahora: () => new Date(reloj),
    verificacion: {
      enviarCorreo: async (email, codigo) => { correos.push({ email, codigo }); },
      pendientes: {
        leer: async (t) => (pendientes.has(t) ? { ...pendientes.get(t)! } : null),
        guardar: async (t, p) => { pendientes.set(t, { ...p }); },
        borrar: async (t) => { pendientes.delete(t); },
      },
      secreto: 'secreto-de-prueba',
      generarCodigo: () => codigos[correos.length % codigos.length],
    },
  };
  return { api: crearAcademico(deps), vinculos, pendientes, correos, avanzar: (ms: number) => { reloj += ms; } };
}

describe('verificación por voz (núcleo): solo para la llamada', () => {
  it('verificarse desde otro número deja intacto el vínculo original y devuelve el teléfono del vínculo real', async () => {
    const m = mundo();
    const antes = JSON.stringify([...m.vinculos]);
    const env = await m.api.iniciarVerificacionPorDato!(LLAMA, { codigo: 'T00012345' });
    assert.equal(env.estado, 'enviado');
    assert.deepEqual(m.correos.map((c) => c.email), [ANA.email]);
    const r = await m.api.confirmarVerificacion!(LLAMA, m.correos[0].codigo);
    assert.deepEqual(r, { ok: true, telefonoEstudiante: ANA_TEL });
    assert.equal(JSON.stringify([...m.vinculos]), antes, 'el vínculo de WhatsApp no se movió ni cambió');
    assert.equal(await m.api.estudianteDe(LLAMA), null, 'el número que llama NO quedó vinculado');
    assert.equal((await m.api.consultar(LLAMA, 'turno')).ok, false, 'el número que llama no lee nada por sí mismo');
    assert.equal((await m.api.estudianteDe(ANA_TEL))?.email, ANA.email, 'Ana sigue vinculada a su WhatsApp');
  });

  it('el código no se guarda en claro y es de un solo uso', async () => {
    const m = mundo();
    await m.api.iniciarVerificacionPorDato!(LLAMA, { codigo: 'T00012345' });
    const codigo = m.correos[0].codigo;
    assert.equal(JSON.stringify([...m.pendientes]).includes(codigo), false);
    assert.equal((await m.api.confirmarVerificacion!(LLAMA, codigo)).ok, true);
    assert.deepEqual(await m.api.confirmarVerificacion!(LLAMA, codigo), { ok: false, motivo: 'vencido' });
  });

  it('un segundo llamante con el mismo código no hereda nada', async () => {
    const m = mundo();
    await m.api.iniciarVerificacionPorDato!(LLAMA, { codigo: 'T00012345' });
    const codigoAna = m.correos[0].codigo;
    // Sin pedir código propio: no hay nada pendiente para él.
    assert.deepEqual(await m.api.confirmarVerificacion!(OTRO, codigoAna), { ok: false, motivo: 'vencido' });
    // Pidiendo el suyo (llega otro código al correo) y dictando el de la primera llamada: no coincide.
    await m.api.iniciarVerificacionPorDato!(OTRO, { codigo: 'T00012345' });
    assert.notEqual(m.correos[1].codigo, codigoAna);
    assert.deepEqual(await m.api.confirmarVerificacion!(OTRO, codigoAna), { ok: false, motivo: 'no_coincide' });
    assert.equal(await m.api.estudianteDe(OTRO), null);
    // Aunque copie la huella de la primera llamada en su pendiente, está atada al número que llama.
    m.pendientes.set(OTRO, { ...m.pendientes.get(LLAMA)! });
    assert.deepEqual(await m.api.confirmarVerificacion!(OTRO, codigoAna), { ok: false, motivo: 'no_coincide' });
    // La llamada original sigue pudiendo verificarse.
    assert.deepEqual(await m.api.confirmarVerificacion!(LLAMA, codigoAna), { ok: true, telefonoEstudiante: ANA_TEL });
  });

  it('código vencido (más de 10 minutos): no verifica', async () => {
    const m = mundo();
    await m.api.iniciarVerificacionPorDato!(LLAMA, { codigo: 'T00012345' });
    m.avanzar(10 * 60_000 + 1);
    assert.deepEqual(await m.api.confirmarVerificacion!(LLAMA, m.correos[0].codigo), { ok: false, motivo: 'vencido' });
    assert.equal(m.pendientes.size, 0);
  });

  it('código equivocado: 3 intentos y después ni el correcto sirve', async () => {
    const m = mundo();
    await m.api.iniciarVerificacionPorDato!(LLAMA, { codigo: 'T00012345' });
    assert.deepEqual(await m.api.confirmarVerificacion!(LLAMA, '000000'), { ok: false, motivo: 'no_coincide' });
    assert.deepEqual(await m.api.confirmarVerificacion!(LLAMA, '000001'), { ok: false, motivo: 'no_coincide' });
    assert.deepEqual(await m.api.confirmarVerificacion!(LLAMA, '000002'), { ok: false, motivo: 'demasiados' });
    assert.deepEqual(await m.api.confirmarVerificacion!(LLAMA, m.correos[0].codigo), { ok: false, motivo: 'vencido' });
  });

  it('si el vínculo cambió entre el envío y la confirmación, el código ya no vale', async () => {
    const m = mundo();
    await m.api.iniciarVerificacionPorDato!(LLAMA, { codigo: 'T00012345' });
    m.vinculos.set(ANA_TEL, { ...ANA, email: 'otra.persona@utb.edu.co' });
    assert.deepEqual(await m.api.confirmarVerificacion!(LLAMA, m.correos[0].codigo), { ok: false, motivo: 'vencido' });
  });

  it('pedir otro código enseguida desde el mismo número: espera', async () => {
    const m = mundo();
    assert.equal((await m.api.iniciarVerificacionPorDato!(LLAMA, { codigo: 'T00012345' })).estado, 'enviado');
    assert.equal((await m.api.iniciarVerificacionPorDato!(LLAMA, { codigo: 'T00012345' })).estado, 'espera');
    assert.equal(m.correos.length, 1);
  });
});

// ── Auditoría de seguridad (22-nov): pruebas INVERTIDAS de los huecos H1-H3 (vara §96) ──────────────────────
// Cada una nació de una prueba de concepto que pasaba mientras el hueco existía: aquí se exige lo contrario.
// El almacén es el de las PoC: solo leer/guardar/borrar, y con `retraso` cada lectura tarda un viaje de red
// (como GET y SET separados en Redis). El reloj NO avanza salvo que la prueba lo pida.
function mundoAtaque(opts: { retraso?: boolean } = {}) {
  let reloj = Date.parse('2026-11-23T08:00:00-05:00');
  const pendientes = new Map<string, PendienteVoz>();
  const correos: { email: string; codigo: string }[] = [];
  const tick = () => new Promise((r) => setImmediate(r));
  const deps: DepsNucleo = {
    identidad: {
      obtener: async (t) => (t === ANA_TEL ? { ...ANA } : null),
      porCodigo: async (c) => (c === ANA.codigo ? { telefono: ANA_TEL, email: ANA.email } : null),
      porCedula: async () => null,
    },
    existeCodigoEnFuente: async () => false,
    cedulaDe: async () => null,
    interruptores: { notas: () => false, recibo: () => false, turno: () => true, horario: () => false, cursos: () => false },
    proveedores: {},
    permitirBusqueda: async () => true,
    regla: () => ({ notaMinima: 3, notaMaxima: 5, pesosCortes: [30, 30, 40], sinConfirmar: true }),
    ahora: () => new Date(reloj),
    verificacion: {
      enviarCorreo: async (email, codigo) => { correos.push({ email, codigo }); },
      pendientes: {
        leer: async (t) => { const v = pendientes.has(t) ? { ...pendientes.get(t)! } : null; if (opts.retraso) await tick(); return v; },
        guardar: async (t, p) => { pendientes.set(t, { ...p }); },
        borrar: async (t) => { pendientes.delete(t); },
      },
      secreto: 'secreto-de-prueba',
      generarCodigo: () => '777777',
    },
  };
  return { api: crearAcademico(deps), correos, pendientes, avanzar: (ms: number) => { reloj += ms; } };
}
const iniciar = (m: ReturnType<typeof mundoAtaque>, llamante = LLAMA) => m.api.iniciarVerificacionPorDato!(llamante, { codigo: 'T00012345' });
const fallar3 = async (m: ReturnType<typeof mundoAtaque>, llamante = LLAMA) => {
  for (let k = 0; k < 3; k++) await m.api.confirmarVerificacion!(llamante, String(100000 + k));
};

describe('auditoría 22-nov: la verificación por voz no se deja forzar (pruebas invertidas)', () => {
  it('H1: agotar los 3 intentos NO borra la espera: no se pueden encadenar «3 conjeturas → código nuevo»', async () => {
    const m = mundoAtaque();
    assert.equal((await iniciar(m)).estado, 'enviado');
    await fallar3(m);
    assert.equal((await iniciar(m)).estado, 'espera', 'tras 3 fallos se aceptó otro código en el mismo instante');
    assert.equal(m.correos.length, 1);
  });

  it('H1: tras un éxito tampoco se puede pedir otro código en el acto', async () => {
    const m = mundoAtaque();
    await iniciar(m);
    assert.equal((await m.api.confirmarVerificacion!(LLAMA, '777777')).ok, true);
    assert.equal((await iniciar(m)).estado, 'espera');
  });

  it('H1: aun dejando pasar la espera, el mismo número llama a lo sumo 5 veces por hora', async () => {
    const m = mundoAtaque();
    const estados: string[] = [];
    for (let i = 0; i < 6; i++) { estados.push((await iniciar(m)).estado); m.avanzar(61_000); }
    assert.deepEqual(estados, ['enviado', 'enviado', 'enviado', 'enviado', 'enviado', 'espera']);
  });

  it('H1: rotando el número que llama, el mismo estudiante recibe a lo sumo 5 códigos por hora', async () => {
    const m = mundoAtaque();
    const estados: string[] = [];
    for (let i = 0; i < 6; i++) estados.push((await iniciar(m, `57605650${String(i).padStart(4, '0')}`)).estado);
    assert.deepEqual(estados, ['enviado', 'enviado', 'enviado', 'enviado', 'enviado', 'espera']);
    assert.equal(m.correos.length, 5);
  });

  it('H1: agotar los intentos dos veces bloquea al número que llama (estado «bloqueado»)', async () => {
    const m = mundoAtaque();
    await iniciar(m); await fallar3(m); m.avanzar(61_000);
    await iniciar(m); await fallar3(m); m.avanzar(61_000);
    assert.equal((await iniciar(m)).estado, 'bloqueado');
    m.avanzar(3600_000);
    assert.equal((await iniciar(m)).estado, 'enviado', 'el bloqueo es temporal');
  });

  it('H1: diez rondas de la PoC en el mismo instante dan 3 conjeturas, no 30', async () => {
    const m = mundoAtaque();
    let fallos = 0;
    for (let ronda = 0; ronda < 10; ronda++) {
      if ((await iniciar(m)).estado !== 'enviado') continue;
      for (let k = 0; k < 3; k++) if (!(await m.api.confirmarVerificacion!(LLAMA, String(100000 + k))).ok) fallos++;
    }
    assert.equal(fallos, 3);
    assert.equal(m.correos.length, 1);
  });

  it('H2: 20 confirmaciones simultáneas no saltan el tope de 3 (la 20.ª, la buena, ya no vale)', async () => {
    const m = mundoAtaque({ retraso: true });
    await iniciar(m);
    const conjeturas = Array.from({ length: 20 }, (_, i) => String(100000 + i));
    conjeturas[19] = '777777';
    const rs = await Promise.all(conjeturas.map((c) => m.api.confirmarVerificacion!(LLAMA, c)));
    const motivos = rs.map((r) => (r.ok ? 'ok' : r.motivo));
    assert.equal(motivos.filter((x) => x === 'no_coincide').length, 2, motivos.join(','));
    assert.equal(motivos.filter((x) => x === 'demasiados').length, 1, motivos.join(','));
    assert.equal(motivos.filter((x) => x === 'ok').length, 0, 'acertó tras más de 3 intentos');
    assert.equal(m.pendientes.size, 0);
  });

  it('H3: tres inicios simultáneos del mismo número mandan UN correo', async () => {
    const m = mundoAtaque({ retraso: true });
    const rs = await Promise.all([1, 2, 3].map(() => iniciar(m)));
    assert.deepEqual(rs.map((r) => r.estado).sort(), ['enviado', 'espera', 'espera']);
    assert.equal(m.correos.length, 1);
  });
});

// ── El cableado real (servicio.ts): nunca pasa por startVerification/checkCode ──
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
  async setex(k: string, _ttl: number, v: string) { RedisMemoria.datos.set(k, v); return 'OK'; }
  async del(...ks: string[]) { let n = 0; for (const k of ks) if (RedisMemoria.datos.delete(k)) n++; return n; }
  on() { return this; }
  once() { return this; }
  disconnect() {}
  async quit() { return 'OK'; }
}
const SIN_MOCKS = typeof (mock as { module?: unknown }).module !== 'function'
  ? 'necesita Node 22.3+ con --experimental-test-module-mocks' : false;
if (!SIN_MOCKS) mock.module('ioredis', { defaultExport: RedisMemoria });

describe('verificación por voz (servicio real): no toca identityService.checkCode', { skip: SIN_MOCKS }, () => {
  const correos: { to: string; code: string }[] = [];
  const llamadasVinculo: string[] = [];
  // Pendientes de voz en memoria (el Lua real se prueba con Redis en verificacionVoz.redis.test.ts).
  const pendientesVoz = new Map<string, PendienteVoz>();
  // checkRateLimit en memoria con la misma regla que el real: contador por clave, permitido si n <= max.
  const cupos = new Map<string, number>();
  let api: typeof import('./servicio').academico;
  let config: typeof import('../../config').config;
  let atomicos: Record<string, (...a: unknown[]) => unknown> = {};
  let nuevosAtomicos = () => {};

  before(async () => {
    const [identidad, correo, nucleo] = await Promise.all([import('../identityService'), import('../mailService'), import('./nucleo')]);
    ({ config } = await import('../../config'));
    const base = {
      leer: async (t: string) => (pendientesVoz.has(t) ? { ...pendientesVoz.get(t)! } : null),
      guardar: async (t: string, p: PendienteVoz) => { pendientesVoz.set(t, { ...p }); },
      borrar: async (t: string) => { pendientesVoz.delete(t); },
    };
    // Con el arreglo, servicio.ts llama a crearSiCabe/intentar: aquí van los de memoria del núcleo, nuevos en cada
    // prueba (beforeEach) para que la marca de espera de una no se cuele en la siguiente.
    const crear = (nucleo as unknown as { atomicoEnMemoria?: (b: typeof base) => Record<string, (...a: unknown[]) => unknown> }).atomicoEnMemoria;
    nuevosAtomicos = () => { atomicos = crear ? crear(base) : {}; };
    nuevosAtomicos();
    const voz: Record<string, unknown> = { ...base };
    if (crear) for (const k of ['crearSiCabe', 'intentar']) voz[k] = (...a: unknown[]) => atomicos[k](...a);
    const fila = { email: ANA.email, verifiedAt: Date.now(), codigo: ANA.codigo, codigoVerificado: true, nombre: ANA.nombre };
    const espia = (nombre: string) => async () => { llamadasVinculo.push(nombre); throw new Error(`${nombre} no debe usarse en la voz`); };
    mock.module('../identityService', { namedExports: {
      ...identidad,
      getIdentity: async (t: string) => (t === ANA_TEL ? fila : null),
      buscarIdentidadPorCodigo: async (c: string) => (c === ANA.codigo ? { telefono: ANA_TEL, identity: fila } : null),
      startVerification: espia('startVerification'),
      checkCode: espia('checkCode'),
      revokeIdentity: espia('revokeIdentity'),
      pendientesVoz: voz,
    } });
    mock.module('../mailService', { namedExports: {
      ...correo,
      sendOtpEmail: async (to: string, code: string) => { correos.push({ to, code }); },
    } });
    mock.module('../rateLimit', { namedExports: {
      checkRateLimit: async (clave: string, max: number) => {
        const n = (cupos.get(clave) ?? 0) + 1;
        cupos.set(clave, n);
        return { allowed: n <= max };
      },
    } });
    ({ academico: api } = await import('./servicio'));
  }, { timeout: 120_000 });

  beforeEach(() => {
    correos.length = 0; llamadasVinculo.length = 0; RedisMemoria.datos.clear(); pendientesVoz.clear(); cupos.clear(); nuevosAtomicos();
  });

  it('manda el código con la plantilla del OTP, lo guarda como HMAC y confirma sin mover el vínculo', async () => {
    const env = await api.iniciarVerificacionPorDato!(LLAMA, { codigo: 'T00012345' });
    assert.equal(env.estado, 'enviado');
    assert.equal(correos.length, 1);
    assert.equal(correos[0].to, ANA.email);
    assert.match(correos[0].code, /^\d{6}$/);
    assert.deepEqual([...pendientesVoz.keys()], [LLAMA]);
    assert.equal(JSON.stringify([...pendientesVoz]).includes(correos[0].code), false, 'el código no se guarda en claro');

    assert.deepEqual(await api.confirmarVerificacion!(OTRO, correos[0].code), { ok: false, motivo: 'vencido' });
    assert.deepEqual(await api.confirmarVerificacion!(LLAMA, correos[0].code), { ok: true, telefonoEstudiante: ANA_TEL });
    assert.deepEqual(llamadasVinculo, [], 'ni startVerification ni checkCode: el vínculo de WhatsApp no se toca');
    assert.equal(RedisMemoria.datos.size, 0, 'nada queda escrito (ni identity:* ni otp:*)');
    assert.equal(pendientesVoz.size, 0, 'el código se consumió');
  });

  // H4 (invertida): un solo llamante con códigos inventados agotaba el cupo global y dejaba sin servicio a todos.
  it('H4: un solo llamante no agota el cupo de búsqueda de los demás', async () => {
    for (let i = 0; i < 40; i++) {
      const r = await api.iniciarVerificacionPorDato!(OTRO, { codigo: `T9${String(i).padStart(7, '0')}` });
      assert.notEqual(r.estado, 'enviado');
    }
    const real = await api.iniciarVerificacionPorDato!(LLAMA, { codigo: 'T00012345' });
    assert.equal(real.estado, 'enviado', 'el estudiante real se queda sin verificarse por culpa de otro número');
    assert.equal(correos.length, 1);
  });

  // Menor (invertida): con la clave de ejemplo y fuera de pruebas, la voz no firma con una clave conocida.
  it('clave pública (JWT_SECRET de ejemplo) fuera de pruebas: la voz se apaga en vez de usarla', async () => {
    const antes = { secreto: config.auth.jwtSecret, entorno: process.env.NODE_ENV };
    try {
      process.env.NODE_ENV = 'production';
      for (const publico of ['cambia-este-secreto-largo-para-jwt-tooli-2026', 'cambia_esto_por_un_secreto_largo_y_aleatorio_para_jwt', '']) {
        (config.auth as { jwtSecret: string }).jwtSecret = publico;
        assert.deepEqual(await api.iniciarVerificacionPorDato!(LLAMA, { codigo: 'T00012345' }), { estado: 'error' }, `clave «${publico}»`);
      }
      assert.equal(correos.length, 0, 'no sale ningún correo con un código firmado con clave pública');
    } finally {
      (config.auth as { jwtSecret: string }).jwtSecret = antes.secreto;
      process.env.NODE_ENV = antes.entorno;
    }
  });
});
