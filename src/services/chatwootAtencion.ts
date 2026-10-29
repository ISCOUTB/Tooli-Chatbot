/**
 * Bandeja de atención del panel sobre la API de Chatwoot.
 *
 * Chatwoot sigue siendo donde viven las conversaciones con asesor: ahí las crea
 * el bot al pasar a la persona a un asesor, y desde ahí salen por WhatsApp
 * gracias al webhook (src/routes/chatwootWebhook.ts). Pero Chatwoot ya no se
 * edita ni se usa directamente: el asesor las atiende desde el panel. Este
 * módulo traduce la API de Chatwoot a la forma que usa el panel y comprueba que
 * cada conversación sea del inbox del bot antes de tocarla.
 */

import { config } from '../config';
import { chatwootApi } from './chatwootService';

export type EstadoAtencion = 'open' | 'pending' | 'resolved';
export const ESTADOS_ATENCION: readonly EstadoAtencion[] = ['open', 'pending', 'resolved'];

export type FiltroAsignado = 'mias' | 'sin_asignar' | 'todas';
export const FILTROS_ASIGNADO: readonly FiltroAsignado[] = ['mias', 'sin_asignar', 'todas'];

export type TipoMensaje = 'in' | 'out' | 'nota' | 'sistema';

export interface PersonaRef {
  id: number;
  nombre: string;
}

export interface ConversacionAtencion {
  id: number;
  estado: string;
  contacto: { nombre: string; telefono: string };
  asignado: PersonaRef | null;
  equipo: PersonaRef | null;
  etiquetas: string[];
  prioridad: string | null;
  noLeidos: number;
  ultimoMensaje: { texto: string; ts: number; tipo: TipoMensaje } | null;
  actividadTs: number;
}

export interface MensajeAtencion {
  id: number;
  tipo: TipoMensaje;
  texto: string;
  ts: number;
  autor: string | null;
  adjuntos: { tipo: string; url: string; nombre: string | null }[];
}

/** No existe o no es del inbox del bot: para el panel, es lo mismo. */
export class ConversacionNoEncontrada extends Error {}

/* ===== Traducción de la API de Chatwoot (funciones puras, con pruebas) ===== */

/** Chatwoot fecha en segundos; el panel trabaja en milisegundos. */
function aMs(valor: unknown): number {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? n * 1000 : n;
}

