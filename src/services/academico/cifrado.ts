import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM para lo poco que se guarda cifrado (sesión del camino A y cédula).
 * Formato: "v1.<iv>.<etiqueta>.<texto>" en base64url. `contexto` entra como dato
 * autenticado: un blob copiado a otro teléfono NO se descifra.
 */

export class ErrorCifrado extends Error {
  constructor() { super('No se pudo descifrar el dato'); }
}

/** Clave de 32 bytes en hex (64 caracteres) o base64. null si falta o no sirve. */
export function leerClave(clave: string | undefined = process.env.TOOLI_ACADEMICO_CLAVE): Buffer | null {
  if (!clave) return null;
  const c = clave.trim();
  if (/^[0-9a-f]{64}$/i.test(c)) return Buffer.from(c, 'hex');
  const b = Buffer.from(c, 'base64');
  return b.length === 32 ? b : null;
}

export function cifrar(texto: string, contexto: string, clave: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', clave, iv);
  cipher.setAAD(Buffer.from(contexto, 'utf8'));
  const cuerpo = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  const etiqueta = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), etiqueta.toString('base64url'), cuerpo.toString('base64url')].join('.');
}

export function descifrar(blob: string, contexto: string, clave: Buffer): string {
  try {
    const [version, iv, etiqueta, cuerpo] = blob.split('.');
    if (version !== 'v1' || !iv || !etiqueta || cuerpo === undefined) throw new ErrorCifrado();
    const decipher = createDecipheriv('aes-256-gcm', clave, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(contexto, 'utf8'));
    decipher.setAuthTag(Buffer.from(etiqueta, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(cuerpo, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new ErrorCifrado();
  }
}
