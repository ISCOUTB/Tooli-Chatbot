/**
 * Recordatorios por WhatsApp: el envío inmediato y los programados,
 * que dispara solo el worker de reminderService.
 */

import { Router } from 'express';
import { enviarRecordatorio } from '../../flows/recordatorios';
import { AuthedRequest } from '../../middleware/auth';
import { logAudit } from '../../services/auditService';
import { Response } from 'express';
import { describeError } from '../../services/logSafe';

export const recordatoriosRouter = Router();

const ESTADOS_VALIDOS = ['programado', 'procesando', 'enviado', 'fallido', 'cancelado'] as const;

/**
 * Redis caído no es un 500 genérico: es transitorio y reintentable. Se
 * distingue por el mensaje del driver para responder 503 accionable en vez
 * de "internal_error", que esconde la causa y sugiere reintentar a ciegas.
 */
function esFalloTransitorio(msg: string): boolean {
  return /ECONNREFUSED|Connection is closed|ETIMEDOUT|timed out|MaxRetriesPerRequest|ENOTFOUND|EAI_AGAIN/i.test(msg);
}

function responderFalloServicio(res: Response, logPrefix: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(logPrefix, describeError(err));
  if (esFalloTransitorio(msg)) {
    res.status(503).json({
      error: 'redis_unavailable',
      message: 'Redis no disponible, reintenta en unos segundos',
      retryable: true,
    });
    return;
  }
  res.status(500).json({ error: 'internal_error', message: 'No se pudo completar la operación' });
}

/* ===== Recordatorios manuales (infraestructura real, disparo futuro) =====
   Infraestructura de envío REAL (usa Evolution/Meta ya configurado).
   El disparador es MANUAL vía este endpoint protegido con requireAuth.
   No hay integración con Banner/SIA — el día que exista, ese sistema solo
   debe llamar a enviarRecordatorio({ telefono, mensaje }) o a este endpoint
   vía cron. Ver src/flows/recordatorios.ts para el detalle. */
recordatoriosRouter.post('/recordatorio', async (req: AuthedRequest, res: Response) => {
  const { telefono, mensaje } = req.body ?? {};
  if (!telefono || !mensaje) {
    res.status(400).json({ error: 'missing_fields', message: 'Se requiere { telefono, mensaje }' });
    return;
  }
  try {
    const result = await enviarRecordatorio({ telefono: String(telefono), mensaje: String(mensaje) });
    try {
      await logAudit(req.user!.username, 'recordatorio_enviado', result.to.slice(-4));
    } catch (auditError) {
      console.error('[tools/recordatorio] auditoría no disponible:', describeError(auditError));
    }
    res.json(result);
  } catch (err: any) {
    const msg = err?.message ?? 'internal_error';
    // Errores de validación → 400, resto → 500
    const isValidation = /requeridos|inválido|caracteres/.test(msg);
    console.error('[tools/recordatorio] error:', describeError(err));
    res.status(isValidation ? 400 : 500).json({
      error: isValidation ? 'validation_error' : 'internal_error',
      message: isValidation ? msg : 'No se pudo enviar el recordatorio',
    });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   RECORDATORIOS PROGRAMADOS
   El endpoint `/recordatorio` (arriba) envía ya mismo. Estos programan para
   una fecha futura y los dispara solo el worker de `reminderService.ts`.
   ══════════════════════════════════════════════════════════════════════════ */

recordatoriosRouter.post('/recordatorios', async (req: AuthedRequest, res: Response) => {
  const { telefono, mensaje, scheduledAt } = req.body ?? {};
  try {
    const { scheduleReminder, ReminderValidationError } = await import('../../services/reminderService');
    try {
      const reminder = await scheduleReminder({
        telefono: String(telefono ?? ''),
        mensaje: String(mensaje ?? ''),
        scheduledAt: scheduledAt ?? '',
        createdBy: req.user!.username,
      });
      try {
        await logAudit(
          req.user!.username,
          'recordatorio_programado',
          `${reminder.telefono.slice(-4)} · ${new Date(reminder.scheduledAt).toISOString()}`
        );
      } catch (auditError) {
        console.error('[tools/recordatorios] auditoría no disponible:', describeError(auditError));
      }
      res.json({ ok: true, reminder });
    } catch (err: unknown) {
      if (err instanceof ReminderValidationError) {
        res.status(400).json({ error: 'validation_error', message: err.message });
        return;
      }
      throw err;
    }
  } catch (err: unknown) {
    responderFalloServicio(res, '[tools/recordatorios] error al programar:', err);
  }
});

recordatoriosRouter.get('/recordatorios', async (req: AuthedRequest, res: Response) => {
  try {
    const { listReminders } = await import('../../services/reminderService');
    const estado = req.query.estado ? String(req.query.estado) : undefined;
    // Un estado desconocido antes se ignoraba en silencio y devolvía todo:
    // ahora es 400 accionable en vez de una lista que nadie pidió.
    if (estado !== undefined && !(ESTADOS_VALIDOS as readonly string[]).includes(estado)) {
      res.status(400).json({
        error: 'validation_error',
        message: `estado inválido (usa uno de: ${ESTADOS_VALIDOS.join(', ')})`,
      });
      return;
    }
    const reminders = await listReminders({
      estado: estado as 'programado' | 'procesando' | 'enviado' | 'fallido' | 'cancelado' | undefined,
      limit: Math.max(1, Math.min(200, parseInt(String(req.query.limit ?? '50')) || 50)),
    });
    res.json({ reminders });
  } catch (err: unknown) {
    responderFalloServicio(res, '[tools/recordatorios] error al listar:', err);
  }
});

recordatoriosRouter.delete('/recordatorios/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const id = String(req.params.id ?? '').trim();
    if (!id || id.length > 256) {
      res.status(400).json({ error: 'validation_error', message: 'id de recordatorio inválido' });
      return;
    }
    const { cancelReminder } = await import('../../services/reminderService');
    const result = await cancelReminder(id);
    if (!result) {
      res.status(404).json({ error: 'not_found', message: 'Ese recordatorio ya no existe' });
      return;
    }
    if (!result.cancelled) {
      res.status(409).json({
        error: 'not_cancellable',
        message: `El recordatorio ya está ${result.reminder.estado}`,
        reminder: result.reminder,
      });
      return;
    }
    try {
      await logAudit(req.user!.username, 'recordatorio_cancelado', result.reminder.telefono.slice(-4));
    } catch (auditError) {
      console.error('[tools/recordatorios] auditoría no disponible:', describeError(auditError));
    }
    res.json({ ok: true, reminder: result.reminder });
  } catch (err: unknown) {
    responderFalloServicio(res, '[tools/recordatorios] error al cancelar:', err);
  }
});
