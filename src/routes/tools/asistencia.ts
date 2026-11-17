/**
 * Asistencia a eventos: eventos con QR, lista de asistentes e importación
 * desde Excel o CSV. Ver `src/services/asistenciaService.ts`.
 */

import { Router, Response } from 'express';
import { AuthedRequest } from '../../middleware/auth';
import { logAudit } from '../../services/auditService';
import { describeError } from '../../services/logSafe';
import {
  AsistenciaError, actualizarEvento, crearEvento, eliminarAsistente, eliminarEvento,
  getEvento, idEventoValido, importarAsistentes, listarAsistentes, listarEventos, registrarAsistente,
} from '../../services/asistenciaService';
import {
  ImportacionInvalidaError, leerTablaArchivo, normalizarCelular, prepararImportacion, validarMapeo,
} from '../../services/asistenciaImport';
import { enlaceWhatsApp, textoQr } from '../../flows/asistenciaView';

export const asistenciaRouter = Router();

/** Un archivo de 3 MB ocupa cerca de 4 MB en base64; el cuerpo admite 5 MB. */
const MAX_ARCHIVO_BASE64 = 4_400_000;

function responderError(res: Response, operacion: string, err: unknown): void {
  if (err instanceof AsistenciaError) {
    const status = err.code === 'not_found' ? 404 : err.code === 'invalid_data' ? 400 : 409;
    res.status(status).json({ error: err.code, message: err.message });
    return;
  }
  if (err instanceof ImportacionInvalidaError) {
    res.status(400).json({ error: 'archivo_invalido', message: err.message });
    return;
  }
  console.error(`[tools/asistencia/${operacion}] error:`, describeError(err));
  res.status(500).json({ error: 'internal_error', message: 'Error interno del servidor' });
}

/** El evento de la ruta, o responde 404 y devuelve null. */
async function eventoDeRuta(req: AuthedRequest, res: Response) {
  const id = String(req.params.id ?? '');
  const evento = idEventoValido(id) ? await getEvento(id) : null;
  if (!evento) res.status(404).json({ error: 'not_found', message: 'El evento no existe' });
  return evento;
}

asistenciaRouter.get('/asistencia/eventos', async (_req: AuthedRequest, res: Response) => {
  try {
    res.json({ eventos: await listarEventos() });
  } catch (err) {
    responderError(res, 'eventos', err);
  }
});

asistenciaRouter.post('/asistencia/eventos', async (req: AuthedRequest, res: Response) => {
  try {
    const evento = await crearEvento(req.body ?? {}, req.user!.username);
    await logAudit(req.user!.username, 'asistencia_evento_creado', `${evento.nombre} · ${evento.sector}`);
    res.status(201).json({ ok: true, evento });
  } catch (err) {
    responderError(res, 'crear', err);
  }
});

asistenciaRouter.get('/asistencia/eventos/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const evento = await eventoDeRuta(req, res);
    if (!evento) return;
    res.json({ evento, asistentes: await listarAsistentes(evento.id) });
  } catch (err) {
    responderError(res, 'detalle', err);
  }
});

/**
 * El QR aparte del detalle: la lista se refresca cada pocos segundos mientras
 * el evento está proyectado, y la imagen no cambia.
 */
asistenciaRouter.get('/asistencia/eventos/:id/qr', async (req: AuthedRequest, res: Response) => {
  try {
    const evento = await eventoDeRuta(req, res);
    if (!evento) return;
    const { numeroPublicoBot } = await import('../../services/whatsappNumeroPublico');
    const numero = await numeroPublicoBot();
    const texto = textoQr(evento.codigo);
    if (!numero) {
      // Sin el número del bot no hay enlace: el panel muestra el texto para dictarlo.
      res.json({ texto, enlace: null, imagen: null });
      return;
    }
    const enlace = enlaceWhatsApp(numero, evento.codigo);
    const QRCode = await import('qrcode');
    const imagen = await QRCode.toDataURL(enlace, { errorCorrectionLevel: 'M', margin: 2, width: 720 });
    res.json({ texto, enlace, imagen, numero });
  } catch (err) {
    responderError(res, 'qr', err);
  }
});

asistenciaRouter.patch('/asistencia/eventos/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const previo = await eventoDeRuta(req, res);
    if (!previo) return;
    const { nombre, sector, fecha, lugar, estado } = req.body ?? {};
    const evento = await actualizarEvento(previo.id, { nombre, sector, fecha, lugar, estado });
    const detalle = evento.estado !== previo.estado
      ? `${evento.nombre} · registro ${evento.estado}`
      : `${evento.nombre} · datos editados`;
    await logAudit(req.user!.username, 'asistencia_evento_actualizado', detalle);
    res.json({ ok: true, evento });
  } catch (err) {
    responderError(res, 'actualizar', err);
  }
});

