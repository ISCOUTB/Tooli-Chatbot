/**
 * Bandeja de atención: las conversaciones con asesor se atienden desde el panel.
 * Por detrás siguen siendo conversaciones de Chatwoot (ver
 * src/services/chatwootAtencion.ts), que ya no se usa directamente.
 */

import { Router, Response } from 'express';
import { AuthedRequest } from '../../middleware/auth';
import { config } from '../../config';
import { logAudit } from '../../services/auditService';
import { getUser } from '../../services/usersService';
import { describeError } from '../../services/logSafe';
import {
  ConversacionNoEncontrada,
  ESTADOS_ATENCION,
  EstadoAtencion,
  FILTROS_ASIGNADO,
  FiltroAsignado,
  asignar,
  cambiarEstado,
  chatwootConfigurado,
  contarPorAsignado,
  enviarMensaje,
  equipoAtencion,
  filtrarPorAsignado,
  listarConversaciones,
  marcarLeida,
  obtenerConversacion,
} from '../../services/chatwootAtencion';
import { motivoVentanaCerrada } from './shared';

export const atencionRouter = Router();

async function miChatwootId(req: AuthedRequest): Promise<number | undefined> {
  return (await getUser(req.user!.username))?.chatwootUserId;
}

function idValido(valor: string): number | null {
  const id = Number(valor);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Un mismo manejo de errores para todas las rutas de la bandeja. */
function responderError(res: Response, err: unknown, contexto: string): void {
  if (err instanceof ConversacionNoEncontrada) {
    res.status(404).json({ error: 'no_encontrada', message: 'La conversación no existe o no es del bot.' });
    return;
  }
  console.error(`[atencion] ${contexto}:`, describeError(err));
  res.status(502).json({ error: 'chatwoot_error', message: 'No se pudo hablar con el sistema de atención. Intenta de nuevo.' });
}

atencionRouter.use('/atencion', (_req, res, next) => {
  if (!chatwootConfigurado()) {
    res.status(503).json({ error: 'chatwoot_no_configurado', message: 'La bandeja de atención no está configurada en este servidor.' });
    return;
  }
  next();
});

atencionRouter.get('/atencion/equipo', async (req: AuthedRequest, res: Response) => {
  try {
    const [equipo, yo, usuario] = await Promise.all([equipoAtencion(), miChatwootId(req), getUser(req.user!.username)]);
    // El área del asesor sugiere su equipo de Chatwoot como filtro inicial.
    const miEquipoId = usuario?.area === 'ti' ? Number(config.chatwoot.teamTiId) || null
      : usuario?.area === 'admisiones' ? Number(config.chatwoot.teamAdmisionesId) || null
      : null;
    res.json({ ...equipo, yo: yo ?? null, miEquipoId });
  } catch (err) {
    responderError(res, err, 'equipo');
  }
});

atencionRouter.get('/atencion/conversaciones', async (req: AuthedRequest, res: Response) => {
  const estado = String(req.query.estado ?? 'open') as EstadoAtencion;
  const asignado = String(req.query.asignado ?? 'todas') as FiltroAsignado;
  const equipoId = req.query.equipo ? idValido(String(req.query.equipo)) : null;
  if (!ESTADOS_ATENCION.includes(estado) || !FILTROS_ASIGNADO.includes(asignado)) {
    res.status(400).json({ error: 'validation_error', message: 'Filtro no válido.' });
    return;
  }
  try {
    const [{ conversaciones, truncado }, yo] = await Promise.all([listarConversaciones(estado), miChatwootId(req)]);
    const delEquipo = equipoId ? conversaciones.filter((c) => c.equipo?.id === equipoId) : conversaciones;
    res.json({
      conversaciones: filtrarPorAsignado(delEquipo, asignado, yo),
      conteos: contarPorAsignado(delEquipo, yo),
      truncado,
    });
  } catch (err) {
    responderError(res, err, 'listar');
  }
});

atencionRouter.get('/atencion/conversaciones/:id', async (req: AuthedRequest, res: Response) => {
  const id = idValido(req.params.id);
  const antesDe = req.query.antesDe ? idValido(String(req.query.antesDe)) ?? undefined : undefined;
  if (!id) {
    res.status(400).json({ error: 'validation_error', message: 'Conversación no válida.' });
    return;
  }
  try {
    const detalle = await obtenerConversacion(id, antesDe);
    if (!antesDe) await marcarLeida(id);
    res.json(detalle);
  } catch (err) {
    responderError(res, err, 'detalle');
  }
});

atencionRouter.post('/atencion/conversaciones/:id/mensajes', async (req: AuthedRequest, res: Response) => {
  const id = idValido(req.params.id);
  const texto = String(req.body?.texto ?? '').trim();
  const privado = req.body?.privado === true;
  if (!id || !texto || texto.length > 4096) {
    res.status(400).json({ error: 'validation_error', message: texto.length > 4096 ? 'El mensaje no puede superar 4096 caracteres.' : 'El mensaje no puede estar vacío.' });
    return;
  }
  try {
    if (!privado) {
      // Chatwoot aceptaría el texto, pero Meta lo rechazaría al entregarlo por
      // WhatsApp sin avisarle a nadie: se valida la ventana de 24 h antes.
      const { conversacion } = await obtenerConversacion(id);
      const motivo = conversacion.contacto.telefono ? await motivoVentanaCerrada(conversacion.contacto.telefono) : null;
      if (motivo) {
        res.status(409).json({ error: 'fuera_de_ventana', message: motivo });
        return;
      }
    }
    await enviarMensaje(id, texto, privado);
    await logAudit(req.user!.username, privado ? 'atencion_nota_privada' : 'mensaje_enviado', `conv ${id} · ${texto.length} chars`);
    res.json({ ok: true });
  } catch (err) {
    responderError(res, err, 'enviar');
  }
});

atencionRouter.post('/atencion/conversaciones/:id/estado', async (req: AuthedRequest, res: Response) => {
  const id = idValido(req.params.id);
  const estado = String(req.body?.estado ?? '') as EstadoAtencion;
  if (!id || !ESTADOS_ATENCION.includes(estado)) {
    res.status(400).json({ error: 'validation_error', message: 'Estado no válido.' });
    return;
  }
  try {
    await cambiarEstado(id, estado);
    await logAudit(req.user!.username, 'atencion_estado_cambiado', `conv ${id} → ${estado}`);
    res.json({ ok: true });
  } catch (err) {
    responderError(res, err, 'estado');
  }
});

atencionRouter.post('/atencion/conversaciones/:id/asignar', async (req: AuthedRequest, res: Response) => {
  const id = idValido(req.params.id);
  const body = req.body ?? {};
  const leer = (clave: string): number | null | undefined => {
    if (!(clave in body)) return undefined;
    if (body[clave] === null) return null;
    return idValido(String(body[clave])) ?? undefined;
  };
  let asesorId = leer('asesorId');
  const equipoId = leer('equipoId');
  if (body.asesorId === 'yo') {
    asesorId = await miChatwootId(req);
    if (!asesorId) {
      res.status(409).json({ error: 'sin_usuario_chatwoot', message: 'Tu usuario no tiene cuenta de atención vinculada. Pídele a un administrador que la cree.' });
      return;
    }
  }
  if (!id || (asesorId === undefined && equipoId === undefined)) {
    res.status(400).json({ error: 'validation_error', message: 'Indica a quién asignar.' });
    return;
  }
  try {
    await asignar(id, { asesorId, equipoId });
    await logAudit(req.user!.username, 'atencion_asignada', `conv ${id}${asesorId !== undefined ? ` · asesor ${asesorId ?? 'ninguno'}` : ''}${equipoId !== undefined ? ` · equipo ${equipoId ?? 'ninguno'}` : ''}`);
    res.json({ ok: true });
  } catch (err) {
    responderError(res, err, 'asignar');
  }
});
