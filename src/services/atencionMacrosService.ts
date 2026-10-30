/** Macros compartidas por el equipo de atención, independientes de Chatwoot. */

import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { config } from '../config';
import { EstadoAtencion, normalizarEtiquetas, ValidacionEtiquetasError } from './chatwootAtencion';

// La conexión se abre al usar persistencia; importar los validadores puros no
// debe dejar un socket abierto en sus pruebas unitarias.
const redis = new Redis(config.redis.url, { lazyConnect: true });
const KEY = 'atencion_macros';
const MAX_MACROS = 40;

export interface AccionesMacro {
  nota?: string;
  mensaje?: string;
  etiquetas?: string[];
  equipoId?: number | null;
  asesorId?: number | 'yo' | null;
  estado?: EstadoAtencion;
}

export interface Macro {
  id: string;
  nombre: string;
  acciones: AccionesMacro;
  creadoPor: string;
  creadoEn: number;
}

export type TipoPasoMacro = 'nota' | 'mensaje' | 'etiquetas' | 'equipo' | 'asesor' | 'estado';
export interface PasoMacro { tipo: TipoPasoMacro; valor: string | string[] | number | null }

export class AtencionMacroError extends Error {}

function idPositivo(valor: unknown): number | null {
  const id = Number(valor);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Devuelve únicamente datos validados, para no persistir campos inesperados. */
export function normalizarMacro(input: unknown): { nombre: string; acciones: AccionesMacro } {
  if (!input || typeof input !== 'object') throw new AtencionMacroError('La macro no es válida.');
  const raw = input as Record<string, unknown>;
  const nombre = typeof raw.nombre === 'string' ? raw.nombre.trim() : '';
  if (nombre.length < 1 || nombre.length > 60) throw new AtencionMacroError('El nombre debe tener entre 1 y 60 caracteres.');
  if (!raw.acciones || typeof raw.acciones !== 'object' || Array.isArray(raw.acciones)) {
    throw new AtencionMacroError('La macro debe incluir al menos una acción.');
  }

  const origen = raw.acciones as Record<string, unknown>;
  const acciones: AccionesMacro = {};
  if ('nota' in origen) {
    if (typeof origen.nota !== 'string' || !origen.nota.trim() || origen.nota.trim().length > 2000) {
      throw new AtencionMacroError('La nota debe tener entre 1 y 2000 caracteres.');
    }
    acciones.nota = origen.nota.trim();
  }
  if ('mensaje' in origen) {
    if (typeof origen.mensaje !== 'string' || !origen.mensaje.trim() || origen.mensaje.trim().length > 4096) {
      throw new AtencionMacroError('El mensaje debe tener entre 1 y 4096 caracteres.');
    }
    acciones.mensaje = origen.mensaje.trim();
  }
  if ('etiquetas' in origen) {
    try {
      const etiquetas = normalizarEtiquetas(origen.etiquetas);
      if (!etiquetas.length) throw new AtencionMacroError('La acción de etiquetas debe incluir al menos una etiqueta.');
      acciones.etiquetas = etiquetas;
    } catch (err) {
      if (err instanceof AtencionMacroError) throw err;
      if (err instanceof ValidacionEtiquetasError) throw new AtencionMacroError(err.message);
      throw err;
    }
  }
  if ('equipoId' in origen) {
    if (origen.equipoId !== null && !idPositivo(origen.equipoId)) throw new AtencionMacroError('El equipo no es válido.');
    acciones.equipoId = origen.equipoId === null ? null : idPositivo(origen.equipoId)!;
  }
  if ('asesorId' in origen) {
    if (origen.asesorId !== null && origen.asesorId !== 'yo' && !idPositivo(origen.asesorId)) {
      throw new AtencionMacroError('El asesor no es válido.');
    }
    acciones.asesorId = origen.asesorId === null || origen.asesorId === 'yo' ? origen.asesorId : idPositivo(origen.asesorId)!;
  }
  if ('estado' in origen) {
    if (origen.estado !== 'open' && origen.estado !== 'pending' && origen.estado !== 'resolved') {
      throw new AtencionMacroError('El estado no es válido.');
    }
    acciones.estado = origen.estado;
  }
  if (!planMacro(acciones).length) throw new AtencionMacroError('La macro debe incluir al menos una acción.');
  return { nombre, acciones };
}

/** El plan fija el orden contractual independientemente del orden del JSON. */
export function planMacro(acciones: AccionesMacro): PasoMacro[] {
  const pasos: PasoMacro[] = [];
  if (acciones.nota !== undefined) pasos.push({ tipo: 'nota', valor: acciones.nota });
  if (acciones.mensaje !== undefined) pasos.push({ tipo: 'mensaje', valor: acciones.mensaje });
  if (acciones.etiquetas !== undefined) pasos.push({ tipo: 'etiquetas', valor: acciones.etiquetas });
  if (acciones.equipoId !== undefined) pasos.push({ tipo: 'equipo', valor: acciones.equipoId });
  if (acciones.asesorId !== undefined) pasos.push({ tipo: 'asesor', valor: acciones.asesorId });
  if (acciones.estado !== undefined) pasos.push({ tipo: 'estado', valor: acciones.estado });
  return pasos;
}

export function reemplazarNombre(texto: string, nombre: string | null | undefined): string {
  const primero = (nombre ?? '').trim().split(/\s+/)[0] ?? '';
  if (primero) return texto.replace(/\{nombre\}/gi, primero);
  return texto
    .replace(/\s*\{nombre\}\s*,?/gi, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/,([.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export async function listarMacros(): Promise<Macro[]> {
  const raw = await redis.get(KEY);
  if (!raw) return [];
  try {
    const lista = JSON.parse(raw);
    return Array.isArray(lista) ? lista as Macro[] : [];
  } catch {
    console.error('[atencionMacros] JSON corrupto en Redis');
    return [];
  }
}

export async function buscarMacro(id: string): Promise<Macro | null> {
  return (await listarMacros()).find((macro) => macro.id === id) ?? null;
}

export async function crearMacro(input: unknown, creadoPor: string): Promise<Macro> {
  const normalizada = normalizarMacro(input);
  const lista = await listarMacros();
  if (lista.length >= MAX_MACROS) throw new AtencionMacroError(`Máximo ${MAX_MACROS} macros.`);
  if (lista.some((macro) => macro.nombre.localeCompare(normalizada.nombre, 'es', { sensitivity: 'accent' }) === 0)) {
    throw new AtencionMacroError('Ya existe una macro con ese nombre.');
  }
  const macro: Macro = { id: randomUUID(), ...normalizada, creadoPor, creadoEn: Date.now() };
  await redis.set(KEY, JSON.stringify([...lista, macro]));
  return macro;
}

export async function eliminarMacro(id: string): Promise<boolean> {
  const lista = await listarMacros();
  const filtrada = lista.filter((macro) => macro.id !== id);
  if (filtrada.length === lista.length) return false;
  await redis.set(KEY, JSON.stringify(filtrada));
  return true;
}

export async function renombrarUsuarioEnMacros(viejo: string, nuevo: string): Promise<void> {
  const raw = await redis.get(KEY);
  if (!raw) return;
  const lista = JSON.parse(raw) as Macro[];
  let cambio = false;
  const actualizada = lista.map((macro) => {
    if (macro.creadoPor !== viejo) return macro;
    cambio = true;
    return { ...macro, creadoPor: nuevo };
  });
  if (cambio) await redis.set(KEY, JSON.stringify(actualizada), 'KEEPTTL');
}
