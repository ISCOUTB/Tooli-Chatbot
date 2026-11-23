// AlmacenVoz sobre Redis (la única base de Tooli). Reemplaza las funciones SQL de FastFood:
//   voice_claim_event  → SET NX con TTL (idempotencia de eventos de Telnyx).
//   voice_reserve_call → script Lua: lee el uso del día y del mes (hora de Colombia), calcula los minutos que puede
//                        durar la llamada, los aparta y crea la llamada, todo atómico (dos llamadas a la vez nunca
//                        pasan juntas el tope).
//   UPDATE con estado  → compare-and-set por versión (script Lua).
// Retención (Ley 1581): la llamada y su transcripción vencen solas (PEXPIREAT) a los `retencionDias`.
import Redis from 'ioredis';
import { bogotaClock } from './horario';
import { nuevaLlamada, recortarLinea, type AlmacenVoz } from './almacen';
import { MAX_LINEAS, leerDialogo, type LineaTranscripcion, type LlamadaVoz } from './tipos';

const K = {
  evento: (p: string, id: string) => `voz:evento:${p}:${id}`,
  llamada: (id: string) => `voz:llamada:${id}`,
  prov: (p: string, cid: string) => `voz:prov:${p}:${cid}`,
  dia: (d: string) => `voz:uso:dia:${d}`,
  mes: (m: string) => `voz:uso:mes:${m}`,
  indice: 'voz:llamadas',
  lineas: (id: string) => `voz:lineas:${id}`,
  sim: (d: string) => `voz:sim:${d}`,
  silencios: 'voz:silencios',
};

// El código por WhatsApp desde la voz ya no tiene cupo propio aquí: pasa por el almacén atómico del código al correo
// (src/services/academico/verificacionVoz.ts, issue #34), con tope diario y bloqueo.

// Quita la entrada del índice solo si su fecha sigue siendo la que se leyó (si otra instancia ya programó la siguiente
// etapa, ZADD cambió el puntaje y esta no la toca).
export const QUITAR_SILENCIO_SCRIPT = `
local v = redis.call('ZSCORE', KEYS[1], ARGV[1])
if v and tonumber(v) == tonumber(ARGV[2]) then redis.call('ZREM', KEYS[1], ARGV[1]) return 1 end
return 0
`;

export const RESERVAR_SCRIPT = `
if redis.call('EXISTS', KEYS[3]) == 1 then return {0, 'duplicada'} end
local permitido = tonumber(ARGV[1])
if ARGV[4] ~= '1' then
  local d = tonumber(redis.call('GET', KEYS[1]) or '0')
  local m = tonumber(redis.call('GET', KEYS[2]) or '0')
  permitido = math.floor(math.min(permitido, tonumber(ARGV[2]) - d, tonumber(ARGV[3]) - m))
  if permitido < 1 then return {0, 'sin_cupo'} end
  redis.call('INCRBY', KEYS[1], permitido)
  redis.call('EXPIRE', KEYS[1], 259200)
  redis.call('INCRBY', KEYS[2], permitido)
  redis.call('EXPIRE', KEYS[2], 3456000)
end
local json = string.gsub(ARGV[6], '"minutosPermitidos":%-1', '"minutosPermitidos":' .. permitido, 1)
redis.call('SET', KEYS[4], json)
redis.call('PEXPIREAT', KEYS[4], ARGV[7])
redis.call('SET', KEYS[3], ARGV[5], 'EX', 172800)
redis.call('ZADD', KEYS[5], ARGV[8], ARGV[5])
return {1, tostring(permitido)}
`;

// La versión va SIEMPRE primero en el JSON (serializar()), así el patrón anclado no puede confundirse con texto.
export const GUARDAR_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if not cur then return 0 end
local v = string.match(cur, '^{"version":(%d+)')
if v ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
return 1
`;

const AJUSTAR_SCRIPT = `
for i = 1, 2 do
  local n = redis.call('INCRBY', KEYS[i], ARGV[1])
  if n < 0 then redis.call('SET', KEYS[i], 0, 'KEEPTTL') end
