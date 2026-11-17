/**
 * Almacén en memoria con lo que `asistenciaService.ts` usa de Redis. Existe
 * para las pruebas: el servicio y la conversación del QR se ejercitan
 * completos sin levantar Redis.
 */
import type { AsistenciaStore } from './asistenciaService';

export function almacenEnMemoria(): AsistenciaStore {
  const textos = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  const ordenados = new Map<string, Map<string, number>>();
  const hash = (key: string) => hashes.get(key) ?? hashes.set(key, new Map()).get(key)!;
  const zset = (key: string) => ordenados.get(key) ?? ordenados.set(key, new Map()).get(key)!;
  return {
    get: async key => textos.get(key) ?? null,
    set: async (key, value) => { textos.set(key, value); },
    setSiNoExiste: async (key, value) => { if (textos.has(key)) return false; textos.set(key, value); return true; },
    del: async (...keys) => { for (const k of keys) { textos.delete(k); hashes.delete(k); } },
    zadd: async (key, score, member) => { zset(key).set(member, score); },
    zrevrange: async (key, start, stop) => [...zset(key).entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(start, stop + 1),
    zrem: async (key, member) => { zset(key).delete(member); },
    hget: async (key, field) => hash(key).get(field) ?? null,
    hset: async (key, field, value) => { hash(key).set(field, value); },
    hdel: async (key, field) => { hash(key).delete(field); },
    hgetall: async key => Object.fromEntries(hash(key)),
    hlen: async key => hash(key).size,
  };
}
