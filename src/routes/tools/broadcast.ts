/**
 * Mensajes masivos con templates aprobados de Meta.
 */

import { Router } from 'express';
import { AuthedRequest } from '../../middleware/auth';
import { Response } from 'express';
import { describeError } from '../../services/logSafe';
import { BroadcastValidationError } from '../../services/broadcastValidation';

export const broadcastRouter = Router();

/* ===== Broadcast / mensajes masivos por templates de Meta (WABA) — AL FINAL =====
   Infraestructura REAL: lista templates aprobados del Business Manager y
   envío masivo usando Graph API v20.0. Sin templates aprobados no hay envío
   posible (Meta no permite texto libre fuera de ventana 24h). Sin credenciales
   WABA en este entorno, la lista viene vacía — estado honesto en la UI. */

broadcastRouter.get('/broadcast/templates', async (_req, res) => {
  try {
    const { listApprovedTemplates } = await import('../../services/broadcastService');
    const templates = await listApprovedTemplates();
    res.json({ templates });
  } catch (err: unknown) {
    console.error('[tools/broadcast/templates] error:', describeError(err));
    res.status(502).json({ error: 'templates_error', message: 'No se pudieron consultar los templates de Meta' });
  }
});

// Enviar plantillas es parte del trabajo de un asesor: cualquier sesión del
// panel puede hacerlo. Cada envío queda a nombre de quien lo creó.
/**
 * Todas las plantillas de la cuenta con su estado (aprobada, en revisión,
 * rechazada…). La pantalla Plantillas la usa para mostrar también las que
 * alguien creó y Meta todavía no aprueba.
 */
broadcastRouter.get('/broadcast/templates/todas', async (_req, res) => {
  try {
    const { listarPlantillasConEstado } = await import('../../services/broadcastService');
    res.json({ templates: await listarPlantillasConEstado() });
  } catch (err: unknown) {
    console.error('[tools/broadcast/templates/todas] error:', describeError(err));
    res.status(502).json({ error: 'templates_error', message: 'No se pudieron consultar las plantillas de Meta' });
  }
});

/**
 * Crea una plantilla en Meta. Cualquier asesor puede proponerla: no todos
 * tienen acceso al administrador de WhatsApp. Meta la revisa antes de que se
 * pueda enviar. Con tope por persona para no saturar el límite de la cuenta.
 */
broadcastRouter.post('/broadcast/templates', async (req: AuthedRequest, res: Response) => {
  try {
    const { checkRateLimit } = await import('../../services/rateLimit');
    const limite = await checkRateLimit(`plantilla:${req.user!.username}`, 10, 60 * 60);
    if (!limite.allowed) {
      res.status(429).json({ error: 'too_many_requests', message: 'Ya creaste varias plantillas en la última hora. Espera un poco antes de crear otra.' });
      return;
    }
    const { PlantillaInvalidaError, validarPlantillaNueva } = await import('../../services/plantillaNueva');
    const { crearPlantillaEnMeta } = await import('../../services/plantillasMeta');
    try {
      const plantilla = validarPlantillaNueva(req.body ?? {});
      const imagen = req.body?.imagen && typeof req.body.imagen === 'object'
        ? { base64: String(req.body.imagen.base64 ?? ''), mime: String(req.body.imagen.mime ?? '') }
        : null;
      const creada = await crearPlantillaEnMeta(plantilla, imagen);
      const { logAudit } = await import('../../services/auditService');
      await logAudit(req.user!.username, 'plantilla_creada', `${creada.name} (${creada.language}) · ${creada.category}`);
      res.status(201).json({ ok: true, plantilla: creada });
    } catch (err) {
      if (err instanceof PlantillaInvalidaError) {
        res.status(400).json({ error: 'validation_error', message: err.message });
        return;
      }
      throw err;
    }
  } catch (err: unknown) {
    console.error('[tools/broadcast/templates] crear:', describeError(err));
    res.status(502).json({ error: 'create_failed', message: 'No se pudo crear la plantilla en Meta. Intenta de nuevo en unos minutos.' });
  }
});

