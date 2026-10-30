import { Router, Response } from 'express';
import { AuthedRequest } from '../../middleware/auth';
import { obtenerInicio } from '../../services/inicioService';
import { describeError } from '../../services/logSafe';

export const inicioRouter = Router();

inicioRouter.get('/inicio', async (req: AuthedRequest, res: Response) => {
  try {
    res.json(await obtenerInicio(req.user!.username, req.user!.role));
  } catch (err) {
    console.error('[tools/inicio] error general:', describeError(err));
    res.status(500).json({ error: 'inicio_error', message: 'No se pudo cargar Inicio.' });
  }
});
