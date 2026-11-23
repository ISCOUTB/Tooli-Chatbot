// AlmacenVoz sobre Redis (la única base de Tooli). Reemplaza las funciones SQL de FastFood:
//   voice_claim_event  → SET NX con TTL (idempotencia de eventos de Telnyx).
//   voice_reserve_call → script Lua: lee el uso del día y del mes (hora de Colombia), calcula los minutos que puede
//                        durar la llamada, los aparta y crea la llamada, todo atómico (dos llamadas a la vez nunca
//                        pasan juntas el tope).
//   UPDATE con estado  → compare-and-set por versión (script Lua).
// Retención (Ley 1581): la llamada y su transcripción vencen solas (PEXPIREAT) a los `retencionDias`.
import Redis from 'ioredis';
import { bogotaClock } from './horario';
import { ESPERA_CONTESTAR_MS, MARGEN_TOPE_MS, claveNumero, nuevaLlamada, recortarLinea, type AlmacenVoz } from './almacen';
import { MAX_LINEAS, leerDialogo, type LineaTranscripcion, type LlamadaVoz } from './tipos';

const K = {
  evento: (p: string, id: string) => `voz:evento:${p}:${id}`,
  llamada: (id: string) => `voz:llamada:${id}`,
  prov: (p: string, cid: string) => `voz:prov:${p}:${cid}`,
  dia: (d: string) => `voz:uso:dia:${d}`,
  mes: (m: string) => `voz:uso:mes:${m}`,
  numero: (d: string, tel: string) => `voz:uso:num:${d}:${claveNumero(tel)}`,
  indice: 'voz:llamadas',
  lineas: (id: string) => `voz:lineas:${id}`,
  sim: (d: string) => `voz:sim:${d}`,
  silencios: 'voz:silencios',
  plazos: 'voz:plazos',
  colgada: (p: string, cid: string) => `voz:colgada:${p}:${cid}`,
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
  -- Tope de llamadas por día de un mismo número (punto 14): uno solo no gasta el cupo del día.
  if tonumber(redis.call('GET', KEYS[7]) or '0') >= tonumber(ARGV[11]) then return {0, 'tope_numero'} end
  local d = tonumber(redis.call('GET', KEYS[1]) or '0')
  local m = tonumber(redis.call('GET', KEYS[2]) or '0')
  permitido = math.floor(math.min(permitido, tonumber(ARGV[2]) - d, tonumber(ARGV[3]) - m))
  if permitido < 1 then return {0, 'sin_cupo'} end
  redis.call('INCRBY', KEYS[1], permitido)
  redis.call('EXPIRE', KEYS[1], 259200)
  redis.call('INCRBY', KEYS[2], permitido)
  redis.call('EXPIRE', KEYS[2], 3456000)
  redis.call('INCR', KEYS[7])
  redis.call('EXPIRE', KEYS[7], 172800)
end
local json = string.gsub(ARGV[6], '"minutosPermitidos":%-1', '"minutosPermitidos":' .. permitido, 1)
redis.call('SET', KEYS[4], json)
redis.call('PEXPIREAT', KEYS[4], ARGV[7])
redis.call('SET', KEYS[3], ARGV[5], 'EX', 172800)
redis.call('ZADD', KEYS[5], ARGV[8], ARGV[5])
-- El índice no crece sin fin (punto 15): fuera lo que ya pasó la retención, nunca más de 20000 y vence solo si no
-- entran llamadas en todo el plazo de retención.
redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', '(' .. string.format('%.0f', tonumber(ARGV[8]) - tonumber(ARGV[12])))
local total = redis.call('ZCARD', KEYS[5])
if total > 20000 then redis.call('ZREMRANGEBYRANK', KEYS[5], 0, total - 20001) end
redis.call('PEXPIRE', KEYS[5], ARGV[12])
-- Tope duro (punto 8): la llamada queda vigilada desde que se reserva, en el mismo paso.
if ARGV[10] == '1' then
  redis.call('ZADD', KEYS[6], string.format('%.0f', tonumber(ARGV[8]) + permitido * 60000 + tonumber(ARGV[9])), ARGV[5])
end
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

// Un día o un mes que ya venció no se revive sin TTL (punto 15): INCRBY sobre una llave que no existe la crearía para
// siempre. INCRBY conserva el TTL de la que sí existe.
export const AJUSTAR_SCRIPT = `
for i = 1, 2 do
  if redis.call('EXISTS', KEYS[i]) == 1 then
    local n = redis.call('INCRBY', KEYS[i], ARGV[1])
    if n < 0 then redis.call('SET', KEYS[i], 0, 'KEEPTTL') end
  end
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
      verificada: o.verificada === true,
      finHabla: Number.isFinite(o.finHabla) ? o.finHabla : null,
      colgadoForzado: Number.isFinite(o.colgadoForzado) ? o.colgadoForzado : null,
      transferidaEn: typeof o.transferidaEn === 'string' ? o.transferidaEn : null,
      transferidaHasta: Number.isFinite(o.transferidaHasta) ? o.transferidaHasta : null,
      pataContestada: o.pataContestada === true,
      segPata: Number.isFinite(o.segPata) ? o.segPata : null,
      minutosPata: Number.isFinite(o.minutosPata) ? o.minutosPata : 0,
      verificacionNegada: o.verificacionNegada === 'espera' || o.verificacionNegada === 'bloqueado' ? o.verificacionNegada : null,
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
        RESERVAR_SCRIPT, 7,
        K.dia(day), K.mes(month), K.prov(proveedor, proveedorCallId), K.llamada(base.id), K.indice, K.plazos, K.numero(day, telefono),
        String(topes.maxMinutosLlamada), String(topes.topeMinutosDia), String(topes.topeMinutosMes), simulada || soloRegistro ? '1' : '0',
        base.id, serializar(base), String(base.expira), String(ahora.getTime()),
        String(MARGEN_TOPE_MS + ESPERA_CONTESTAR_MS), soloRegistro ? '0' : '1', String(topes.maxLlamadasNumeroDia),
        String(topes.retencionDias * 86_400_000),
      )) as [number, string];
      if (r[0] !== 1) return { ok: false, motivo: r[1] === 'duplicada' || r[1] === 'tope_numero' ? r[1] : 'sin_cupo' };
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
    async marcarColgada(p, cid) {
      await redis.set(K.colgada(p, cid), '1', 'EX', 3600);
    },
    async fueColgada(p, cid) {
      return (await redis.exists(K.colgada(p, cid))) === 1;
    },
    async vigilar(id, vence) {
      await redis.zadd(K.plazos, vence, id);
    },
    async vigiladasVencidas(ahora, limite) {
      const r = await redis.zrangebyscore(K.plazos, '-inf', ahora, 'WITHSCORES', 'LIMIT', 0, limite);
      const out: { id: string; vence: number }[] = [];
      for (let i = 0; i + 1 < r.length; i += 2) out.push({ id: r[i], vence: Number(r[i + 1]) });
      return out;
    },
    async dejarDeVigilar(id) {
      await redis.zrem(K.plazos, id);
    },
  };
}
