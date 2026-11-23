import { createHmac, timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyMetaSignature(rawBody: Buffer | undefined, signature: string | undefined, secret: string): boolean {
  if (!secret || !rawBody || !signature || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  return safeEqual(expected, signature.toLowerCase());
}

/**
 * Compara un secreto compartido (Evolution, métricas) en tiempo constante.
 * Un secreto vacío nunca abre la puerta.
 */
export function verifySharedSecret(given: unknown, secret: string): boolean {
  return typeof given === 'string' && secret.length > 0 && safeEqual(given, secret);
}

/** Chatwoot v3.16 does not sign outgoing webhooks. Use an unguessable URL token. */
export function verifyChatwootToken(token: unknown, secret: string): boolean {
  return typeof token === 'string' && secret.length >= 32 && safeEqual(token, secret);
}

let warnedMissingMetaSecret = false;

/**
 * Sin META_APP_SECRET no hay forma de saber que una entrega viene de Meta.
 * En desarrollo se aceptan (con aviso) para poder probar sin el secreto; en
 * producción se rechazan, salvo que alguien lo pida a propósito con
 * META_ALLOW_UNSIGNED=1 mientras configura el secreto.
 */
export function metaUnsignedAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.META_ALLOW_UNSIGNED === '1';
}

export function requireMetaSignature(req: RawBodyRequest, res: Response, next: NextFunction): void {
  if (!config.metaCloud.appSecret) {
    const allowed = metaUnsignedAllowed();
    if (!warnedMissingMetaSecret) {
      warnedMissingMetaSecret = true;
      console.warn(
        allowed
          ? '[meta-webhook] META_APP_SECRET no configurado: se aceptan entregas SIN verificar la firma.'
          : '[meta-webhook] META_APP_SECRET no configurado en producción: se rechazan las entregas. Configúralo (o META_ALLOW_UNSIGNED=1 de forma temporal).'
      );
    }
    if (allowed) {
      next();
      return;
    }
    res.status(503).json({ error: 'meta_app_secret_missing' });
    return;
  }
  const signature = req.header('x-hub-signature-256');
  if (!verifyMetaSignature(req.rawBody, signature, config.metaCloud.appSecret)) {
    res.sendStatus(401);
    return;
  }
  next();
}

export function requireChatwootToken(req: Request, res: Response, next: NextFunction): void {
  if (!config.chatwoot.webhookToken) {
    res.status(503).json({ error: 'webhook_not_configured' });
    return;
  }
  if (!verifyChatwootToken(req.query.token, config.chatwoot.webhookToken)) {
    res.sendStatus(401);
    return;
  }
  next();
}

/**
 * Token de métricas: METRICS_TOKEN (o WEBHOOK_SECRET si no se definió, para no
 * romper despliegues viejos). Se prefiere la cabecera (`x-metrics-token` o
 * `Authorization: Bearer`) porque la URL queda en los registros del proxy;
 * `?token=` se sigue aceptando (Prometheus y la página del tablero lo usan).
 */
export function metricsTokensFrom(req: Pick<Request, 'headers' | 'query'>): unknown[] {
  const auth = req.headers.authorization;
  return [
    req.headers['x-metrics-token'],
    typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : undefined,
    req.query.token,
  ].filter(t => t !== undefined && t !== '');
}

/** Basta con que UNA de las fuentes traiga el token (un proxy puede añadir otro Bearer). */
export function metricsAuthorized(req: Pick<Request, 'headers' | 'query'>, secret: string): boolean {
  return metricsTokensFrom(req).some(t => verifySharedSecret(t, secret));
}
