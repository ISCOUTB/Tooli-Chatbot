import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { describeError } from './logSafe';

let client: AxiosInstance | null = null;

function cw(): AxiosInstance {
  if (!client) {
    client = axios.create({
      baseURL: `${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}`,
      headers: { api_access_token: config.chatwoot.apiToken },
      timeout: 15_000,
    });
  }
  return client;
}

/** Cliente de la API de Chatwoot para otros módulos (la bandeja de atención). */
export function chatwootApi(): AxiosInstance {
  return cw();
}

export interface ChatwootContact {
  contactId: number;
  sourceId: string;
}

/**
 * Nombres que el bot pone cuando todavía no sabe cómo se llama la persona
 * (`Usuario 1234`, `Prospecto`) o que Chatwoot deja por defecto (el número).
 */
export function esNombreGenerico(nombre: string | null | undefined, phoneNumber: string): boolean {
  const n = (nombre ?? '').trim();
  return !n || n === 'Prospecto' || /^Usuario \d{4}$/.test(n) || n.replace(/\D/g, '') === phoneNumber;
}

/**
 * Busca un contacto por número de teléfono en el inbox o lo crea si no existe.
 * `phoneNumber` debe ser solo dígitos (E.164 sin el +), ej: "573215640735"
 * Si el contacto ya existía con un nombre genérico y ahora se conoce el real,
 * lo corrige: si no, el asesor lo vería como "Usuario 1234" para siempre.
 */
export async function getOrCreateContact(phoneNumber: string, name: string): Promise<ChatwootContact> {
  const inboxId = parseInt(config.chatwoot.inboxId);

  // 1. Buscar por identifier
  try {
    const search = await cw().get('/contacts/search', { params: { q: phoneNumber } });
    const existing = search.data?.payload?.find(
      (c: any) => c.identifier === phoneNumber || c.phone_number === `+${phoneNumber}`
    );

    if (existing) {
      if (esNombreGenerico(existing.name, phoneNumber) && !esNombreGenerico(name, phoneNumber)) {
        try {
          await cw().put(`/contacts/${existing.id}`, { name });
        } catch (err: unknown) {
          // No impide abrir la conversación: solo queda el nombre anterior.
          console.warn('[chatwoot] no se pudo actualizar el nombre del contacto:', describeError({ response: { status: axios.isAxiosError(err) ? err.response?.status : undefined } }));
        }
      }
      // Buscar contact_inbox para nuestro inbox
      const ci = await cw().get(`/contacts/${existing.id}/contactable_inboxes`);
      const inb = ci.data?.payload?.find((x: any) => x.inbox?.id === inboxId);
      if (inb?.source_id) {
        return { contactId: existing.id, sourceId: inb.source_id };
      }
      // No existe contact_inbox para este inbox → crearlo
      const newCi = await cw().post(`/contacts/${existing.id}/contact_inboxes`, {
        inbox_id: inboxId,
        source_id: phoneNumber,
      });
      return { contactId: existing.id, sourceId: newCi.data?.source_id ?? phoneNumber };
    }
  } catch (err: unknown) {
    console.error('[chatwoot] error buscando contacto:', describeError({ response: { status: axios.isAxiosError(err) ? err.response?.status : undefined } }));
  }

  // 2. Crear contacto nuevo
  const create = await cw().post('/contacts', {
    inbox_id: inboxId,
    name,
    phone_number: `+${phoneNumber}`,
    identifier: phoneNumber,
  });

  const contact = create.data?.payload?.contact;
  const contactInbox = create.data?.payload?.contact_inbox;
  if (!contact?.id) throw new Error('Chatwoot no devolvió contact.id');

  return {
    contactId: contact.id,
    sourceId: contactInbox?.source_id ?? phoneNumber,
  };
}

export interface CreateConversationOpts {
  sourceId: string;
  contactId: number;
  /** ID del Team al que asignar (Soporte TI o Soporte Admisiones) */
  teamId: number;
  /** Mensaje inicial visible para el asesor (resumen del caso) */
  initialMessage: string;
  /** Atributos extra que se ven en el panel del agente */
  customAttributes?: Record<string, string>;
  /** Etiquetas (labels) para clasificar */
  labels?: string[];
  /** Prioridad: low | medium | high | urgent */
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  /** Nota privada inicial (solo visible para asesores, no para el usuario) */
  privateNote?: string;
}

/**
 * Crea una conversación nueva en Chatwoot, asignada a un team.
 * Devuelve el conversation_id.
 */