/** Borra el evento y su lista. Solo quien lo creó o un administrador. */
asistenciaRouter.delete('/asistencia/eventos/:id', async (req: AuthedRequest, res: Response) => {
  try {
    const evento = await eventoDeRuta(req, res);
    if (!evento) return;
    if (req.user!.role !== 'admin' && evento.creadoPor !== req.user!.username) {
      res.status(403).json({ error: 'forbidden', message: 'Solo quien creó el evento o un administrador puede eliminarlo' });
      return;
    }
    const total = (await listarAsistentes(evento.id)).length;
    await eliminarEvento(evento.id);
    await logAudit(req.user!.username, 'asistencia_evento_eliminado', `${evento.nombre} · ${total} asistentes`);
    res.json({ ok: true });
  } catch (err) {
    responderError(res, 'eliminar', err);
  }
});

/** Anotar a mano a quien no pudo escanear el QR. */
asistenciaRouter.post('/asistencia/eventos/:id/asistentes', async (req: AuthedRequest, res: Response) => {
  try {
    const evento = await eventoDeRuta(req, res);
    if (!evento) return;
    const { nombre, whatsapp, correo, documento, programa, consentimiento } = req.body ?? {};
    if (String(whatsapp ?? '').trim() && !normalizarCelular(String(whatsapp))) {
      res.status(400).json({ error: 'invalid_data', message: 'El celular no es válido: usa 10 dígitos o incluye el indicativo' });
      return;
    }
    const resultado = await registrarAsistente(
      evento.id, { nombre, whatsapp, correo, documento, programa },
      { origen: 'manual', consentimiento: consentimiento === true },
    );
    await logAudit(req.user!.username, 'asistencia_persona_agregada', evento.nombre);
    res.status(resultado.nuevo ? 201 : 200).json({ ok: true, ...resultado });
  } catch (err) {
    responderError(res, 'agregar', err);
  }
});

asistenciaRouter.delete('/asistencia/eventos/:id/asistentes', async (req: AuthedRequest, res: Response) => {
  try {
    const evento = await eventoDeRuta(req, res);
    if (!evento) return;
    // La clave viaja en el cuerpo: lleva el celular o el correo de la persona
    // y una URL termina en los registros del proxy.
    const eliminado = await eliminarAsistente(evento.id, String(req.body?.clave ?? ''));
    if (!eliminado) {
      res.status(404).json({ error: 'not_found', message: 'Esa persona ya no está en la lista' });
      return;
    }
    await logAudit(req.user!.username, 'asistencia_persona_eliminada', evento.nombre);
    res.json({ ok: true });
  } catch (err) {
    responderError(res, 'quitar', err);
  }
});

/**
 * Importa una lista desde .xlsx o .csv. Sin `confirmar` solo muestra cómo se
 * leería el archivo (columnas reconocidas, conteos y una muestra) para que el
 * asesor corrija el mapeo antes de guardar nada.
 */
asistenciaRouter.post('/asistencia/eventos/:id/importar', async (req: AuthedRequest, res: Response) => {
  try {
    const evento = await eventoDeRuta(req, res);
    if (!evento) return;
    const { archivo, nombreArchivo, mapeo, confirmar, consentimiento } = req.body ?? {};
    if (typeof archivo !== 'string' || !archivo) {
      res.status(400).json({ error: 'archivo_requerido', message: 'Adjunta un archivo .xlsx o .csv' });
      return;
    }
    if (archivo.length > MAX_ARCHIVO_BASE64) {
      res.status(413).json({ error: 'archivo_muy_grande', message: 'El archivo no puede superar 3 MB' });
      return;
    }
    const tabla = leerTablaArchivo(Buffer.from(archivo, 'base64'), String(nombreArchivo ?? ''));
    const preparada = prepararImportacion(tabla, validarMapeo(mapeo, tabla.columnas.length));
    const resumen = {
      columnas: preparada.columnas,
      mapeo: preparada.mapeo,
      totalFilas: preparada.totalFilas,
      validas: preparada.asistentes.length,
      omitidas: preparada.omitidas,
      sinWhatsapp: preparada.sinWhatsapp,
      celularesInvalidos: preparada.celularesInvalidos,
    };
    if (confirmar !== true) {
      res.json({ ok: true, previa: true, ...resumen, muestra: preparada.asistentes.slice(0, 5) });
      return;
    }
    if (!preparada.asistentes.length) {
      res.status(400).json({ error: 'sin_personas', message: 'El archivo no trae ninguna persona identificable' });
      return;
    }
    const resultado = await importarAsistentes(evento.id, preparada.asistentes, consentimiento === true);
    await logAudit(
      req.user!.username, 'asistencia_importada',
      `${evento.nombre} · ${resultado.nuevos} nuevos, ${resultado.actualizados} actualizados`,
    );
    res.json({ ok: true, previa: false, ...resumen, ...resultado });
  } catch (err) {
    responderError(res, 'importar', err);
  }
});
