import { z } from 'zod';
import { InboundMessage } from '../adapters/messaging/IMessagingAdapter';

const MetaMessageSchema = z.object({
  from: z.string().optional(),
  from_user_id: z.string().optional(),
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  interactive: z.any().optional(),
  button: z.object({ payload: z.string().optional(), text: z.string() }).optional(),
  image: z.object({ id: z.string(), mime_type: z.string().optional() }).optional(),
}).passthrough();

const MetaContactSchema = z.object({
  wa_id: z.string().optional(),
  user_id: z.string().optional(),
  profile: z.object({ name: z.string().optional(), username: z.string().optional() }).optional(),
}).passthrough();

const MetaWebhookSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(z.object({
    id: z.string(),
    changes: z.array(z.object({
      value: z.object({
        messaging_product: z.literal('whatsapp'),
        metadata: z.object({ display_phone_number: z.string(), phone_number_id: z.string() }),
        messages: z.array(z.unknown()).optional(),
        contacts: z.array(MetaContactSchema).optional(),
        statuses: z.array(z.unknown()).optional(),
        errors: z.array(z.object({ code: z.union([z.string(), z.number()]) }).passthrough()).optional(),
      }),
      field: z.string(),
    })),
  })),
});

export type MetaWebhookPayload = z.infer<typeof MetaWebhookSchema>;
export interface MetaCloudParseResult {
  mensajes: InboundMessage[];
  estados: number;
  sinTelefono: number;
  descartados: string[];
}

const UNSUPPORTED = new Set(['audio', 'voice', 'sticker', 'video', 'document', 'location', 'contacts', 'unsupported']);

/** Parsea mensajes y devuelve además contadores seguros para observabilidad. */
export function parseMetaCloudWebhookResult(body: unknown): MetaCloudParseResult {
  const result = MetaWebhookSchema.safeParse(body);
  if (!result.success) return { mensajes: [], estados: 0, sinTelefono: 0, descartados: [] };
  const output: MetaCloudParseResult = { mensajes: [], estados: 0, sinTelefono: 0, descartados: [] };

  for (const entry of result.data.entry) {
    for (const change of entry.changes) {
      output.estados += change.value.statuses?.length ?? 0;
      output.descartados.push(...(change.value.errors ?? []).map(error => String(error.code)));
      if (change.field !== 'messages') continue;

      // Cada mensaje se valida aparte para no perder los demás por un audio o sticker.
      for (const raw of change.value.messages ?? []) {
        const parsed = MetaMessageSchema.safeParse(raw);
        if (!parsed.success) {
          const type = typeof raw === 'object' && raw && 'type' in raw ? String(raw.type) : 'invalido';
          output.descartados.push(type);
          continue;
        }
        const msg = parsed.data;
        if (msg.type === 'reaction' || msg.type === 'system') {
          output.descartados.push(msg.type);
          continue;
        }
        if (!msg.from && msg.from_user_id) {
          output.sinTelefono++;
        }
        const from = msg.from ?? msg.from_user_id;
        if (!from) {
          output.descartados.push(`${msg.type}:sin-from:sin-from_user_id`);
          continue;
        }

        let text: string | undefined;
        let mediaId: string | undefined;
        let mediaType: string | undefined;
        if (msg.type === 'text') text = msg.text?.body;
        else if (msg.type === 'interactive') {
          const interactive = msg.interactive;
          if (interactive?.type === 'button_reply') text = interactive.button_reply?.id;
          if (interactive?.type === 'list_reply') text = interactive.list_reply?.id;
        // `button` es el toque en una respuesta rápida de una plantilla; Meta no lo manda como `interactive`.
        } else if (msg.type === 'button') {
          // Sin payload definido al enviar, Meta repite el texto del botón.
          text = msg.button?.payload || msg.button?.text;
        }
        else if (msg.type === 'image') {
          text = '__image__'; mediaId = msg.image?.id; mediaType = 'image';
        } else if (UNSUPPORTED.has(msg.type)) {
          text = '__unsupported__'; mediaType = msg.type;
        }
        if (!text) {
          output.descartados.push(msg.type);
          continue;
        }

        const contact = (change.value.contacts ?? []).find(candidate =>
          candidate.wa_id === msg.from || candidate.user_id === msg.from_user_id ||
          candidate.wa_id === from || candidate.user_id === from);
        output.mensajes.push({
          from,
          userId: msg.from_user_id,
          username: contact?.profile?.username,
          profileName: contact?.profile?.name,
          messageId: msg.id,
          text,
          timestamp: parseInt(msg.timestamp, 10),
          phoneNumberId: change.value.metadata.phone_number_id,
          mediaId,
          mediaType,
        });
      }
    }
  }
  return output;
}

/** Parsea todos los mensajes válidos incluidos en el webhook. */
export function parseMetaCloudWebhooks(body: unknown): InboundMessage[] {
  return parseMetaCloudWebhookResult(body).mensajes;
}

/** Compatibilidad con consumidores que solo necesitan el primer mensaje. */
export function parseMetaCloudWebhook(body: unknown): InboundMessage | null {
  return parseMetaCloudWebhooks(body)[0] ?? null;
}
