/**
 * Asistencia a eventos: quién estuvo, por evento y por sector.
 *
 * Un asesor crea el evento y obtiene un código. Las personas escanean el QR,
 * que abre WhatsApp con ese código, y el bot las registra (`flows/asistencia.ts`).
 * También se puede cargar una lista desde un archivo (`asistenciaImport.ts`).
 *
 * Vive en Redis, como las fichas del CRM:
 *   asistencia:eventos                 ZSET  id → fecha de creación
 *   asistencia:evento:{id}             JSON del evento
 *   asistencia:codigo:{CODIGO}         id del evento (lo que resuelve el QR)
 *   asistencia:evento:{id}:asistentes  HASH  clave de la persona → JSON
 *
 * Una persona es una sola fila aunque llegue por dos caminos: si escanea el QR
 * y además viene en el Excel, se juntan por celular, correo o identificación.
 */
import { createHash, randomInt, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { config } from '../config';
import {
  type DatosAsistente, limpiarTexto, normalizarCelular, normalizarCorreo, normalizarDocumento,
} from './asistenciaImport';
import { isBsuid } from './whatsappId';

export class AsistenciaError extends Error {
  constructor(public code: 'invalid_data' | 'not_found' | 'evento_cerrado' | 'evento_lleno', message: string) {
    super(message);
  }
}

export const SECTORES = ['posgrado', 'pregrado', 'otro'] as const;
export type SectorEvento = typeof SECTORES[number];
export type OrigenAsistente = 'qr' | 'importado' | 'manual';

export interface EventoAsistencia {
  id: string;
  nombre: string;
  sector: SectorEvento;
  /** Día del evento, AAAA-MM-DD, o '' si no se indicó. */
  fecha: string;
  lugar: string;
  codigo: string;
  estado: 'abierto' | 'cerrado';
  creadoPor: string;
  creadoEn: number;
}

export interface Asistente extends DatosAsistente {
  clave: string;
  origen: OrigenAsistente;
  /** Autorizó el tratamiento de datos y que la UTB la contacte (Ley 1581). */
  consentimiento: boolean;
  registradoEn: number;
}

export interface EventoConConteo extends EventoAsistencia {
  asistentes: number;
}

/** Lo mínimo de Redis que usa este servicio; las pruebas lo reemplazan en memoria. */
export interface AsistenciaStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  /** Escribe solo si la clave no existe. */
  setSiNoExiste(key: string, value: string): Promise<boolean>;
  del(...keys: string[]): Promise<void>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
  zrem(key: string, member: string): Promise<void>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<void>;
  hdel(key: string, field: string): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  hlen(key: string): Promise<number>;
}

const redis = new Redis(config.redis.url, { lazyConnect: true });

const REDIS_STORE: AsistenciaStore = {
  get: key => redis.get(key),
  set: async (key, value) => { await redis.set(key, value); },
  setSiNoExiste: async (key, value) => (await redis.set(key, value, 'NX')) === 'OK',
  del: async (...keys) => { if (keys.length) await redis.del(...keys); },
  zadd: async (key, score, member) => { await redis.zadd(key, score, member); },
  zrevrange: (key, start, stop) => redis.zrevrange(key, start, stop),
  zrem: async (key, member) => { await redis.zrem(key, member); },
  hget: (key, field) => redis.hget(key, field),
  hset: async (key, field, value) => { await redis.hset(key, field, value); },
  hdel: async (key, field) => { await redis.hdel(key, field); },
  hgetall: key => redis.hgetall(key),
  hlen: key => redis.hlen(key),
};

const INDICE = 'asistencia:eventos';
const EVENTO = (id: string) => `asistencia:evento:${id}`;
const CODIGO = (codigo: string) => `asistencia:codigo:${codigo}`;
const ASISTENTES = (id: string) => `asistencia:evento:${id}:asistentes`;

export const MAX_EVENTOS_LISTADOS = 200;
export const MAX_ASISTENTES_POR_EVENTO = 5000;

// ── Código del QR ───────────────────────────────────────────────────────────

/** Sin 0/O ni 1/I/L: el código también se dicta y se copia a mano. */
export const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LARGO_CODIGO = 6;

/**
 * Siempre mezcla letras y números: así una frase normal ("asistencia semana")
 * nunca se confunde con un código (ver `parseCodigoAsistencia`).
 */
export function generarCodigo(): string {
  for (;;) {
    let codigo = '';
    for (let i = 0; i < LARGO_CODIGO; i++) codigo += ALFABETO_CODIGO[randomInt(ALFABETO_CODIGO.length)];
    if (/\d/.test(codigo) && /[A-Z]/.test(codigo)) return codigo;
  }
}

