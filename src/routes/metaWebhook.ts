import { Router, Request, Response } from 'express';
import { parseMetaCloudWebhookResult } from '../webhooks/metaCloudParser';
import { enqueueInbound } from '../services/inboundInbox';
import { describeExternalError } from '../services/logSafe';
import { config } from '../config';
import { requireMetaSignature } from '../middleware/webhookAuth';

export const metaWebhookRouter = Router();

metaWebhookRouter.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === config.metaCloud.verifyToken) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// La firma se valida antes de tocar Redis. Se responde 200 solo cuando todos
// los mensajes manejables del payload ya quedaron en el inbox durable.
metaWebhookRouter.post('/', requireMetaSignature, async (req: Request, res: Response) => {
  const parsed = parseMetaCloudWebhookResult(req.body);
  const inbound = parsed.mensajes;
  try {
    let accepted = 0;
    for (const message of inbound) {
      if (await enqueueInbound('meta', message)) accepted++;
    }
    const extras = [
      parsed.estados ? `${parsed.estados} estados` : '',
      parsed.sinTelefono ? `${parsed.sinTelefono} sin teléfono (BSUID)` : '',
      parsed.descartados.length ? `descartados: ${parsed.descartados.join(', ')}` : '',
    ].filter(Boolean).join(' · ');
    console.log(`[meta-webhook] ${accepted}/${inbound.length} mensajes nuevos en inbox${extras ? ` · ${extras}` : ''}`);
    res.sendStatus(200);
  } catch (err) {
    // Meta reintentará el payload. Los mensajes ya escritos se deduplican
    // atómicamente por ID al volver a recibirlo.
    console.error('[meta-webhook] no se pudo persistir:', describeExternalError(err));
    res.sendStatus(503);
  }
});
