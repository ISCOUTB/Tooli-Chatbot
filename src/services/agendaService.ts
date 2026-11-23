/**
 * Agenda de asesores: disponibilidad por asesor, franjas libres y citas.
 *
 * Implementa el contrato src/contratos/agenda.ts (`agenda: AgendaApi`), que
 * usan WhatsApp y el bot de llamadas, y suma lo que necesita el panel.
 *
 * DISEÑO EN REDIS
 *   agenda:config             JSON  límites generales (antelación, festivos…)
 *   agenda:disp:<asesor>      JSON  disponibilidad semanal del asesor
 *   agenda:cita:<id>          JSON  la cita (se conserva 90 días tras terminar)
 *   agenda:asesor:<asesor>    ZSET  score = inicio, member = "inicio:fin:id"
 *                                   (citas que ocupan al asesor; sale al cancelar)
 *   agenda:tel:<tel>          ZSET  igual, solo citas confirmadas del teléfono
 *   agenda:todas              ZSET  score = inicio, member = id (para el panel)
 *   agenda:rec:<id>           JSON  ids de los recordatorios programados
 *
 * Reservar y cambiar de estado son scripts Lua: la comprobación de choque y la
 * escritura ocurren en una sola operación de Redis, así dos personas que piden
 * la misma franja a la vez nunca la obtienen las dos.
 *
 * Los módulos que abren Redis al importarse (usersService, reminderService) se
 * cargan con import dinámico detrás de "puertos" (`DepsAgenda`), de modo que la
 * lógica se prueba con dobles y sin sockets.
 */

import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { config } from '../config';
import type { AgendaApi, AreaAgenda, CanalCita, Cita, Franja, ResultadoReserva } from '../contratos/agenda';
import {
  AREAS_AGENDA,
  AgendaValidacionError,
  CONFIG_AGENDA_DEFAULT,
  ConfigAgenda,
  Disponibilidad,
  HorarioEquipo,
  Ocupado,
  calcularFranjasAsesor,
  disponibilidadVacia,
  inicioDelDia,
  isoBogota,
  msDeIso,
  partesBogota,
  planearRecordatorios,
  sumarDias,
  validarConfigAgenda,
  validarDisponibilidad,
} from './agendaLogica';
import { textoRecordatorio } from './agendaTextos';
import { describeError } from './logSafe';
import { ultimoEntranteVerificable } from './replyWindow';
import { isBsuid, normalizeContactId } from './whatsappId';

export type EstadoCita = Cita['estado'];

/** La cita tal como se guarda: el contrato más lo que el panel necesita. */
export interface CitaAgenda extends Cita {
  /** ISO de creación. */
  creada: string;
  /** Quién la creó si fue desde el panel. */
  creadaPor?: string;
  /** Id de la cita que esta reemplaza (reprogramación). */
  reprogramadaDe?: string;
  /** Recordatorios que sí quedaron programados. */
  recordatorios?: Array<'24h' | '1h'>;
  /** Recordatorios que NO se programaron: la cita queda «sin recordatorio» y el panel lo muestra. */
  recordatoriosPendientes?: Array<'24h' | '1h'>;
  /**
   * Por qué: `ventana` (Meta y fuera de las 24 h del último mensaje; falta plantilla aprobada),
   * `sin_telefono` (contacto con BSUID: el programador de recordatorios solo acepta teléfonos)
   * o `error` (el programador falló).
   */
  motivoSinRecordatorio?: MotivoSinRecordatorio;
}

export type MotivoSinRecordatorio = 'ventana' | 'sin_telefono' | 'error';

export type CodigoAgenda = 'no_encontrada' | 'ajena' | 'estado_invalido' | 'futura' | 'ocupada' | 'invalida' | 'limite' | 'asesor_invalido';

export class AgendaError extends Error {
  constructor(public code: CodigoAgenda, message: string) {
    super(message);
  }
}

export interface UsuarioAgenda {
  username: string;
  fullName: string;
  role: 'admin' | 'asesor';
}

