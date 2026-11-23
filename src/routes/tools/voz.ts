// API del panel para la línea de voz (/api/tools/voz/*). Portada de FastFood (src/app/api/voice/admin/*): settings,
// test, calls, callbacks, report, simulate. Va detrás de requireAuth (toolsRoutes); ajustes y prueba de conexión
// solo admin; asesores ven llamadas, cola de devoluciones, reporte y usan el simulador. Las llaves de Telnyx viven en
// el entorno del servidor: el panel solo ve si están puestas.
import { Router, type Response } from 'express';
import { requireAdmin, type AuthedRequest } from '../../middleware/auth';
import { logAudit } from '../../services/auditService';
import { describeError } from '../../services/logSafe';
import { VOCES } from '../../voice/ajustes';
import { VOICE_COP_PER_USD } from '../../voice/caps';
import { OUTCOME_WHY, buildWeeklyReport, pendingCallbacks } from '../../voice/devoluciones';
import {
  almacen, avisosRecientes, estadoConexion, guardarAjustes, leerAjustesGuardados, probarConexion, simulador,
} from '../../voice/servicio';
import { costoMesUsd, vistaLlamada, vistaTranscripcion } from '../../voice/vista';

export const vozRouter = Router();

const fallo = (res: Response, op: string, err: unknown) => {
  console.error(`[tools/voz/${op}] error:`, describeError(err));
  res.status(500).json({ error: 'voz_error', message: 'No se pudo completar la operación de la línea de voz.' });
};
const esAdmin = (req: AuthedRequest) => req.user?.role === 'admin';
const idValido = (id: string) => /^[0-9a-f-]{36}$/.test(id);

vozRouter.get('/voz/estado', async (req: AuthedRequest, res) => {
  try {
    const ajustes = await leerAjustesGuardados();
    const ahora = new Date();
    const [uso, llamadas, avisos] = await Promise.all([almacen.uso(ahora), almacen.listar(1000), avisosRecientes()]);
    const costoMes = costoMesUsd(llamadas, ahora);
    res.json({
      conexion: esAdmin(req) ? estadoConexion() : { lista: estadoConexion().llaveApi && estadoConexion().llavePublica },
      ajustes,
      voces: VOCES,
      uso: { ...uso, topeDia: ajustes.topeMinutosDia, topeMes: ajustes.topeMinutosMes },
      costoMes: { usd: costoMes, copAprox: Math.round((costoMes * VOICE_COP_PER_USD) / 100) * 100 },
      avisos,
      admin: esAdmin(req),
    });
  } catch (err) { fallo(res, 'estado', err); }
});

vozRouter.put('/voz/ajustes', requireAdmin, async (req: AuthedRequest, res) => {
  try {
    const nuevo = await guardarAjustes(req.body ?? {});
    await logAudit(req.user!.username, 'voz_ajustes_actualizados', nuevo.activo ? 'línea activa' : 'línea apagada');
    res.json({ ajustes: nuevo });
  } catch (err) { fallo(res, 'ajustes', err); }
});

vozRouter.post('/voz/probar', requireAdmin, async (_req, res) => {
  try { res.json(await probarConexion()); } catch (err) { fallo(res, 'probar', err); }
});

vozRouter.get('/voz/llamadas', async (req: AuthedRequest, res) => {
  try {
    const conSimuladas = req.query.simuladas === '1';
    const limite = Math.min(200, Math.max(1, Number(req.query.limite) || 50));
    const rows = (await almacen.listar(500)).filter((l) => conSimuladas || !l.simulada).slice(0, limite);
    res.json({ llamadas: rows.map((l) => vistaLlamada(l, esAdmin(req))) });
  } catch (err) { fallo(res, 'llamadas', err); }
});

