// Firma de los webhooks de Telnyx (API v2): Ed25519 sobre `${telnyx-timestamp}|${cuerpo crudo}` con la llave
// pública de la cuenta (base64 de 32 bytes, la da el portal de Telnyx en «API Keys → Public Key»).
// Se verifica sobre los BYTES crudos que llegaron, nunca sobre un JSON re-serializado. Con hora fuera de la
// ventana (±5 min) se rechaza aunque la firma sea buena: así un evento grabado no se puede reenviar después.
import { createPublicKey, verify, type KeyObject } from 'node:crypto';

export const SIGNATURE_TOLERANCE_SECONDS = 300;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export type SignatureCheck = { ok: true } | { ok: false; reason: 'missing' | 'bad_key' | 'stale' | 'invalid' };

export function ed25519PublicKeyFromBase64(publicKeyB64: string): KeyObject | null {
  try {
    const raw = Buffer.from(publicKeyB64.trim(), 'base64');
    if (raw.length !== 32) return null;
    return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
}

export function verifyTelnyxSignature(args: {
  rawBody: string;
  signatureB64: string | null;
  timestamp: string | null;
  publicKeyB64: string | null;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): SignatureCheck {
  const { rawBody, signatureB64, timestamp, publicKeyB64 } = args;
  if (!signatureB64 || !timestamp) return { ok: false, reason: 'missing' };
  if (!publicKeyB64) return { ok: false, reason: 'bad_key' };
  const key = ed25519PublicKeyFromBase64(publicKeyB64);
  if (!key) return { ok: false, reason: 'bad_key' };
  if (!/^\d{9,11}$/.test(timestamp)) return { ok: false, reason: 'invalid' };
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > (args.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS)) {
    return { ok: false, reason: 'stale' };
  }
  let signature: Buffer;
  try {
    signature = Buffer.from(signatureB64, 'base64');
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (signature.length !== 64) return { ok: false, reason: 'invalid' };
  try {
    const ok = verify(null, Buffer.from(`${timestamp}|${rawBody}`, 'utf8'), key, signature);
    return ok ? { ok: true } : { ok: false, reason: 'invalid' };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}