export interface DepsAgenda {
  redis: RedisAgenda;
  ahora: () => number;
  usuarios: {
    listar(): Promise<UsuarioAgenda[]>;
    obtener(username: string): Promise<UsuarioAgenda | null>;
  };
  /** Tope del equipo; null si no hay horario configurado o no se pudo leer. */
  horarioEquipo: () => Promise<HorarioEquipo | null>;
  recordatorios: {
    /** Programa un texto para `cuandoMs`; devuelve el id del recordatorio. */
    programar(telefono: string, mensaje: string, cuandoMs: number): Promise<string>;
    cancelar(id: string): Promise<void>;
  };
  adaptador: () => 'meta' | 'evolution';
  /** Último mensaje ENTRANTE de la persona por WhatsApp (epoch ms), o null. Marca la ventana de 24 h de Meta. */
  ultimoEntrante: (telefono: string) => Promise<number | null>;
}

/** Lo que la agenda usa de ioredis; permite un doble en las pruebas. */
export interface RedisAgenda {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  mget(keys: string[]): Promise<Array<string | null>>;
  zrangebyscore(key: string, min: string | number, max: string | number): Promise<string[]>;
  zrem(key: string, ...members: string[]): Promise<number>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

const K = {
  config: 'agenda:config',
  disp: (u: string) => `agenda:disp:${u.toLowerCase()}`,
  cita: (id: string) => `agenda:cita:${id}`,
  asesorZ: (u: string) => `agenda:asesor:${u.toLowerCase()}`,
  telZ: (t: string) => `agenda:tel:${t}`,
  todas: 'agenda:todas',
  rec: (id: string) => `agenda:rec:${id}`,
};

const MIN = 60_000;
const DIA_MS = 24 * 60 * MIN;
/** Una cita guardada por el panel puede durar más que la del grid; este es el tope. */
const DURACION_MAX_MS = 4 * 60 * MIN;
const CONSERVAR_TRAS_FIN_S = 90 * 24 * 60 * 60;

/* ─────────────────────────────── Scripts Lua ───────────────────────────── */

/**
 * KEYS: 1 zset del asesor, 2 zset del teléfono, 3 clave de la cita, 4 índice general
 * ARGV: 1 miembro "inicio:fin:id", 2 inicio, 3 fin, 4 pausa(ms), 5 ahora, 6 máximo de
 *       citas futuras del teléfono (0 = sin límite), 7 JSON, 8 TTL(s), 9 id,
 *       10 id a ignorar (reprogramación), 11 límite inferior de búsqueda, 12 superior.
 * Devuelve 1 reservada, 0 ocupada, -1 límite, -2 el teléfono ya tiene una cita a esa hora.
 */
export const LUA_RESERVAR = `
local ini = tonumber(ARGV[2])
local fin = tonumber(ARGV[3])
local pausa = tonumber(ARGV[4])
local ahora = tonumber(ARGV[5])
local maxFut = tonumber(ARGV[6])
local excluir = ARGV[10]

local propias = redis.call('ZRANGEBYSCORE', KEYS[2], ARGV[5], '+inf')
local cuenta = 0
for _, m in ipairs(propias) do
  local i, f, id = string.match(m, '^(%d+):(%d+):(.+)$')
  if id ~= excluir then
    cuenta = cuenta + 1
    if ini < tonumber(f) and tonumber(i) < fin then return -2 end
  end
end
if maxFut > 0 and cuenta >= maxFut then return -1 end

local ocupadas = redis.call('ZRANGEBYSCORE', KEYS[1], ARGV[11], '(' .. ARGV[12])
for _, m in ipairs(ocupadas) do
  local i, f, id = string.match(m, '^(%d+):(%d+):(.+)$')
  if id ~= excluir then
    if ini < tonumber(f) + pausa and tonumber(i) < fin + pausa then return 0 end
  end
end

redis.call('SET', KEYS[3], ARGV[7], 'EX', ARGV[8])
redis.call('ZADD', KEYS[1], ini, ARGV[1])
redis.call('ZADD', KEYS[2], ini, ARGV[1])
redis.call('ZADD', KEYS[4], ini, ARGV[9])
local limite = string.format('%.0f', ahora - 86400000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', limite)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', limite)
return 1
`;

/**
 * KEYS: 1 clave de la cita, 2 zset del asesor, 3 zset del teléfono
 * ARGV: 1 teléfono dueño ('' = personal del panel), 2 estado nuevo,
 *       3 estados desde los que se permite (",a,b,"), 4 TTL(s), 5 miembro del zset
 * Devuelve 'ok', 'noexiste', 'ajena' o 'estado'.
 */
export const LUA_CAMBIAR_ESTADO = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 'noexiste' end
local c = cjson.decode(raw)
if ARGV[1] ~= '' and c.telefono ~= ARGV[1] then return 'ajena' end
if not string.find(ARGV[3], ',' .. c.estado .. ',', 1, true) then return 'estado' end
c.estado = ARGV[2]
redis.call('SET', KEYS[1], cjson.encode(c), 'EX', ARGV[4])
if ARGV[2] == 'cancelada' then redis.call('ZREM', KEYS[2], ARGV[5]) end
redis.call('ZREM', KEYS[3], ARGV[5])
return 'ok'
`;

/* ─────────────────────────────── Utilidades ────────────────────────────── */

const miembro = (c: Pick<Cita, 'id' | 'inicio' | 'fin'>) => `${msDeIso(c.inicio)}:${msDeIso(c.fin)}:${c.id}`;

function parseMiembro(m: string): (Ocupado & { id: string }) | null {
  const r = /^(\d+):(\d+):(.+)$/.exec(m);
  return r ? { inicioMs: Number(r[1]), finMs: Number(r[2]), id: r[3] } : null;
}

function parseCita(raw: string | null): CitaAgenda | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CitaAgenda;
  } catch {
    return null;
  }
}

/** Teléfono canónico: dígitos E.164 o un BSUID de Meta. Vacío si no es válido. */
export function telefonoValido(input: unknown): string {
  const t = normalizeContactId(input);
  return isBsuid(t) || /^[1-9]\d{9,14}$/.test(t) ? t : '';
}

const esArea = (a: unknown): a is AreaAgenda => AREAS_AGENDA.includes(a as AreaAgenda);

function ttlSegundos(finMs: number, ahoraMs: number): number {
  return Math.max(3600, Math.ceil((finMs - ahoraMs) / 1000) + CONSERVAR_TRAS_FIN_S);
}

export interface AsesorAgenda {
  username: string;
  nombre: string;
  role: 'admin' | 'asesor';
  disponibilidad: Disponibilidad;
}

export interface EntradaReserva {
  telefono: string;
  nombre?: string;
  area: AreaAgenda;
  franja: Franja;
  canal: CanalCita;
  motivo?: string;
}

interface OpcionesReserva {
  /** Panel: salta la disponibilidad semanal y el límite por teléfono; el choque con otras citas se sigue exigiendo. */
  forzar?: boolean;
  excluirId?: string;
  reprogramadaDe?: string;
  creadaPor?: string;
}

/* ──────────────────────────────── Fábrica ──────────────────────────────── */

export function crearAgenda(deps: DepsAgenda) {
  const { redis } = deps;

  async function obtenerConfig(): Promise<ConfigAgenda> {
    const raw = await redis.get(K.config);
    if (!raw) return structuredClone(CONFIG_AGENDA_DEFAULT);
    try {
      return validarConfigAgenda(JSON.parse(raw));
    } catch {
      console.error('[agenda] configuración inválida en Redis; se usan los valores por defecto');
      return structuredClone(CONFIG_AGENDA_DEFAULT);
    }
  }

  async function guardarConfig(input: unknown): Promise<ConfigAgenda> {
    const nueva = validarConfigAgenda(input);
    await redis.set(K.config, JSON.stringify(nueva));
    return nueva;
  }

  async function disponibilidadDe(asesor: string): Promise<Disponibilidad> {
    const raw = await redis.get(K.disp(asesor));
    if (!raw) return disponibilidadVacia(asesor.toLowerCase());
    try {
      return validarDisponibilidad(JSON.parse(raw), asesor.toLowerCase());
    } catch {
      console.error('[agenda] disponibilidad inválida en Redis para un asesor; se trata como inactiva');
      return disponibilidadVacia(asesor.toLowerCase());
    }
  }

  async function guardarDisponibilidad(asesor: string, input: unknown): Promise<Disponibilidad> {
    const usuario = await deps.usuarios.obtener(asesor);
    if (!usuario) throw new AgendaError('asesor_invalido', 'Ese asesor no existe.');
    const disp = validarDisponibilidad(input, usuario.username.toLowerCase());
    await redis.set(K.disp(asesor), JSON.stringify(disp));
    return disp;
  }

  /** Todos los usuarios del panel con su disponibilidad (activa o no). */
  async function asesores(): Promise<AsesorAgenda[]> {
    const usuarios = await deps.usuarios.listar();
    if (!usuarios.length) return [];
    const raws = await redis.mget(usuarios.map((u) => K.disp(u.username)));
    return usuarios.map((u, i) => {
      let disp = disponibilidadVacia(u.username.toLowerCase());
      if (raws[i]) {
        try { disp = validarDisponibilidad(JSON.parse(raws[i] as string), u.username.toLowerCase()); } catch { /* inactiva */ }
      }
      return { username: u.username, nombre: u.fullName, role: u.role, disponibilidad: disp };
    });
  }

  async function ocupadosDe(asesor: string, desdeMs: number, hastaMs: number): Promise<Ocupado[]> {
    const miembros = await redis.zrangebyscore(K.asesorZ(asesor), desdeMs - DURACION_MAX_MS, hastaMs + DIA_MS);
    return miembros.map(parseMiembro).filter((m): m is Ocupado & { id: string } => !!m);
  }

  function ventana(desde: Date | undefined, dias: number | undefined, cfg: ConfigAgenda, ahoraMs: number) {
    const desdeMs = Math.max(desde ? desde.getTime() : ahoraMs, 0);
    const n = Math.max(1, Math.min(dias ?? cfg.diasVentana, cfg.diasVentana));
    const hastaMs = inicioDelDia(sumarDias(partesBogota(desdeMs).fecha, n));
    return { desdeMs, hastaMs };
  }

  async function franjasDeAsesorInterno(
    a: AsesorAgenda, desdeMs: number, hastaMs: number, cfg: ConfigAgenda, equipo: HorarioEquipo | null, ahoraMs: number,
  ): Promise<{ franjas: Franja[]; ocupadas: number }> {
    const ocupados = await ocupadosDe(a.username, desdeMs, hastaMs);
    const libres = calcularFranjasAsesor({
      disp: a.disponibilidad, ocupados, ahoraMs, desdeMs, hastaMs,
      antelacionMin: cfg.antelacionMin, festivos: cfg.festivos, horarioEquipo: equipo,
    });
    return {
      ocupadas: ocupados.length,
      franjas: libres.map((f) => ({
        asesor: a.username.toLowerCase(), asesorNombre: a.nombre,
        inicio: isoBogota(f.inicioMs), fin: isoBogota(f.finMs),
      })),
    };
  }

  async function franjasLibres(opts: { area: AreaAgenda; desde?: Date; dias?: number; max?: number }): Promise<Franja[]> {
    if (!esArea(opts.area)) return [];
    const ahoraMs = deps.ahora();
    const cfg = await obtenerConfig();
    const { desdeMs, hastaMs } = ventana(opts.desde, opts.dias, cfg, ahoraMs);
    const equipo = await deps.horarioEquipo().catch(() => null);
    const elegibles = (await asesores()).filter((a) => a.disponibilidad.activo && a.disponibilidad.areas.includes(opts.area));
    const porInicio = new Map<string, { franja: Franja; carga: number }>();
    for (const a of elegibles) {
      const { franjas, ocupadas } = await franjasDeAsesorInterno(a, desdeMs, hastaMs, cfg, equipo, ahoraMs);
      for (const f of franjas) {
        // A la misma hora se ofrece UN asesor: el que tiene menos citas en la ventana.
        const previo = porInicio.get(f.inicio);
        if (!previo || ocupadas < previo.carga || (ocupadas === previo.carga && f.asesor < previo.franja.asesor)) {
          porInicio.set(f.inicio, { franja: f, carga: ocupadas });
        }
      }
    }
    const max = Math.max(1, Math.min(opts.max ?? 10, 200));
    return [...porInicio.values()].map((v) => v.franja).sort((a, b) => a.inicio.localeCompare(b.inicio)).slice(0, max);
  }

  /** Para el panel: las franjas de un solo asesor, sin mezclar con los demás. */
  async function franjasDeAsesor(asesor: string, opts: { desde?: Date; dias?: number } = {}): Promise<Franja[]> {
    const ahoraMs = deps.ahora();
    const cfg = await obtenerConfig();
    const { desdeMs, hastaMs } = ventana(opts.desde, opts.dias, cfg, ahoraMs);
    const a = (await asesores()).find((x) => x.username.toLowerCase() === asesor.toLowerCase());
    if (!a) return [];
    const equipo = await deps.horarioEquipo().catch(() => null);
    return (await franjasDeAsesorInterno(a, desdeMs, hastaMs, cfg, equipo, ahoraMs)).franjas;
  }

  async function reservarInterno(input: EntradaReserva, op: OpcionesReserva = {}): Promise<ResultadoReserva> {
    const ahoraMs = deps.ahora();
    const telefono = telefonoValido(input?.telefono);
    const franja = input?.franja;
    if (!telefono || !esArea(input?.area) || !franja || typeof franja.asesor !== 'string') return { ok: false, motivo: 'invalida' };
    const inicioMs = msDeIso(franja.inicio);
    const finMs = msDeIso(franja.fin);
    if (!Number.isFinite(inicioMs) || !Number.isFinite(finMs) || finMs <= inicioMs || finMs - inicioMs > DURACION_MAX_MS) {
      return { ok: false, motivo: 'invalida' };
    }
    if (inicioMs <= ahoraMs) return { ok: false, motivo: 'invalida' };
    if (input.canal !== 'whatsapp' && input.canal !== 'voz' && input.canal !== 'panel') return { ok: false, motivo: 'invalida' };

    const usuario = await deps.usuarios.obtener(franja.asesor);
    if (!usuario) return { ok: false, motivo: 'invalida' };
    const asesor = usuario.username.toLowerCase();
    const disp = await disponibilidadDe(asesor);
    const cfg = await obtenerConfig();

    if (!op.forzar) {
      // La franja tiene que seguir siendo una de las reales del asesor: misma
      // duración, dentro de su semana, sin excepción ni festivo, no pasada ni
      // dentro de la antelación mínima.
      if (!disp.activo || !disp.areas.includes(input.area)) return { ok: false, motivo: 'invalida' };
      if (finMs - inicioMs !== disp.duracionMin * MIN) return { ok: false, motivo: 'invalida' };
      if (inicioMs > ahoraMs + cfg.diasVentana * DIA_MS) return { ok: false, motivo: 'invalida' };
      const equipo = await deps.horarioEquipo().catch(() => null);
      const encaja = calcularFranjasAsesor({
        disp, ocupados: [], ahoraMs, desdeMs: inicioMs, hastaMs: inicioMs + 1,
        antelacionMin: cfg.antelacionMin, festivos: cfg.festivos, horarioEquipo: equipo, ignorarOcupados: true,
      }).some((f) => f.inicioMs === inicioMs && f.finMs === finMs);
      if (!encaja) return { ok: false, motivo: 'invalida' };
    }

    const cita: CitaAgenda = {
      id: `cita_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      telefono,
      ...(input.nombre?.trim() ? { nombre: input.nombre.trim().slice(0, 120) } : {}),
      area: input.area,
      asesor,
      asesorNombre: usuario.fullName,
      inicio: isoBogota(inicioMs),
      fin: isoBogota(finMs),
      canal: input.canal,
      ...(input.motivo?.trim() ? { motivo: input.motivo.trim().slice(0, 300) } : {}),
      estado: 'confirmada',
      creada: new Date(ahoraMs).toISOString(),
      ...(op.creadaPor ? { creadaPor: op.creadaPor } : {}),
      ...(op.reprogramadaDe ? { reprogramadaDe: op.reprogramadaDe } : {}),
    };
    const pausaMs = op.forzar ? 0 : disp.pausaMin * MIN;
    const m = miembro(cita);
    const codigo = Number(await redis.eval(
      LUA_RESERVAR, 4,
      K.asesorZ(asesor), K.telZ(telefono), K.cita(cita.id), K.todas,
      m, inicioMs, finMs, pausaMs, ahoraMs, op.forzar ? 0 : cfg.maxCitasFuturas,
      JSON.stringify(cita), ttlSegundos(finMs, ahoraMs), cita.id, op.excluirId ?? '',
      inicioMs - DURACION_MAX_MS - pausaMs, finMs + pausaMs,
    ));
    if (codigo === 0) return { ok: false, motivo: 'ocupada' };
    if (codigo === -1) return { ok: false, motivo: 'limite' };
    if (codigo !== 1) return { ok: false, motivo: 'invalida' };

    await programarRecordatorios(cita, ahoraMs);
    return { ok: true, cita };
  }

  async function programarRecordatorios(cita: CitaAgenda, ahoraMs: number): Promise<void> {
    const programados: Array<'24h' | '1h'> = [];
    const sinRecordatorio: Array<'24h' | '1h'> = [];
    let motivo: MotivoSinRecordatorio | undefined;
    try {
      const adaptador = deps.adaptador();
      const ultimoEntrante = adaptador === 'meta' ? await deps.ultimoEntrante(cita.telefono).catch(() => null) : null;
      const plan = planearRecordatorios({ inicioMs: msDeIso(cita.inicio), ahoraMs, ultimoEntranteMs: ultimoEntrante, adaptador });
      if (plan.sinVentana.length) {
        sinRecordatorio.push(...plan.sinVentana.map((r) => r.tipo));
        motivo = 'ventana';
      }
      const ids: string[] = [];
      for (const r of plan.programar) {
        // reminderService solo acepta teléfonos E.164: con un BSUID ni se intenta (lanzaría y no quedaría marca).
        if (isBsuid(cita.telefono)) {
          sinRecordatorio.push(r.tipo);
          motivo ??= 'sin_telefono';
          continue;
        }
        try {
          ids.push(await deps.recordatorios.programar(cita.telefono, textoRecordatorio(cita, r.tipo), r.cuandoMs));
          programados.push(r.tipo);
        } catch (err) {
          console.error('[agenda] no se pudo programar un recordatorio:', describeError(err));
          sinRecordatorio.push(r.tipo);
          motivo ??= 'error';
        }
      }
      if (ids.length) await redis.set(K.rec(cita.id), JSON.stringify(ids), 'EX', ttlSegundos(msDeIso(cita.fin), ahoraMs));
    } catch (err) {
      // Un recordatorio que falla no debe deshacer una cita ya reservada.
      console.error('[agenda] error al programar recordatorios:', describeError(err));
      motivo ??= 'error';
    }
    if (programados.length) cita.recordatorios = programados;
    if (sinRecordatorio.length) {
      cita.recordatoriosPendientes = (['24h', '1h'] as const).filter((t) => sinRecordatorio.includes(t));
      cita.motivoSinRecordatorio = motivo ?? 'error';
    }
    if (!programados.length && !sinRecordatorio.length) return;
    try {
      // Queda anotado en la cita: el panel muestra «sin recordatorio» y los textos no prometen lo que no salió.
      await redis.set(K.cita(cita.id), JSON.stringify(cita), 'EX', ttlSegundos(msDeIso(cita.fin), ahoraMs));
    } catch (err) {
      console.error('[agenda] no se pudo anotar los recordatorios en la cita:', describeError(err));
    }
  }

  async function cancelarRecordatorios(citaId: string): Promise<void> {
    try {
      const raw = await redis.get(K.rec(citaId));
      if (!raw) return;
      for (const id of JSON.parse(raw) as string[]) {
        await deps.recordatorios.cancelar(id).catch((err) => {
          console.error('[agenda] no se pudo cancelar un recordatorio:', describeError(err));
        });
      }
      await redis.del(K.rec(citaId));
    } catch (err) {
      console.error('[agenda] error al cancelar recordatorios:', describeError(err));
    }
  }

  async function obtenerCita(id: string): Promise<CitaAgenda | null> {
    if (typeof id !== 'string' || !/^cita_[a-z0-9]{1,40}$/.test(id)) return null;
    return parseCita(await redis.get(K.cita(id)));
  }

  /** Cambio de estado atómico. `telefono` vacío = lo hace personal del panel. */
  async function cambiarEstado(
    cita: CitaAgenda, nuevo: EstadoCita, desde: EstadoCita[], telefono: string,
  ): Promise<'ok' | 'noexiste' | 'ajena' | 'estado'> {
    const r = String(await redis.eval(
      LUA_CAMBIAR_ESTADO, 3,
      K.cita(cita.id), K.asesorZ(cita.asesor), K.telZ(cita.telefono),
      telefono, nuevo, `,${desde.join(',')},`, ttlSegundos(msDeIso(cita.fin), deps.ahora()), miembro(cita),
    ));
    if (r === 'ok' && (nuevo === 'cancelada' || nuevo === 'atendida' || nuevo === 'no_asistio')) {
      await cancelarRecordatorios(cita.id);
    }
    return r as 'ok' | 'noexiste' | 'ajena' | 'estado';
  }

  async function cancelar(citaId: string, telefono: string): Promise<boolean> {
    const tel = telefonoValido(telefono);
    const cita = await obtenerCita(citaId);
    if (!tel || !cita) return false;
    return (await cambiarEstado(cita, 'cancelada', ['confirmada'], tel)) === 'ok';
  }

  async function citasDe(telefono: string): Promise<Cita[]> {
    const tel = telefonoValido(telefono);
    if (!tel) return [];
    const miembros = await redis.zrangebyscore(K.telZ(tel), deps.ahora(), '+inf');
    const ids = miembros.map(parseMiembro).filter((m): m is Ocupado & { id: string } => !!m).map((m) => m.id);
    if (!ids.length) return [];
    const raws = await redis.mget(ids.map(K.cita));
    return raws.map(parseCita)
      .filter((c): c is CitaAgenda => !!c && c.estado === 'confirmada' && c.telefono === tel)
      .sort((a, b) => a.inicio.localeCompare(b.inicio));
  }

  /** La persona cambia su propia cita: se reserva la nueva y recién entonces se cancela la vieja. */
  async function reprogramar(citaId: string, telefono: string, franja: Franja): Promise<ResultadoReserva> {
    const tel = telefonoValido(telefono);
    const vieja = await obtenerCita(citaId);
    if (!tel || !vieja || vieja.telefono !== tel || vieja.estado !== 'confirmada') return { ok: false, motivo: 'invalida' };
    return moverConReserva(vieja, franja, tel, { excluirId: vieja.id, reprogramadaDe: vieja.id, canal: vieja.canal });
  }

  async function moverConReserva(
    vieja: CitaAgenda, franja: Franja, telefonoDueno: string,
    op: OpcionesReserva & { canal: CanalCita },
  ): Promise<ResultadoReserva> {
    const r = await reservarInterno({
      telefono: vieja.telefono, nombre: vieja.nombre, area: vieja.area, franja, canal: op.canal, motivo: vieja.motivo,
    }, op);
    if (!r.ok) return r;
    const cancelada = await cambiarEstado(vieja, 'cancelada', ['confirmada'], telefonoDueno);
    if (cancelada !== 'ok') {
      // La vieja ya no se podía cancelar (otra operación se adelantó): se deshace la nueva.
      await cambiarEstado(r.cita as CitaAgenda, 'cancelada', ['confirmada'], '');
      return { ok: false, motivo: 'invalida' };
    }
    return r;
  }

  /* ── Acciones del personal del panel ───────────────────────────────── */

  async function reservarPanel(
    input: Omit<EntradaReserva, 'canal'>, actor: string, forzar: boolean,
  ): Promise<ResultadoReserva> {
    return reservarInterno({ ...input, canal: 'panel' }, { forzar, creadaPor: actor });
  }

  async function moverPanel(citaId: string, franja: Franja, actor: string, forzar: boolean): Promise<ResultadoReserva> {
    const vieja = await obtenerCita(citaId);
    if (!vieja) throw new AgendaError('no_encontrada', 'Esa cita ya no existe.');
    if (vieja.estado !== 'confirmada') throw new AgendaError('estado_invalido', 'Solo se puede mover una cita confirmada.');
    return moverConReserva(vieja, franja, '', {
      forzar, excluirId: vieja.id, reprogramadaDe: vieja.id, creadaPor: actor, canal: vieja.canal,
    });
  }

  async function cancelarPanel(citaId: string): Promise<CitaAgenda> {
    const cita = await obtenerCita(citaId);
    if (!cita) throw new AgendaError('no_encontrada', 'Esa cita ya no existe.');
    const r = await cambiarEstado(cita, 'cancelada', ['confirmada'], '');
    if (r !== 'ok') throw new AgendaError('estado_invalido', 'Solo se puede cancelar una cita confirmada.');
    return { ...cita, estado: 'cancelada' };
  }

  async function marcarPanel(citaId: string, estado: 'atendida' | 'no_asistio'): Promise<CitaAgenda> {
    const cita = await obtenerCita(citaId);
    if (!cita) throw new AgendaError('no_encontrada', 'Esa cita ya no existe.');
    if (msDeIso(cita.inicio) > deps.ahora()) throw new AgendaError('futura', 'La cita todavía no empieza.');
    const r = await cambiarEstado(cita, estado, ['confirmada', 'atendida', 'no_asistio'], '');
    if (r !== 'ok') throw new AgendaError('estado_invalido', 'Esa cita está cancelada.');
    return { ...cita, estado };
  }

  async function listarCitas(opts: { desdeMs: number; hastaMs: number; asesor?: string; estado?: EstadoCita; limite?: number }): Promise<CitaAgenda[]> {
    const ids = await redis.zrangebyscore(K.todas, opts.desdeMs, `(${opts.hastaMs}`);
    const tope = Math.min(opts.limite ?? 1000, 2000);
    const recortados = ids.slice(0, tope);
    if (!recortados.length) return [];
    const raws = await redis.mget(recortados.map(K.cita));
    const huerfanos: string[] = [];
    const citas: CitaAgenda[] = [];
    raws.forEach((raw, i) => {
      const c = parseCita(raw);
      if (!c) { huerfanos.push(recortados[i]); return; }
      if (opts.asesor && c.asesor !== opts.asesor.toLowerCase()) return;
      if (opts.estado && c.estado !== opts.estado) return;
      citas.push(c);
    });
    if (huerfanos.length) await redis.zrem(K.todas, ...huerfanos).catch(() => 0);
    return citas.sort((a, b) => a.inicio.localeCompare(b.inicio));
  }

  const api: AgendaApi = {
    franjasLibres,
    reservar: (input) => reservarInterno(input),
    citasDe,
    cancelar,
  };

  return {
    ...api,
    reprogramar,
    obtenerConfig, guardarConfig,
    disponibilidadDe, guardarDisponibilidad, asesores,
    franjasDeAsesor,
    obtenerCita, listarCitas,
    reservarPanel, moverPanel, cancelarPanel, marcarPanel,
  };
}

