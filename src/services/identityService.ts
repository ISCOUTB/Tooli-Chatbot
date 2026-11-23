import Redis from 'ioredis';
import { createHash, createHmac, randomInt } from 'crypto';
import { config } from '../config';
import { sendOtpEmail } from './mailService';
import { correoSimulado, esNumeroSimulado, saltarEnSimulacion } from './simulacion';
import {
  CamposAcademicos, conservarAlRenovar, extraerCamposAcademicos, FuenteCodigo,
  normalizarCedula, normalizarCodigo, sinCamposAcademicos,
} from './academico/identidadAcademica';
import { cifrar, descifrar, leerClave } from './academico/cifrado';
import {
  clavesIndice, huellaDeIndice, indiceCedulaDeHuella, migrarIndicesBusqueda, secretosBusqueda,
  type RedisIndices, type ResultadoMigracion,
} from './academico/indicesBusqueda';
import {
  clavesVoz, type LimitesVoz, type PendienteVoz, type ResultadoIntentoVoz, type ResultadoReservaVoz,
} from './academico/nucleo';

// ─────────────────────────────────────────────────────────────────────────────
// Habilitador de identidad del bot (independiente del login Azure AD de la app).
//
// Prueba que quien escribe por WhatsApp controla un correo institucional
// (@utb.edu.co) mediante un OTP de 6 dígitos, y guarda el vínculo
// WhatsApp <-> correo verificado. Los flujos que leen datos institucionales
// deben usar este vínculo y comprobar que la cuenta consultada corresponde al
// correo verificado. Turno/recibo por código siguen deshabilitados por defecto.
// ─────────────────────────────────────────────────────────────────────────────

const redis = new Redis(config.redis.url, { lazyConnect: true });

const OTP_TTL = 600;                       // 10 minutos
const IDENTITY_TTL = 120 * 24 * 60 * 60;   // ~120 días → re-verificar cada semestre
const MAX_TRIES = 5;
const SEND_COOLDOWN = 60;
const INSTITUTIONAL_EMAIL = /^[^\s@]+@(utb\.edu\.co|utbvirtual\.edu\.co)$/i;

export class VerificationRateLimitError extends Error {
  constructor() { super('Espera antes de pedir otro código'); }
}

/**
 * Vínculo WhatsApp-correo. Los campos académicos (código estudiantil, nombre,
 * programa…) son OPCIONALES: los vínculos creados antes de la identidad fuerte
 * siguen valiendo tal cual y solo les falta el código.
 */
export interface Identity extends CamposAcademicos {
  email: string;
  verifiedAt: number;
}

interface OtpState {
  email: string;
  codeHash: string;
  tries: number;
}

const otpKey = (from: string) => `otp:${from}`;
const otpSendKey = (from: string) => `otp-send:${from}`;
const identityKey = (from: string) => `identity:${from}`;
// Hash estable: rotar JWT_SECRET no puede dejar vínculos reversos huérfanos.
const emailKey = (email: string) => `identity-email:${createHash('sha256').update(email).digest('hex')}`;
const codeHash = (from: string, code: string) => createHmac('sha256', config.auth.jwtSecret).update(`${from}:${code}`).digest('hex');

// Comprobación y transferencia atómicas: un correo verificado pertenece a un
// solo WhatsApp. Si el titular verifica el correo desde otro número, se revoca
// el vínculo anterior antes de crear el nuevo.
const CLAIM_IDENTITY_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'expired' end
local decoded, state = pcall(cjson.decode, raw)
if not decoded or type(state) ~= 'table' or state.email ~= ARGV[1] then return 'expired' end
if tonumber(state.tries or 0) >= tonumber(ARGV[4]) then
  redis.call('DEL', KEYS[1])
  return 'toomany'
end
if state.codeHash ~= ARGV[2] then
  state.tries = tonumber(state.tries or 0) + 1
  local ttl = redis.call('TTL', KEYS[1])
  redis.call('SETEX', KEYS[1], math.max(ttl, 1), cjson.encode(state))
  return 'wrong'