function persona(raw: any): PersonaRef | null {
  const id = Number(raw?.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { id, nombre: String(raw.available_name ?? raw.name ?? 'Sin nombre') };
}

/** Chatwoot usa números en /messages y textos en los webhooks: se aceptan ambos. */
export function tipoDeMensaje(raw: any): TipoMensaje {
  if (raw?.private === true) return 'nota';
  const t = raw?.message_type;
  if (t === 0 || t === 'incoming') return 'in';
  if (t === 1 || t === 'outgoing' || t === 3 || t === 'template') return 'out';
  return 'sistema';
}

export function mapMensaje(raw: any): MensajeAtencion {
  const adjuntos = (Array.isArray(raw?.attachments) ? raw.attachments : [])
    .map((a: any) => ({
      tipo: String(a?.file_type ?? 'file'),
      url: String(a?.data_url ?? a?.file_url ?? ''),
      nombre: a?.fallback_title ? String(a.fallback_title) : null,
    }))
    .filter((a: { url: string }) => /^https?:\/\//.test(a.url));
  return {
    id: Number(raw?.id) || 0,
    tipo: tipoDeMensaje(raw),
    texto: String(raw?.content ?? ''),
    ts: aMs(raw?.created_at),
    autor: raw?.sender ? String(raw.sender.available_name ?? raw.sender.name ?? '') || null : null,
    adjuntos,
  };
}

export function mapConversacion(raw: any): ConversacionAtencion {
  const sender = raw?.meta?.sender ?? {};
  const telefono = String(sender.phone_number ?? sender.identifier ?? '').replace(/\D/g, '');
  const mensajes = Array.isArray(raw?.messages) ? raw.messages : [];
  const ultimo = mensajes.length ? mapMensaje(mensajes[mensajes.length - 1]) : null;
  return {
    id: Number(raw?.id) || 0,
    estado: String(raw?.status ?? 'open'),
    contacto: { nombre: String(sender.name ?? '').trim() || (telefono ? `+${telefono}` : 'Sin nombre'), telefono },
    asignado: persona(raw?.meta?.assignee),
    equipo: persona(raw?.meta?.team),
    etiquetas: Array.isArray(raw?.labels) ? raw.labels.map(String) : [],
    prioridad: raw?.priority ? String(raw.priority) : null,
    noLeidos: Math.max(0, Number(raw?.unread_count) || 0),
    ultimoMensaje: ultimo ? { texto: ultimo.texto, ts: ultimo.ts, tipo: ultimo.tipo } : null,
    actividadTs: aMs(raw?.last_activity_at ?? raw?.timestamp),
  };
}

/** "Mías" usa el usuario de Chatwoot del asesor; sin él no hay nada que mostrar. */
export function filtrarPorAsignado(
  lista: ConversacionAtencion[],
  filtro: FiltroAsignado,
  miChatwootId: number | undefined,
): ConversacionAtencion[] {
  if (filtro === 'sin_asignar') return lista.filter((c) => !c.asignado);
  if (filtro === 'mias') return miChatwootId ? lista.filter((c) => c.asignado?.id === miChatwootId) : [];
  return lista;
}

export function contarPorAsignado(lista: ConversacionAtencion[], miChatwootId: number | undefined) {
  return {
    mias: filtrarPorAsignado(lista, 'mias', miChatwootId).length,
    sin_asignar: filtrarPorAsignado(lista, 'sin_asignar', miChatwootId).length,
    todas: lista.length,
  };
}

/* ===== Llamadas a Chatwoot ===== */

const POR_PAGINA = 25;
const MAX_PAGINAS = 4;

export function chatwootConfigurado(): boolean {
  return !!(config.chatwoot.url && config.chatwoot.apiToken && config.chatwoot.accountId);
}

function esDelInbox(raw: any): boolean {
  return !config.chatwoot.inboxId || String(raw?.inbox_id) === String(config.chatwoot.inboxId);
}

/**
 * Las conversaciones activas son pocas, así que se traen hasta 100 y se
 * filtran aquí: la API de Chatwoot solo sabe filtrar "mías" por el dueño del
 * token, que es el bot, no el asesor.
 */
export async function listarConversaciones(estado: EstadoAtencion): Promise<{ conversaciones: ConversacionAtencion[]; truncado: boolean }> {
  const crudas: any[] = [];
  let truncado = false;
  for (let page = 1; page <= MAX_PAGINAS; page++) {
    const r = await chatwootApi().get('/conversations', {
      params: { status: estado, assignee_type: 'all', page, ...(config.chatwoot.inboxId ? { inbox_id: config.chatwoot.inboxId } : {}) },
    });
    const payload: any[] = r.data?.data?.payload ?? [];
    crudas.push(...payload);
    if (payload.length < POR_PAGINA) break;
    if (page === MAX_PAGINAS) truncado = true;
  }
  const conversaciones = crudas.filter(esDelInbox).map(mapConversacion).sort((a, b) => b.actividadTs - a.actividadTs);
  return { conversaciones, truncado };
}

async function conversacionDelInbox(id: number): Promise<any> {
  try {
    const r = await chatwootApi().get(`/conversations/${id}`);
    if (!r.data?.id || !esDelInbox(r.data)) throw new ConversacionNoEncontrada();
    return r.data;
  } catch (err: any) {
    if (err instanceof ConversacionNoEncontrada || err?.response?.status === 404) throw new ConversacionNoEncontrada();
    throw err;
  }
}

/** Chatwoot entrega los mensajes de 20 en 20, del más viejo al más nuevo. */
export async function obtenerConversacion(id: number, antesDe?: number) {
  const raw = await conversacionDelInbox(id);
  const r = await chatwootApi().get(`/conversations/${id}/messages`, { params: antesDe ? { before: antesDe } : {} });
  const payload: any[] = r.data?.payload ?? [];
  return {
    conversacion: mapConversacion(raw),
    mensajes: payload.map(mapMensaje),
    hayAnteriores: payload.length >= 20,
  };
}

/** Deja la conversación como leída para todo el equipo, igual que al abrirla en Chatwoot. */
export async function marcarLeida(id: number): Promise<void> {
  await chatwootApi().post(`/conversations/${id}/update_last_seen`).catch(() => {});
}

/**
 * Un mensaje público queda en Chatwoot como respuesta del asesor y el webhook
 * lo entrega por WhatsApp: por eso NO se envía también desde aquí, o llegaría
 * dos veces. Una nota privada solo la ve el equipo.
 */
export async function enviarMensaje(id: number, texto: string, privado: boolean): Promise<ConversacionAtencion> {
  const raw = await conversacionDelInbox(id);
  await chatwootApi().post(`/conversations/${id}/messages`, { content: texto, message_type: 'outgoing', private: privado });
  return mapConversacion(raw);
}

/** Resolver dispara el webhook que cierra la sesión del bot y se lo avisa a la persona. */
export async function cambiarEstado(id: number, estado: EstadoAtencion): Promise<ConversacionAtencion> {
  const raw = await conversacionDelInbox(id);
  await chatwootApi().post(`/conversations/${id}/toggle_status`, { status: estado });
  return mapConversacion(raw);
}

/** `null` quita la asignación: Chatwoot la quita cuando el id no existe. */
export async function asignar(
  id: number,
  cambios: { asesorId?: number | null; equipoId?: number | null },
): Promise<ConversacionAtencion> {
  const raw = await conversacionDelInbox(id);
  if (cambios.equipoId !== undefined) {
    await chatwootApi().post(`/conversations/${id}/assignments`, { team_id: cambios.equipoId ?? 0 });
  }
  if (cambios.asesorId !== undefined) {
    await chatwootApi().post(`/conversations/${id}/assignments`, { assignee_id: cambios.asesorId ?? 0 });
  }
  return mapConversacion(raw);
}

export async function equipoAtencion() {
  const [agentes, equipos] = await Promise.all([
    chatwootApi().get('/agents').then((r) => (Array.isArray(r.data) ? r.data : [])),
    chatwootApi().get('/teams').then((r) => (Array.isArray(r.data) ? r.data : [])).catch(() => []),
  ]);
  return {
    agentes: agentes
      .map((a: any) => ({ ...persona(a), estado: String(a?.availability_status ?? 'offline') }))
      .filter((a: any) => a.id),
    equipos: equipos.map(persona).filter(Boolean) as PersonaRef[],
  };
}