export type AgendaServicio = ReturnType<typeof crearAgenda>;

/* ──────────────────────── Conexión real (producción) ───────────────────── */

function depsReales(): DepsAgenda {
  // lazyConnect: importar este módulo en una prueba no abre ningún socket.
  const redis = new Redis(config.redis.url, { lazyConnect: true }) as unknown as RedisAgenda;
  return {
    redis,
    ahora: () => Date.now(),
    usuarios: {
      async listar() {
        const { listUsers } = await import('./usersService');
        return (await listUsers()).map((u) => ({ username: u.username, fullName: u.fullName, role: u.role }));
      },
      async obtener(username) {
        const { getUser } = await import('./usersService');
        const u = await getUser(username);
        return u ? { username: u.username, fullName: u.fullName, role: u.role } : null;
      },
    },
    async horarioEquipo() {
      const { obtenerConfigAtencionCacheada } = await import('./atencionEquipoService');
      const h = (await obtenerConfigAtencionCacheada()).horario;
      return h.activo ? h : null;
    },
    recordatorios: {
      async programar(telefono, mensaje, cuandoMs) {
        const { scheduleReminder } = await import('./reminderService');
        return (await scheduleReminder({ telefono, mensaje, scheduledAt: cuandoMs, createdBy: 'agenda' })).id;
      },
      async cancelar(id) {
        const { cancelReminder } = await import('./reminderService');
        await cancelReminder(id);
      },
    },
    adaptador: () => config.messagingAdapter,
    // La misma marca que usa Conversaciones para la ventana de 24 h: el historial `activity:<tel>` (botUserService).
    async ultimoEntrante(telefono) {
      const historial = await (redis as unknown as Redis).lrange(`activity:${telefono}`, 0, 49);
      const mensajes = historial.flatMap((raw) => {
        try { return [JSON.parse(raw) as { ts: number; direction: 'in' | 'out' }]; } catch { return []; }
      });
      return ultimoEntranteVerificable(mensajes, Date.now());
    },
  };
}

let instancia: AgendaServicio | null = null;
function real(): AgendaServicio {
  if (!instancia) instancia = crearAgenda(depsReales());
  return instancia;
}

/** Servicio completo (panel y flujos). Se crea al primer uso. */
export const agendaServicio: AgendaServicio = new Proxy({} as AgendaServicio, {
  get: (_t, prop: string) => (real() as unknown as Record<string, unknown>)[prop],
});

/** Lo que consumen WhatsApp y la voz: exactamente el contrato. */
export const agenda: AgendaApi = {
  franjasLibres: (o) => real().franjasLibres(o),
  reservar: (i) => real().reservar(i),
  citasDe: (t) => real().citasDe(t),
  cancelar: (id, t) => real().cancelar(id, t),
};

export { AgendaValidacionError };
