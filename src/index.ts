import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { webhookRouter } from './routes/webhook';
import { metaWebhookRouter } from './routes/metaWebhook';
import { chatwootWebhookRouter } from './routes/chatwootWebhook';
import { dashboardRouter, promRouter } from './routes/metrics';
import { authRouter } from './routes/authRoutes';
import { toolsRouter } from './routes/toolsRoutes';
import { healthRouter } from './routes/health';
import { seedDefaultAdmin } from './services/usersService';
import { startReminderWorker } from './services/reminderService';
import { startBroadcastWorker } from './services/broadcastJobService';
import { startInboundWorker } from './services/inboundInbox';
import { securityHeaders, bodySizeLimit, errorHandler, notFoundHandler } from './middleware/security';
import { checkRateLimit } from './services/rateLimit';
import { validateJwtSecret } from './middleware/auth';
import { iniciarAsignacionAutomatica } from './services/atencionEquipoService';
import { iniciarRegistroHitos } from './services/atencionInformesService';

const app = express();

// Detrás de nginx (un solo salto). Sin esto req.ip es 127.0.0.1 para todos y el
// rate limit de /api/ de más abajo termina compartido entre todos los asesores.
app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(bodySizeLimit);
app.use(express.json({
  limit: '5mb',
  verify: (req, _res, body) => {
    if (req.url?.startsWith('/meta-webhook')) {
      (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(body);
    }
  },
}));
app.use(cookieParser());

const isProduction = process.env.NODE_ENV === 'production';

app.use(async (req, res, next) => {
  if (isProduction && req.path.startsWith('/api/')) {
    const ip = req.ip ?? 'unknown';
    const limit = await checkRateLimit(`api:${ip}`, 120, 60);
    res.setHeader('X-RateLimit-Limit', '120');
    res.setHeader('X-RateLimit-Remaining', String(limit.remaining));
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSec));
      res.status(429).json({ error: 'too_many_requests', retryAfterSec: limit.retryAfterSec });
      return;
    }
  }
  next();
});

app.use('/health', healthRouter);
app.use('/webhook', webhookRouter);
app.use('/meta-webhook', metaWebhookRouter);
app.use('/chatwoot-webhook', chatwootWebhookRouter);
app.use('/dashboard', dashboardRouter);
app.use('/metrics', promRouter);

app.use('/api/auth', authRouter);
app.use('/api/tools', toolsRouter);

// Static UI for asesores
app.use('/app', express.static(path.resolve(__dirname, 'public/app')));
app.get('/', (_req, res) => res.redirect('/app/'));
app.get('/app', (_req, res) => res.redirect('/app/'));

// Dashboard público Posgrados (presentación + QR del chat)
app.use('/posgrados', express.static(path.resolve(__dirname, 'public/posgrados')));

app.use('/public', express.static(path.resolve(__dirname, 'public')));

app.use(notFoundHandler);
app.use(errorHandler);

(async () => {
  validateJwtSecret();
  await seedDefaultAdmin();
  iniciarRegistroHitos();
  iniciarAsignacionAutomatica();
  // Dispara los recordatorios programados que ya vencieron (ver reminderService.ts).
  startReminderWorker();
  startBroadcastWorker();
  startInboundWorker();
  app.listen(config.port, () => {
    console.log(`Tooli Chatbot escuchando en puerto ${config.port}`);
    console.log(`UI Asesores → http://localhost:${config.port}/app/`);
  });
})();
