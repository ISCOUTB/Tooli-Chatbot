/**
 * Bandeja de atención: las conversaciones con asesor se atienden desde el panel.
 * Por detrás siguen siendo conversaciones de Chatwoot (ver
 * src/services/chatwootAtencion.ts), que ya no se usa directamente.
 */

import { Router, Response } from 'express';
import { AuthedRequest, requireAdmin } from '../../middleware/auth';
import { config } from '../../config';
import { logAudit } from '../../services/auditService';
import { getUser, listUsers } from '../../services/usersService';
import { describeError } from '../../services/logSafe';
import {
  ConversacionNoEncontrada,
  ValidacionArchivoError,
  ValidacionEtiquetasError,
  ESTADOS_ATENCION,
  EstadoAtencion,
  FILTROS_ASIGNADO,
  FiltroAsignado,
  asignar,
  cambiarEstado,
  chatwootConfigurado,
  contarPorAsignado,
  enviarAdjunto,
  enviarMensaje,
  equipoAtencion,
  filtrarPorAsignado,
  listarEtiquetas,
  listarConversaciones,
  marcarLeida,
  obtenerConversacion,
  normalizarEtiquetas,
  reemplazarEtiquetas,
  validarArchivoAdjunto,
} from '../../services/chatwootAtencion';
import { motivoVentanaCerrada } from './shared';
import { esNombreGenerico } from '../../services/chatwootService';

const ESTADO_HECHO: Record<EstadoAtencion, string> = {
  open: 'Conversación reabierta',
  pending: 'Marcada como pendiente',
  resolved: 'Conversación resuelta',
};
import { formatoSse, publicarAtencion, suscribirAtencion } from '../../services/atencionEventos';
import {
  AtencionConfigError,
  cambiarEstadoAsesor,
  estaConectado,
  guardarConfigAtencion,
  obtenerConfigAtencion,
  obtenerEstadoAsesor,
  registrarConexion,
  registrarDesconexion,
} from '../../services/atencionEquipoService';
import {
  AtencionMacroError,
  buscarMacro,
  crearMacro,
  eliminarMacro,
  listarMacros,
  normalizarMacro,
  planMacro,
  reemplazarNombre,
} from '../../services/atencionMacrosService';

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

function responderValidacion(res: Response, err: unknown): boolean {
  if (err instanceof ValidacionArchivoError) {
    res.status(err.status).json({ error: err.codigo, message: err.message });
    return true;
  }
  if (err instanceof ValidacionEtiquetasError || err instanceof AtencionMacroError || err instanceof AtencionConfigError) {
    res.status(400).json({ error: 'validation_error', message: err.message });
    return true;
  }
  return false;
}

atencionRouter.use('/atencion', (_req, res, next) => {
  if (!chatwootConfigurado()) {
    res.status(503).json({ error: 'chatwoot_no_configurado', message: 'La bandeja de atención no está configurada en este servidor.' });
    return;
  }
  next();
});

/* ===== En vivo =====
   Server-Sent Events: el panel abre una conexión y recibe cada cambio en las
   conversaciones con asesor. El latido evita que nginx o el navegador la
   corten por inactividad. */
const LATIDO_MS = 25_000;

atencionRouter.get('/atencion/eventos', (req: AuthedRequest, res: Response) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx no debe acumular la respuesta
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const cancelar = suscribirAtencion((evento) => res.write(formatoSse(evento)));
  registrarConexion(req.user!.username);
  const latido = setInterval(() => res.write(': latido\n\n'), LATIDO_MS);
  let cerrada = false;
  res.on('close', () => {
    if (cerrada) return;
    cerrada = true;
    clearInterval(latido);
    cancelar();
    registrarDesconexion(req.user!.username);
  });
});

/* ===== Equipo y configuración ===== */

atencionRouter.get('/atencion/presencia', async (req: AuthedRequest, res: Response) => {
  try {
    const usuarios = (await listUsers()).filter((usuario) => usuario.role === 'asesor');
    const estados = await Promise.all(usuarios.map((usuario) => obtenerEstadoAsesor(usuario.username)));
    const miEstado = await obtenerEstadoAsesor(req.user!.username);
    res.json({
      yo: { estado: miEstado, conectado: estaConectado(req.user!.username) },
      equipo: usuarios.map((usuario, i) => {
        const conectado = estaConectado(usuario.username);
        const estado = estados[i];
        return {
          username: usuario.username,
          nombre: usuario.fullName,
          area: usuario.area ?? 'all',
          conectado,
          estado,
          disponible: conectado && estado === 'disponible',
          chatwootVinculado: !!usuario.chatwootUserId,
        };
      }),
    });
  } catch (err) {
    responderError(res, err, 'presencia');
  }
});

atencionRouter.post('/atencion/presencia', async (req: AuthedRequest, res: Response) => {
  try {
    const estado = await cambiarEstadoAsesor(req.user!.username, req.body?.estado);
    res.json({ ok: true, estado });
  } catch (err) {
    if (!responderValidacion(res, err)) responderError(res, err, 'actualizar presencia');
  }
});

