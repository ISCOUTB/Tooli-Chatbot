import { Router } from 'express';
import axios from 'axios';
import Redis from 'ioredis';
import { config } from '../config';

export const healthRouter = Router();

const redis = new Redis(config.redis.url, { lazyConnect: true, maxRetriesPerRequest: 1 });

export interface CheckResult {
  status: 'ok' | 'degraded' | 'down' | 'skipped';
  latencyMs?: number;
  detail?: string;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; latencyMs: number }> {
  const start = Date.now();
  const value = await fn();
  return { value, latencyMs: Date.now() - start };
}

async function checkRedis(): Promise<CheckResult> {
  try {
    const { latencyMs } = await timed(async () => {
      if (redis.status !== 'ready') await redis.connect().catch(() => {});
      return await redis.ping();
    });
    return { status: 'ok', latencyMs };
  } catch (err: any) {
    return { status: 'down', detail: err?.message };
  }
}

async function checkMetaCloud(): Promise<CheckResult> {
  if (!config.metaCloud.token || !config.metaCloud.phoneNumberId) {
    return { status: 'skipped', detail: 'WHATSAPP_TOKEN o WHATSAPP_PHONE_NUMBER_ID no configurados' };
  }
  try {
    const { latencyMs, value } = await timed(() =>
      axios.get(`https://graph.facebook.com/v20.0/${config.metaCloud.phoneNumberId}`, {
        params: { fields: 'display_phone_number,verified_name,quality_rating', access_token: config.metaCloud.token },
        timeout: 5_000,
      })
    );
    const phone = value.data?.display_phone_number ?? '';
    const quality = value.data?.quality_rating ?? '';
    return { status: 'ok', latencyMs, detail: `${phone} · calidad: ${quality}` };
  } catch (err: any) {
    const detail = err?.response?.data?.error?.message ?? err?.code ?? err?.message;
    return { status: 'down', detail };
  }
}

async function checkOpenAI(): Promise<CheckResult> {
  if (!config.openai.apiKey) return { status: 'skipped', detail: 'OPENAI_API_KEY no configurada' };
  try {
    const { latencyMs } = await timed(() =>
      axios.get('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${config.openai.apiKey}` },
        timeout: 5_000,
      })
    );
    return { status: 'ok', latencyMs };
  } catch (err: any) {
    return { status: 'down', detail: err?.response?.status ?? err?.message };
  }
}

async function checkChatwoot(): Promise<CheckResult> {
  if (!config.chatwoot.url || !config.chatwoot.apiToken) return { status: 'skipped' };
  try {
    const { latencyMs } = await timed(() =>
      axios.get(`${config.chatwoot.url}/api/v1/accounts/${config.chatwoot.accountId}/inboxes`, {
        headers: { api_access_token: config.chatwoot.apiToken },
        timeout: 5_000,
      })
    );
    return { status: 'ok', latencyMs };
  } catch (err: any) {
    return { status: 'down', detail: err?.response?.status ?? err?.message };
  }
}

async function checkGoogleSheets(): Promise<CheckResult> {
  if (!config.google.serviceAccount?.client_email) return { status: 'skipped' };
  try {
    const { google } = await import('googleapis');
    const auth = new google.auth.JWT({
      email: config.google.serviceAccount.client_email,
      key: config.google.serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const { latencyMs } = await timed(() => auth.authorize());
    return { status: 'ok', latencyMs };
  } catch (err: any) {
    return { status: 'down', detail: err?.message };
  }
}

healthRouter.get('/', async (_req, res) => {
  res.json({ status: 'ok', message: 'use /health/deep para chequeo completo' });
});

/** El panel Inicio consume exactamente los mismos chequeos que /health/deep. */
export async function getDeepHealth() {
  const [redisR, metaR, openaiR, chatwootR, sheetsR] = await Promise.all([
    checkRedis(),
    checkMetaCloud(),
    checkOpenAI(),
    checkChatwoot(),
    checkGoogleSheets(),
  ]);

  const checks = {
    redis: redisR,
    meta_whatsapp: metaR,
    openai: openaiR,
    chatwoot: chatwootR,
    google_sheets: sheetsR,
  };

  const downCount = Object.values(checks).filter(c => c.status === 'down').length;
  const overall = downCount === 0 ? 'ok' : downCount >= 2 ? 'down' : 'degraded';
  return {
    status: overall,
    timestamp: new Date().toISOString(),
    checks,
  };
}

healthRouter.get('/deep', async (_req, res) => {
  const resultado = await getDeepHealth();
  res.status(resultado.status === 'down' ? 503 : 200).json(resultado);
});
