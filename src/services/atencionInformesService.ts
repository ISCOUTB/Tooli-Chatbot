/** Hitos persistentes y armado de informes de la bandeja de atención. */

import Redis from 'ioredis';
import { config } from '../config';
import { EventoAtencion, suscribirAtencion } from './atencionEventos';
import type { PublicUser } from './usersService';

// Las pruebas de las funciones puras pueden importar este módulo sin abrir Redis.
const redis = new Redis(config.redis.url, { lazyConnect: true });
const INDEX_KEY = 'atencion:hitos:index';
const KEY = (conversacionId: number) => `atencion:hitos:${conversacionId}`;
const TTL_SEGUNDOS = 120 * 24 * 60 * 60;
const DIA_MS = 24 * 60 * 60 * 1000;
const OFFSET_BOGOTA_MS = 5 * 60 * 60 * 1000;

export interface HitosAtencion {
  conversacionId: number;
  creadaEn: number;
  equipo: 'ti' | 'admisiones' | null;
  primeraRespuestaEn: number | null;
  primeraRespuestaPor: string | null;
  resueltaEn: number | null;
  resueltaPor: string | null;
  csat: number | null;
  csatEn: number | null;
  parcial: boolean;
}

export interface InformeAtencion {
  periodo: { dias: 7 | 30 | 90; desde: string; hasta: string };
  totales: {
    recibidas: number; respondidas: number; resueltas: number; sinResponder: number;
    primeraRespuestaMedianaMin: number | null; resolucionMedianaMin: number | null;
    csatPromedio: number | null; csatRespuestas: number;
    csatDistribucion: { 1: number; 2: number; 3: number; 4: number; 5: number };
  };
  porAsesor: Array<{
    username: string | null; nombre: string | null; respondidas: number; resueltas: number;
    primeraRespuestaMedianaMin: number | null; resolucionMedianaMin: number | null;
    csatPromedio: number | null; csatRespuestas: number;
  }>;
  porDia: Array<{ fecha: string; recibidas: number; resueltas: number }>;
  notas: string[];
}

function numero(raw: string | undefined): number | null {
  if (!raw) return null;
  const valor = Number(raw);
  return Number.isFinite(valor) ? valor : null;
}

function desdeHash(conversacionId: number, raw: Record<string, string>): HitosAtencion | null {
  const creadaEn = numero(raw.creadaEn);
  if (creadaEn === null) return null;
  const equipo = raw.equipo === 'ti' || raw.equipo === 'admisiones' ? raw.equipo : null;
  const csat = numero(raw.csat);
  return {
    conversacionId,
    creadaEn,
    equipo,
    primeraRespuestaEn: numero(raw.primeraRespuestaEn),
    primeraRespuestaPor: raw.primeraRespuestaPor || null,
    resueltaEn: numero(raw.resueltaEn),
    resueltaPor: raw.resueltaPor || null,
    csat: csat !== null && csat >= 1 && csat <= 5 ? csat : null,
    csatEn: numero(raw.csatEn),
    parcial: raw.parcial === '1',
  };
}

async function asegurarCreada(conversacionId: number, ahora: number): Promise<void> {
  const agregada = await redis.hsetnx(KEY(conversacionId), 'creadaEn', String(ahora));
  if (agregada) {
    await redis.hset(KEY(conversacionId), { equipo: '', parcial: '1' });
    await redis.zadd(INDEX_KEY, ahora, String(conversacionId));
  }
  await redis.expire(KEY(conversacionId), TTL_SEGUNDOS);
  await redis.zremrangebyscore(INDEX_KEY, '-inf', ahora - TTL_SEGUNDOS * 1000);
  await redis.expire(INDEX_KEY, TTL_SEGUNDOS);
}

