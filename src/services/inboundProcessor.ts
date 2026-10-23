import type { InboundMessage } from '../adapters/messaging/IMessagingAdapter';
import { config } from '../config';
import { handleMessage } from '../flows';
import { handleEventoMessage } from '../flows/evento';
import { handleNutriaMessage } from '../flows/nutria';
import { handleVoluntarioMessage } from '../flows/voluntarios';
import { handlePosgradoMessage } from '../flows/posgrados-evento';
import { messaging } from '../flows/shared';
import { checkUserRateLimit } from './rateLimit';
import { isBanned, recordActivity } from './botUserService';
import { track } from './metrics';
import { maskPhone } from './logSafe';

export type InboundSource = 'meta' | 'evolution' | 'chatwoot';

/** Ejecutado por el inbox, nunca por el webhook HTTP después del ACK. */
export async function processInboundMessage(
  source: InboundSource, inbound: InboundMessage,
): Promise<'handled' | 'ignored'> {
  if (source === 'chatwoot') {
    const { forwardChatwootEvent } = await import('../routes/chatwootWebhook');
    await forwardChatwootEvent(JSON.parse(inbound.text));
    return 'handled';
  }
  const from = source === 'meta' ? inbound.from : await messaging.resolveSenderId(inbound.from);
  if (from.endsWith('@lid')) {
    console.warn('[inbound] número @lid sin resolver:', maskPhone(from));
    return 'ignored';
  }
  if (await isBanned(from)) return 'ignored';

  await recordActivity(from, 'in', inbound.text);
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

  if (source === 'meta' && config.nutria.phoneNumberId &&
      inbound.phoneNumberId === config.nutria.phoneNumberId) {
    if (config.voluntarios.activo) {
      await handleVoluntarioMessage(from, inbound.text, inbound);
    } else {
      await handleNutriaMessage(from, inbound.text, inbound);
    }
  } else if (config.evento.activo) {
    await handleEventoMessage(from, inbound.text, inbound);
  } else if (config.posgradosEvento.activo) {
    await handlePosgradoMessage(from, inbound.text, inbound);
  } else {
    await handleMessage(from, inbound.text);
  }
  return 'handled';
}