broadcastRouter.post('/broadcast/send', async (req: AuthedRequest, res: Response) => {
  // Tres formas: `telefonos` (plantilla sin variables), `destinatarios` con
  // `{ telefono, parametros }` (cada persona con sus datos) o `destinatarios` +
  // `relacion` (campaña por pregrado: {{1}} nombre, {{2}} pregrado).
  const { templateName, language, telefonos, destinatarios, relacion, etiqueta } = req.body ?? {};
  const lista: unknown[] | null = Array.isArray(destinatarios) ? destinatarios : Array.isArray(telefonos) ? telefonos : null;
  if (!templateName || !language || !lista) {
    res.status(400).json({
      error: 'missing_fields',
      message: 'Se requiere { templateName, language, telefonos: string[] } o { templateName, language, destinatarios, relacion }',
    });
    return;
  }
  if (lista.length === 0) {
    res.status(400).json({ error: 'no_telefonos_validos' });
    return;
  }
  if (lista.length > 200) {
    res.status(400).json({ error: 'too_many_recipients', message: 'Máximo 200 destinatarios por envío' });
    return;
  }
  try {
    // Filtro grueso acá; la normalización fina (dígitos, E.164, dedupe) vive en
    // el servicio para que cada número inválido llegue al resumen de `fallidos`
    // en vez de desaparecer en silencio.
    const { prepararDestinatariosCampana } = await import('../../flows/campanaReco');
    const recipients = Array.isArray(destinatarios)
      ? (relacion !== undefined
        ? prepararDestinatariosCampana(destinatarios, relacion)
        // Solo teléfono y valores: el contexto del bot lo pone únicamente la campaña.
        : destinatarios.map((d: unknown) => {
          const item = (d && typeof d === 'object' ? d : {}) as { telefono?: unknown; parametros?: unknown };
          return { telefono: String(item.telefono ?? ''), parametros: Array.isArray(item.parametros) ? item.parametros.map(v => String(v ?? '')) : [] };
        }))
      : lista.map(v => String(v ?? '').trim());
    const { enqueueBroadcast } = await import('../../services/broadcastJobService');
    const inicio = Date.now();
    const job = await enqueueBroadcast(templateName, language, recipients, req.user!.username, undefined, etiqueta);
    // El mismo envío dentro de 24 h devuelve el trabajo original y no sale de nuevo.
    const repetido = job.createdAt < inicio;
    res.status(job.estado === 'completado' ? 200 : 202).json({ ok: true, job, repetido });
  } catch (err: unknown) {
    const { CampanaInvalidaError } = await import('../../flows/campanaReco');
    if (err instanceof BroadcastValidationError || err instanceof CampanaInvalidaError) {
      res.status(400).json({ error: 'validation_error', message: err.message });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[tools/broadcast/send] error:', describeError(err));
    if (/credenciales/.test(msg)) {
      res.status(503).json({ error: 'service_unavailable', message: 'El canal de Meta no está configurado' });
      return;
    }
    if (/ECONNREFUSED|Connection is closed|ETIMEDOUT|MaxRetriesPerRequest/i.test(msg)) {
      res.status(503).json({ error: 'queue_unavailable', message: 'La cola de envíos no está disponible' });
      return;
    }
    res.status(502).json({ error: 'send_failed', message: 'No se pudo preparar el envío' });
  }
});

/**
 * Historial de la pantalla Plantillas. Un asesor ve sus envíos; un
 * administrador, los de todos. Los teléfonos se consultan por envío, no aquí.
 */
broadcastRouter.get('/broadcast/jobs', async (req: AuthedRequest, res: Response) => {
  try {
    const { listBroadcastJobs } = await import('../../services/broadcastJobService');
    res.json({ jobs: await listBroadcastJobs(30, req.user!) });
  } catch (err) {
    console.error('[tools/broadcast/jobs] error:', describeError(err));
    res.status(503).json({ error: 'queue_unavailable', message: 'No se pudo consultar el historial de envíos' });
  }
});

broadcastRouter.get('/broadcast/jobs/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const { getBroadcastJob, puedeVerEnvio } = await import('../../services/broadcastJobService');
    const job = await getBroadcastJob(String(req.params.id ?? ''));
    // El envío de otro asesor responde igual que uno que no existe.
    if (!job || !puedeVerEnvio(job, req.user!)) {
      res.status(404).json({ error: 'not_found', message: 'Envío no encontrado' });
      return;
    }
    res.json({ job });
  } catch (err) {
    console.error('[tools/broadcast/jobs] error:', describeError(err));
    res.status(503).json({ error: 'queue_unavailable', message: 'No se pudo consultar el envío' });
  }
});
