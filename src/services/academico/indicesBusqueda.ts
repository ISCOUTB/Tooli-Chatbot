import { hkdfSync } from 'node:crypto';
import { claveBusqueda, extraerCamposAcademicos } from './identidadAcademica';

/**
 * Secreto de los índices inversos `identity-codigo:*` e `identity-cedula:*` (issue #38).
 *
 * Antes era `TOOLI_ACADEMICO_CLAVE || JWT_SECRET`: rotar la clave AES o el JWT dejaba huérfanos todos los índices y
 * rompía «un código, un correo» (el índice viejo no se encontraba y el mismo código se podía atar a otro correo).
 * Ahora tiene clave propia, `TOOLI_BUSQUEDA_CLAVE`, de la que se DERIVA el secreto con HKDF y una etiqueta (nunca se
 * usa en crudo ni se comparte con AES). Lo de antes queda como `legado`, solo para LEER lo que todavía no se migró
 * (`tools/migrar-indices-busqueda.ts`). Sin `TOOLI_BUSQUEDA_CLAVE` todo sigue como antes.
 */

export interface SecretosBusqueda {
  /** Con el que se escriben (y se buscan primero) los índices. */
  actual: string;
  /** El de antes, solo para leer lo no migrado. null si no hay migración pendiente. */
  legado: string | null;
}

export const ETIQUETA_HKDF_BUSQUEDA = 'tooli/indices-busqueda/v1';
const SAL_HKDF = 'tooli-chatbot';

export function claveBusquedaValida(valor: string | undefined): boolean {
  return Boolean(valor && valor.trim().length >= 32);
}

export function secretosBusqueda(fuente: { busqueda?: string; academico?: string; jwt: string }): SecretosBusqueda {
  const legado = fuente.academico?.trim() || fuente.jwt;
  const propia = fuente.busqueda?.trim();
  if (!propia || !claveBusquedaValida(propia)) return { actual: legado, legado: null };
  const actual = Buffer.from(hkdfSync('sha256', propia, SAL_HKDF, ETIQUETA_HKDF_BUSQUEDA, 32)).toString('hex');
  return { actual, legado: legado === actual ? null : legado };
}

/** Claves Redis donde puede estar el índice: primero la del secreto actual, después la del legado. */
export function clavesIndice(tipo: 'codigo' | 'cedula', valor: string, s: SecretosBusqueda): string[] {
  const actual = claveBusqueda(tipo, valor, s.actual);
  if (!s.legado) return [actual];
  const vieja = claveBusqueda(tipo, valor, s.legado);
  return vieja === actual ? [actual] : [actual, vieja];
}

/** La parte HMAC de una clave de índice (lo que se guarda en el vínculo como `cedulaIndice`). */
export function huellaDeIndice(clave: string): string {
  return clave.slice(clave.indexOf(':') + 1);
}

export const indiceCedulaDeHuella = (huella: string): string => `identity-cedula:${huella}`;

/* ─────────────────────────── Migración de índices ─────────────────────────── */