vozRouter.get('/voz/llamadas/:id', async (req: AuthedRequest, res) => {
  try {
    const id = String(req.params.id);
    const l = idValido(id) ? await almacen.leer(id) : null;
    if (!l) { res.status(404).json({ error: 'not_found' }); return; }
    res.json({ llamada: vistaLlamada(l, esAdmin(req)), transcripcion: vistaTranscripcion(await almacen.transcripcion(l.id), l.simulada) });
  } catch (err) { fallo(res, 'detalle', err); }
});

vozRouter.get('/voz/devoluciones', async (_req, res) => {
  try {
    const pendientes = pendingCallbacks(await almacen.listar(1000));
    // Aquí el número va completo también para asesores: la cola existe para que lo llamen de vuelta.
    res.json({ devoluciones: pendientes.map((p) => ({ ...p, motivo: OUTCOME_WHY[p.outcome] ?? p.outcome })) });
  } catch (err) { fallo(res, 'devoluciones', err); }
});

vozRouter.post('/voz/devoluciones/:id/hecha', async (req: AuthedRequest, res) => {
  try {
    const id = String(req.params.id);
    const nota = typeof req.body?.nota === 'string' ? req.body.nota.replace(/[<>]/g, '').trim().slice(0, 300) : '';
    for (let i = 0; i < 4; i++) {
      const l = idValido(id) ? await almacen.leer(id) : null;
      if (!l || l.simulada) { res.status(404).json({ error: 'not_found' }); return; }
      const ok = await almacen.guardar({ ...l, devolucionHecha: new Date().toISOString(), devolucionNota: nota || null, devolucionPor: req.user!.username });
      if (ok) {
        await logAudit(req.user!.username, 'voz_devolucion_hecha', nota ? nota.slice(0, 80) : undefined);
        res.json({ ok: true });
        return;
      }
    }
    res.status(409).json({ error: 'conflicto', message: 'La llamada cambió mientras se guardaba. Inténtalo de nuevo.' });
  } catch (err) { fallo(res, 'devolucion', err); }
});

vozRouter.get('/voz/reporte', async (_req, res) => {
  try { res.json(buildWeeklyReport(await almacen.listar(2000))); } catch (err) { fallo(res, 'reporte', err); }
});

// ── Simulador: mismo motor, llamada marcada simulada, datos y agenda simulados ──
const enviarSim = (res: Response, r: { ok: boolean; motivo?: string }) => {
  if (!r.ok) {
    const status = r.motivo === 'tope_diario' ? 429 : r.motivo === 'no_encontrada' ? 404 : 409;
    res.status(status).json({ error: r.motivo });
    return;
  }
  res.json(r);
};

vozRouter.post('/voz/simular', async (req: AuthedRequest, res) => {
  try { enviarSim(res, await simulador.iniciar({ desdeNumeroDelEstudiante: req.body?.desdeNumeroDelEstudiante === true })); } catch (err) { fallo(res, 'simular', err); }
});

vozRouter.post('/voz/simular/:id/decir', async (req: AuthedRequest, res) => {
  try {
    const id = String(req.params.id);
    const texto = typeof req.body?.texto === 'string' ? req.body.texto : '';
    if (!idValido(id) || !texto.trim()) { res.status(400).json({ error: 'datos_invalidos' }); return; }
    enviarSim(res, await simulador.decir(id, texto));
  } catch (err) { fallo(res, 'simular-decir', err); }
});

vozRouter.post('/voz/simular/:id/silencio', async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!idValido(id)) { res.status(400).json({ error: 'datos_invalidos' }); return; }
    enviarSim(res, await simulador.silencio(id));
  } catch (err) { fallo(res, 'simular-silencio', err); }
});

vozRouter.post('/voz/simular/:id/colgar', async (req, res) => {
  try {
    const id = String(req.params.id);
    if (!idValido(id)) { res.status(400).json({ error: 'datos_invalidos' }); return; }
    enviarSim(res, await simulador.colgar(id));
  } catch (err) { fallo(res, 'simular-colgar', err); }
});