end
local previousPhone = redis.call('GET', KEYS[3])
if previousPhone and previousPhone ~= ARGV[3] then
  local previousKey = 'identity:' .. previousPhone
  local previousRaw = redis.call('GET', previousKey)
  if previousRaw then
    local valid, previous = pcall(cjson.decode, previousRaw)
    if valid and previous.email == ARGV[1] then
      redis.call('DEL', previousKey, 'otp:' .. previousPhone)
    end
  end
end
if KEYS[4] ~= KEYS[3] and redis.call('GET', KEYS[4]) == ARGV[3] then
  redis.call('DEL', KEYS[4])
end
redis.call('SETEX', KEYS[2], tonumber(ARGV[5]), ARGV[6])
redis.call('SETEX', KEYS[3], tonumber(ARGV[5]), ARGV[3])
redis.call('DEL', KEYS[1])
return 'ok'
`;

export const REVOKE_IDENTITY_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'missing' end
local valid, identity = pcall(cjson.decode, raw)
if not valid or identity.email ~= ARGV[2] then return 'changed' end
if redis.call('GET', KEYS[2]) == ARGV[1] then redis.call('DEL', KEYS[2]) end
redis.call('DEL', KEYS[1], KEYS[3])
return 'ok'
`;

/** Genera un OTP, lo guarda (TTL 10 min) y lo envía al correo institucional. */
export async function startVerification(from: string, email: string): Promise<void> {
  const code = String(randomInt(100000, 1000000)); // 6 dígitos
  let normalizedEmail = email.trim().toLowerCase();
  if (!INSTITUTIONAL_EMAIL.test(normalizedEmail)) throw new Error('Correo institucional inválido');
  // Un número del simulador nunca reclama el correo de un estudiante real (le quitaría su vínculo):
  // el vínculo de prueba queda con un correo ficticio que no existe en la UTB.
  if (esNumeroSimulado(from)) {
    saltarEnSimulacion('Verificación', `El vínculo de prueba usa ${correoSimulado(from)} en lugar de ${normalizedEmail}: así no toca el vínculo de nadie.`, from);
    normalizedEmail = correoSimulado(from);
  }
  const cooldown = await redis.set(otpSendKey(from), '1', 'EX', SEND_COOLDOWN, 'NX');
  if (cooldown !== 'OK') throw new VerificationRateLimitError();
  const state: OtpState = { email: normalizedEmail, codeHash: codeHash(from, code), tries: 0 };
  await redis.setex(otpKey(from), OTP_TTL, JSON.stringify(state));
  try {
    await sendOtpEmail(normalizedEmail, code);
  } catch (error) {
    await redis.del(otpKey(from));
    await redis.del(otpSendKey(from));
    throw error;
  }
}

export type CheckResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'expired' | 'toomany' | 'wrong' };

/** Verifica el código escrito por el usuario contra el OTP guardado. */
export async function checkCode(from: string, input: string): Promise<CheckResult> {
  const raw = await redis.get(otpKey(from));
  if (!raw) return { ok: false, reason: 'expired' };
  let state: OtpState;
  try { state = JSON.parse(raw) as OtpState; }
  catch { await redis.del(otpKey(from)); return { ok: false, reason: 'expired' }; }
  if (!state.email || !state.codeHash) return { ok: false, reason: 'expired' };
  const previous = await getIdentity(from);
  // Renovar el vínculo con el MISMO correo conserva el código ya comprobado.
  // Si el correo estaba vinculado a OTRO número (verifica desde un teléfono nuevo),
  // sus datos académicos se heredan: el OTP acaba de probar el control del correo.
  // La cédula cifrada NO viaja (está atada al número anterior): se pide de nuevo.
  const conservados = await datosAcademicosAConservar(from, previous, state.email);
  const identity: Identity = { email: state.email, verifiedAt: Date.now(), ...conservados };
  const result = await redis.eval(
    CLAIM_IDENTITY_SCRIPT,
    4,
    otpKey(from), identityKey(from), emailKey(state.email), emailKey(previous?.email ?? state.email),
    state.email, codeHash(from, input.trim()), from, String(MAX_TRIES), String(IDENTITY_TTL), JSON.stringify(identity),
  );
  if (result === 'ok' && conservados.codigo) await renovarIndicesAcademicos(from);
  return result === 'ok' ? { ok: true, email: state.email } : { ok: false, reason: result as 'expired' | 'toomany' | 'wrong' };
}

