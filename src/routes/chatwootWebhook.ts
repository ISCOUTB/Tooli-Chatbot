import { Router, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { MediaKind } from '../adapters/messaging/IMessagingAdapter';
import { getSession, setSession } from '../services/session';
import { describeError, maskPhone } from '../services/logSafe';
import { messaging } from '../flows/shared';
import { requireChatwootToken } from '../middleware/webhookAuth';
import { config } from '../config';
import { isLinkedSession, linkedChatwootTarget } from '../services/chatwootWebhookGuard';
import { enqueueInbound } from '../services/inboundInbox';
import { publicarAtencion } from '../services/atencionEventos';

export const chatwootWebhookRouter = Router();

interface ChatwootAttachment {
  file_type?: string;
  data_url?: string;
  file_url?: string;
  fallback_title?: string;
  extension?: string;
}

const FILE_TYPE_TO_KIND: Record<string, MediaKind> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  voice: 'audio',
  file: 'document',
};

chatwootWebhookRouter.post('/', requireChatwootToken, async (req: Request, res: Response) => {
  try {
    const event = req.body?.event;
    let eventKind: 'message' | 'resolved';
    if (event === 'message_created') {
      const attachments = Array.isArray(req.body?.attachments) ? req.body.attachments : [];
      if (req.body?.message_type !== 'outgoing' || req.body?.private === true ||
          (!req.body?.content && attachments.length === 0)) {
        res.sendStatus(200);
        return;
      }
      eventKind = 'message';
    } else if ((event === 'conversation_status_changed' || event === 'conversation_resolved') &&
               (req.body?.status ?? req.body?.conversation?.status) === 'resolved') {
      eventKind = 'resolved';
    } else {
      res.sendStatus(200);
      return;
    }
    const target = linkedChatwootTarget(req.body, config.chatwoot.accountId, config.chatwoot.inboxId, eventKind);
    if (!target) {
      console.warn('[chatwoot-webhook] evento ignorado: cuenta, inbox, contacto o conversación no coinciden');
      res.sendStatus(200);
      return;
    }
    const raw = JSON.stringify(req.body);
    const fingerprint = createHash('sha256').update(raw).digest('hex');
    const providerId = eventKind === 'message' && Number.isSafeInteger(Number(req.body?.id)) && Number(req.body.id) > 0
      ? `message:${req.body.id}` : `${eventKind}:${fingerprint}`;
    await enqueueInbound('chatwoot', {
      from: target.phone, phoneNumberId: config.chatwoot.accountId,
      messageId: providerId, text: raw, timestamp: Date.now(),
    });
    res.sendStatus(200);
  } catch (err) {
    console.error('[chatwoot-webhook] error:', describeError(err));
    res.sendStatus(503);
  }
});

/** El worker llama esta función tras confirmar la escritura en Redis. */
export async function forwardChatwootEvent(payload: any): Promise<void> {
  if (payload?.event === 'message_created') {
    await handleMessageCreated(payload);
  } else if (payload?.event === 'conversation_status_changed' || payload?.event === 'conversation_resolved') {
    await handleConversationResolved(payload);
  }
}

async function handleMessageCreated(payload: any): Promise<void> {
  const messageType = payload?.message_type;
  const isPrivate = payload?.private === true;
  const content: string | undefined = payload?.content;
  const attachments: ChatwootAttachment[] = payload?.attachments ?? [];

  if (messageType !== 'outgoing' || isPrivate) return;
  if (!content && attachments.length === 0) return;

  const target = linkedChatwootTarget(payload, config.chatwoot.accountId, config.chatwoot.inboxId, 'message');
  if (!target) {
    console.warn('[chatwoot-webhook] mensaje ignorado: cuenta, inbox, contacto o conversación no coinciden');
    return;
  }
  const { phone, conversationId } = target;
  // Los paneles abiertos se ponen al día aunque la respuesta no salga por
  // WhatsApp (por ejemplo, si la sesión del bot ya no está con el asesor).
  publicarAtencion({ tipo: 'mensaje', conversacionId: conversationId, entrante: false });
  const session = await getSession(phone);
  if (!isLinkedSession(session, conversationId)) return;

  console.log('[chatwoot-webhook] reenviando a WhatsApp:', maskPhone(phone), 'attachments:', attachments.length);

  const trimmedText = content?.trim();
  const hasAttachments = attachments.length > 0;

  if (!hasAttachments && trimmedText) {
    await messaging.sendText({ to: phone, text: `*Asesor:* ${trimmedText}` });
    return;
  }

  if (hasAttachments) {
    let captionUsed = false;
    for (const att of attachments) {
      const url = att.file_url ?? att.data_url;
      if (!url) continue;
      const kind = FILE_TYPE_TO_KIND[att.file_type ?? 'file'] ?? 'document';

      const captionForThis =
        !captionUsed && trimmedText
          ? `*Asesor:* ${trimmedText}`
          : undefined;
      if (captionForThis) captionUsed = true;

      try {
        await messaging.sendMediaFromUrl({
          to: phone,
          url,
          kind,
          fileName: att.fallback_title,
          caption: kind === 'audio' ? undefined : captionForThis,
        });
      } catch (err) {
        console.error('[chatwoot-webhook] error enviando attachment:', describeError(err));
        await messaging.sendText({
          to: phone,
          text: `*Asesor:* (envió un archivo que no pude entregar) ${url}`,
        });
      }
    }

    if (trimmedText && !captionUsed) {
      await messaging.sendText({ to: phone, text: `*Asesor:* ${trimmedText}` });
    }
  }
}

async function handleConversationResolved(payload: any): Promise<void> {
  const status = payload?.status ?? payload?.conversation?.status;
  if (status !== 'resolved') return;

  const target = linkedChatwootTarget(payload, config.chatwoot.accountId, config.chatwoot.inboxId, 'resolved');
  if (!target) return;
  const { phone, conversationId } = target;
  publicarAtencion({ tipo: 'estado', conversacionId: conversationId });
  const session = await getSession(phone);
  if (!isLinkedSession(session, conversationId)) return;
  await setSession(phone, { step: 'menu', data: {} });

  await messaging.sendText({
    to: phone,
    text: '✅ La conversación con el asesor fue cerrada.\n\nEscribe *menu* para volver al inicio.',
  });
}