// ── Eventos ─────────────────────────────────────────────────────────────────

export interface DatosEvento {
  nombre?: unknown;
  sector?: unknown;
  fecha?: unknown;
  lugar?: unknown;
  estado?: unknown;
}

function validarEvento(input: DatosEvento, completo: boolean): Partial<Pick<EventoAsistencia, 'nombre' | 'sector' | 'fecha' | 'lugar' | 'estado'>> {
  const out: Partial<Pick<EventoAsistencia, 'nombre' | 'sector' | 'fecha' | 'lugar' | 'estado'>> = {};
  if (completo || input.nombre !== undefined) {
    const nombre = limpiarTexto(input.nombre, 100);
    if (nombre.length < 3) throw new AsistenciaError('invalid_data', 'El nombre del evento necesita al menos 3 caracteres');
    out.nombre = nombre;
  }
  if (completo || input.sector !== undefined) {
    if (!(SECTORES as readonly unknown[]).includes(input.sector)) {
      throw new AsistenciaError('invalid_data', 'Elige el sector del evento: posgrado, pregrado u otro');
    }
    out.sector = input.sector as SectorEvento;
  }
  if (input.fecha !== undefined) {
    const fecha = String(input.fecha ?? '').trim();
    if (fecha && (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(`${fecha}T00:00:00Z`)))) {
      throw new AsistenciaError('invalid_data', 'La fecha del evento no es válida');
    }
    out.fecha = fecha;
  }
  if (input.lugar !== undefined) out.lugar = limpiarTexto(input.lugar, 100);
  if (input.estado !== undefined) {
    if (input.estado !== 'abierto' && input.estado !== 'cerrado') {
      throw new AsistenciaError('invalid_data', 'El estado debe ser abierto o cerrado');
    }
    out.estado = input.estado;
  }
  return out;
}

function parseEvento(raw: string | null): EventoAsistencia | null {
  if (!raw) return null;
  try {
    const e = JSON.parse(raw) as EventoAsistencia;
    return e && typeof e.id === 'string' && typeof e.codigo === 'string' ? e : null;
  } catch {
    return null;
  }
}

export async function crearEvento(
  input: DatosEvento, creadoPor: string, store: AsistenciaStore = REDIS_STORE,
): Promise<EventoAsistencia> {
  const datos = validarEvento(input, true);
  const id = randomUUID();
  let codigo = '';
  for (let intento = 0; intento < 8 && !codigo; intento++) {
    const candidato = generarCodigo();
    if (await store.setSiNoExiste(CODIGO(candidato), id)) codigo = candidato;
  }
  if (!codigo) throw new Error('No se pudo reservar un código de asistencia');
  const evento: EventoAsistencia = {
    id, nombre: datos.nombre!, sector: datos.sector!, fecha: datos.fecha ?? '', lugar: datos.lugar ?? '',
    codigo, estado: 'abierto', creadoPor, creadoEn: Date.now(),
  };
  await store.set(EVENTO(id), JSON.stringify(evento));
  await store.zadd(INDICE, evento.creadoEn, id);
  return evento;
}

export function idEventoValido(id: unknown): id is string {
  return typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id);
}

export async function getEvento(id: string, store: AsistenciaStore = REDIS_STORE): Promise<EventoAsistencia | null> {
  if (!idEventoValido(id)) return null;
  return parseEvento(await store.get(EVENTO(id)));
}

export async function getEventoPorCodigo(codigo: string, store: AsistenciaStore = REDIS_STORE): Promise<EventoAsistencia | null> {
  const limpio = String(codigo ?? '').toUpperCase();
  if (limpio.length !== LARGO_CODIGO || [...limpio].some(c => !ALFABETO_CODIGO.includes(c))) return null;
  const id = await store.get(CODIGO(limpio));
  return id ? getEvento(id, store) : null;
}

export async function listarEventos(store: AsistenciaStore = REDIS_STORE): Promise<EventoConConteo[]> {
  const ids = await store.zrevrange(INDICE, 0, MAX_EVENTOS_LISTADOS - 1);
  const eventos: EventoConConteo[] = [];
  for (const id of ids) {
    const evento = parseEvento(await store.get(EVENTO(id)));
    if (!evento) { await store.zrem(INDICE, id); continue; }
    eventos.push({ ...evento, asistentes: await store.hlen(ASISTENTES(id)) });
  }
  return eventos;
}