export async function registrarCreada(
  conversacionId: number,
  equipo: HitosAtencion['equipo'],
  creadaEn = Date.now(),
): Promise<void> {
  const agregada = await redis.hsetnx(KEY(conversacionId), 'creadaEn', String(creadaEn));
  if (agregada) {
    await redis.hset(KEY(conversacionId), { equipo: equipo ?? '', parcial: '0' });
    await redis.zadd(INDEX_KEY, creadaEn, String(conversacionId));
  } else if (await redis.hget(KEY(conversacionId), 'parcial') === '1') {
    // Si una respuesta ganó la carrera por milisegundos, el evento de creación
    // es la fuente autoritativa y evita excluir una conversación realmente nueva.
    await redis.hset(KEY(conversacionId), { creadaEn: String(creadaEn), equipo: equipo ?? '', parcial: '0' });
    await redis.zadd(INDEX_KEY, creadaEn, String(conversacionId));
  } else if (equipo) {
    // El evento se registra antes de consultar Chatwoot; el equipo llega después.
    await redis.hset(KEY(conversacionId), 'equipo', equipo);
  }
  await redis.expire(KEY(conversacionId), TTL_SEGUNDOS);
  await redis.zremrangebyscore(INDEX_KEY, '-inf', creadaEn - TTL_SEGUNDOS * 1000);
  await redis.expire(INDEX_KEY, TTL_SEGUNDOS);
}

/* Registrar tiempos es medición, no atención: un fallo de Redis aquí no debe
   cortar el reenvío de una respuesta por WhatsApp (webhook) ni hacer que el
   panel diga "no se pudo enviar" a un mensaje que ya salió (y el asesor lo
   reintente). Por eso estas funciones nunca lanzan. */
async function sinInterrumpir(motivo: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch {
    console.error(`[atencionInformes] no se pudo registrar ${motivo}`);
  }
}

/* Lo que se hace desde el panel también dispara el webhook de Chatwoot, que
   registra sin usuario (null) y puede llegar antes que la propia ruta del
   panel. Si el panel registra lo mismo poco después, el asesor reclama la
   autoría; la hora queda la más temprana. Una respuesta de verdad hecha en
   Chatwoot hace minutos no se reasigna. */
const VENTANA_RECLAMO_MS = 2 * 60 * 1000;
async function reclamarAutoria(conversacionId: number, campoEn: string, campoPor: string, username: string, en: number): Promise<void> {
  const [registradoEn, registradoPor] = await redis.hmget(KEY(conversacionId), campoEn, campoPor);
  if (registradoPor === '' && Math.abs(en - Number(registradoEn)) <= VENTANA_RECLAMO_MS) {
    await redis.hset(KEY(conversacionId), campoPor, username);
  }
}

export async function registrarPrimeraRespuesta(
  conversacionId: number,
  username: string | null,
  respondidaEn = Date.now(),
): Promise<void> {
  await sinInterrumpir('la primera respuesta', async () => {
    await asegurarCreada(conversacionId, respondidaEn);
    const gano = await redis.hsetnx(KEY(conversacionId), 'primeraRespuestaEn', String(respondidaEn));
    if (gano) await redis.hset(KEY(conversacionId), 'primeraRespuestaPor', username ?? '');
    else if (username) await reclamarAutoria(conversacionId, 'primeraRespuestaEn', 'primeraRespuestaPor', username, respondidaEn);
    await redis.expire(KEY(conversacionId), TTL_SEGUNDOS);
  });
}

export async function registrarResolucion(
  conversacionId: number,
  username: string | null,
  resueltaEn = Date.now(),
): Promise<void> {
  await sinInterrumpir('la resolución', async () => {
    await asegurarCreada(conversacionId, resueltaEn);
    const gano = await redis.hsetnx(KEY(conversacionId), 'resueltaEn', String(resueltaEn));
    if (gano) await redis.hset(KEY(conversacionId), 'resueltaPor', username ?? '');
    else if (username) await reclamarAutoria(conversacionId, 'resueltaEn', 'resueltaPor', username, resueltaEn);
    await redis.expire(KEY(conversacionId), TTL_SEGUNDOS);
  });
}

export async function registrarReapertura(conversacionId: number): Promise<void> {
  await sinInterrumpir('la reapertura', async () => { await redis.hdel(KEY(conversacionId), 'resueltaEn', 'resueltaPor'); });
  await redis.expire(KEY(conversacionId), TTL_SEGUNDOS);
}

