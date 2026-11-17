/**
 * Qué dato va en cada variable de las plantillas creadas desde el panel
 * ({{1}} = primer nombre, {{2}} = programa…). Meta solo guarda el número de
 * la variable; esto lo recuerda para que, al enviar, el panel la llene sola
 * con el dato de cada persona.
 *
 * Un hash de Redis: campo `${nombre}|${idioma}` → JSON { clave: significado }.
 */
import Redis from 'ioredis';
import { config } from '../config';
import { SIGNIFICADOS, type Significado } from './plantillaNueva';

const redis = new Redis(config.redis.url, { lazyConnect: true });
const CLAVE = 'plantillas:significados';

export type Significados = Record<string, Significado>;

export async function guardarSignificados(nombre: string, idioma: string, significados: Significados): Promise<void> {
  const campo = `${nombre}|${idioma}`;
  if (Object.keys(significados).length) await redis.hset(CLAVE, campo, JSON.stringify(significados));
  else await redis.hdel(CLAVE, campo);
}

/** Todos los significados guardados, por `${nombre}|${idioma}`. */
export async function leerSignificados(): Promise<Record<string, Significados>> {
  const crudo = await redis.hgetall(CLAVE);
  const out: Record<string, Significados> = {};
  for (const [campo, json] of Object.entries(crudo)) {
    try {
      const datos = JSON.parse(json) as Record<string, unknown>;
      out[campo] = Object.fromEntries(
        Object.entries(datos).filter((e): e is [string, Significado] => (SIGNIFICADOS as readonly unknown[]).includes(e[1])),
      );
    } catch { /* un registro dañado no tumba la lista */ }
  }
  return out;
}