end
return 1
`;

export function serializar(l: LlamadaVoz): string {
  const { version, ...resto } = l;
  return JSON.stringify({ version, ...resto });
}

function deserializar(raw: string | null): LlamadaVoz | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as LlamadaVoz;
    return {
      ...o,
      silencioVence: Number.isFinite(o.silencioVence) ? o.silencioVence : null,
      dictado: typeof o.dictado === 'string' ? o.dictado.slice(0, 12) : '',
      turnoAplicado: Number.isInteger(o.turnoAplicado) ? o.turnoAplicado : 0,
      dialogo: leerDialogo(o.dialogo),
    };
  } catch {
    return null;
  }
}

export function almacenRedis(redis: Redis): AlmacenVoz {
  return {
    async reclamarEvento(p, id) {
      return (await redis.set(K.evento(p, id), '1', 'EX', 86_400, 'NX')) === 'OK';
    },
    async liberarEvento(p, id) {
      await redis.del(K.evento(p, id));
    },
    async reservarLlamada({ proveedor, proveedorCallId, telefono, simulada, topes, ahora, soloRegistro }) {
      const base = nuevaLlamada({ proveedor, proveedorCallId, telefono, simulada, minutosPermitidos: -1, ahora, retencionDias: topes.retencionDias });
      const { day, month } = bogotaClock(ahora);
      const r = (await redis.eval(
        RESERVAR_SCRIPT, 5,
        K.dia(day), K.mes(month), K.prov(proveedor, proveedorCallId), K.llamada(base.id), K.indice,
        String(topes.maxMinutosLlamada), String(topes.topeMinutosDia), String(topes.topeMinutosMes), simulada || soloRegistro ? '1' : '0',
        base.id, serializar(base), String(base.expira), String(ahora.getTime()),
      )) as [number, string];
      if (r[0] !== 1) return { ok: false, motivo: r[1] === 'duplicada' ? 'duplicada' : 'sin_cupo' };
      return { ok: true, llamada: { ...base, minutosPermitidos: Number(r[1]) } };
    },
    async porProveedor(p, cid) {
      const id = await redis.get(K.prov(p, cid));
      return id ? deserializar(await redis.get(K.llamada(id))) : null;
    },
    async leer(id) {
      return deserializar(await redis.get(K.llamada(id)));
    },
    async guardar(l) {
      const nueva = { ...l, version: l.version + 1 };
      const ok = await redis.eval(GUARDAR_SCRIPT, 1, K.llamada(l.id), String(l.version), serializar(nueva));
      return ok === 1 ? nueva : null;
    },
    async ajustarUso(dia, mes, delta) {
      if (!delta) return;
      await redis.eval(AJUSTAR_SCRIPT, 2, K.dia(dia), K.mes(mes), String(Math.round(delta)));
    },
    async agregarLinea(id, linea, retencionDias) {
      const k = K.lineas(id);
      await redis.multi()
        .rpush(k, JSON.stringify(recortarLinea(linea)))
        .ltrim(k, -MAX_LINEAS, -1)
        .pexpire(k, retencionDias * 86_400_000)
        .exec();
    },
    async transcripcion(id) {
      const raw = await redis.lrange(K.lineas(id), 0, -1);
      return raw.flatMap((r) => {
        try { return [JSON.parse(r) as LineaTranscripcion]; } catch { return []; }
      });
    },
    async listar(limite) {
      // Las vencidas ya no existen (PEXPIREAT); se limpian del índice al listar.
      const ids = await redis.zrevrange(K.indice, 0, Math.max(0, limite * 2 - 1));
      if (!ids.length) return [];
      const raws = await redis.mget(ids.map(K.llamada));
      const muertas = ids.filter((_, i) => !raws[i]);
      if (muertas.length) await redis.zrem(K.indice, ...muertas);
      return raws.map(deserializar).filter((l): l is LlamadaVoz => !!l).slice(0, limite);
    },
    async uso(ahora) {
      const { day, month } = bogotaClock(ahora);
      const [d, m] = await redis.mget(K.dia(day), K.mes(month));
      return { dia: Number(d ?? 0), mes: Number(m ?? 0) };
    },
    async contarSimulacion(ahora, tope) {
      const k = K.sim(bogotaClock(ahora).day);
      const n = await redis.incr(k);
      if (n === 1) await redis.expire(k, 172_800);
      return n <= tope;
    },
    async indexarSilencio(id, vence) {
      await redis.zadd(K.silencios, vence, id);
    },
    async silenciosVencidos(ahora, limite) {
      const r = await redis.zrangebyscore(K.silencios, '-inf', ahora, 'WITHSCORES', 'LIMIT', 0, limite);
      const out: { id: string; vence: number }[] = [];
      for (let i = 0; i + 1 < r.length; i += 2) out.push({ id: r[i], vence: Number(r[i + 1]) });
      return out;
    },
    async quitarSilencio(id, vence) {
      await redis.eval(QUITAR_SILENCIO_SCRIPT, 1, K.silencios, id, String(vence));
    },
  };
}