/** Lo que la migración usa de Redis (ioredis cumple; las pruebas usan un doble). */
export interface RedisIndices {
  scan(cursor: string, ...args: Array<string | number>): Promise<[string, string[]]>;
  get(clave: string): Promise<string | null>;
  set(clave: string, valor: string, ...args: Array<string | number>): Promise<unknown>;
  del(...claves: string[]): Promise<number>;
  ttl(clave: string): Promise<number>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export interface ResultadoMigracion {
  /** Vínculos con código revisados. */
  revisados: number;
  /** Índices de código que se escribieron con el secreto actual. */
  codigos: number;
  /** Índices de cédula que se rehicieron con el secreto actual (se pudo descifrar la cédula). */
  cedulas: number;
  /** Cédulas que siguen con el índice viejo (no hay cédula cifrada o no se pudo descifrar): se leen con el respaldo. */
  cedulasPendientes: number;
  /** El índice nuevo ya apunta a OTRO teléfono con un vínculo vigente para ese código: se deja y se informa. */
  conflictos: number;
}

/** Reescribe el vínculo solo si nadie lo cambió desde que se leyó (conserva el TTL). */
export const SCRIPT_CAS_VINCULO = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
return 1
`;

/**
 * Pasa los índices de código y cédula al secreto actual. IDEMPOTENTE: correrla dos veces deja lo mismo, y con
 * `aplicar: false` solo cuenta. Por cada vínculo vigente con código: escribe el índice nuevo (si no es de otro),
 * borra el viejo si apuntaba a este teléfono y, si la cédula cifrada se puede abrir, rehace también su índice y
 * anota la nueva huella en el vínculo (`cedulaIndice`). Lo que no se puede migrar se sigue leyendo con el respaldo.
 */
export async function migrarIndicesBusqueda(
  redis: RedisIndices,
  s: SecretosBusqueda,
  opts: { aplicar: boolean; descifrarCedula?: (telefono: string, blob: string) => string | null },
): Promise<ResultadoMigracion> {
  const r: ResultadoMigracion = { revisados: 0, codigos: 0, cedulas: 0, cedulasPendientes: 0, conflictos: 0 };
  let cursor = '0';
  do {
    const [siguiente, claves] = await redis.scan(cursor, 'MATCH', 'identity:*', 'COUNT', 200);
    cursor = siguiente;
    for (const claveVinculo of claves) {
      const telefono = claveVinculo.slice('identity:'.length);
      const raw = await redis.get(claveVinculo);
      if (!raw) continue;
      let vinculo: Record<string, unknown>;
      try { vinculo = JSON.parse(raw); } catch { continue; }
      const campos = extraerCamposAcademicos(vinculo);
      if (!campos.codigo) continue;
      const ttl = await redis.ttl(claveVinculo);
      if (ttl < 1) continue;
      r.revisados++;

      // Código.
      const [nuevaCodigo, ...viejasCodigo] = clavesIndice('codigo', campos.codigo, s);
      const dueno = await redis.get(nuevaCodigo);
      if (dueno && dueno !== telefono) {
        r.conflictos++;
      } else if (dueno !== telefono) {
        r.codigos++;
        if (opts.aplicar) await redis.set(nuevaCodigo, telefono, 'EX', ttl);
      }
      if (opts.aplicar && (!dueno || dueno === telefono)) {
        for (const vieja of viejasCodigo) if ((await redis.get(vieja)) === telefono) await redis.del(vieja);
      }

      // Cédula: solo si quedó cifrada y se puede abrir; si no, el índice viejo se sigue leyendo con el respaldo.
      if (!campos.codigoVerificado || !s.legado) continue;
      const cedula = campos.cedulaCifrada && opts.descifrarCedula ? opts.descifrarCedula(telefono, campos.cedulaCifrada) : null;
      if (!cedula) {
        if (campos.cedulaIndice || campos.cedulaCifrada) r.cedulasPendientes++;
        continue;
      }
      const [nuevaCedula, ...viejasCedula] = clavesIndice('cedula', cedula, s);
      const huella = huellaDeIndice(nuevaCedula);
      const duenoCedula = await redis.get(nuevaCedula);
      if (duenoCedula && duenoCedula !== telefono) { r.conflictos++; continue; }
      if (duenoCedula === telefono && campos.cedulaIndice === huella) continue;
      r.cedulas++;
      if (!opts.aplicar) continue;
      const cambiado = await redis.eval(SCRIPT_CAS_VINCULO, 1, claveVinculo, raw, JSON.stringify({ ...vinculo, cedulaIndice: huella }));
      if (Number(cambiado) !== 1) { r.cedulas--; r.cedulasPendientes++; continue; }
      await redis.set(nuevaCedula, telefono, 'EX', ttl);
      for (const vieja of viejasCedula) if ((await redis.get(vieja)) === telefono) await redis.del(vieja);
    }
  } while (cursor !== '0');
  return r;
}
