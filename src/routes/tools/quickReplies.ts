/**
 * Respuestas rápidas compartidas por el equipo para el composer.
 */

import { Router } from 'express';
import { AuthedRequest } from '../../middleware/auth';
import { Response } from 'express';
import { describeError } from '../../services/logSafe';

export const quickRepliesRouter = Router();

function logQuickReplyError(operation: string, err: unknown): void {
  const status = (err as { response?: { status?: number } })?.response?.status;
  console.error(`[tools/quick-replies/${operation}] error:`, describeError({ status }));
}

/* ══════════════════════════════════════════════════════════════════════════
   RESPUESTAS RÁPIDAS
   Plantillas compartidas por el equipo para el composer de la bandeja.
   Ver `src/services/quickRepliesService.ts`.
   ══════════════════════════════════════════════════════════════════════════ */

quickRepliesRouter.get('/quick-replies', async (_req: AuthedRequest, res: Response) => {
  try {
    const { listQuickReplies } = await import('../../services/quickRepliesService');
    res.json({ replies: await listQuickReplies() });
  } catch (err: unknown) {
    logQuickReplyError('listar', err);
    res.status(500).json({ error: 'internal_error', message: 'Error interno del servidor' });
  }
});

quickRepliesRouter.post('/quick-replies', async (req: AuthedRequest, res: Response) => {
  try {
    const { addQuickReply, QuickReplyError } = await import('../../services/quickRepliesService');
    try {
      const reply = await addQuickReply(
        { titulo: String(req.body?.titulo ?? ''), texto: String(req.body?.texto ?? ''), area: req.body?.area },
        req.user!.username,
      );
      res.json({ ok: true, reply });
    } catch (err: unknown) {
      if (err instanceof QuickReplyError) {
        res.status(400).json({ error: 'validation_error', message: err.message });
        return;
      }
      throw err;
    }
  } catch (err: unknown) {
    logQuickReplyError('crear', err);
    res.status(500).json({ error: 'internal_error', message: 'Error interno del servidor' });
  }
});

quickRepliesRouter.delete('/quick-replies/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const { deleteQuickReply } = await import('../../services/quickRepliesService');
    const ok = await deleteQuickReply(String(req.params.id));
    if (!ok) {
      res.status(404).json({ error: 'not_found', message: 'Esa respuesta rápida ya no existe' });
      return;
    }
    res.json({ ok: true });
  } catch (err: unknown) {
    logQuickReplyError('eliminar', err);
    res.status(500).json({ error: 'internal_error', message: 'Error interno del servidor' });
  }
});