export async function getIdentity(from: string): Promise<Identity | null> {
  const raw = await redis.get(identityKey(from));
  if (!raw) return null;
  let identity: Identity;
  try { identity = JSON.parse(raw) as Identity; }
  catch { return null; }
  if (!identity.email || !INSTITUTIONAL_EMAIL.test(identity.email) || !Number.isFinite(identity.verifiedAt)) return null;
  // Los vínculos anteriores no tienen índice inverso: se vuelven a verificar.
  // Esta comprobación también impide aceptar un número ya reemplazado.
  if ((await redis.get(emailKey(identity.email))) !== from) return null;
  return { email: identity.email, verifiedAt: identity.verifiedAt, ...extraerCamposAcademicos(identity) };
}

export async function isVerified(from: string): Promise<boolean> {
  return (await getIdentity(from)) !== null;
}

export async function revokeIdentity(from: string): Promise<void> {
  const raw = await redis.get(identityKey(from));
  if (!raw) return;
  let identity: Identity;
  try { identity = JSON.parse(raw) as Identity; }
  catch { return; }
  if (!identity.email || !INSTITUTIONAL_EMAIL.test(identity.email)) return;
  await redis.eval(REVOKE_IDENTITY_SCRIPT, 3, identityKey(from), emailKey(identity.email), otpKey(from), from, identity.email);
  // Sin vínculo no quedan códigos buscables ni sesión de notas guardada (camino A).
  await soltarIndicesAcademicos(from, extraerCamposAcademicos(identity));
  await redis.del(`notas-sesion:${from}`);
}

// ── Pendientes de la verificación por VOZ (solo para la llamada) ─────────────
// No son OTP de vínculo: `checkCode` no los ve y confirmarlos nunca toca
// `identity:*` ni `identity-email:*`. Ver src/services/academico/nucleo.ts.
const vozOtpKey = clavesVoz.pendiente;

// H1 + H3 (auditoría 22-nov): en UN paso mira bloqueos, la marca de espera (aparte del pendiente: sobrevive a su
// borrado) y los topes por llamante y por destino; si todo cabe, deja la marca, cuenta el envío y guarda el pendiente.
const VOZ_CREAR_SCRIPT = `
if redis.call('EXISTS', KEYS[6]) == 1 or redis.call('EXISTS', KEYS[7]) == 1 then return 'bloqueado' end
if redis.call('EXISTS', KEYS[1]) == 1 then return 'espera' end
for i = 2, 5 do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[i]) then return 'espera' end
end
redis.call('SET', KEYS[1], '1', 'PX', tonumber(ARGV[1]))
for i = 2, 5 do
  redis.call('INCR', KEYS[i])
  if redis.call('PTTL', KEYS[i]) < 0 then
    local ventana = ARGV[7]
    if i == 2 or i == 4 then ventana = ARGV[6] end
    redis.call('PEXPIRE', KEYS[i], tonumber(ventana))
  end
end
redis.call('SET', KEYS[8], ARGV[8], 'PX', tonumber(ARGV[9]))
return 'ok'
`;

// H2: comparar la huella, sumar el intento y consumir el pendiente en UN paso. Al agotar, cuenta para el bloqueo
// del llamante y del destino.
const VOZ_INTENTAR_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'vencido' end
local ok, p = pcall(cjson.decode, raw)
if not ok or type(p) ~= 'table' or p.telefonoEstudiante ~= ARGV[1] then return 'vencido' end
if tonumber(ARGV[3]) > tonumber(p.expira or 0) then redis.call('DEL', KEYS[1]); return 'vencido' end
local intentos = tonumber(p.intentos or 0)
local max = tonumber(ARGV[4])
if intentos >= max then redis.call('DEL', KEYS[1]); return 'demasiados' end
if p.huella == ARGV[2] then redis.call('DEL', KEYS[1]); return 'ok' end
intentos = intentos + 1
if intentos < max then
  p.intentos = intentos
  local ttl = redis.call('PTTL', KEYS[1])
  redis.call('SET', KEYS[1], cjson.encode(p), 'PX', math.max(ttl, 1))
  return 'no_coincide'
