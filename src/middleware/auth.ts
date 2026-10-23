import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { UserRole, getUser } from '../services/usersService';

const COOKIE_NAME = 'tooli_session';
const TOKEN_TTL = '8h';

const DEFAULT_JWT_SECRET = 'cambia-este-secreto-largo-para-jwt-tooli-2026';

export function validateJwtSecret(): void {
  const secret = config.auth.jwtSecret;
  const isProduction = process.env.NODE_ENV === 'production';
  if (secret === DEFAULT_JWT_SECRET) {
    if (isProduction) {
      console.error('[FATAL] JWT_SECRET está usando el valor por defecto inseguro. Define JWT_SECRET en las variables de entorno.');
      process.exit(1);
    }
    console.warn('[WARN] JWT_SECRET usa valor por defecto (solo desarrollo). Configura JWT_SECRET en producción.');
  }
  if (secret.length < 32) {
    if (isProduction) {
      console.error('[FATAL] JWT_SECRET debe tener al menos 32 caracteres en producción.');
      process.exit(1);
    }
    console.warn('[WARN] JWT_SECRET es corto (< 32 chars). Usa un secreto de al menos 32 caracteres.');
  }
}

export interface AuthPayload {
  username: string;
  role: UserRole;
  fullName: string;
  sessionVersion?: string;
}

export interface AuthedRequest extends Request {
  user?: AuthPayload;
}

export function signSession(payload: AuthPayload): string {
  return jwt.sign(payload, config.auth.jwtSecret, { expiresIn: TOKEN_TTL });
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: 'no_session' });
    return;
  }
  let payload: AuthPayload;
  try {
    payload = jwt.verify(token, config.auth.jwtSecret) as AuthPayload;
  } catch {
    res.status(401).json({ error: 'invalid_session' });
    return;
  }
  if (typeof payload.username !== 'string' || !payload.username ||
      (payload.role !== 'admin' && payload.role !== 'asesor')) {
    res.status(401).json({ error: 'invalid_session' });
    return;
  }
  // A signed cookie can outlive a deleted account. Check current authority,
  // and use the role from Redis rather than trusting a stale JWT claim.
  let current;
  try {
    current = await getUser(payload.username);
  } catch {
    res.status(503).json({ error: 'session_store_unavailable' });
    return;
  }
  if (!current) {
    clearSessionCookie(res);
    res.status(401).json({ error: 'invalid_session' });
    return;
  }
  if (current.sessionVersion !== payload.sessionVersion) {
    clearSessionCookie(res);
    res.status(401).json({ error: 'invalid_session' });
    return;
  }
  req.user = { username: current.username, role: current.role, fullName: current.fullName };
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
