/** Presencia, horario y reparto de conversaciones del panel de atención. */

import Redis from 'ioredis';
import { config } from '../config';
import { publicarAtencion, suscribirAtencion } from './atencionEventos';
import type { PublicUser } from './usersService';

// Importar las funciones puras desde una prueba no debe abrir un socket.
const redis = new Redis(config.redis.url, { lazyConnect: true });
const CONFIG_KEY = 'atencion:config';
const ESTADO_KEY = (username: string) => `atencion:presencia:${username.toLowerCase()}`;
const ULTIMA_ASIGNACION_KEY = 'atencion:ultima-asignacion';
const CACHE_MS = 60_000;

export type EstadoAsesor = 'disponible' | 'ocupado' | 'ausente';
export const ESTADOS_ASESOR: readonly EstadoAsesor[] = ['disponible', 'ocupado', 'ausente'];

export interface HorarioAtencion {
  activo: boolean;
  dias: number[];
  desde: string;
  hasta: string;
}

export interface ConfigAtencion {
  asignacionAutomatica: boolean;
  maxAbiertasPorAsesor: number;
  horario: HorarioAtencion;
}

export const CONFIG_ATENCION_DEFAULT: ConfigAtencion = {
  asignacionAutomatica: false,
  maxAbiertasPorAsesor: 5,
  horario: { activo: false, dias: [1, 2, 3, 4, 5], desde: '08:00', hasta: '18:00' },
};

export class AtencionConfigError extends Error {}

const HORA = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

/** Devuelve una copia canónica; nunca conserva referencias del body recibido. */
export function validarConfigAtencion(input: unknown): ConfigAtencion {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AtencionConfigError('La configuración de atención no es válida.');
  }
  const valor = input as Record<string, unknown>;
  if (typeof valor.asignacionAutomatica !== 'boolean') {
    throw new AtencionConfigError('La asignación automática debe ser verdadera o falsa.');
  }
  if (!Number.isInteger(valor.maxAbiertasPorAsesor) || Number(valor.maxAbiertasPorAsesor) < 1 || Number(valor.maxAbiertasPorAsesor) > 50) {
    throw new AtencionConfigError('El máximo de conversaciones abiertas por asesor debe estar entre 1 y 50.');
  }
  if (!valor.horario || typeof valor.horario !== 'object' || Array.isArray(valor.horario)) {
    throw new AtencionConfigError('El horario de atención no es válido.');
  }
  const horario = valor.horario as Record<string, unknown>;
  if (typeof horario.activo !== 'boolean') throw new AtencionConfigError('El estado del horario debe ser verdadero o falso.');
  if (!Array.isArray(horario.dias) || !horario.dias.length || horario.dias.some((dia) => !Number.isInteger(dia) || Number(dia) < 0 || Number(dia) > 6)) {
    throw new AtencionConfigError('Los días del horario deben ser números entre 0 y 6.');
  }
  const dias = [...new Set(horario.dias as number[])].sort((a, b) => a - b);
  if (dias.length !== horario.dias.length) throw new AtencionConfigError('Los días del horario no pueden repetirse.');
  if (typeof horario.desde !== 'string' || !HORA.test(horario.desde) || typeof horario.hasta !== 'string' || !HORA.test(horario.hasta)) {
    throw new AtencionConfigError('Las horas deben tener el formato HH:MM.');
  }
  if (horario.desde >= horario.hasta) throw new AtencionConfigError('La hora de inicio debe ser anterior a la hora de cierre.');
  return {
    asignacionAutomatica: valor.asignacionAutomatica,
    maxAbiertasPorAsesor: Number(valor.maxAbiertasPorAsesor),
    horario: { activo: horario.activo, dias, desde: horario.desde, hasta: horario.hasta },
  };
}