end
redis.call('DEL', KEYS[1])
local nl = redis.call('INCR', KEYS[2])
if redis.call('PTTL', KEYS[2]) < 0 then redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[5])) end
if nl >= tonumber(ARGV[7]) then redis.call('SET', KEYS[4], '1', 'PX', tonumber(ARGV[9])) end
local nd = redis.call('INCR', KEYS[3])
if redis.call('PTTL', KEYS[3]) < 0 then redis.call('PEXPIRE', KEYS[3], tonumber(ARGV[6])) end
if nd >= tonumber(ARGV[8]) then redis.call('SET', KEYS[5], '1', 'PX', tonumber(ARGV[9])) end
return 'demasiados'
`;

export const pendientesVoz = {
  async leer(telefonoLlamante: string): Promise<PendienteVoz | null> {
    const raw = await redis.get(vozOtpKey(telefonoLlamante));
    if (!raw) return null;
    try {
      const p = JSON.parse(raw) as PendienteVoz;
      return typeof p.huella === 'string' && typeof p.telefonoEstudiante === 'string' && typeof p.email === 'string'
        && Number.isFinite(p.expira) ? p : null;
    } catch {
      return null;
    }
  },
  async guardar(telefonoLlamante: string, p: PendienteVoz, ttlMs: number): Promise<void> {
    await redis.set(vozOtpKey(telefonoLlamante), JSON.stringify(p), 'PX', Math.max(1, Math.round(ttlMs)));
  },
  async borrar(telefonoLlamante: string): Promise<void> {
    await redis.del(vozOtpKey(telefonoLlamante));
  },
  async crearSiCabe(ll: string, p: PendienteVoz, ttlMs: number, _ahora: number, l: LimitesVoz): Promise<ResultadoReservaVoz> {
    const d = p.telefonoEstudiante;
    const r = await redis.eval(
      VOZ_CREAR_SCRIPT, 8,
      clavesVoz.espera(ll), clavesVoz.horaLlamante(ll), clavesVoz.diaLlamante(ll),
      clavesVoz.horaDestino(d), clavesVoz.diaDestino(d), clavesVoz.bloqLlamante(ll), clavesVoz.bloqDestino(d),
      vozOtpKey(ll),
      l.esperaMs, l.maxHoraLlamante, l.maxDiaLlamante, l.maxHoraDestino, l.maxDiaDestino, l.horaMs, l.diaMs,
      JSON.stringify(p), Math.max(1, Math.round(ttlMs)),
    );
    return r === 'ok' || r === 'espera' || r === 'bloqueado' ? r : 'espera';
  },
  async intentar(ll: string, destino: string, huella: string, ahora: number, l: LimitesVoz): Promise<ResultadoIntentoVoz> {
    const r = await redis.eval(
      VOZ_INTENTAR_SCRIPT, 5,
      vozOtpKey(ll), clavesVoz.agotLlamante(ll), clavesVoz.agotDestino(destino),
      clavesVoz.bloqLlamante(ll), clavesVoz.bloqDestino(destino),
      destino, huella, ahora, l.maxIntentos, l.horaMs, l.diaMs, l.agotamientosLlamante, l.agotamientosDestino, l.bloqueoMs,
    );
    return r === 'ok' || r === 'no_coincide' || r === 'demasiados' ? r : 'vencido';
  },
};

/**
 * Perfil «estudiante verificado» del simulador de WhatsApp: el mismo vínculo que deja el OTP, pero con el correo
 * ficticio del número de prueba (nunca uno real) y por un día. Solo acepta números de la zona de pruebas.
 * Se borra con `revokeIdentity` al empezar de nuevo.
 */
export async function vincularIdentidadSimulada(from: string): Promise<Identity> {
  if (!esNumeroSimulado(from)) throw new Error('Solo un número del simulador puede tener un vínculo de prueba');
  const identity: Identity = { email: correoSimulado(from), verifiedAt: Date.now() };
  const UN_DIA = 24 * 60 * 60;
  await redis.multi()
    .setex(identityKey(from), UN_DIA, JSON.stringify(identity))
    .setex(emailKey(identity.email), UN_DIA, from)
    .exec();
  return identity;
}

/** Cierra la conexión al detener el proceso o al terminar una prueba aislada. */
export function closeIdentityService(): void {
  redis.disconnect();
}

/**
 * Barrera anti-suplantación: el correo institucional que aparece en el portal
 * (Banner/ICEBERG) tras el login con código+cédula DEBE coincidir con el correo
 * que el usuario verificó por OTP. Así, un estudiante verificado no puede
 * consultar datos de otro metiendo el código+cédula ajenos.
 *
 * El TODO original (icebergService no devuelve el correo del portal) se cierra
 * con la IDENTIDAD FUERTE de más abajo: el código estudiantil se ata al vínculo
 * una sola vez (comprobado contra Iceberg con código+cédula) y, desde entonces,
 * turno y recibo SOLO consultan el código atado al vínculo del remitente, nunca
 * uno escrito en el momento. `emailMatchesIdentity` queda para cuando el portal
 * entregue el correo; mientras tanto la barrera es el vínculo código-correo.
 */
export function emailMatchesIdentity(identity: Identity, portalEmail?: string | null): boolean {
  if (!portalEmail) return false;
  return portalEmail.trim().toLowerCase() === identity.email.trim().toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Identidad fuerte: código estudiantil atado al vínculo (compatible hacia atrás).
// ─────────────────────────────────────────────────────────────────────────────

// Índices inversos por código y por cédula con su clave propia (TOOLI_BUSQUEDA_CLAVE, derivada con HKDF; #38).
// Se escriben con el secreto actual y se LEEN también con el de antes (TOOLI_ACADEMICO_CLAVE || JWT_SECRET) mientras
// no se haya corrido tools/migrar-indices-busqueda.ts. Ver src/services/academico/indicesBusqueda.ts.
const secretos = () => secretosBusqueda({
  busqueda: process.env.TOOLI_BUSQUEDA_CLAVE, academico: process.env.TOOLI_ACADEMICO_CLAVE, jwt: config.auth.jwtSecret,
});
const codigoIdxs = (codigo: string) => clavesIndice('codigo', codigo, secretos());
const cedulaIdxs = (cedula: string) => clavesIndice('cedula', cedula, secretos());

/** Borra cada índice que todavía apunte a `from` (nunca el de otra persona). */
async function soltarSiApunta(from: string, claves: string[]): Promise<void> {
  for (const clave of claves) if ((await redis.get(clave)) === from) await redis.del(clave);
}

/** Cédula en claro de un vínculo, si quedó cifrada y hay clave. */
function cedulaDelVinculo(from: string, campos: CamposAcademicos): string | null {
  const clave = leerClave();
  if (!campos.cedulaCifrada || !clave) return null;
  try { return normalizarCedula(descifrar(campos.cedulaCifrada, `cedula:${from}`, clave)); } catch { return null; }
}

// Un código pertenece a un solo correo. Si otro vínculo VIGENTE (otro correo) ya lo tiene, se rechaza; un vínculo
// vencido o revocado no bloquea. Se mira el índice con el secreto actual Y con el de antes: sin migrar, el dueño real
// solo aparece en el viejo y, si no se mirara, el mismo código se podría atar a un segundo correo.
// KEYS: 1 índice del código, 2 vínculo, 3 índice de la cédula (o KEYS[1]), 4 índice del código con el secreto de antes
//       (o KEYS[1]). ARGV: 1 teléfono, 2 vínculo nuevo (JSON), 3 código, 4 correo.
export const ATAR_CODIGO_SCRIPT = `
local function ajeno(clave)
  local owner = redis.call('GET', clave)
  if not owner or owner == ARGV[1] then return false end
  local raw = redis.call('GET', 'identity:' .. owner)
  if not raw then return false end
  local ok, other = pcall(cjson.decode, raw)
  return ok and type(other) == 'table' and other.codigo == ARGV[3] and other.email ~= ARGV[4]
