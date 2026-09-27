import { Router, Request, Response } from 'express';
import { parseMetaCloudWebhook } from '../webhooks/metaCloudParser';
import { claimMessageId } from '../services/session';
import { checkUserRateLimit } from '../services/rateLimit';
import { track } from '../services/metrics';
import { isBanned, recordActivity } from '../services/botUserService';
import { describeError, describeId, describeText, maskPhone } from '../services/logSafe';
import { config } from '../config';
import { messaging } from '../flows/shared';
import { handleMessage } from '../flows';
import { handleNutriaMessage } from '../flows/nutria';
import { handleEventoMessage } from '../flows/evento';
import { handlePosgradoMessage } from '../flows/posgrados-evento';

export const metaWebhookRouter = Router();

// ── GET: verificación del webhook requerida por Meta ──────────────────────────
metaWebhookRouter.get('/', (req: Request, res: Response) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.metaCloud.verifyToken) {
    console.log('[meta-webhook] verificación OK');
    res.status(200).send(challenge);
  } else {
    console.warn('[meta-webhook] verificación fallida — token no coincide');
    res.sendStatus(403);
  }
});

// ── POST: mensajes entrantes de Meta Cloud API ────────────────────────────────
metaWebhookRouter.post('/', async (req: Request, res: Response) => {
  // Meta requiere respuesta 200 inmediata o reintentará el envío
  res.sendStatus(200);

  console.log(
    '[meta-webhook] payload object:',
    req.body?.object,
    '| entry count:',
    req.body?.entry?.length ?? 0
  );

  const inbound = parseMetaCloudWebhook(req.body);

  if (!inbound) {
    console.log('[meta-webhook] parser returned null — ignorado (status/no-text)');
    return;
  }

  // Ver la nota en logSafe.ts: el contenido de la conversación no va al log.
  console.log('[meta-webhook] inbound:', {
    from: maskPhone(inbound.from),
    text: describeText(inbound.text),
    id: describeId(inbound.messageId),
  });

  const isNew = await claimMessageId(inbound.messageId);
  if (!isNew) {
    console.log('[meta-webhook] mensaje duplicado, ignorado:', describeId(inbound.messageId));
    await track('duplicate_message');
    return;
  }

  // En Meta Cloud API el `from` ya es el número E.164 real — no hay @lid
  const from = inbound.from;

  if (await isBanned(from)) {
    console.warn('[meta-webhook] usuario baneado, ignorando:', maskPhone(from));
    return;
  }

  await recordActivity(from, 'in', inbound.text);

  const limit = await checkUserRateLimit(from);
  if (!limit.allowed) {
    console.warn('[meta-webhook] rate limit alcanzado para', maskPhone(from));
    await track('rate_limited');
    if (limit.firstBlock) {
      await messaging
        .sendText({
          to: from,
          text: `⚠️ Estás enviando mensajes muy rápido. Espera ${limit.retryAfterSec}s e intenta de nuevo.`,
        })
        .catch(() => {});
    }
    return;
  }

  // ── Rutear al bot correcto según el número que recibió el mensaje ────────────
  const isNutria = config.nutria.phoneNumberId && inbound.phoneNumberId === config.nutria.phoneNumberId;

  if (isNutria) {
    handleNutriaMessage(from, inbound.text, inbound).catch(err => {
      console.error('[meta-webhook] error en handleNutriaMessage para', maskPhone(from), describeError(err));
    });
  } else if (config.evento.activo) {
    // Flujo temporal del evento Talento Tech (reemplaza el menú clásico mientras esté activo)
    handleEventoMessage(from, inbound.text, inbound).catch(err => {
      console.error('[meta-webhook] error en handleEventoMessage para', maskPhone(from), describeError(err));
    });
  } else if (config.posgradosEvento.activo) {
    // Flujo temporal del evento de Posgrados (sábado)
    handlePosgradoMessage(from, inbound.text, inbound).catch(err => {
      console.error('[meta-webhook] error en handlePosgradoMessage para', maskPhone(from), describeError(err));
    });
  } else {
    handleMessage(from, inbound.text).catch(err => {
      console.error('[meta-webhook] error en handleMessage para', maskPhone(from), describeError(err));
    });
  }
});
