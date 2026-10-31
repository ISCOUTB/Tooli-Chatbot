import type { ConversacionAtencion } from './chatwootAtencion';
import type { EstadoProspecto, FichaCrm } from './crmService';
import type { UserRole } from './usersService';
import type { CheckResult } from '../routes/health';

type EstadoBloque = 'ok' | 'error';
type EstadoAtencionInicio = EstadoBloque | 'no_configurado';
type ConteosSeguimiento = Record<EstadoProspecto, number>;

export interface AtencionInicio {
  estado: EstadoAtencionInicio;
  sinAsignar: number;
  misSinLeer: number;
  mias: number;
  /** Sin usuario de Chatwoot vinculado no hay "mías": el panel lo explica. */
  vinculado: boolean;
  esperaMasLargaMin: number | null;
  porAsesor?: {
    id: number;
    nombre: string;
    disponible: boolean;
    estado: 'disponible' | 'ocupado' | 'ausente' | 'desconectado';
    abiertas: number;
  }[];
}

export interface InicioRespuesta {
  rol: UserRole;
  generadoEn: number;
  atencion: AtencionInicio;
  seguimiento: { estado: EstadoBloque; mios: ConteosSeguimiento; sinAsignar: number };
  recordatorios: { estado: EstadoBloque; fallidos: number; programadosHoy: number };
  hoy: {
    estado: EstadoBloque;
    interaccionesBot: number | null;
    derivadosAsesor: number | null;
    prospectosNuevos: number | null;
    preguntasIa: number | null;
  };
  servicios: {
    estado: EstadoBloque;
    afectados: { servicio: string; nivel: 'caido' | 'degradado'; mensaje: string; detalle?: string }[];
  };
}

const conteosVacios = (): ConteosSeguimiento => ({ nuevo: 0, contactado: 0, interesado: 0, inscrito: 0, descartado: 0 });

export function contarSeguimiento(fichas: FichaCrm[], username: string) {
  const mios = conteosVacios();
  let sinAsignar = 0;
  for (const ficha of fichas) {
    if (ficha.asignadoA === username) mios[ficha.estado]++;
    if (!ficha.asignadoA && (ficha.estado === 'contactado' || ficha.estado === 'interesado')) sinAsignar++;
  }
  return { mios, sinAsignar };
}

export function esperaMasLargaMin(conversaciones: ConversacionAtencion[], ahora = Date.now()): number | null {
  const actividades = conversaciones
    .filter((c) => !c.asignado && Number.isFinite(c.actividadTs) && c.actividadTs > 0)
    .map((c) => c.actividadTs);
  if (!actividades.length) return null;
  return Math.max(0, Math.floor((ahora - Math.min(...actividades)) / 60_000));
}

const MENSAJES_SERVICIOS: Record<string, string> = {
  iceberg: 'No se pueden consultar turnos ni descargar recibos',
  sheets: 'Los registros nuevos del CRM pueden tardar en aparecer',
  google_sheets: 'Los registros nuevos del CRM pueden tardar en aparecer',
  meta: 'Los mensajes de WhatsApp pueden no salir',
  meta_whatsapp: 'Los mensajes de WhatsApp pueden no salir',
  chatwoot: 'La bandeja de Atención no responde',
  redis: 'El panel puede fallar',
};

export function mensajesDeServicios(
  checks: Record<string, CheckResult>,
  rol: UserRole,
): InicioRespuesta['servicios']['afectados'] {
  return Object.entries(checks).flatMap(([servicio, check]) => {
    if (check.status !== 'down' && check.status !== 'degraded') return [];
    const afectado: InicioRespuesta['servicios']['afectados'][number] = {
      servicio,
      nivel: check.status === 'down' ? 'caido' : 'degradado',
      mensaje: MENSAJES_SERVICIOS[servicio] ?? 'Una función del panel puede no responder',
    };
    if (rol === 'admin' && check.detail) afectado.detalle = String(check.detail);
    return [afectado];
  });
}

export function armarInicioPorRol(
  rol: UserRole,
  bloques: Omit<InicioRespuesta, 'rol' | 'generadoEn'>,
  generadoEn = Date.now(),
): InicioRespuesta {
  const atencion = { ...bloques.atencion };
  if (rol !== 'admin') delete atencion.porAsesor;
  return { rol, generadoEn, ...bloques, atencion };
}

/* Las métricas del día son contadores de un hash de Redis (HINCRBY): una
   clave ausente es un evento que no ocurrió hoy, así que vale 0. "Sin datos"
   (null) queda para cuando la fuente misma falla o guarda algo ilegible. */
export function numeroMetrica(metricas: Record<string, string>, clave: string): number | null {
  if (!Object.prototype.hasOwnProperty.call(metricas, clave)) return 0;
  const numero = Number(metricas[clave]);
  return Number.isFinite(numero) ? numero : null;
}

function sumaMetricas(metricas: Record<string, string>, claves: string[]): number | null {
  const valores = claves.map((clave) => numeroMetrica(metricas, clave));
  return valores.some((valor) => valor === null) ? null : (valores as number[]).reduce((total, valor) => total + valor, 0);
}

/** Inicio del día en Bogotá (UTC-5, sin horario de verano): el servidor corre en UTC. */
const OFFSET_BOGOTA_MS = 5 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;
export function inicioDiaBogota(ahora = Date.now()): number {
  return Math.floor((ahora - OFFSET_BOGOTA_MS) / DIA_MS) * DIA_MS + OFFSET_BOGOTA_MS;
}

/* La salud consulta servicios externos (Meta, Iceberg, Sheets...) y es lo más
   lento. Inicio se recarga con cada evento en vivo de cada asesor conectado,
   así que se reutiliza el último resultado durante un minuto. */
