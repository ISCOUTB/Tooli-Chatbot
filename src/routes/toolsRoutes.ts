/**
 * Punto de montaje de la API que consume el panel de asesores.
 *
 * Este archivo llegó a tener 789 líneas con todos los endpoints juntos: cada
 * cambio obligaba a leerlo entero y era imposible ver de un vistazo qué queda
 * detrás de autenticación y qué no. Ahora solo compone; cada dominio vive en
 * src/routes/tools/.
 *
 * El orden importa: lo que va antes de `requireAuth` es público.
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth';

import { nutriaRouter, nutriaRouterProtegido } from './tools/nutria';
import { turnoRouter } from './tools/turno';
import { reciboRouter } from './tools/recibo';
import { metricsRouter } from './tools/metrics';
import { botUsersRouter } from './tools/botUsers';
import { auditRouter } from './tools/audit';
import { chatwootRouter } from './tools/chatwoot';
import { registrosRouter } from './tools/registros';
import { eventoRouter } from './tools/evento';
import { recordatoriosRouter } from './tools/recordatorios';
import { broadcastRouter } from './tools/broadcast';
import { crmRouter } from './tools/crm';
import { quickRepliesRouter } from './tools/quickReplies';

export const toolsRouter = Router();

// ── Rutas PÚBLICAS (sin autenticación) ────────────────────────────────────────
toolsRouter.use(nutriaRouter);

// ── Rutas PROTEGIDAS: todo lo que se monta debajo exige sesión de asesor ──────
toolsRouter.use(requireAuth);

toolsRouter.use(nutriaRouterProtegido);
toolsRouter.use(turnoRouter);
toolsRouter.use(reciboRouter);
toolsRouter.use(metricsRouter);
toolsRouter.use(botUsersRouter);
toolsRouter.use(auditRouter);
toolsRouter.use(chatwootRouter);
toolsRouter.use(registrosRouter);
toolsRouter.use(eventoRouter);
toolsRouter.use(recordatoriosRouter);
toolsRouter.use(broadcastRouter);
toolsRouter.use(crmRouter);
toolsRouter.use(quickRepliesRouter);