export async function actualizarEvento(
  id: string, cambios: DatosEvento, store: AsistenciaStore = REDIS_STORE,
): Promise<EventoAsistencia> {
  const evento = await getEvento(id, store);
  if (!evento) throw new AsistenciaError('not_found', 'El evento no existe');
  const actualizado = { ...evento, ...validarEvento(cambios, false) };
  await store.set(EVENTO(id), JSON.stringify(actualizado));
  return actualizado;
}

export async function eliminarEvento(id: string, store: AsistenciaStore = REDIS_STORE): Promise<boolean> {
  const evento = await getEvento(id, store);
  if (!evento) return false;
  await store.del(EVENTO(id), ASISTENTES(id), CODIGO(evento.codigo));
  await store.zrem(INDICE, id);
  return true;
}

// ── Asistentes ──────────────────────────────────────────────────────────────

const claveWhatsapp = (whatsapp: string) => `w:${whatsapp}`;
const claveCorreo = (correo: string) => `c:${correo}`;
const claveDocumento = (documento: string) => `d:${documento.toLowerCase()}`;

/** Con qué se identifica a la persona, de lo más confiable a lo menos. */
function clavesDe(datos: DatosAsistente): string[] {
  const claves: string[] = [];
  if (datos.whatsapp) claves.push(claveWhatsapp(datos.whatsapp));
  if (datos.correo) claves.push(claveCorreo(datos.correo));
  if (datos.documento) claves.push(claveDocumento(datos.documento));
  if (!claves.length && datos.nombre) {
    const nombre = datos.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    claves.push(`n:${createHash('sha256').update(nombre).digest('hex').slice(0, 16)}`);
  }
  return claves;
}

function parseAsistente(raw: string | null | undefined): Asistente | null {
  if (!raw) return null;
  try {
    const a = JSON.parse(raw) as Asistente;
    return a && typeof a.clave === 'string' ? a : null;
  } catch {
    return null;
  }
}

/**
 * Identificador de WhatsApp tal como lo entrega el bot: dígitos con indicativo
 * o el identificador de quien escribe sin mostrar su número (BSUID).
 */
function normalizarWhatsapp(raw: unknown, delBot: boolean): string {
  const texto = String(raw ?? '').trim();
  if (isBsuid(texto)) return texto;
  // El número que entrega WhatsApp ya trae su indicativo: no se le antepone 57.
  if (delBot) return /^[1-9]\d{6,14}$/.test(texto) ? texto : '';
  return normalizarCelular(texto);
}

/** `whatsappDelBot`: el identificador viene de un mensaje recibido, no de alguien que lo escribió. */
export function limpiarDatosAsistente(
  raw: Partial<Record<keyof DatosAsistente, unknown>>, whatsappDelBot = false,
): DatosAsistente {
  return {
    nombre: limpiarTexto(raw.nombre, 120),
    whatsapp: normalizarWhatsapp(raw.whatsapp, whatsappDelBot),
    correo: normalizarCorreo(String(raw.correo ?? '')),
    documento: normalizarDocumento(String(raw.documento ?? '')),
    programa: limpiarTexto(raw.programa, 120),
  };
}

export interface ResultadoRegistro {
  asistente: Asistente;
  nuevo: boolean;
}

/**
 * Registra o completa a una persona. Lo que ya se sabía no se borra: un dato
 * nuevo vacío no pisa uno guardado, y el consentimiento dado no se retira por
 * un registro posterior que no lo traiga.
 */
