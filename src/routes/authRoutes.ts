import { Router, Response } from 'express';
import {
  verifyPassword,
  createUser,
  listUsers,
  deleteUser,
  updatePassword,
  toPublic,
  getUser,
} from '../services/usersService';
import {
  signSession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin,
  AuthedRequest,
} from '../middleware/auth';
import { config } from '../config';
import { getChatwootSsoUrl, isChatwootSsoEnabled } from '../services/chatwootSsoService';
import { logAudit } from '../services/auditService';
import { checkRateLimit } from '../services/rateLimit';
import { describeExternalError } from '../services/logSafe';
import { isAcceptableNewPassword } from '../services/passwordPolicy';

export const authRouter = Router();

const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_WINDOW_SEC = 5 * 60;

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' ||
      !username.trim() || !password || username.length > 128 || password.length > 1024) {
    res.status(400).json({ error: 'invalid_credentials' });
    return;
  }

  // Por IP+usuario: evita fuerza bruta sobre una cuenta puntual sin bloquear
  // a todos los asesores que comparten salida a internet en la universidad.
  const attemptKey = `login:${req.ip}:${String(username).toLowerCase()}`;
  const limit = await checkRateLimit(attemptKey, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_SEC);
  if (!limit.allowed) {
    res.status(429).json({ error: 'too_many_attempts', retryAfterSec: limit.retryAfterSec });
    return;
  }

  const user = await verifyPassword(username, password);
  if (!user) {
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }
  const token = signSession({ username: user.username, role: user.role, fullName: user.fullName, sessionVersion: user.sessionVersion });
  setSessionCookie(res, token);
  await logAudit(user.username, 'login');
  res.json({ user: toPublic(user) });
});

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req: AuthedRequest, res: Response) => {
  const user = await getUser(req.user!.username);
  if (!user) {
    res.status(401).json({ error: 'user_not_found' });
    return;
  }
  res.json({
    user: toPublic(user),
    urls: {
      chatwoot: config.publicUrls.chatwoot,
      grafana: config.publicUrls.grafana,
    },
    capabilities: {
      chatwootSso: isChatwootSsoEnabled() && !!user.chatwootUserId,
    },
  });
});

/**
 * Devuelve una URL SSO de Chatwoot que loguea automáticamente al asesor.
 * Si SSO no está configurado o el usuario no tiene cuenta en Chatwoot,
 * devuelve la URL pública (login manual).
 */
authRouter.get('/chatwoot-sso', requireAuth, async (req: AuthedRequest, res: Response) => {
  const user = await getUser(req.user!.username);
  if (!user) {
    res.status(401).json({ error: 'user_not_found' });
    return;
  }
  if (!isChatwootSsoEnabled() || !user.chatwootUserId) {
    res.json({ url: config.publicUrls.chatwoot, sso: false });
    return;
  }
  try {
    const url = await getChatwootSsoUrl(user.chatwootUserId);
    res.json({ url, sso: true });
  } catch (err: any) {
    console.error('[chatwoot-sso] error generando URL:', describeExternalError(err));
    res.json({ url: config.publicUrls.chatwoot, sso: false, error: 'sso_unavailable' });
  }
});

authRouter.post('/change-password', requireAuth, async (req: AuthedRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || !currentPassword || !isAcceptableNewPassword(newPassword)) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const ok = await verifyPassword(req.user!.username, currentPassword);
  if (!ok) {
    res.status(401).json({ error: 'wrong_current_password' });
    return;
  }
  await updatePassword(req.user!.username, newPassword);
  res.json({ ok: true });
});

authRouter.get('/users', requireAuth, requireAdmin, async (_req, res) => {
  res.json({ users: await listUsers() });
});

authRouter.post('/users', requireAuth, requireAdmin, async (req: AuthedRequest, res: Response) => {
  try {
    const { username, password, fullName, email, role, area } = req.body ?? {};
    if (!username || !password || !fullName) {
      res.status(400).json({ error: 'missing_fields' });
      return;
    }
    const user = await createUser({ username, password, fullName, email, role, area });
    await logAudit(req.user!.username, 'usuario_creado', username);
    res.json({ user });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'create_failed' });
  }
});

authRouter.delete('/users/:username', requireAuth, requireAdmin, async (req: AuthedRequest, res: Response) => {
  if (req.params.username.toLowerCase() === req.user!.username) {
    res.status(400).json({ error: 'cannot_delete_self' });
    return;
  }
  await deleteUser(req.params.username);
  await logAudit(req.user!.username, 'usuario_eliminado', req.params.username);
  res.json({ ok: true });
});
