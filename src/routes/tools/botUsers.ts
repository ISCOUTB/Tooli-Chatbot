/**
 * Conversaciones de WhatsApp: listado, detalle, acciones rápidas
 * (resetear, banear, apagar la IA) y respuesta desde la bandeja.
 */

import { Router } from 'express';
import { normalizePhone } from './shared';
import { messaging } from '../../flows/shared';
import { config } from '../../config';
import { AuthedRequest } from '../../middleware/auth';
import { logAudit } from '../../services/auditService';
import { banUser, getBotUser, listActiveUsers, resetSession, setAiEnabled, unbanUser } from '../../services/botUserService';
import { Response } from 'express';
import { describeError, maskPhone } from '../../services/logSafe';
import { ultimoEntranteVerificable, ventanaTextoLibreAbierta } from '../../services/replyWindow';

export const botUsersRouter = Router();

/* ===== Gestión de usuarios del bot ===== */

botUsersRouter.get('/bot-users', async (_req, res) => {
  const phones = await listActiveUsers(100);
  res.json({ phones });
});

botUsersRouter.get('/bot-users/:phone', async (req: AuthedRequest, res: Response) => {
  const phone = normalizePhone(req.params.phone);
  if (!phone) {
    res.status(400).json({ error: 'invalid_phone' });
    return;
  }
  const info = await getBotUser(phone);
  res.json(info);
});

botUsersRouter.post('/bot-users/:phone/reset-session', async (req: AuthedRequest, res: Response) => {
  const phone = normalizePhone(req.params.phone);
  await resetSession(phone);
  await logAudit(req.user!.username, 'sesion_reseteada', phone.slice(-4));
  console.log(`[asesor] sesión reseteada para ${maskPhone(phone)}`);
  res.json({ ok: true });
});

botUsersRouter.post('/bot-users/:phone/ban', async (req: AuthedRequest, res: Response) => {
  const phone = normalizePhone(req.params.phone);
  const reason = req.body?.reason ?? `Baneado por ${req.user?.username}`;
  await banUser(phone, reason);
  await logAudit(req.user!.username, 'usuario_baneado', phone.slice(-4));
  console.log(`[asesor] usuario bloqueado: ${maskPhone(phone)}`);
  res.json({ ok: true });
});

botUsersRouter.post('/bot-users/:phone/unban', async (req: AuthedRequest, res: Response) => {
  const phone = normalizePhone(req.params.phone);
  await unbanUser(phone);
  await logAudit(req.user!.username, 'usuario_desbaneado', phone.slice(-4));
  console.log(`[asesor] usuario desbloqueado: ${maskPhone(phone)}`);
  res.json({ ok: true });
});

botUsersRouter.post('/bot-users/:phone/ai-toggle', async (req: AuthedRequest, res: Response) => {
  const phone = normalizePhone(req.params.phone);
  const enabled = !!req.body?.enabled;
  await setAiEnabled(phone, enabled);
  await logAudit(req.user!.username, enabled ? 'ia_activada' : 'ia_desactivada', phone.slice(-4));
  console.log(`[asesor] IA ${enabled ? 'activada' : 'apagada'} para ${maskPhone(phone)}`);
  res.json({ ok: true, enabled });
});

/* ══════════════════════════════════════════════════════════════════════════
   RESPONDER DESDE EL PANEL
   Permite que un asesor conteste por WhatsApp sin salir de la bandeja — es el
   hueco que obligaba a abrir Chatwoot para algo tan básico como responder.
   El mensaje enviado aparece solo en el hilo: los adaptadores de mensajería ya
   llaman a recordActivity(phone, 'out', ...) al enviar.
   ══════════════════════════════════════════════════════════════════════════ */

botUsersRouter.post('/bot-users/:phone/reply', async (req: AuthedRequest, res: Response) => {
  const phone = normalizePhone(req.params.phone);
  if (!phone) {
    res.status(400).json({ error: 'invalid_phone' });
    return;
  }

  const texto = String(req.body?.text ?? '').trim();
  if (!texto) {
    res.status(400).json({ error: 'validation_error', message: 'El mensaje no puede estar vacío' });
    return;
  }
  if (texto.length > 4096) {
    res.status(400).json({ error: 'validation_error', message: 'El mensaje no puede superar 4096 caracteres' });
    return;
  }

  try {
    // Restricción REAL de la WhatsApp Business Platform: fuera de las 24h desde
    // el último mensaje del usuario, Meta solo acepta plantillas aprobadas. En
    // vez de dejar que el envío falle con un error críptico de la Graph API, se
    // avisa acá con el motivo y la alternativa.
    const info = await getBotUser(phone);
    const now = Date.now();
    const ultimoEntranteTs = ultimoEntranteVerificable(info.recentMessages, now);
    if (config.messagingAdapter === 'meta' && !ventanaTextoLibreAbierta(ultimoEntranteTs, now)) {
      const detalle = ultimoEntranteTs === null
        ? 'No hay un mensaje entrante reciente verificable para este contacto. '
        : `Han pasado ${Math.floor((now - ultimoEntranteTs) / (60 * 60 * 1000))} horas desde su último mensaje. `;
      res.status(409).json({
        error: 'fuera_de_ventana',
        message:
          detalle +
          'WhatsApp solo permite texto libre dentro de las 24 horas siguientes; ' +
          'para retomar el contacto hay que usar una plantilla aprobada por Meta.',
      });
      return;
    }

    await messaging.sendText({ to: phone, text: texto });
    await logAudit(req.user!.username, 'mensaje_enviado', `${phone.slice(-4)} · ${texto.length} chars`);
    console.log(`[asesor] respuesta enviada a ${maskPhone(phone)} (${texto.length} chars)`);
    res.json({ ok: true });
  } catch (err: unknown) {
    console.error('[tools/reply] error al enviar:', describeError({ response: { status: (err as { response?: { status?: number } })?.response?.status } }));
    res.status(502).json({ error: 'send_failed', message: 'No se pudo enviar el mensaje' });
  }
});


/**
 * Detalle de varias conversaciones en una sola petición.
 *
 * La bandeja pintaba hasta 30 tarjetas pidiendo `/bot-users/:phone` una por una:
 * 31 peticiones HTTP cada vez que se abre, cada una con su ida y vuelta a Redis.
 * Con esto son 2. Se mantiene el endpoint individual porque el hilo abierto sí
 * necesita una sola conversación fresca.
 */
botUsersRouter.post('/bot-users/batch', async (req: AuthedRequest, res: Response) => {
  const lista = Array.isArray(req.body?.phones) ? req.body.phones : [];
  if (!lista.length) {
    res.status(400).json({ error: 'validation_error', message: 'phones debe ser un arreglo con al menos un número' });
    return;
  }
  if (lista.length > 60) {
    res.status(400).json({ error: 'validation_error', message: 'Máximo 60 números por lote' });
    return;
  }

  const phones = [...new Set(lista.map((p: unknown) => normalizePhone(String(p ?? ''))).filter(Boolean))] as string[];

  try {
    const users = await Promise.all(phones.map(async (phone) => {
      try {
        return await getBotUser(phone);
      } catch {
        // Una conversación que falla no debe tumbar el lote entero: la bandeja
        // la muestra vacía y el resto se pinta igual.
        return { phone, session: null, banned: false, aiDisabled: false, recentMessages: [] };
      }
    }));
    res.json({ users });
  } catch (err: unknown) {
    console.error('[tools/bot-users/batch] error:', describeError({ response: { status: (err as { response?: { status?: number } })?.response?.status } }));
    res.status(500).json({ error: 'internal_error', message: 'Error interno del servidor' });
  }
});
