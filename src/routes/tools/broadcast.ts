/**
 * Mensajes masivos con templates aprobados de Meta.
 */

import { Router } from 'express';
import { AuthedRequest, requireAdmin } from '../../middleware/auth';
import { Response } from 'express';
import { describeError } from '../../services/logSafe';
import { BroadcastValidationError } from '../../services/broadcastValidation';

export const broadcastRouter = Router();

/* ===== Broadcast / mensajes masivos por templates de Meta (WABA) — AL FINAL =====
   Infraestructura REAL: lista templates aprobados del Business Manager y
   envío masivo usando Graph API v20.0. Sin templates aprobados no hay envío
   posible (Meta no permite texto libre fuera de ventana 24h). Sin credenciales
   WABA en este entorno, la lista viene vacía — estado honesto en la UI. */

broadcastRouter.get('/broadcast/templates', async (_req, res) => {
  try {
    const { listApprovedTemplates } = await import('../../services/broadcastService');
    const templates = await listApprovedTemplates();
    res.json({ templates });
  } catch (err: unknown) {
    console.error('[tools/broadcast/templates] error:', describeError(err));
    res.status(502).json({ error: 'templates_error', message: 'No se pudieron consultar los templates de Meta' });
  }
});

broadcastRouter.post('/broadcast/send', requireAdmin, async (req: AuthedRequest, res: Response) => {
  const { templateName, language, telefonos } = req.body ?? {};
  if (!templateName || !language || !Array.isArray(telefonos)) {
    res.status(400).json({ error: 'missing_fields', message: 'Se requiere { templateName, language, telefonos: string[] }' });
    return;
  }
  // Filtro grueso acá; la normalización fina (dígitos, E.164, dedupe) vive en
  // el servicio para que cada número inválido llegue al resumen de `fallidos`
  // en vez de desaparecer en silencio.
  const rawNums: string[] = (telefonos as unknown[])
    .map(v => String(v ?? '').trim());
  if (telefonos.length === 0) {
    res.status(400).json({ error: 'no_telefonos_validos' });
    return;
  }
  if (rawNums.length > 200) {
    res.status(400).json({ error: 'too_many_recipients', message: 'Máximo 200 destinatarios por envío' });
    return;
  }
  try {
    const { enqueueBroadcast } = await import('../../services/broadcastJobService');
    const job = await enqueueBroadcast(templateName, language, rawNums, req.user!.username);
    res.status(job.estado === 'completado' ? 200 : 202).json({ ok: true, job });
  } catch (err: unknown) {
    if (err instanceof BroadcastValidationError) {
      res.status(400).json({ error: 'validation_error', message: err.message });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[tools/broadcast/send] error:', describeError(err));
    if (/credenciales/.test(msg)) {
      res.status(503).json({ error: 'service_unavailable', message: 'El canal de Meta no está configurado' });
      return;
    }
    if (/ECONNREFUSED|Connection is closed|ETIMEDOUT|MaxRetriesPerRequest/i.test(msg)) {
      res.status(503).json({ error: 'queue_unavailable', message: 'La cola de envíos no está disponible' });
      return;
    }
    res.status(502).json({ error: 'send_failed', message: 'No se pudo preparar el envío' });
  }
});

broadcastRouter.get('/broadcast/jobs/:id', requireAdmin, async (req: AuthedRequest, res: Response) => {
  try {
    const { getBroadcastJob } = await import('../../services/broadcastJobService');
    const job = await getBroadcastJob(String(req.params.id ?? ''));
    if (!job) {
      res.status(404).json({ error: 'not_found', message: 'Envío no encontrado' });
      return;
    }
    res.json({ job });
  } catch (err) {
    console.error('[tools/broadcast/jobs] error:', describeError(err));
    res.status(503).json({ error: 'queue_unavailable', message: 'No se pudo consultar el envío' });
  }
});