/** Bogotá conserva UTC-5 todo el año, por eso se evita depender de la zona del servidor. */
export function dentroDeHorario(horario: HorarioAtencion, ahora: Date): boolean {
  if (!horario.activo) return true;
  const bogota = new Date(ahora.getTime() - 5 * 60 * 60 * 1000);
  const dia = bogota.getUTCDay();
  const hora = `${String(bogota.getUTCHours()).padStart(2, '0')}:${String(bogota.getUTCMinutes()).padStart(2, '0')}`;
  return horario.dias.includes(dia) && hora >= horario.desde && hora < horario.hasta;
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const horaLegible = (hora: string) => hora.replace(/^0/, '');

export function textoHorario(horario: HorarioAtencion): string {
  const dias = [...horario.dias].sort((a, b) => a - b);
  let textoDias: string;
  const consecutivos = dias.every((dia, i) => i === 0 || dia === dias[i - 1] + 1);
  if (dias.length >= 3 && consecutivos) textoDias = `${DIAS[dias[0]]} a ${DIAS[dias[dias.length - 1]]}`;
  else if (dias.length === 1) textoDias = DIAS[dias[0]];
  else textoDias = `${dias.slice(0, -1).map((dia) => DIAS[dia]).join(', ')} y ${DIAS[dias[dias.length - 1]]}`;
  return `${textoDias} de ${horaLegible(horario.desde)} a ${horaLegible(horario.hasta)}`;
}

let configCache: { config: ConfigAtencion; vence: number } | null = null;

export async function obtenerConfigAtencion(): Promise<ConfigAtencion> {
  const raw = await redis.get(CONFIG_KEY);
  if (!raw) return structuredClone(CONFIG_ATENCION_DEFAULT);
  try {
    return validarConfigAtencion(JSON.parse(raw));
  } catch (err) {
    console.error('[atencionEquipo] configuración inválida en Redis; se usarán los valores por defecto');
    return structuredClone(CONFIG_ATENCION_DEFAULT);
  }
}

export async function guardarConfigAtencion(input: unknown): Promise<ConfigAtencion> {
  const nueva = validarConfigAtencion(input);
  await redis.set(CONFIG_KEY, JSON.stringify(nueva));
  configCache = { config: nueva, vence: Date.now() + CACHE_MS };
  return nueva;
}

export async function obtenerConfigAtencionCacheada(): Promise<ConfigAtencion> {
  if (configCache && configCache.vence > Date.now()) return configCache.config;
  const actual = await obtenerConfigAtencion();
  configCache = { config: actual, vence: Date.now() + CACHE_MS };
  return actual;
}

/* La usa el bot antes de pasar a alguien con un asesor: si Redis falla, se
   comporta como siempre (dentro de horario) en vez de romper la conexión. */
export async function dentroDeHorarioAsync(ahora = new Date()): Promise<boolean> {
  try {
    return dentroDeHorario((await obtenerConfigAtencionCacheada()).horario, ahora);
  } catch {
    console.error('[atencionEquipo] no se pudo leer el horario; se atiende como dentro de horario');
    return true;
  }
}

/** Cuándo se responde, para el mensaje de fuera de horario del bot. */
export async function textoProximaAtencion(): Promise<string> {
  try {
    const horario = (await obtenerConfigAtencionCacheada()).horario;
    return horario.activo ? textoHorario(horario) : 'el próximo día hábil';
  } catch {
    return 'el próximo día hábil';
  }
}

const conexiones = new Map<string, number>();
const usuarioNormalizado = (username: string) => username.toLowerCase();

export function registrarConexion(username: string): void {
  const key = usuarioNormalizado(username);
  conexiones.set(key, (conexiones.get(key) ?? 0) + 1);
  publicarAtencion({ tipo: 'presencia' });
}

export function registrarDesconexion(username: string): void {
  const key = usuarioNormalizado(username);
  const restantes = (conexiones.get(key) ?? 0) - 1;
  if (restantes > 0) conexiones.set(key, restantes);
  else conexiones.delete(key);
  publicarAtencion({ tipo: 'presencia' });
}

export function estaConectado(username: string): boolean {
  return (conexiones.get(usuarioNormalizado(username)) ?? 0) > 0;
}

export async function obtenerEstadoAsesor(username: string): Promise<EstadoAsesor> {
  const estado = await redis.get(ESTADO_KEY(username));
  return ESTADOS_ASESOR.includes(estado as EstadoAsesor) ? estado as EstadoAsesor : 'disponible';
}

export async function cambiarEstadoAsesor(username: string, estado: unknown): Promise<EstadoAsesor> {
  if (!ESTADOS_ASESOR.includes(estado as EstadoAsesor)) throw new AtencionConfigError('El estado de presencia no es válido.');
  await redis.set(ESTADO_KEY(username), estado as EstadoAsesor);
  publicarAtencion({ tipo: 'presencia' });
  return estado as EstadoAsesor;
}

export interface AsesorElegible {
  username: string;
  chatwootUserId: number;
  area: PublicUser['area'];
  conectado: boolean;
  estado: EstadoAsesor;
  abiertas: number;
  ultimaAsignacion: number;
}

export function elegirAsesor(
  asesores: AsesorElegible[],
  area: 'ti' | 'admisiones',
  maxAbiertas: number,
): AsesorElegible | null {
  return asesores
    .filter((asesor) => asesor.conectado && asesor.estado === 'disponible')
    .filter((asesor) => asesor.area === area || asesor.area === 'all')
    .filter((asesor) => asesor.abiertas < maxAbiertas)
    .sort((a, b) => a.abiertas - b.abiertas || a.ultimaAsignacion - b.ultimaAsignacion || a.username.localeCompare(b.username))[0] ?? null;
}

let cancelarAsignacion: (() => void) | null = null;
let colaAsignacion = Promise.resolve();

/** Se registra una sola vez; cada evento queda en cola para no sobreasignar por carreras. */
export function iniciarAsignacionAutomatica(): void {
  if (cancelarAsignacion) return;
  cancelarAsignacion = suscribirAtencion((evento) => {
    if (evento.tipo !== 'nueva') return;
    colaAsignacion = colaAsignacion.then(() => asignarNueva(evento.conversacionId)).catch(() => {
      // El error de Chatwoot podría traer datos de la conversación: el log solo
      // deja el motivo operativo y la conversación permanece sin asignar.
      console.error('[atencionEquipo] falló la consulta o asignación automática');
    });
  });
}

async function asignarNueva(conversacionId: number): Promise<void> {
  const configuracion = await obtenerConfigAtencionCacheada();
  if (!configuracion.asignacionAutomatica || !dentroDeHorario(configuracion.horario, new Date())) return;

  const [{ obtenerConversacion, listarConversaciones, asignar }, { listUsers }] = await Promise.all([
    import('./chatwootAtencion'), import('./usersService'),
  ]);
  const [{ conversacion }, { conversaciones }, usuarios] = await Promise.all([
    obtenerConversacion(conversacionId), listarConversaciones('open'), listUsers(),
  ]);
  if (conversacion.asignado) return;
  const tiId = Number(config.chatwoot.teamTiId);
  const admisionesId = Number(config.chatwoot.teamAdmisionesId);
  const area = conversacion.equipo?.id === tiId ? 'ti'
    : conversacion.equipo?.id === admisionesId ? 'admisiones' : null;
  if (!area) {
    console.info('[atencionEquipo] conversación nueva sin equipo compatible; queda sin asignar');
    return;
  }

  // Admins incluidos: también atienden, y quien no quiera recibir se marca
  // Ocupado o Ausente (es lo que muestra la ventana Equipo para todos).
  const vinculados = usuarios.filter((usuario) => usuario.chatwootUserId);
  const estados = await Promise.all(vinculados.map((usuario) => obtenerEstadoAsesor(usuario.username)));
  const ultimas = vinculados.length ? await redis.hmget(ULTIMA_ASIGNACION_KEY, ...vinculados.map((usuario) => usuario.username.toLowerCase())) : [];
  const candidatos: AsesorElegible[] = vinculados.map((usuario, i) => ({
    username: usuario.username,
    chatwootUserId: usuario.chatwootUserId!,
    area: usuario.area,
    conectado: estaConectado(usuario.username),
    estado: estados[i],
    abiertas: conversaciones.filter((item) => item.asignado?.id === usuario.chatwootUserId).length,
    ultimaAsignacion: Number(ultimas[i]) || 0,
  }));
  const elegido = elegirAsesor(candidatos, area, configuracion.maxAbiertasPorAsesor);
  if (!elegido) {
    console.info('[atencionEquipo] no hay asesores disponibles para asignación automática');
    return;
  }
  await asignar(conversacionId, { asesorId: elegido.chatwootUserId });
  await redis.hset(ULTIMA_ASIGNACION_KEY, elegido.username.toLowerCase(), Date.now());
  publicarAtencion({ tipo: 'asignacion', conversacionId });
}
