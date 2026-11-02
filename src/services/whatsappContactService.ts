import Redis from 'ioredis';
import type { InboundMessage } from '../adapters/messaging/IMessagingAdapter';
import { config } from '../config';
import { isBsuid } from './whatsappId';

const redis = new Redis(config.redis.url);
const PROFILE_TTL_SECONDS = 365 * 24 * 60 * 60;

export interface WhatsAppContactProfile {
  username?: string;
  profileName?: string;
}

// Migra sesión, actividad, perfil, bloqueos y rate limit desde el BSUID al teléfono.
// El primer mensaje de alguien con username puede traer solo BSUID; los siguientes ya traen teléfono.
const MIGRATE_SCRIPT = `
redis.call('SET', KEYS[1], ARGV[1])
if redis.call('EXISTS', KEYS[3]) == 0 and redis.call('EXISTS', KEYS[2]) == 1 then
  redis.call('RENAME', KEYS[2], KEYS[3])
elseif redis.call('EXISTS', KEYS[2]) == 1 then
  redis.call('DEL', KEYS[2])
end
if redis.call('EXISTS', KEYS[5]) == 0 and redis.call('EXISTS', KEYS[4]) == 1 then
  redis.call('RENAME', KEYS[4], KEYS[5])
elseif redis.call('EXISTS', KEYS[4]) == 1 then
  local merged = redis.call('LRANGE', KEYS[5], 0, 49)
  local old = redis.call('LRANGE', KEYS[4], 0, 49)
  for _, item in ipairs(old) do table.insert(merged, item) end
  table.sort(merged, function(a, b)
    local oka, va = pcall(cjson.decode, a)
    local okb, vb = pcall(cjson.decode, b)
    return (oka and type(va) == 'table' and tonumber(va.ts) or 0) >
      (okb and type(vb) == 'table' and tonumber(vb.ts) or 0)
  end)
  local ttl = math.max(redis.call('TTL', KEYS[4]), redis.call('TTL', KEYS[5]))
  redis.call('DEL', KEYS[5])
  for _, item in ipairs(merged) do redis.call('RPUSH', KEYS[5], item) end
  redis.call('LTRIM', KEYS[5], 0, 49)
  if ttl > 0 then redis.call('EXPIRE', KEYS[5], ttl) end
  redis.call('DEL', KEYS[4])
end
if redis.call('EXISTS', KEYS[7]) == 0 and redis.call('EXISTS', KEYS[6]) == 1 then
  redis.call('RENAME', KEYS[6], KEYS[7])
elseif redis.call('EXISTS', KEYS[6]) == 1 then
  redis.call('DEL', KEYS[6])
end
for i = 8, 10, 2 do
  if redis.call('EXISTS', KEYS[i + 1]) == 0 and redis.call('EXISTS', KEYS[i]) == 1 then
    redis.call('RENAME', KEYS[i], KEYS[i + 1])
  elseif redis.call('EXISTS', KEYS[i]) == 1 then
    redis.call('DEL', KEYS[i])
  end
end
if redis.call('EXISTS', KEYS[13]) == 0 and redis.call('EXISTS', KEYS[12]) == 1 then
  redis.call('RENAME', KEYS[12], KEYS[13])
elseif redis.call('EXISTS', KEYS[12]) == 1 then
  local total = tonumber(redis.call('GET', KEYS[12]) or '0') + tonumber(redis.call('GET', KEYS[13]) or '0')
  local ttl = math.max(redis.call('TTL', KEYS[12]), redis.call('TTL', KEYS[13]))
  redis.call('SET', KEYS[13], total)
  if ttl > 0 then redis.call('EXPIRE', KEYS[13], ttl) end
  redis.call('DEL', KEYS[12])
end
return 1`;

/** Resuelve la clave estable y migra el estado provisional del BSUID. */
export async function resolveWhatsAppContact(inbound: InboundMessage): Promise<string> {
  const bsuid = inbound.userId && isBsuid(inbound.userId) ? inbound.userId :
    (isBsuid(inbound.from) ? inbound.from : undefined);
  let contactId = inbound.from;
  if (bsuid) {
    const phone = inbound.from !== bsuid && /^\d+$/.test(inbound.from)
      ? inbound.from
      : await redis.get(`bsuid:${bsuid}`);
    if (phone) {
      await redis.eval(
        MIGRATE_SCRIPT, 13,
        `bsuid:${bsuid}`, `session:${bsuid}`, `session:${phone}`,
        `activity:${bsuid}`, `activity:${phone}`,
        `contact-profile:${bsuid}`, `contact-profile:${phone}`,
        `ban:${bsuid}`, `ban:${phone}`,
        `ai_disabled:${bsuid}`, `ai_disabled:${phone}`,
        `ratelimit:user:${bsuid}`, `ratelimit:user:${phone}`, phone,
      );
      contactId = phone;
    } else {
      contactId = bsuid;
    }
  }

  if (inbound.username || inbound.profileName) {
    const profile: WhatsAppContactProfile = {
      ...(inbound.username ? { username: inbound.username } : {}),
      ...(inbound.profileName ? { profileName: inbound.profileName } : {}),
    };
    await redis.setex(`contact-profile:${contactId}`, PROFILE_TTL_SECONDS, JSON.stringify(profile));
  }
  return contactId;
}

export async function getWhatsAppContactProfile(contactId: string): Promise<WhatsAppContactProfile> {
  const raw = await redis.get(`contact-profile:${contactId}`);
  if (!raw) return {};
  try { return JSON.parse(raw) as WhatsAppContactProfile; }
  catch { return {}; }
}