export async function registrarCsat(conversacionId: number, csat: number, csatEn = Date.now()): Promise<void> {
  if (!Number.isInteger(csat) || csat < 1 || csat > 5) return;
  await sinInterrumpir('la calificación', async () => {
    await asegurarCreada(conversacionId, csatEn);
    await redis.hset(KEY(conversacionId), { csat: String(csat), csatEn: String(csatEn) });
    await redis.expire(KEY(conversacionId), TTL_SEGUNDOS);
  });
}

export function parsearCalificacion(texto: string): number | null {
  const coincidencia = texto.match(/^\s*([1-5])(?:\s+estrellas?)?\s*$/i);
  return coincidencia ? Number(coincidencia[1]) : null;
}

export function encuestaVencida(preguntadaEn: number, ahora = Date.now()): boolean {
  return !Number.isFinite(preguntadaEn) || ahora - preguntadaEn > 2 * 60 * 60 * 1000;
}

export function mediana(valores: number[]): number | null {
  const ordenados = valores.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordenados.length) return null;
  const mitad = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[mitad] : (ordenados[mitad - 1] + ordenados[mitad]) / 2;
}

const redondear = (valor: number | null): number | null => valor === null ? null : Math.round(valor * 100) / 100;
const promedio = (valores: number[]): number | null => valores.length
  ? valores.reduce((total, valor) => total + valor, 0) / valores.length : null;

function fechaBogota(timestamp: number): string {
  return new Date(timestamp - OFFSET_BOGOTA_MS).toISOString().slice(0, 10);
}

export function periodoBogota(dias: 7 | 30 | 90, ahora = Date.now()): { desde: number; hasta: number } {
  const inicioHoy = Math.floor((ahora - OFFSET_BOGOTA_MS) / DIA_MS) * DIA_MS + OFFSET_BOGOTA_MS;
  return { desde: inicioHoy - (dias - 1) * DIA_MS, hasta: ahora };
}

