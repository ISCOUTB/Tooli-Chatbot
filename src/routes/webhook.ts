import { Router, Request, Response } from 'express';
import { parseEvolutionWebhook } from '../webhooks/evolutionParser';
import { enqueueInbound } from '../services/inboundInbox';
import { describeExternalError } from '../services/logSafe';
import { config } from '../config';

export const webhookRouter = Router();

webhookRouter.post(['/', '/:event'], async (req: Request, res: Response) => {
  if (req.body?.apikey !== config.webhookSecret) {
    res.sendStatus(401);
    return;
  }
  const inbound = parseEvolutionWebhook(req.body);
  if (!inbound) {
    res.sendStatus(200);
    return;
  }
  try {
    const accepted = await enqueueInbound('evolution', inbound);
    console.log(`[webhook] mensaje ${accepted ? 'nuevo' : 'duplicado'} en inbox`);
    res.sendStatus(200);
  } catch (err) {
    console.error('[webhook] no se pudo persistir:', describeExternalError(err));
    res.sendStatus(503);
  }
});
