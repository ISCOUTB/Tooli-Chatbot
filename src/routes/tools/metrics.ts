/**
 * Métricas de uso del bot y registro de eventos desde el panel.
 */

import { Router } from 'express';
import { AuthedRequest } from '../../middleware/auth';
import { getMetrics, track } from '../../services/metrics';
import { isMetricEvent } from '../../services/metricEventAllowlist';
import { Response } from 'express';

export const metricsRouter = Router();

metricsRouter.get('/metrics/today', async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const data = await getMetrics(today);
  res.json({ day: today, metrics: data });
});

metricsRouter.get('/metrics/range', async (req, res) => {
  const days = Math.max(1, Math.min(30, parseInt(String(req.query.days ?? '7'))));
  const today = new Date();
  const result: Record<string, Record<string, string>> = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    result[key] = await getMetrics(key);
  }
  res.json({ days: result });
});

metricsRouter.post('/track', async (req: AuthedRequest, res: Response) => {
  const { event, props } = req.body ?? {};
  if (!isMetricEvent(event) || (props !== undefined && (typeof props !== 'object' || props === null || Array.isArray(props))) ||
      (props?.area !== undefined && !['ti', 'admisiones', 'posgrados'].includes(props.area))) {
    res.status(400).json({ error: 'invalid_metric' });
    return;
  }
  await track(event, { area: props?.area });
  res.json({ ok: true });
});
