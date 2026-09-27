import { Router, Request, Response } from 'express';
import { MediaKind } from '../adapters/messaging/IMessagingAdapter';
import { getSession, setSession } from '../services/session';
import { describeError, maskPhone } from '../services/logSafe';
import { messaging } from '../flows/shared';

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

chatwootWebhookRouter.post('/', async (req: Request, res: Response) => {
  res.sendStatus(200);

  try {
    const event = req.body?.event;

    if (event === 'message_created') {
      await handleMessageCreated(req.body);
      return;
    }

    if (event === 'conversation_status_changed' || event === 'conversation_resolved') {
      await handleConversationResolved(req.body);
      return;
    }
  } catch (err) {
    console.error('[chatwoot-webhook] error:', describeError(err));
  }
});

async function handleMessageCreated(payload: any): Promise<void> {
  const messageType = payload?.message_type;
  const isPrivate = payload?.private === true;
  const content: string | undefined = payload?.content;
  const attachments: ChatwootAttachment[] = payload?.attachments ?? [];

  if (messageType !== 'outgoing' || isPrivate) return;
  if (!content && attachments.length === 0) return;

  const phone =
    payload?.conversation?.meta?.sender?.identifier ??
    payload?.sender?.identifier;

  const conversationId =
    payload?.conversation?.id ??
    payload?.conversation_id;

  if (!phone) {
    console.warn('[chatwoot-webhook] mensaje outgoing sin identifier de contacto');
    return;
  }

  console.log('[chatwoot-webhook] reenviando a WhatsApp:', maskPhone(phone), 'attachments:', attachments.length);

  if (conversationId) {
    await setSession(phone, {
      step: 'with_agent',
      data: { conversationId: String(conversationId) },
    });
  }

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

  const phone =
    payload?.meta?.sender?.identifier ??
    payload?.conversation?.meta?.sender?.identifier;

  if (!phone) return;

  const session = await getSession(phone);
  if (session?.step === 'with_agent') {
    await setSession(phone, { step: 'menu', data: {} });
  }

  await messaging.sendText({
    to: phone,
    text: '✅ La conversación con el asesor fue cerrada.\n\nEscribe *menu* para volver al inicio.',
  });
}