end
if ajeno(KEYS[1]) or (KEYS[4] ~= KEYS[1] and ajeno(KEYS[4])) then return 'en_uso' end
local cur = redis.call('GET', KEYS[2])
if not cur then return 'sin_identidad' end
local okc, curObj = pcall(cjson.decode, cur)
if not okc or type(curObj) ~= 'table' or curObj.email ~= ARGV[4] then return 'sin_identidad' end
local ttl = redis.call('TTL', KEYS[2])
if ttl < 1 then return 'sin_identidad' end
redis.call('SET', KEYS[2], ARGV[2], 'EX', ttl)
redis.call('SET', KEYS[1], ARGV[1], 'EX', ttl)
if KEYS[3] ~= KEYS[1] then redis.call('SET', KEYS[3], ARGV[1], 'EX', ttl) end
if KEYS[4] ~= KEYS[1] and redis.call('GET', KEYS[4]) == ARGV[1] then redis.call('DEL', KEYS[4]) end
return 'ok'
`;

export interface DatosVinculoCodigo {
  codigo: string;
  /** true solo si una fuente oficial confirmó código y cédula. */
  verificado: boolean;
  fuente: FuenteCodigo;
  nombre?: string;
  programa?: string;
  nivel?: 'pregrado' | 'posgrado';
  /** Se guarda CIFRADA y solo si hay TOOLI_ACADEMICO_CLAVE; si no, se descarta. */
  cedula?: string;
}

export type ResultadoVinculoCodigo = 'ok' | 'sin_identidad' | 'en_uso' | 'formato';

/** Ata el código estudiantil al vínculo vigente de `from`. No toca el TTL del vínculo. */
export async function guardarCodigoEstudiantil(from: string, datos: DatosVinculoCodigo): Promise<ResultadoVinculoCodigo> {
  // El código de un estudiante real nunca se ata a un número de prueba (se le quitaría a él).
  if (esNumeroSimulado(from)) return 'sin_identidad';
  const codigo = normalizarCodigo(datos.codigo);
  if (!codigo) return 'formato';
  const actual = await getIdentity(from);
  if (!actual) return 'sin_identidad';
  const cedula = datos.cedula ? normalizarCedula(datos.cedula) : null;
  const clave = leerClave();
  const [idxCodigo, idxCodigoViejo = idxCodigo] = codigoIdxs(codigo);
  const idxCedula = cedula ? cedulaIdxs(cedula)[0] : null;
  const nueva: Identity = {
    ...actual,
    codigo,
    codigoVerificado: datos.verificado,
    codigoFuente: datos.fuente,
    ...(datos.nombre ? { nombre: datos.nombre.slice(0, 120) } : {}),
    ...(datos.programa ? { programa: datos.programa.slice(0, 120) } : {}),
    ...(datos.nivel ? { nivel: datos.nivel } : {}),
  };
  // La cédula y su índice son del código que se ata: lo de un código anterior no se arrastra.
  if (cedula || actual.codigo !== codigo) { delete nueva.cedulaCifrada; delete nueva.cedulaIndice; }
  if (cedula && clave) nueva.cedulaCifrada = cifrar(cedula, `cedula:${from}`, clave);
  if (idxCedula) nueva.cedulaIndice = huellaDeIndice(idxCedula);
  const resultado = await redis.eval(
    ATAR_CODIGO_SCRIPT, 4,
    idxCodigo, identityKey(from), idxCedula ?? idxCodigo, idxCodigoViejo,
    from, JSON.stringify(nueva), codigo, actual.email,
  );
  if (resultado === 'ok') {
    // Cambió de código o de cédula: los índices anteriores dejan de apuntar a este número.
    if (actual.codigo && actual.codigo !== codigo) await soltarSiApunta(from, codigoIdxs(actual.codigo));
    if (actual.cedulaIndice && actual.cedulaIndice !== nueva.cedulaIndice) await soltarSiApunta(from, [indiceCedulaDeHuella(actual.cedulaIndice)]);
    if (cedula) await soltarSiApunta(from, cedulaIdxs(cedula).slice(1));
  }
  return resultado === 'ok' || resultado === 'en_uso' ? resultado : 'sin_identidad';
}

async function datosAcademicosAConservar(from: string, previous: Identity | null, email: string): Promise<CamposAcademicos> {
  const propios = conservarAlRenovar(previous, email);
  if (propios.codigo) return propios;
  const dueno = await redis.get(emailKey(email));
  if (!dueno || dueno === from) return propios;
  const raw = await redis.get(identityKey(dueno));
  if (!raw) return propios;
  try {
    // La cédula cifrada (atada al número anterior) y su índice (que apunta a ese número) no viajan.
    const { cedulaCifrada: _noViaja, cedulaIndice: _noApunta, ...heredados } = conservarAlRenovar(JSON.parse(raw), email);
    return heredados;
  } catch {
    return propios;
  }
}

/** Los índices inversos apuntan ahora a este número (y viven lo que vive el vínculo). */
async function renovarIndicesAcademicos(from: string): Promise<void> {
  const raw = await redis.get(identityKey(from));
  if (!raw) return;
  let campos: CamposAcademicos;
  try { campos = extraerCamposAcademicos(JSON.parse(raw)); } catch { return; }
  if (campos.codigo) {
    const [nuevo, ...viejos] = codigoIdxs(campos.codigo);
    await redis.set(nuevo, from, 'EX', IDENTITY_TTL);
    await soltarSiApunta(from, viejos);
  }
  if (campos.cedulaIndice) await redis.set(indiceCedulaDeHuella(campos.cedulaIndice), from, 'EX', IDENTITY_TTL);
}

/** Al revocar: ningún índice (código ni cédula, con el secreto actual ni con el de antes) sigue apuntando a `from`. */
async function soltarIndicesAcademicos(from: string, campos: CamposAcademicos): Promise<void> {
  if (campos.codigo) await soltarSiApunta(from, codigoIdxs(campos.codigo));
  if (campos.cedulaIndice) await soltarSiApunta(from, [indiceCedulaDeHuella(campos.cedulaIndice)]);
  const cedula = cedulaDelVinculo(from, campos);
  if (cedula) await soltarSiApunta(from, cedulaIdxs(cedula));
}

/** Vínculo vigente que tiene ese código (o null). El índice se confirma contra el propio vínculo. */
export async function buscarIdentidadPorCodigo(codigo: string): Promise<{ telefono: string; identity: Identity } | null> {
  const c = normalizarCodigo(codigo);
  if (!c) return null;
  for (const clave of codigoIdxs(c)) {
    const telefono = await redis.get(clave);
    if (!telefono) continue;
    const identity = await getIdentity(telefono);
    if (identity?.codigo === c) return { telefono, identity };
  }
  return null;
}

/**
 * Igual por cédula. El índice se CONFIRMA contra el vínculo al que apunta: el código tiene que estar comprobado y el
 * vínculo tiene que reconocer ese mismo índice (`cedulaIndice`) o, en vínculos anteriores a esa huella, su cédula
 * cifrada tiene que ser esa. Un índice viejo (la persona cambió de código o de cédula) ya no devuelve a nadie.
 */
export async function buscarIdentidadPorCedula(cedula: string): Promise<{ telefono: string; identity: Identity } | null> {
  const c = normalizarCedula(cedula);
  if (!c) return null;
  for (const clave of cedulaIdxs(c)) {
    const telefono = await redis.get(clave);
    if (!telefono) continue;
    const identity = await getIdentity(telefono);
    if (!identity?.codigoVerificado) continue;
    const confirmado = identity.cedulaIndice
      ? identity.cedulaIndice === huellaDeIndice(clave)
      : cedulaDelVinculo(telefono, identity) === c;
    if (confirmado) return { telefono, identity };
  }
  return null;
}

// Soltar un código: deja el vínculo de correo como estaba pero sin los datos académicos, y borra sus índices, solo si
// nadie cambió el vínculo desde que se leyó. KEYS: 1 vínculo, 2.. índices; ARGV: 1 teléfono, 2 vínculo leído,
// 3 vínculo sin datos académicos. Conserva el vencimiento.
export const SOLTAR_CODIGO_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[2] then return 'cambio' end
redis.call('SET', KEYS[1], ARGV[3], 'KEEPTTL')
for i = 2, #KEYS do
  if redis.call('GET', KEYS[i]) == ARGV[1] then redis.call('DEL', KEYS[i]) end
end
return 'ok'
`;

