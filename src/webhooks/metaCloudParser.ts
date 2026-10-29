import { z } from 'zod';
import { InboundMessage } from '../adapters/messaging/IMessagingAdapter';

// ── Esquemas Zod ──────────────────────────────────────────────────────────────

const MetaTextMessageSchema = z.object({
  type: z.literal('text'),
  text: z.object({ body: z.string() }),
});

const MetaInteractiveSchema = z.object({
  type: z.literal('interactive'),
  interactive: z.union([
    z.object({
      type: z.literal('button_reply'),
      button_reply: z.object({ id: z.string(), title: z.string() }),
    }),
    z.object({
      type: z.literal('list_reply'),
      list_reply: z.object({ id: z.string(), title: z.string() }),
    }),
  ]),
});

const MetaImageMessageSchema = z.object({
  type: z.literal('image'),
  image: z.object({ id: z.string(), mime_type: z.string().optional() }),
});

// Toque en un botón de respuesta rápida de una PLANTILLA (los mensajes que
// inicia el bot). Meta no lo manda como `interactive` sino como `button`.
const MetaTemplateButtonSchema = z.object({
  type: z.literal('button'),
  button: z.object({ payload: z.string().optional(), text: z.string() }),
});

const MetaMessageSchema = z.union([
  MetaTextMessageSchema, MetaInteractiveSchema, MetaImageMessageSchema, MetaTemplateButtonSchema,
]).and(
  z.object({
    from: z.string(),
    id: z.string(),
    timestamp: z.string(),
  })
);

const MetaWebhookSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          value: z.object({
            messaging_product: z.literal('whatsapp'),
            metadata: z.object({
              display_phone_number: z.string(),
              phone_number_id: z.string(),
            }),
            // Un webhook puede mezclar texto con tipos no soportados. Validar
            // cada mensaje aparte evita perder los demás por un audio/sticker.
            messages: z.array(z.unknown()).optional(),
            statuses: z.array(z.unknown()).optional(),
          }),
          field: z.string(),
        })
      ),
    })
  ),
});

export type MetaWebhookPayload = z.infer<typeof MetaWebhookSchema>;

// ── Parser ────────────────────────────────────────────────────────────────────

/**
 * Parsea el body de un webhook de Meta WhatsApp Cloud API.
 * Devuelve todos los mensajes manejables del payload en orden de entrega.
 */
export function parseMetaCloudWebhooks(body: unknown): InboundMessage[] {
  const result = MetaWebhookSchema.safeParse(body);
  if (!result.success) return [];

  const inbound: InboundMessage[] = [];

  for (const entry of result.data.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;
      const messages = change.value.messages ?? [];

      for (const rawMsg of messages) {
        const parsed = MetaMessageSchema.safeParse(rawMsg);
        if (!parsed.success) continue;
        const msg = parsed.data;
        let text: string | undefined;

        let mediaId: string | undefined;
        let mediaType: string | undefined;

        if (msg.type === 'text') {
          text = msg.text.body;
        } else if (msg.type === 'interactive') {
          if (msg.interactive.type === 'button_reply') {
            text = msg.interactive.button_reply.id;
          } else if (msg.interactive.type === 'list_reply') {
            text = msg.interactive.list_reply.id;
          }
        } else if (msg.type === 'button') {
          // Sin payload definido al enviar, Meta repite el texto del botón.
          text = msg.button.payload || msg.button.text;
        } else if (msg.type === 'image') {
          text = '__image__';
          mediaId = msg.image.id;
          mediaType = 'image';
        }

        if (!text) continue; // audio, sticker — ignorar

        inbound.push({
          from: msg.from,
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

  return inbound;
}

/** Compatibilidad con consumidores que solo necesitan el primer mensaje. */
export function parseMetaCloudWebhook(body: unknown): InboundMessage | null {
  return parseMetaCloudWebhooks(body)[0] ?? null;
}
