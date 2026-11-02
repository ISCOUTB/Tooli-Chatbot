import type { InboundMessage } from '../adapters/messaging/IMessagingAdapter';
import { config } from '../config';
import { handleMessage } from '../flows';
import { handlePosgradoMessage } from '../flows/posgrados-evento';
import { messaging } from '../flows/shared';
import { checkUserRateLimit } from './rateLimit';
import { isBanned, recordActivity } from './botUserService';
import { track } from './metrics';
import { maskPhone } from './logSafe';
import { resolveWhatsAppContact } from './whatsappContactService';
import { getSession } from './session';
import { iniciarRecomendacion } from '../flows/recomendacion';

export type InboundSource = 'meta' | 'evolution' | 'chatwoot';

function describeUnsupportedMedia(mediaType?: string): string {
  return mediaType === 'audio' || mediaType === 'voice' ? 'un audio'
    : mediaType === 'sticker' ? 'un sticker'
    : mediaType === 'video' ? 'un video'
    : mediaType === 'document' ? 'un documento'
    : mediaType === 'location' ? 'una ubicación'
    : mediaType === 'contacts' ? 'un contacto'
    : 'un mensaje que WhatsApp no deja leer';
}

/** Ejecutado por el inbox, nunca por el webhook HTTP después del ACK. */
export async function processInboundMessage(
  source: InboundSource, inbound: InboundMessage,
): Promise<'handled' | 'ignored'> {
  if (source === 'chatwoot') {
    const { forwardChatwootEvent } = await import('../routes/chatwootWebhook');
    await forwardChatwootEvent(JSON.parse(inbound.text));
    return 'handled';
  }
  const from = source === 'meta'
    ? await resolveWhatsAppContact(inbound)
    : await messaging.resolveSenderId(inbound.from);
  if (from.endsWith('@lid')) {
    console.warn('[inbound] número @lid sin resolver:', maskPhone(from));
    return 'ignored';
  }
  if (await isBanned(from)) return 'ignored';

  await recordActivity(
    from,
    'in',
    inbound.text === '__unsupported__'
      ? `📎 Envió ${describeUnsupportedMedia(inbound.mediaType)}`
      : inbound.text,
  );
  const limit = await checkUserRateLimit(from);
  if (!limit.allowed) {
    await track('rate_limited');
    if (limit.firstBlock) {
      await messaging.sendText({
        to: from,
        text: `⚠️ Estás enviando mensajes muy rápido. Espera ${limit.retryAfterSec}s e intenta de nuevo.`,
      });
    }
    return 'ignored';
  }

  if (inbound.text === '__unsupported__') {
    const session = await getSession(from);
    if (session?.step === 'with_agent') {
      const tipo = describeUnsupportedMedia(inbound.mediaType);
      await handleMessage(from, `📎 Envió ${tipo} (el bot todavía no reenvía este tipo de mensaje)`);
      await messaging.sendText({
        to: from,
        text: 'Tu asesor por ahora solo recibe texto 🙏 Escríbele tu mensaje.',
      });
      return 'handled';
    }
    await messaging.sendText({
      to: from,
      text: 'Por ahora solo puedo leer mensajes de texto 🙏 Escríbeme lo que necesitas.',
    });
    if (!session) await iniciarRecomendacion(from);
    return 'handled';
  }

  if (config.posgradosEvento.activo) {
    await handlePosgradoMessage(from, inbound.text, inbound);
  } else {
    await handleMessage(from, inbound.text);
  }
  return 'handled';
}
