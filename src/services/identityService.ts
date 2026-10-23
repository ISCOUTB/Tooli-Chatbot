import Redis from 'ioredis';
import { createHash, createHmac, randomInt } from 'crypto';
import { config } from '../config';
import { sendOtpEmail } from './mailService';

// ─────────────────────────────────────────────────────────────────────────────
// Habilitador de identidad del bot (independiente del login Azure AD de la app).
//
// Prueba que quien escribe por WhatsApp controla un correo institucional
// (@utb.edu.co) mediante un OTP de 6 dígitos, y guarda el vínculo
// WhatsApp <-> correo verificado. Los flujos que leen datos institucionales
// deben usar este vínculo y comprobar que la cuenta consultada corresponde al
// correo verificado. Turno/recibo por código siguen deshabilitados por defecto.
// ─────────────────────────────────────────────────────────────────────────────

const redis = new Redis(config.redis.url);

const OTP_TTL = 600;                       // 10 minutos
const IDENTITY_TTL = 120 * 24 * 60 * 60;   // ~120 días → re-verificar cada semestre
const MAX_TRIES = 5;
const SEND_COOLDOWN = 60;
const INSTITUTIONAL_EMAIL = /^[^\s@]+@(utb\.edu\.co|utbvirtual\.edu\.co)$/i;

export class VerificationRateLimitError extends Error {
  constructor() { super('Espera antes de pedir otro código'); }
}

export interface Identity {
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

const REVOKE_IDENTITY_SCRIPT = `
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
  const normalizedEmail = email.trim().toLowerCase();
  if (!INSTITUTIONAL_EMAIL.test(normalizedEmail)) throw new Error('Correo institucional inválido');
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
  const identity: Identity = { email: state.email, verifiedAt: Date.now() };
  const result = await redis.eval(
    CLAIM_IDENTITY_SCRIPT,
    4,
    otpKey(from), identityKey(from), emailKey(state.email), emailKey(previous?.email ?? state.email),
    state.email, codeHash(from, input.trim()), from, String(MAX_TRIES), String(IDENTITY_TTL), JSON.stringify(identity),
  );
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
  return (await redis.get(emailKey(identity.email))) === from ? identity : null;
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
 * TODO(integración): hoy icebergService no devuelve el correo del portal. Para
 * cerrar del todo la suplantación, extrae el correo institucional del portal
 * (página de datos personales de Banner) y pásalo aquí antes de entregar el PDF.
 */
export function emailMatchesIdentity(identity: Identity, portalEmail?: string | null): boolean {
  if (!portalEmail) return false;
  return portalEmail.trim().toLowerCase() === identity.email.trim().toLowerCase();
}
