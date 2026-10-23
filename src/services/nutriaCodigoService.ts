import Redis from 'ioredis';
import { config } from '../config';
import { generateCode } from './nutriaCode';

const redis = new Redis(config.redis.url);

/** TTL: 48 horas — cubre el evento y un margen */
const TTL = 60 * 60 * 48;

const CREATE_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
if existing then return existing end
if redis.call('EXISTS', KEYS[2]) == 1 then return nil end
redis.call('SETEX', KEYS[2], ARGV[1], ARGV[2])
redis.call('SETEX', KEYS[1], ARGV[1], ARGV[3])
return ARGV[3]
`;

// Check, mark and append the redemption record in one Redis operation. A
// GET-then-SET sequence lets two scanners redeem the same QR simultaneously.
const REDEEM_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {0} end
local data = cjson.decode(raw)
if data.canjeado then return {1, raw} end
data.canjeado = true
data.canjeadoEn = ARGV[2]
local updated = cjson.encode(data)
redis.call('SETEX', KEYS[1], ARGV[1], updated)
redis.call('LPUSH', KEYS[2], cjson.encode({code=ARGV[3], phone=data.phone, canjeadoEn=data.canjeadoEn}))
redis.call('LTRIM', KEYS[2], 0, 19)
return {2, updated}
`;

export interface CodigoNutria {
  phone: string;
  canjeado: boolean;
  creadoEn: string;
  canjeadoEn?: string;
}

/**
 * Crea un código para un participante.
 * Si ya tiene uno, lo reutiliza (idempotente).
 */
export async function crearCodigoNutria(phone: string): Promise<string> {
  const data: CodigoNutria = {
    phone,
    canjeado: false,
    creadoEn: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
  };

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    const created = await redis.eval(
      CREATE_SCRIPT, 2, `nutria:phone:${phone}:codigo`, `nutria:codigo:${code}`,
      String(TTL), JSON.stringify(data), code
    ) as string | null;
    if (created) return created;
  }
  throw new Error('No se pudo reservar un código NutriA único');
}

/** Consulta el estado de un código. */
export async function getCodigoNutria(code: string): Promise<CodigoNutria | null> {
  const raw = await redis.get(`nutria:codigo:${code.toUpperCase()}`);
  if (!raw) return null;
  return JSON.parse(raw) as CodigoNutria;
}

/** Retorna los últimos N canjes realizados. */
export async function getCanjesRecientes(limit = 10): Promise<{ code: string; phone: string; canjeadoEn: string }[]> {
  const raw = await redis.lrange('nutria:canjes:log', 0, limit - 1);
  return raw.map(r => JSON.parse(r));
}

/**
 * Marca un código como canjeado.
 * Retorna error si no existe o ya fue canjeado.
 */
export async function canjearCodigoNutria(
  code: string
): Promise<{ ok: boolean; error?: 'not_found' | 'already_redeemed'; data?: CodigoNutria }> {
  const key = `nutria:codigo:${code.toUpperCase()}`;
  const redeemedAt = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
  const result = await redis.eval(REDEEM_SCRIPT, 2, key, 'nutria:canjes:log', String(TTL), redeemedAt, code.toUpperCase()) as [number, string?];
  if (result[0] === 0) return { ok: false, error: 'not_found' };
  const data = JSON.parse(result[1]!) as CodigoNutria;
  if (result[0] === 1) return { ok: false, error: 'already_redeemed', data };
  return { ok: true, data };
}
