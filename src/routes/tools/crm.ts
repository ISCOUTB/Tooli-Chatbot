/**
 * Fichas de seguimiento del CRM: notas, etapa del embudo, etiquetas
 * y asignación por prospecto.
 */

import { Router } from 'express';
import { normalizePhone } from './shared';
import { AuthedRequest } from '../../middleware/auth';
import { logAudit } from '../../services/auditService';
import { Response } from 'express';
import { describeError, maskPhone } from '../../services/logSafe';

export const crmRouter = Router();

function logCrmError(operation: string, err: unknown): void {
  const status = (err as { response?: { status?: number } })?.response?.status;
  console.error(`[tools/crm/${operation}] error:`, describeError({ status }));
}

/* ══════════════════════════════════════════════════════════════════════════
   FICHAS DE SEGUIMIENTO DEL CRM
   Notas, estado del embudo, etiquetas y asignación por prospecto.
   Ver `src/services/crmService.ts` para el porqué y los límites.
   ══════════════════════════════════════════════════════════════════════════ */

/** Todas las fichas de una, para que el CRM no haga N+1 al pintar la grilla. */
crmRouter.get('/crm/fichas', async (_req: AuthedRequest, res: Response) => {
  try {
    const { getFichas } = await import('../../services/crmService');
    res.json({ fichas: await getFichas() });
  } catch (err: unknown) {
    logCrmError('fichas', err);
    res.status(500).json({ error: 'internal_error', message: 'Error interno del servidor' });
  }
});

crmRouter.get('/crm/:phone', async (req: AuthedRequest, res: Response) => {
  const phone = normalizePhone(req.params.phone);
  if (!phone) {
    res.status(400).json({ error: 'invalid_phone' });
    return;
  }
  try {
    const { getFicha } = await import('../../services/crmService');
    res.json({ ficha: await getFicha(phone) });
  } catch (err: unknown) {
    logCrmError('ficha', err);
    res.status(500).json({ error: 'internal_error', message: 'Error interno del servidor' });
  }
});

crmRouter.post('/crm/:phone/nota', async (req: AuthedRequest, res: Response) => {
  const phone = normalizePhone(req.params.phone);
  if (!phone) {
    res.status(400).json({ error: 'invalid_phone' });
    return;
  }
  try {
    const { agregarNota } = await import('../../services/crmService');
    const ficha = await agregarNota(phone, String(req.body?.texto ?? ''), req.user!.username);
    await logAudit(req.user!.username, 'crm_nota_agregada', phone.slice(-4));
    res.json({ ok: true, ficha });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '';
    if (message === 'La nota no puede estar vacía' || message === 'La nota no puede superar 2000 caracteres') {
      res.status(400).json({ error: 'validation_error', message });
      return;
    }
    logCrmError('nota', err);
    res.status(500).json({ error: 'validation_error', message: 'Error interno del servidor' });
  }
});

crmRouter.delete('/crm/:phone/nota/:notaId', async (req: AuthedRequest, res: Response) => {
  const phone = normalizePhone(req.params.phone);
  if (!phone) {
    res.status(400).json({ error: 'invalid_phone' });
    return;
  }
  try {
    const { eliminarNota } = await import('../../services/crmService');
    const ficha = await eliminarNota(phone, String(req.params.notaId), req.user!.username);
    res.json({ ok: true, ficha });
  } catch (err: unknown) {
    logCrmError('eliminar-nota', err);
    res.status(500).json({ error: 'internal_error', message: 'Error interno del servidor' });
  }
});

crmRouter.post('/crm/:phone/estado', async (req: AuthedRequest, res: Response) => {
  const phone = normalizePhone(req.params.phone);
  if (!phone) {
    res.status(400).json({ error: 'invalid_phone' });
    return;
  }
  try {
    const { setEstado } = await import('../../services/crmService');
    const ficha = await setEstado(phone, req.body?.estado, req.user!.username);
    await logAudit(req.user!.username, 'crm_estado_actualizado', `${phone.slice(-4)} · ${ficha.estado}`);
    res.json({ ok: true, ficha });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.startsWith('Estado inválido:')) {
      res.status(400).json({ error: 'validation_error', message: 'Estado inválido' });
      return;
    }
    logCrmError('estado', err);
    res.status(500).json({ error: 'validation_error', message: 'Error interno del servidor' });
  }
});

crmRouter.post('/crm/:phone/asignar', async (req: AuthedRequest, res: Response) => {
  const phone = normalizePhone(req.params.phone);
  if (!phone) {
    res.status(400).json({ error: 'invalid_phone' });
    return;
  }
  try {
    const { setAsignado } = await import('../../services/crmService');
    const username = req.body?.username ? String(req.body.username) : null;
    const ficha = await setAsignado(phone, username, req.user!.username);
    await logAudit(req.user!.username, 'crm_asignado', `${maskPhone(phone)} · ${username ? 'asignado' : 'sin asignar'}`);
    res.json({ ok: true, ficha });
  } catch (err: unknown) {
    logCrmError('asignar', err);
    res.status(500).json({ error: 'internal_error', message: 'Error interno del servidor' });
  }
});

crmRouter.post('/crm/:phone/etiquetas', async (req: AuthedRequest, res: Response) => {
  const phone = normalizePhone(req.params.phone);
  if (!phone) {
    res.status(400).json({ error: 'invalid_phone' });
    return;
  }
  try {
    const { setEtiquetas } = await import('../../services/crmService');
    const etiquetas = Array.isArray(req.body?.etiquetas) ? req.body.etiquetas : [];
    const ficha = await setEtiquetas(phone, etiquetas, req.user!.username);
    res.json({ ok: true, ficha });
  } catch (err: unknown) {
    logCrmError('etiquetas', err);
    res.status(500).json({ error: 'internal_error', message: 'Error interno del servidor' });
  }
});
