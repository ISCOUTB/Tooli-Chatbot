/**
 * Ficha de seguimiento de un prospecto (CRM del panel de asesores).
 *
 * POR QUÉ EXISTE:
 *   Hasta ahora el CRM mostraba exactamente lo que el bot había capturado en la
 *   hoja de cálculo (nombre, correo, WhatsApp, programa de interés) y nada más.
 *   Un asesor que llamaba a alguien no tenía dónde anotar el resultado de esa
 *   llamada, ni cómo marcar en qué punto del embudo va cada persona, ni cómo
 *   repartirse los prospectos con el resto del equipo. Todo eso terminaba en un
 *   WhatsApp interno o en la cabeza de alguien.
 *
 * QUÉ ES REAL:
 *   Todo lo de este archivo. No depende de ninguna integración externa: la ficha
 *   vive en Redis junto al resto del estado del bot, indexada por teléfono (la
 *   única llave que comparten la hoja de prospectos y las conversaciones).
 *
 * QUÉ NO ES:
 *   No trae semestre ni carrera *actual* del estudiante — eso sigue necesitando
 *   el sistema académico de la universidad (docs/pendientes-panel-asesores.md §1).
 *   Lo que un asesor escriba a mano en una nota es una nota, no un dato del
 *   sistema, y la UI debe mostrarlo como tal.
 *
 * NOTA SOBRE TTL: a diferencia de `session:` o `activity:`, estas claves NO
 * expiran a propósito — son el historial de gestión del equipo. Se acotan por
 * tamaño (máximo de notas por ficha), no por tiempo.
 */

import Redis from 'ioredis';
import { config } from '../config';

const redis = new Redis(config.redis.url, { lazyConnect: true });

const FICHA_KEY = (phone: string) => `crm:${phone}`;
const INDEX_KEY = 'crm:index';
const MAX_NOTAS = 50;

export type EstadoProspecto = 'nuevo' | 'contactado' | 'interesado' | 'inscrito' | 'descartado';

export const ESTADOS_PROSPECTO: EstadoProspecto[] = [
  'nuevo',
  'contactado',
  'interesado',
  'inscrito',
  'descartado',
];

export interface NotaCrm {
  id: string;
  texto: string;
  /** username del asesor que la escribió */
  autor: string;
  ts: number;
}

export interface FichaCrm {
  phone: string;
  estado: EstadoProspecto;
  /** username del asesor responsable, si alguien lo tomó */
  asignadoA?: string;
  etiquetas: string[];
  notas: NotaCrm[];
  actualizadoEn: number;
  actualizadoPor?: string;
}

export function reescribirUsuarioEnFicha(ficha: FichaCrm, viejo: string, nuevo: string): FichaCrm {
  return {
    ...ficha,
    ...(ficha.asignadoA === viejo ? { asignadoA: nuevo } : {}),
    ...(ficha.actualizadoPor === viejo ? { actualizadoPor: nuevo } : {}),
    notas: ficha.notas.map((nota) => nota.autor === viejo ? { ...nota, autor: nuevo } : nota),
  };
}

export async function renombrarUsuarioEnCrm(viejo: string, nuevo: string): Promise<void> {
  const phones = await redis.smembers(INDEX_KEY);
  if (!phones.length) return;
  const raws = await redis.mget(phones.map(FICHA_KEY));
  const pipe = redis.pipeline();
  raws.forEach((raw, index) => {
    if (!raw) return;
    try {
      const ficha = JSON.parse(raw) as FichaCrm;
      const actualizada = reescribirUsuarioEnFicha(ficha, viejo, nuevo);
      if (JSON.stringify(actualizada) !== raw) pipe.set(FICHA_KEY(phones[index]), JSON.stringify(actualizada));
    } catch { /* Una ficha corrupta no debe bloquear las demás. */ }
  });
  await pipe.exec();
}

function fichaVacia(phone: string): FichaCrm {
  return { phone, estado: 'nuevo', etiquetas: [], notas: [], actualizadoEn: 0 };
}

