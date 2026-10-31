/** Presencia, horario y reparto de conversaciones del panel de atención. */

import Redis from 'ioredis';
import { config } from '../config';
import { publicarAtencion, suscribirAtencion } from './atencionEventos';
import type { ConversacionAtencion, PersonaRef } from './chatwootAtencion';
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
  encuestaSatisfaccion: boolean;
  maxAbiertasPorAsesor: number;
  horario: HorarioAtencion;
}

export const CONFIG_ATENCION_DEFAULT: ConfigAtencion = {
  asignacionAutomatica: false,
  encuestaSatisfaccion: false,
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
  if (valor.encuestaSatisfaccion !== undefined && typeof valor.encuestaSatisfaccion !== 'boolean') {
    throw new AtencionConfigError('La encuesta de satisfacción debe ser verdadera o falsa.');
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
    encuestaSatisfaccion: valor.encuestaSatisfaccion === true,
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
  // Activar la asignación, subir el máximo o ampliar el horario puede dejar
  // conversaciones en espera listas para repartir.
  programarReparto();
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

/* ===== Cola de espera =====
   Una conversación sin asesor espera hasta que alguien pueda recibirla: no
   solo se reparte al llegar, sino también cuando alguien se conecta, pasa a
   Disponible o libera un cupo. */

type AreaAtencion = 'ti' | 'admisiones';

export interface EquiposAtencion {
  ti: number;
  admisiones: number;
}

export interface ConversacionEnEspera {
  id: number;
  area: AreaAtencion;
}

export interface AsignacionPlaneada {
  conversacionId: number;
  area: AreaAtencion;
  username: string;
  chatwootUserId: number;
}

export function equiposDeAtencion(): EquiposAtencion {
  return { ti: Number(config.chatwoot.teamTiId), admisiones: Number(config.chatwoot.teamAdmisionesId) };
}

export function areaDeEquipo(equipo: PersonaRef | null, equipos: EquiposAtencion): AreaAtencion | null {
  if (!equipo) return null;
  return equipo.id === equipos.ti ? 'ti' : equipo.id === equipos.admisiones ? 'admisiones' : null;
}

/**
 * Las abiertas sin asesor de un equipo que atiende el panel, de la más antigua
 * a la más nueva. Chatwoot numera las conversaciones al crearlas, así que el id
 * da el orden de llegada aunque la lista venga por última actividad.
 */
export function conversacionesEnEspera(abiertas: ConversacionAtencion[], equipos: EquiposAtencion): ConversacionEnEspera[] {
  return abiertas
    .filter((conversacion) => !conversacion.asignado)
    .map((conversacion) => ({ id: conversacion.id, area: areaDeEquipo(conversacion.equipo, equipos) }))
    .filter((conversacion): conversacion is ConversacionEnEspera => conversacion.area !== null)
    .sort((a, b) => a.id - b.id);
}

/**
 * Reparte con la misma regla que `elegirAsesor`, sumando cada asignación a la
 * carga del elegido para que la siguiente vaya a quien quede con menos. Una
 * conversación sin candidato de su área no frena a las de la otra área.
 */
export function planificarReparto(
  enEspera: ConversacionEnEspera[],
  asesores: AsesorElegible[],
  maxAbiertas: number,
): AsignacionPlaneada[] {
  const carga = asesores.map((asesor) => ({ ...asesor }));
  // Lo que se asigna en esta vuelta cuenta como más reciente que cualquier
  // asignación anterior, para que el desempate siga rotando.
  let reciente = Math.max(0, ...asesores.map((asesor) => asesor.ultimaAsignacion));
  const plan: AsignacionPlaneada[] = [];
  for (const conversacion of [...enEspera].sort((a, b) => a.id - b.id)) {
    const elegido = elegirAsesor(carga, conversacion.area, maxAbiertas);
    if (!elegido) continue;
    elegido.abiertas += 1;
    elegido.ultimaAsignacion = ++reciente;
    plan.push({ conversacionId: conversacion.id, area: conversacion.area, username: elegido.username, chatwootUserId: elegido.chatwootUserId });
  }
  return plan;
}

const AGRUPAR_MS = 1_500;
const BARRIDO_MS = 60_000;

let cancelarAsignacion: (() => void) | null = null;
let repartoProgramado: NodeJS.Timeout | null = null;
let repartiendo = false;
let otraVuelta = false;
let avisoPropio = false;

/** Se registra una sola vez, al arrancar el servidor (src/index.ts). */
export function iniciarAsignacionAutomatica(): void {
  if (cancelarAsignacion) return;
  cancelarAsignacion = suscribirAtencion((evento) => {
    // Un mensaje no cambia quién puede recibir; todo lo demás sí: una
    // conversación nueva, una conexión o cambio de estado, o un cupo liberado
    // al resolver, dejar pendiente, reasignar o quitar el asesor.
    if (avisoPropio || evento.tipo === 'mensaje') return;
    programarReparto();
  });
  // Respaldo de lo que no llega como aviso: el inicio del horario, un cambio
  // hecho directamente en Chatwoot o un aviso que falló.
  setInterval(programarReparto, BARRIDO_MS).unref();
}

/* Agrupa los avisos seguidos en una sola vuelta: una recarga del panel
   desconecta y reconecta, y al resolver avisan el panel y el webhook. */
function programarReparto(): void {
  if (!cancelarAsignacion || repartoProgramado) return;
  repartoProgramado = setTimeout(() => {
    repartoProgramado = null;
    void ejecutarReparto();
  }, AGRUPAR_MS);
  repartoProgramado.unref();
}

/* Un solo proceso atiende todo (ver atencionEventos.ts), así que basta una
   bandera para que dos vueltas no repartan lo mismo. Lo que se pida durante
   una vuelta se atiende en otra al terminar. */
async function ejecutarReparto(): Promise<void> {
  if (repartiendo) {
    otraVuelta = true;
    return;
  }
  repartiendo = true;
  try {
    await repartirEnEspera();
  } catch {
    // El error de Chatwoot podría traer datos de la conversación: el log solo
    // deja el motivo operativo y el siguiente barrido lo vuelve a intentar.
    console.error('[atencionEquipo] falló el reparto de conversaciones en espera');
  } finally {
    repartiendo = false;
    if (otraVuelta) {
      otraVuelta = false;
      programarReparto();
    }
  }
}

async function repartirEnEspera(): Promise<void> {
  const configuracion = await obtenerConfigAtencionCacheada();
  // Fuera de horario nada se reparte: lo que espera va al primer asesor
  // disponible cuando empiece el horario (lo detecta el barrido).
  if (!configuracion.asignacionAutomatica || !dentroDeHorario(configuracion.horario, new Date())) return;

  const { listUsers } = await import('./usersService');
  // Admins incluidos: también atienden, y quien no quiera recibir se marca
  // Ocupado o Ausente (es lo que muestra la ventana Equipo para todos).
  const vinculados = (await listUsers()).filter((usuario) => usuario.chatwootUserId);
  const estados = await Promise.all(vinculados.map((usuario) => obtenerEstadoAsesor(usuario.username)));
  // Sin nadie que pueda recibir no se consulta Chatwoot: así el barrido no
  // cuesta nada mientras el equipo no está conectado.
  if (!vinculados.some((usuario, i) => estados[i] === 'disponible' && estaConectado(usuario.username))) return;

  const { listarConversaciones, conversacionDelInbox, mapConversacion, asignar } = await import('./chatwootAtencion');
  const { conversaciones } = await listarConversaciones('open');
  const equipos = equiposDeAtencion();
  const enEspera = conversacionesEnEspera(conversaciones, equipos);
  if (!enEspera.length) return;

  const ultimas = await redis.hmget(ULTIMA_ASIGNACION_KEY, ...vinculados.map((usuario) => usuario.username.toLowerCase()));
  const candidatos: AsesorElegible[] = vinculados.map((usuario, i) => ({
    username: usuario.username,
    chatwootUserId: usuario.chatwootUserId!,
    area: usuario.area,
    conectado: estaConectado(usuario.username),
    estado: estados[i],
    abiertas: conversaciones.filter((item) => item.asignado?.id === usuario.chatwootUserId).length,
    ultimaAsignacion: Number(ultimas[i]) || 0,
  }));

  let asignadas = 0;
  for (const paso of planificarReparto(enEspera, candidatos, configuracion.maxAbiertasPorAsesor)) {
    try {
      // La lista ya tiene unos segundos: si el asesor dejó de estar disponible
      // o alguien tomó, cerró o movió la conversación a mano, no se toca y la
      // siguiente vuelta (que ese mismo cambio pide) decide con datos frescos.
      if (!estaConectado(paso.username) || await obtenerEstadoAsesor(paso.username) !== 'disponible') continue;
      const actual = mapConversacion(await conversacionDelInbox(paso.conversacionId));
      if (actual.asignado || actual.estado !== 'open' || areaDeEquipo(actual.equipo, equipos) !== paso.area) continue;
      await asignar(paso.conversacionId, { asesorId: paso.chatwootUserId });
      asignadas++;
      // publicarAtencion avisa en el acto: con la bandera puesta, el oyente de
      // arriba no programa otra vuelta por lo que esta misma acaba de asignar.
      avisoPropio = true;
      try {
        publicarAtencion({ tipo: 'asignacion', conversacionId: paso.conversacionId });
      } finally {
        avisoPropio = false;
      }
      await redis.hset(ULTIMA_ASIGNACION_KEY, paso.username.toLowerCase(), Date.now());
    } catch {
      console.error('[atencionEquipo] falló un paso de la asignación automática; el barrido lo vuelve a revisar');
    }
  }
  if (asignadas) console.info(`[atencionEquipo] asignación automática: ${asignadas} conversación(es) en espera asignada(s)`);
}

/** Cuántas conversaciones esperan asesor, para la ventana Equipo. */
export async function contarEnEspera(): Promise<number> {
  const { listarConversaciones } = await import('./chatwootAtencion');
  const { conversaciones } = await listarConversaciones('open');
  return conversacionesEnEspera(conversaciones, equiposDeAtencion()).length;
}
