/** Revisión explícita de mensajes entrantes cuyo resultado es incierto. */
import { Router, Response } from 'express';
import { AuthedRequest, requireAdmin } from '../../middleware/auth';
import { logAudit } from '../../services/auditService';
import { listInboundReviews, resolveInboundReview } from '../../services/inboundInbox';
import { describeExternalError } from '../../services/logSafe';

export const inboundRouter = Router();

inboundRouter.get('/inbound/reviews', requireAdmin, async (req: AuthedRequest, res: Response) => {
  try {
    const limit = Math.max(1, Math.min(200, Number.parseInt(String(req.query.limit ?? '100'), 10) || 100));
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ reviews: await listInboundReviews(limit) });
  } catch (err) {
    console.error('[tools/inbound] no se pudo listar:', describeExternalError(err));
    res.status(503).json({ error: 'inbox_unavailable' });
  }
});

inboundRouter.post('/inbound/reviews/:id/resolve', requireAdmin, async (req: AuthedRequest, res: Response) => {
  const decision = req.body?.decision;
  if (decision !== 'acknowledge' && decision !== 'retry') {
    res.status(400).json({ error: 'invalid_decision' });
    return;
  }
  try {
    const resolved = await resolveInboundReview(String(req.params.id ?? ''), decision);
    if (!resolved) {
      res.status(409).json({ error: 'review_not_pending' });
      return;
    }
    try {
      await logAudit(req.user!.username, 'inbound_review_resolved', `${decision} · ${req.params.id}`);
    } catch (auditError) {
      console.error('[tools/inbound] auditoría no disponible:', describeExternalError(auditError));
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[tools/inbound] no se pudo resolver:', describeExternalError(err));
    res.status(503).json({ error: 'inbox_unavailable' });
  }
});