export function normalizarPhone(raw: string): string {
  return String(raw ?? '').replace(/\D/g, '');
}

export async function getFicha(phone: string): Promise<FichaCrm> {
  const key = normalizarPhone(phone);
  const raw = await redis.get(FICHA_KEY(key));
  if (!raw) return fichaVacia(key);
  try {
    return { ...fichaVacia(key), ...(JSON.parse(raw) as FichaCrm), phone: key };
  } catch {
    return fichaVacia(key);
  }
}

/**
 * Todas las fichas que existen, como mapa teléfono → ficha.
 * El CRM del panel pinta decenas de tarjetas a la vez: pedir una ficha por
 * tarjeta sería un N+1 contra Redis, así que se trae todo de una.
 */
export async function getFichas(): Promise<Record<string, FichaCrm>> {
  const phones = await redis.smembers(INDEX_KEY);
  if (!phones.length) return {};

  const raws = await redis.mget(phones.map(FICHA_KEY));
  const out: Record<string, FichaCrm> = {};
  const huerfanos: string[] = [];

  raws.forEach((raw, i) => {
    if (!raw) {
      huerfanos.push(phones[i]);
      return;
    }
    try {
      out[phones[i]] = { ...fichaVacia(phones[i]), ...(JSON.parse(raw) as FichaCrm), phone: phones[i] };
    } catch {
      huerfanos.push(phones[i]);
    }
  });

  if (huerfanos.length) await redis.srem(INDEX_KEY, ...huerfanos);
  return out;
}

async function guardar(ficha: FichaCrm, autor: string): Promise<FichaCrm> {
  ficha.actualizadoEn = Date.now();
  ficha.actualizadoPor = autor;
  const pipe = redis.pipeline();
  pipe.set(FICHA_KEY(ficha.phone), JSON.stringify(ficha));
  pipe.sadd(INDEX_KEY, ficha.phone);
  await pipe.exec();
  return ficha;
}

export async function agregarNota(phone: string, texto: string, autor: string): Promise<FichaCrm> {
  const limpio = texto.trim();
  if (!limpio) throw new Error('La nota no puede estar vacía');
  if (limpio.length > 2000) throw new Error('La nota no puede superar 2000 caracteres');

  const ficha = await getFicha(phone);
  ficha.notas.unshift({
    id: `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    texto: limpio,
    autor,
    ts: Date.now(),
  });
  // Se acota por tamaño, no por tiempo: la ficha no debe crecer sin límite.
  if (ficha.notas.length > MAX_NOTAS) ficha.notas = ficha.notas.slice(0, MAX_NOTAS);

  return guardar(ficha, autor);
}

export async function eliminarNota(phone: string, notaId: string, autor: string): Promise<FichaCrm> {
  const ficha = await getFicha(phone);
  ficha.notas = ficha.notas.filter((n) => n.id !== notaId);
  return guardar(ficha, autor);
}

export async function setEstado(phone: string, estado: EstadoProspecto, autor: string): Promise<FichaCrm> {
  if (!ESTADOS_PROSPECTO.includes(estado)) throw new Error(`Estado inválido: ${estado}`);
  const ficha = await getFicha(phone);
  ficha.estado = estado;
  return guardar(ficha, autor);
}

/** Asignar a un asesor, o liberar la ficha pasando `null`. */
export async function setAsignado(phone: string, username: string | null, autor: string): Promise<FichaCrm> {
  const ficha = await getFicha(phone);
  if (username) ficha.asignadoA = username;
  else delete ficha.asignadoA;
  return guardar(ficha, autor);
}

export async function setEtiquetas(phone: string, etiquetas: string[], autor: string): Promise<FichaCrm> {
  const limpias = [...new Set(
    etiquetas
      .map((e) => String(e ?? '').trim())
      .filter((e) => e.length > 0 && e.length <= 30),
  )].slice(0, 10);

  const ficha = await getFicha(phone);
  ficha.etiquetas = limpias;
  return guardar(ficha, autor);
}