const SALUD_TTL_MS = 60_000;
let saludCache: { en: number; checks: Promise<Record<string, CheckResult>> } | null = null;

export async function obtenerInicio(username: string, rol: UserRole): Promise<InicioRespuesta> {
  // Las fuentes se cargan aquí para que las funciones puras no abran conexiones
  // a Redis al importarse desde sus pruebas.
  const [atencionSvc, equipoSvc, crmSvc, metricsSvc, reminderSvc, usersSvc, healthSvc] = await Promise.all([
    import('./chatwootAtencion'), import('./atencionEquipoService'), import('./crmService'),
    import('./metrics'), import('./reminderService'), import('./usersService'), import('../routes/health'),
  ]);
  const { chatwootConfigurado, listarConversaciones } = atencionSvc;
  const { estaConectado, obtenerEstadoAsesor } = equipoSvc;
  const { getFichas } = crmSvc;
  const { getMetrics } = metricsSvc;
  const { listReminders } = reminderSvc;
  const { getUser, listUsers } = usersSvc;
  const { getDeepHealth } = healthSvc;
  const atencionP = (async (): Promise<AtencionInicio> => {
    if (!chatwootConfigurado()) {
      return { estado: 'no_configurado', sinAsignar: 0, misSinLeer: 0, mias: 0, vinculado: false, esperaMasLargaMin: null };
    }
    const [{ conversaciones }, usuario, usuariosEquipo] = await Promise.all([
      listarConversaciones('open'),
      getUser(username),
      rol === 'admin' ? listUsers() : Promise.resolve(null),
    ]);
    const miId = usuario?.chatwootUserId;
    const sinAsignar = conversaciones.filter((c) => !c.asignado).length;
    const mias = miId ? conversaciones.filter((c) => c.asignado?.id === miId).length : 0;
    const misSinLeer = miId ? conversaciones.filter((c) => c.asignado?.id === miId && c.noLeidos > 0).length : 0;
    const bloque: AtencionInicio = { estado: 'ok', sinAsignar, misSinLeer, mias, vinculado: !!miId, esperaMasLargaMin: esperaMasLargaMin(conversaciones) };
    if (usuariosEquipo) {
      const vinculados = usuariosEquipo.filter((item) => item.chatwootUserId);
      const estados = await Promise.all(vinculados.map((item) => obtenerEstadoAsesor(item.username)));
      bloque.porAsesor = vinculados.map((item, i) => {
        const conectado = estaConectado(item.username);
        const estado = conectado ? estados[i] : 'desconectado';
        return {
          id: item.chatwootUserId!,
          nombre: item.fullName,
          disponible: conectado && estados[i] === 'disponible',
          estado,
          abiertas: conversaciones.filter((c) => c.asignado?.id === item.chatwootUserId).length,
        };
      });
    }
    return bloque;
  })();

  const seguimientoP: Promise<InicioRespuesta['seguimiento']> = getFichas().then((fichas) => ({ estado: 'ok', ...contarSeguimiento(Object.values(fichas), username) }));
  const recordatoriosP: Promise<InicioRespuesta['recordatorios']> = listReminders({ limit: 200 }).then((todos) => {
    const visibles = rol === 'admin' ? todos : todos.filter((r) => r.createdBy === username);
    const desde = inicioDiaBogota();
    const hasta = desde + DIA_MS;
    return {
      estado: 'ok',
      fallidos: visibles.filter((r) => r.estado === 'fallido').length,
      programadosHoy: visibles.filter((r) => r.estado === 'programado' && r.scheduledAt >= desde && r.scheduledAt < hasta).length,
    };
  });
  const hoyP: Promise<InicioRespuesta['hoy']> = getMetrics().then((metricas) => ({
    estado: 'ok',
    interaccionesBot: sumaMetricas(metricas, ['menu_shown', 'ai_request', 'turno_consultado', 'recibo_descargado']),
    derivadosAsesor: numeroMetrica(metricas, 'agent_handoff'),
    prospectosNuevos: numeroMetrica(metricas, 'prospecto_completado'),
    preguntasIa: numeroMetrica(metricas, 'ai_request'),
  }));
  if (!saludCache || Date.now() - saludCache.en > SALUD_TTL_MS) {
    const checks = getDeepHealth().then((salud) => salud.checks);
    saludCache = { en: Date.now(), checks };
    // Un fallo no se guarda: el siguiente Inicio vuelve a intentar.
    checks.catch(() => { if (saludCache?.checks === checks) saludCache = null; });
  }
  const serviciosP: Promise<InicioRespuesta['servicios']> = saludCache.checks.then((checks) => ({ estado: 'ok', afectados: mensajesDeServicios(checks, rol) }));

  const [atencionR, seguimientoR, recordatoriosR, hoyR, serviciosR] = await Promise.allSettled([
    atencionP, seguimientoP, recordatoriosP, hoyP, serviciosP,
  ]);
  const valor = <T>(resultado: PromiseSettledResult<T>, fallback: T): T => resultado.status === 'fulfilled' ? resultado.value : fallback;
  return armarInicioPorRol(rol, {
    atencion: valor(atencionR, { estado: 'error', sinAsignar: 0, misSinLeer: 0, mias: 0, vinculado: false, esperaMasLargaMin: null }),
    seguimiento: valor(seguimientoR, { estado: 'error', mios: conteosVacios(), sinAsignar: 0 }),
    recordatorios: valor(recordatoriosR, { estado: 'error', fallidos: 0, programadosHoy: 0 }),
    hoy: valor(hoyR, { estado: 'error', interaccionesBot: null, derivadosAsesor: null, prospectosNuevos: null, preguntasIa: null }),
    servicios: valor(serviciosR, { estado: 'error', afectados: [] }),
  });
}