export async function registrarAsistente(
  eventoId: string,
  crudo: Partial<Record<keyof DatosAsistente, unknown>>,
  opciones: { origen: OrigenAsistente; consentimiento: boolean; exigirAbierto?: boolean },
  store: AsistenciaStore = REDIS_STORE,
): Promise<ResultadoRegistro> {
  const evento = await getEvento(eventoId, store);
  if (!evento) throw new AsistenciaError('not_found', 'El evento no existe');
  if (opciones.exigirAbierto && evento.estado !== 'abierto') {
    throw new AsistenciaError('evento_cerrado', 'El registro de asistencia de este evento ya cerró');
  }
  const datos = limpiarDatosAsistente(crudo, opciones.origen === 'qr');
  const claves = clavesDe(datos);
  if (!claves.length) {
    throw new AsistenciaError('invalid_data', 'Hace falta al menos el nombre, el celular, el correo o la identificación');
  }
  const hash = ASISTENTES(eventoId);

  // La misma persona puede estar guardada bajo otro identificador (vino en el
  // Excel por correo y ahora escanea el QR con su celular): se juntan.
  const previos: Asistente[] = [];
  for (const clave of claves) {
    const previo = parseAsistente(await store.hget(hash, clave));
    if (previo) previos.push(previo);
  }
  if (!previos.length && (await store.hlen(hash)) >= MAX_ASISTENTES_POR_EVENTO) {
    throw new AsistenciaError('evento_lleno', `El evento ya tiene ${MAX_ASISTENTES_POR_EVENTO} asistentes`);
  }

  const base = previos[0];
  const fusion: Asistente = {
    clave: claves[0],
    nombre: datos.nombre || previos.find(p => p.nombre)?.nombre || '',
    whatsapp: datos.whatsapp || previos.find(p => p.whatsapp)?.whatsapp || '',
    correo: datos.correo || previos.find(p => p.correo)?.correo || '',
    documento: datos.documento || previos.find(p => p.documento)?.documento || '',
    programa: datos.programa || previos.find(p => p.programa)?.programa || '',
    // Quien escaneó el QR estuvo ahí: ese origen pesa más que venir en una lista.
    origen: previos.some(p => p.origen === 'qr') || opciones.origen === 'qr' ? 'qr' : base?.origen ?? opciones.origen,
    consentimiento: opciones.consentimiento || previos.some(p => p.consentimiento),
    registradoEn: previos.length ? Math.min(...previos.map(p => p.registradoEn)) : Date.now(),
  };
  // La clave final es la del mejor identificador que ahora se conoce.
  fusion.clave = clavesDe(fusion)[0];
  for (const previo of previos) {
    if (previo.clave !== fusion.clave) await store.hdel(hash, previo.clave);
  }
  await store.hset(hash, fusion.clave, JSON.stringify(fusion));
  return { asistente: fusion, nuevo: previos.length === 0 };
}

export async function getAsistentePorWhatsapp(
  eventoId: string, whatsapp: string, store: AsistenciaStore = REDIS_STORE,
): Promise<Asistente | null> {
  return parseAsistente(await store.hget(ASISTENTES(eventoId), claveWhatsapp(whatsapp)));
}

export interface AsistenciaDeContacto {
  eventoId: string;
  evento: string;
  sector: SectorEvento;
  fecha: string;
  origen: OrigenAsistente;
  registradoEn: number;
}

/** Los eventos (de los más recientes) en los que aparece este WhatsApp. */
export async function asistenciasPorWhatsapp(whatsapp: string, store: AsistenciaStore = REDIS_STORE): Promise<AsistenciaDeContacto[]> {
  if (!whatsapp) return [];
  const ids = await store.zrevrange(INDICE, 0, MAX_EVENTOS_LISTADOS - 1);
  const out: AsistenciaDeContacto[] = [];
  for (const id of ids) {
    const asistente = parseAsistente(await store.hget(ASISTENTES(id), claveWhatsapp(whatsapp)));
    if (!asistente) continue;
    const evento = parseEvento(await store.get(EVENTO(id)));
    if (!evento) continue;
    out.push({ eventoId: id, evento: evento.nombre, sector: evento.sector, fecha: evento.fecha, origen: asistente.origen, registradoEn: asistente.registradoEn });
  }
  return out;
}

export async function listarAsistentes(eventoId: string, store: AsistenciaStore = REDIS_STORE): Promise<Asistente[]> {
  const todos = await store.hgetall(ASISTENTES(eventoId));
  return Object.values(todos)
    .map(parseAsistente)
    .filter((a): a is Asistente => a !== null)
    .sort((a, b) => b.registradoEn - a.registradoEn);
}

export async function eliminarAsistente(eventoId: string, clave: string, store: AsistenciaStore = REDIS_STORE): Promise<boolean> {
  if (typeof clave !== 'string' || !/^[wcdn]:.{1,300}$/.test(clave)) return false;
  const hash = ASISTENTES(eventoId);
  if (!(await store.hget(hash, clave))) return false;
  await store.hdel(hash, clave);
  return true;
}

export interface ResultadoImportacion {
  nuevos: number;
  actualizados: number;
  /** No cupieron: el evento llegó al tope de asistentes. */
  sinCupo: number;
}

export async function importarAsistentes(
  eventoId: string, personas: DatosAsistente[], consentimiento: boolean, store: AsistenciaStore = REDIS_STORE,
): Promise<ResultadoImportacion> {
  const resultado: ResultadoImportacion = { nuevos: 0, actualizados: 0, sinCupo: 0 };
  for (const persona of personas) {
    try {
      const { nuevo } = await registrarAsistente(eventoId, persona, { origen: 'importado', consentimiento }, store);
      if (nuevo) resultado.nuevos++; else resultado.actualizados++;
    } catch (err) {
      if (err instanceof AsistenciaError && err.code === 'evento_lleno') { resultado.sinCupo++; continue; }
      throw err;
    }
  }
  return resultado;
}
