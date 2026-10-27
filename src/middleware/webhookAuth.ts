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

/** Chatwoot v3.16 does not sign outgoing webhooks. Use an unguessable URL token. */
export function verifyChatwootToken(token: unknown, secret: string): boolean {
  return typeof token === 'string' && secret.length >= 32 && safeEqual(token, secret);
}

let warnedMissingMetaSecret = false;

/**
 * Sin META_APP_SECRET se aceptan las entregas sin firma (como antes de esta
 * validación) para que desplegar sin el secreto no deje al bot sordo. En
 * cuanto se configura, toda entrega sin firma válida se rechaza.
 */
export function requireMetaSignature(req: RawBodyRequest, res: Response, next: NextFunction): void {
  if (!config.metaCloud.appSecret) {
    if (!warnedMissingMetaSecret) {
      warnedMissingMetaSecret = true;
      console.warn('[meta-webhook] META_APP_SECRET no configurado: se aceptan entregas SIN verificar la firma.');
    }
    next();
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
