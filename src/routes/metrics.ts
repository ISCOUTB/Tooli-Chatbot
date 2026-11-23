import { Router, Request, Response } from 'express';
import path from 'path';
import { getMetrics } from '../services/metrics';
import { getMetricsText, getMetricsContentType } from '../services/promMetrics';
import { config } from '../config';
import { metricsAuthorized } from '../middleware/webhookAuth';

export const dashboardRouter = Router();
export const promRouter = Router();

function dayKey(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function lastNDays(n: number): string[] {
  const days: string[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(dayKey(d));
  }
  return days;
}

function checkAuth(req: Request, res: Response): boolean {
  if (!metricsAuthorized(req, config.metricsToken)) {
    res.sendStatus(401);
    return false;
  }
  return true;
}

dashboardRouter.get('/data', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;

  const days = parseInt(String(req.query.days ?? '7'));
  const safeDays = Math.max(1, Math.min(30, days));
  const dayList = lastNDays(safeDays);

  const series: Record<string, Record<string, string>> = {};
  for (const day of dayList) {
    series[day] = await getMetrics(day);
  }

  res.json({ days: dayList, series });
});

dashboardRouter.get('/', (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  res.sendFile(path.resolve(__dirname, '../public/metrics.html'));
});

/**
 * Endpoint de Prometheus.
 * Auth-gated por el mismo WEBHOOK_SECRET para evitar que cualquiera lea las métricas
 * cuando el puerto 3000 esté expuesto a internet. Prometheus pasa el token vía
 * `bearer_token` o `params.token` configurado en prometheus.yml.
 */
promRouter.get('/', async (req: Request, res: Response) => {
  if (!checkAuth(req, res)) return;
  res.set('Content-Type', getMetricsContentType());
  res.end(await getMetricsText());
});