atencionRouter.get('/atencion/config', requireAdmin, async (_req: AuthedRequest, res: Response) => {
  try {
    res.json({ config: await obtenerConfigAtencion() });
  } catch (err) {
    responderError(res, err, 'consultar configuración');
  }
});

atencionRouter.put('/atencion/config', requireAdmin, async (req: AuthedRequest, res: Response) => {
  try {
    const nueva = await guardarConfigAtencion(req.body?.config);
    await logAudit(req.user!.username, 'atencion_config_actualizada');
    res.json({ config: nueva });
  } catch (err) {
    if (!responderValidacion(res, err)) responderError(res, err, 'actualizar configuración');
  }
});

/** Lo que pide atención del asesor: sin asignar y las suyas con mensajes sin leer. */
atencionRouter.get('/atencion/resumen', async (req: AuthedRequest, res: Response) => {
  try {
    const [{ conversaciones }, yo] = await Promise.all([listarConversaciones('open'), miChatwootId(req)]);
    const sinAsignar = conversaciones.filter((c) => !c.asignado).length;
    const misSinLeer = yo ? conversaciones.filter((c) => c.asignado?.id === yo && c.noLeidos > 0).length : 0;
    res.json({ sinAsignar, misSinLeer, pendientes: sinAsignar + misSinLeer });
  } catch (err) {
    responderError(res, err, 'resumen');
  }
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

atencionRouter.get('/atencion/etiquetas', async (_req: AuthedRequest, res: Response) => {
  try {
    res.json({ etiquetas: await listarEtiquetas() });
  } catch (err) {
    responderError(res, err, 'etiquetas');
  }
});

atencionRouter.get('/atencion/macros', async (_req: AuthedRequest, res: Response) => {
  try {
    res.json({ macros: await listarMacros() });
  } catch (err) {
    responderError(res, err, 'listar macros');
  }
});

atencionRouter.post('/atencion/macros', requireAdmin, async (req: AuthedRequest, res: Response) => {
  try {
    const macro = await crearMacro(req.body, req.user!.username);
    await logAudit(req.user!.username, 'atencion_macro_creada', macro.nombre);
    res.json({ macro });
  } catch (err) {
    if (!responderValidacion(res, err)) responderError(res, err, 'crear macro');
  }
});

atencionRouter.delete('/atencion/macros/:id', requireAdmin, async (req: AuthedRequest, res: Response) => {
  try {
    if (!await eliminarMacro(String(req.params.id))) {
      res.status(404).json({ error: 'no_encontrada', message: 'La macro no existe.' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    responderError(res, err, 'eliminar macro');
  }
});

atencionRouter.get('/atencion/conversaciones', async (req: AuthedRequest, res: Response) => {
  const estado = String(req.query.estado ?? 'open') as EstadoAtencion;
  const asignado = String(req.query.asignado ?? 'todas') as FiltroAsignado;
  const equipoId = req.query.equipo ? idValido(String(req.query.equipo)) : null;
  const etiqueta = req.query.etiqueta ? String(req.query.etiqueta).trim().toLowerCase().replace(/\s+/g, '-') : '';
  if (!ESTADOS_ATENCION.includes(estado) || !FILTROS_ASIGNADO.includes(asignado)) {
    res.status(400).json({ error: 'validation_error', message: 'Filtro no válido.' });
    return;
  }
  try {
    const [{ conversaciones, truncado }, yo] = await Promise.all([listarConversaciones(estado), miChatwootId(req)]);
    const delEquipo = equipoId ? conversaciones.filter((c) => c.equipo?.id === equipoId) : conversaciones;
    const filtradas = etiqueta ? delEquipo.filter((c) => c.etiquetas.some((item) => item.toLowerCase() === etiqueta)) : delEquipo;
    res.json({
      conversaciones: filtrarPorAsignado(filtradas, asignado, yo),
      conteos: contarPorAsignado(filtradas, yo),
      truncado,
    });
  } catch (err) {
    responderError(res, err, 'listar');
  }
});

atencionRouter.post('/atencion/conversaciones/:id/etiquetas', async (req: AuthedRequest, res: Response) => {
  const id = idValido(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'validation_error', message: 'Conversación no válida.' });
    return;
  }
  try {
    const etiquetas = normalizarEtiquetas(req.body?.etiquetas);
    await reemplazarEtiquetas(id, etiquetas);
    publicarAtencion({ tipo: 'asignacion', conversacionId: id });
    await logAudit(req.user!.username, 'atencion_etiquetas', `conv ${id} · ${etiquetas.join(', ') || 'sin etiquetas'}`);
    res.json({ ok: true, etiquetas });
  } catch (err) {
    if (!responderValidacion(res, err)) responderError(res, err, 'actualizar etiquetas');
  }
});

atencionRouter.post('/atencion/conversaciones/:id/adjuntos', async (req: AuthedRequest, res: Response) => {
  const id = idValido(req.params.id);
  const textoValido = req.body?.texto === undefined || typeof req.body.texto === 'string';
  const texto = typeof req.body?.texto === 'string' ? req.body.texto.trim() : '';
  const privado = req.body?.privado === true;
  if (!id || !textoValido || texto.length > 1024) {
    const message = !id ? 'Conversación no válida.'
      : !textoValido ? 'El texto debe ser una cadena.'
      : 'El texto no puede superar 1024 caracteres.';
    res.status(400).json({ error: 'validation_error', message });
    return;
  }
  try {
    const archivo = validarArchivoAdjunto(req.body ?? {});
    if (!privado) {
      const { conversacion } = await obtenerConversacion(id);
      const motivo = conversacion.contacto.telefono ? await motivoVentanaCerrada(conversacion.contacto.telefono) : null;
      if (motivo) {
        res.status(409).json({ error: 'fuera_de_ventana', message: motivo });
        return;
      }
    }
    await enviarAdjunto(id, archivo, texto, privado);
    publicarAtencion({ tipo: 'mensaje', conversacionId: id, entrante: false });
    await logAudit(req.user!.username, 'atencion_adjunto', `conv ${id} · ${archivo.nombre}`);
    res.json({ ok: true });
  } catch (err) {
    if (!responderValidacion(res, err)) responderError(res, err, 'enviar adjunto');
  }
});

atencionRouter.post('/atencion/conversaciones/:id/macros/:macroId', async (req: AuthedRequest, res: Response) => {
  const id = idValido(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'validation_error', message: 'Conversación no válida.' });
    return;
  }
  try {
    const macroGuardada = await buscarMacro(String(req.params.macroId));
    if (!macroGuardada) {
      res.status(404).json({ error: 'no_encontrada', message: 'La macro no existe.' });
      return;
    }
    // Se revalida al leer: una entrada antigua o editada a mano en Redis no
    // debe convertirse en acciones arbitrarias contra Chatwoot.
    const macro = { ...macroGuardada, ...normalizarMacro(macroGuardada) };
    const [{ conversacion }, yo] = await Promise.all([obtenerConversacion(id), miChatwootId(req)]);
    if (macro.acciones.asesorId === 'yo' && !yo) {
      res.status(409).json({ error: 'sin_usuario_chatwoot', message: 'Tu usuario no tiene cuenta de atención vinculada. Pídele a un administrador que la cree.' });
      return;
    }
    if (macro.acciones.mensaje) {
      const motivo = conversacion.contacto.telefono ? await motivoVentanaCerrada(conversacion.contacto.telefono) : null;
      if (motivo) {
        res.status(409).json({ error: 'fuera_de_ventana', message: motivo });
        return;
      }
    }

    const nombreReal = conversacion.contacto.nombre === 'Sin nombre' || esNombreGenerico(conversacion.contacto.nombre, conversacion.contacto.telefono)
      ? null : conversacion.contacto.nombre;
    const etiquetasFinales = macro.acciones.etiquetas
      ? normalizarEtiquetas([...conversacion.etiquetas, ...macro.acciones.etiquetas])
      : undefined;
    const hechos: string[] = [];
    for (const paso of planMacro(macro.acciones)) {
      if (paso.tipo === 'nota') {
        await enviarMensaje(id, String(paso.valor), true);
        hechos.push('Nota privada agregada');
      } else if (paso.tipo === 'mensaje') {
        await enviarMensaje(id, reemplazarNombre(String(paso.valor), nombreReal), false);
        hechos.push('Mensaje enviado');
      } else if (paso.tipo === 'etiquetas') {
        await reemplazarEtiquetas(id, etiquetasFinales!);
        hechos.push('Etiquetas agregadas');
      } else if (paso.tipo === 'equipo') {
        await asignar(id, { equipoId: paso.valor as number | null });
        hechos.push(paso.valor === null ? 'Equipo quitado' : 'Equipo asignado');
      } else if (paso.tipo === 'asesor') {
        const asesorId = paso.valor === 'yo' ? yo! : paso.valor as number | null;
        await asignar(id, { asesorId });
        hechos.push(paso.valor === null ? 'Asesor quitado' : 'Asesor asignado');
      } else {
        await cambiarEstado(id, paso.valor as EstadoAtencion);
        hechos.push(ESTADO_HECHO[paso.valor as EstadoAtencion]);
      }
    }
    publicarAtencion({ tipo: 'asignacion', conversacionId: id });
    await logAudit(req.user!.username, 'atencion_macro', `conv ${id} · ${macro.nombre}`);
    res.json({ ok: true, hechos });
  } catch (err) {
    if (!responderValidacion(res, err)) responderError(res, err, 'ejecutar macro');
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
    publicarAtencion({ tipo: 'mensaje', conversacionId: id, entrante: false });
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
    publicarAtencion({ tipo: 'estado', conversacionId: id });
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
    publicarAtencion({ tipo: 'asignacion', conversacionId: id });
    await logAudit(req.user!.username, 'atencion_asignada', `conv ${id}${asesorId !== undefined ? ` · asesor ${asesorId ?? 'ninguno'}` : ''}${equipoId !== undefined ? ` · equipo ${equipoId ?? 'ninguno'}` : ''}`);
    res.json({ ok: true });
  } catch (err) {
    responderError(res, err, 'asignar');
  }
});
