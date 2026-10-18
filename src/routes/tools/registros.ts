/**
 * Prospectos que se registraron por el menú normal del bot (Google Sheets).
 */

import { Router } from 'express';
import { leerRegistrosPosgrado } from '../../services/registroService';
import { describeError } from '../../services/logSafe';

export const registrosRouter = Router();

/* ===== Registros de prospectos de posgrado (Google Sheets) ===== */

registrosRouter.get('/registros-posgrado', async (_req, res) => {
  try {
    const rows = await leerRegistrosPosgrado();
    res.json({ rows });
  } catch (err: unknown) {
    console.error('[tools/registros-posgrado] error:', describeError({ response: { status: (err as { response?: { status?: number } })?.response?.status } }));
    res.status(500).json({ error: 'internal_error', message: 'Error interno del servidor' });
  }
});