export async function createConversation(opts: CreateConversationOpts): Promise<number> {
  const inboxId = parseInt(config.chatwoot.inboxId);

  const res = await cw().post('/conversations', {
    source_id: opts.sourceId,
    inbox_id: inboxId,
    contact_id: opts.contactId,
    team_id: opts.teamId,
    custom_attributes: opts.customAttributes ?? {},
    additional_attributes: opts.customAttributes ?? {},
    message: { content: opts.initialMessage, message_type: 'incoming' },
  });

  const conversationId: number | undefined = res.data?.id;
  if (!conversationId) throw new Error('Chatwoot no devolvió conversation.id');

  // Aplicar labels si hay
  if (opts.labels?.length) {
    await cw().post(`/conversations/${conversationId}/labels`, { labels: opts.labels }).catch(() => {});
  }

  // Setear priority si aplica
  if (opts.priority) {
    await cw()
      .post(`/conversations/${conversationId}/toggle_priority`, { priority: opts.priority })
      .catch(() => {});
  }

  // Agregar nota privada con el contexto del AI si aplica
  if (opts.privateNote) {
    await cw()
      .post(`/conversations/${conversationId}/messages`, {
        content: opts.privateNote,
        message_type: 'outgoing',
        private: true,
      })
      .catch(() => {});
  }

  return conversationId;
}

/**
 * Agrega una nota privada (solo visible para asesores) a una conversación existente.
 */
export async function addPrivateNote(conversationId: number, content: string): Promise<void> {
  await cw()
    .post(`/conversations/${conversationId}/messages`, {
      content,
      message_type: 'outgoing',
      private: true,
    })
    .catch(() => {});
}

/**
 * Envía un mensaje "incoming" (del usuario) a una conversación existente.
 * Esto es lo que se usa cuando el usuario sigue escribiendo y queremos
 * reenviarlo al asesor en Chatwoot.
 */
export async function sendIncomingMessage(conversationId: number, content: string): Promise<void> {
  await cw().post(`/conversations/${conversationId}/messages`, {
    content,
    message_type: 'incoming',
  });
}

/**
 * Marca una conversación como resuelta.
 */
export async function resolveConversation(conversationId: number): Promise<void> {
  await cw().post(`/conversations/${conversationId}/toggle_status`, { status: 'resolved' }).catch(() => {});
}

export interface ChatwootStats {
  open: number;
  unassigned: number;
  pending: number;
  resolvedToday: number;
  agents: Array<{ name: string; status: 'online' | 'busy' | 'offline'; assignedConversations: number }>;
}

/**
 * Trae contadores reales de Chatwoot (conversaciones abiertas, sin asignar,
 * pendientes, resueltas hoy) y el estado de los agentes conectados — para
 * mostrar un resumen en vivo en el panel de asesores sin tener que abrir
 * Chatwoot. Usa la misma API que ya consume el resto de este servicio.
 * Si Chatwoot no responde, no rompe el dashboard: devuelve ceros.
 */
export async function getConversationStats(): Promise<ChatwootStats> {
  const zero: ChatwootStats = { open: 0, unassigned: 0, pending: 0, resolvedToday: 0, agents: [] };
  try {
    const [openRes, unassignedRes, pendingRes, resolvedRes, agentsRes] = await Promise.all([
      cw().get('/conversations', { params: { status: 'open' } }),
      cw().get('/conversations', { params: { status: 'open', assignee_type: 'unassigned' } }),
      cw().get('/conversations', { params: { status: 'pending' } }),
      cw().get('/conversations', { params: { status: 'resolved' } }),
      cw().get('/agents').catch(() => ({ data: [] })),
    ]);

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const resolvedToday = (resolvedRes.data?.data?.payload ?? []).filter((c: any) => {
      const ts = (c.last_activity_at ?? c.updated_at ?? 0) * 1000;
      return ts >= todayStart.getTime();
    }).length;

    const agents = (agentsRes.data ?? []).map((a: any) => ({
      name: a.name ?? a.available_name ?? 'Agente',
      status: (a.availability_status ?? 'offline') as 'online' | 'busy' | 'offline',
      assignedConversations: a.assigned_conversations_count ?? 0,
    }));

    return {
      open: openRes.data?.data?.meta?.all_count ?? openRes.data?.data?.payload?.length ?? 0,
      unassigned: unassignedRes.data?.data?.meta?.all_count ?? unassignedRes.data?.data?.payload?.length ?? 0,
      pending: pendingRes.data?.data?.meta?.all_count ?? pendingRes.data?.data?.payload?.length ?? 0,
      resolvedToday,
      agents,
    };
  } catch (err: unknown) {
    console.error('[chatwoot] error obteniendo estadísticas:', describeError({ response: { status: axios.isAxiosError(err) ? err.response?.status : undefined } }));
    return zero;
  }
}

/**
 * Verifica si la fecha actual está dentro del horario de atención
 * Lunes a viernes, 8:00 AM – 8:00 PM hora de Bogotá (UTC-5).
 */
export function isWithinBusinessHours(now: Date = new Date()): boolean {
  const bogotaStr = now.toLocaleString('en-US', {
    timeZone: 'America/Bogota',
    hour12: false,
  });
  const bogota = new Date(bogotaStr);
  const day = bogota.getDay(); // 0=Dom, 6=Sáb
  if (day === 0 || day === 6) return false;
  const hour = bogota.getHours();
  return hour >= 8 && hour < 20;
}