export function armarInformeAtencion(
  hitos: HitosAtencion[],
  usuarios: Pick<PublicUser, 'username' | 'fullName'>[],
  dias: 7 | 30 | 90,
  ahora = Date.now(),
): InformeAtencion {
  const { desde, hasta } = periodoBogota(dias, ahora);
  const lista = hitos.filter((hito) => hito.creadaEn >= desde && hito.creadaEn <= hasta);
  const tiemposRespuesta = lista.filter((h) => !h.parcial && h.primeraRespuestaEn !== null && h.primeraRespuestaEn >= h.creadaEn)
    .map((h) => (h.primeraRespuestaEn! - h.creadaEn) / 60_000);
  const tiemposResolucion = lista.filter((h) => !h.parcial && h.resueltaEn !== null && h.resueltaEn >= h.creadaEn)
    .map((h) => (h.resueltaEn! - h.creadaEn) / 60_000);
  const calificaciones = lista.flatMap((h) => h.csat === null ? [] : [h.csat]);
  const distribucion = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const csat of calificaciones) distribucion[csat as 1 | 2 | 3 | 4 | 5]++;

  const claves = new Set<string>();
  for (const hito of lista) {
    if (hito.primeraRespuestaEn !== null) claves.add(hito.primeraRespuestaPor ?? 'chatwoot');
    if (hito.resueltaEn !== null) claves.add(hito.resueltaPor ?? 'chatwoot');
  }
  const nombres = new Map(usuarios.map((usuario) => [usuario.username.toLowerCase(), usuario.fullName]));
  const porAsesor = [...claves].map((clave) => {
    const esChatwoot = clave === 'chatwoot';
    const respuestas = lista.filter((h) => h.primeraRespuestaEn !== null && (h.primeraRespuestaPor ?? 'chatwoot') === clave);
    const resoluciones = lista.filter((h) => h.resueltaEn !== null && (h.resueltaPor ?? 'chatwoot') === clave);
    const tiemposR = respuestas.filter((h) => !h.parcial && h.primeraRespuestaEn! >= h.creadaEn)
      .map((h) => (h.primeraRespuestaEn! - h.creadaEn) / 60_000);
    const tiemposC = resoluciones.filter((h) => !h.parcial && h.resueltaEn! >= h.creadaEn)
      .map((h) => (h.resueltaEn! - h.creadaEn) / 60_000);
    const csat = resoluciones.flatMap((h) => h.csat === null ? [] : [h.csat]);
    return {
      username: esChatwoot ? null : clave,
      nombre: esChatwoot ? null : nombres.get(clave.toLowerCase()) ?? clave,
      respondidas: respuestas.length,
      resueltas: resoluciones.length,
      primeraRespuestaMedianaMin: redondear(mediana(tiemposR)),
      resolucionMedianaMin: redondear(mediana(tiemposC)),
      csatPromedio: redondear(promedio(csat)),
      csatRespuestas: csat.length,
    };
  }).sort((a, b) => (a.nombre ?? 'Chatwoot').localeCompare(b.nombre ?? 'Chatwoot', 'es'));

  const porDia: InformeAtencion['porDia'] = [];
  for (let dia = desde; dia <= hasta; dia += DIA_MS) {
    const fecha = fechaBogota(dia);
    porDia.push({
      fecha,
      recibidas: lista.filter((h) => fechaBogota(h.creadaEn) === fecha).length,
      resueltas: lista.filter((h) => h.resueltaEn !== null && fechaBogota(h.resueltaEn) === fecha).length,
    });
  }
  const parciales = lista.filter((h) => h.parcial).length;
  const notas = ['Los tiempos cuentan horas de reloj, no solo el horario de atención'];
  if (parciales) notas.push(`${parciales} conversaciones empezaron antes de que se registraran los tiempos y no cuentan en los promedios`);
  return {
    periodo: { dias, desde: fechaBogota(desde), hasta: fechaBogota(hasta) },
    totales: {
      recibidas: lista.length,
      respondidas: lista.filter((h) => h.primeraRespuestaEn !== null).length,
      resueltas: lista.filter((h) => h.resueltaEn !== null).length,
      sinResponder: lista.filter((h) => h.primeraRespuestaEn === null).length,
      primeraRespuestaMedianaMin: redondear(mediana(tiemposRespuesta)),
      resolucionMedianaMin: redondear(mediana(tiemposResolucion)),
      csatPromedio: redondear(promedio(calificaciones)),
      csatRespuestas: calificaciones.length,
      csatDistribucion: distribucion,
    },
    porAsesor,
    porDia,
    notas,
  };
}

export async function obtenerInformeAtencion(dias: 7 | 30 | 90, ahora = Date.now()): Promise<InformeAtencion> {
  const { desde, hasta } = periodoBogota(dias, ahora);
  const ids = await redis.zrangebyscore(INDEX_KEY, desde, hasta);
  const hashes = await Promise.all(ids.map((id) => redis.hgetall(KEY(Number(id)))));
  const hitos = hashes.flatMap((hash, i) => {
    const hito = desdeHash(Number(ids[i]), hash);
    return hito ? [hito] : [];
  });
  const { listUsers } = await import('./usersService');
  return armarInformeAtencion(hitos, await listUsers(), dias, ahora);
}

let cancelarRegistro: (() => void) | null = null;
let colaRegistro = Promise.resolve();

/** Se registra antes de consultar el equipo para no perder respuestas muy rápidas. */
export function iniciarRegistroHitos(): void {
  if (cancelarRegistro) return;
  cancelarRegistro = suscribirAtencion((evento: EventoAtencion) => {
    if (evento.tipo !== 'nueva') return;
    colaRegistro = colaRegistro.then(async () => {
      await registrarCreada(evento.conversacionId, null, evento.ts);
      const { obtenerConversacion } = await import('./chatwootAtencion');
      const { conversacion } = await obtenerConversacion(evento.conversacionId);
      const teamId = conversacion.equipo?.id;
      const area = teamId === Number(config.chatwoot.teamTiId) ? 'ti'
        : teamId === Number(config.chatwoot.teamAdmisionesId) ? 'admisiones' : null;
      if (area) await registrarCreada(evento.conversacionId, area, evento.ts);
    }).catch(() => console.error('[atencionInformes] no se pudo registrar una conversación nueva'));
  });
}