export type ResultadoSoltarCodigo =
  | { estado: 'formato' | 'no_encontrado' }
  | { estado: 'simulado' | 'listo' | 'cambio'; telefono: string; email: string };

/**
 * Atar un código solo prueba que alguien conocía el par código+cédula; si fue otra persona, el dueño real recibe
 * `en_uso`. TI, tras confirmar por otro medio quién es el titular, suelta el código con
 * tools/soltar-codigo.ts: el vínculo de correo de quien lo tenía sigue, sin código, nombre, programa ni cédula, y sus
 * índices se borran. Con `aplicar: false` solo dice a quién se lo quitaría. Índices huérfanos de ese código se limpian.
 */
export async function soltarCodigoEstudiantil(codigo: string, opts: { aplicar: boolean }): Promise<ResultadoSoltarCodigo> {
  const c = normalizarCodigo(codigo);
  if (!c) return { estado: 'formato' };
  const claves = codigoIdxs(c);
  for (const clave of claves) {
    const telefono = await redis.get(clave);
    if (!telefono) continue;
    const raw = await redis.get(identityKey(telefono));
    if (!raw) continue;
    let vinculo: Identity;
    try { vinculo = JSON.parse(raw) as Identity; } catch { continue; }
    const campos = extraerCamposAcademicos(vinculo);
    if (campos.codigo !== c) continue;
    if (!opts.aplicar) return { estado: 'simulado', telefono, email: vinculo.email };
    const cedula = cedulaDelVinculo(telefono, campos);
    const indices = [...new Set([
      ...claves,
      ...(campos.cedulaIndice ? [indiceCedulaDeHuella(campos.cedulaIndice)] : []),
      ...(cedula ? cedulaIdxs(cedula) : []),
    ])];
    const r = await redis.eval(
      SOLTAR_CODIGO_SCRIPT, 1 + indices.length, identityKey(telefono), ...indices,
      telefono, raw, JSON.stringify(sinCamposAcademicos(vinculo)),
    );
    return { estado: r === 'ok' ? 'listo' : 'cambio', telefono, email: vinculo.email };
  }
  // Ningún vínculo vigente tiene ese código: si quedó algún índice suelto, se borra.
  if (opts.aplicar) for (const clave of claves) await redis.del(clave);
  return { estado: 'no_encontrado' };
}

/**
 * Pasa los índices al secreto actual (TOOLI_BUSQUEDA_CLAVE). Idempotente; con `aplicar: false` solo cuenta.
 * La usa tools/migrar-indices-busqueda.ts (ver docs/datos-academicos.md).
 */
export async function migrarIndicesDeBusqueda(opts: { aplicar: boolean }): Promise<ResultadoMigracion> {
  return migrarIndicesBusqueda(redis as unknown as RedisIndices, secretos(), {
    aplicar: opts.aplicar,
    descifrarCedula: (telefono, blob) => cedulaDelVinculo(telefono, { cedulaCifrada: blob }),
  });
}

/** Teléfonos con vínculo vigente (para avisos proactivos). Recorre con SCAN, sin bloquear Redis. */
export async function listarTelefonosVinculados(limite = 500): Promise<string[]> {
  const telefonos = new Set<string>();
  let cursor = '0';
  do {
    const [siguiente, claves] = await redis.scan(cursor, 'MATCH', 'identity:*', 'COUNT', 200);
    cursor = siguiente;
    for (const clave of claves) telefonos.add(clave.slice('identity:'.length));
    if (telefonos.size >= limite) break;
  } while (cursor !== '0');
  return Array.from(telefonos).slice(0, limite);
}
