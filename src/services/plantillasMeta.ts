/**
 * Crear una plantilla en Meta desde el panel, para que un asesor sin acceso
 * al administrador de WhatsApp pueda proponerla. Meta la revisa y queda en
 * "en revisión" hasta que la aprueba o la rechaza.
 *
 * Con imagen en el encabezado, Meta pide un archivo de muestra subido por su
 * API de subidas reanudables (/{app-id}/uploads), que devuelve un "handle".
 * El token de producción es de un usuario del sistema con el permiso
 * whatsapp_business_management, que alcanza para ambas cosas.
 */
import axios from 'axios';
import { config } from '../config';
import { BroadcastValidationError } from './broadcastValidation';
import { ajustarAlTope, clearTemplateCache } from './broadcastService';
import { describeExternalError } from './logSafe';
import { PlantillaInvalidaError, type PlantillaNuevaValidada, componentesParaMeta } from './plantillaNueva';
import type { ReducirImagen } from './imagenLigera';

const GRAPH_URL = 'https://graph.facebook.com/v20.0';
const MIME_IMAGEN = new Set(['image/jpeg', 'image/png']);

let appId: string | null = null;

/** Para pruebas. */
export function olvidarAppId(): void {
  appId = null;
}

async function idDeLaApp(): Promise<string> {
  if (appId) return appId;
  const r = await axios.get(`${GRAPH_URL}/app`, {
    params: { fields: 'id' }, headers: { Authorization: `Bearer ${config.metaCloud.token}` }, timeout: 15_000,
  });
  const id = String(r.data?.id ?? '');
  if (!/^\d{5,25}$/.test(id)) throw new Error('Meta no devolvió el identificador de la app');
  appId = id;
  return id;
}

/** Sube la imagen de muestra y devuelve el handle que pide la plantilla. */
async function subirImagenMuestra(buffer: Buffer, mime: string): Promise<string> {
  const { token } = config.metaCloud;
  const app = await idDeLaApp();
  const sesion = await axios.post(`${GRAPH_URL}/${app}/uploads`, null, {
    params: { file_name: `encabezado.${mime === 'image/png' ? 'png' : 'jpg'}`, file_length: buffer.length, file_type: mime },
    headers: { Authorization: `Bearer ${token}` }, timeout: 15_000,
  });
  const idSubida = String(sesion.data?.id ?? '');
  // Formato documentado: "upload:<id>?sig=<firma>". Nada más se acepta en la ruta.
  if (!/^upload:[A-Za-z0-9_\-=:+/.]+(\?sig=[A-Za-z0-9_\-=:+/.%]+)?$/.test(idSubida)) {
    throw new Error('Meta no abrió la subida de la imagen');
  }
  const subida = await axios.post(`${GRAPH_URL}/${idSubida}`, buffer, {
    headers: { Authorization: `OAuth ${token}`, file_offset: '0', 'Content-Type': 'application/octet-stream' },
    timeout: 60_000, maxBodyLength: buffer.length + 1024,
  });
  const handle = String(subida.data?.h ?? '');
  if (!handle) throw new Error('Meta no devolvió la referencia de la imagen');
  return handle;
}

/** El motivo que Meta da al rechazar la creación, legible para el asesor. */
function motivoDeMeta(err: unknown): string | null {
  if (!axios.isAxiosError(err)) return null;
  const e = err.response?.data?.error;
  if (!e || err.response!.status >= 500) return null;
  const partes = [e.error_user_title, e.error_user_msg].filter((x: unknown) => typeof x === 'string' && x.trim());
  const texto = partes.length ? partes.join(': ') : typeof e.message === 'string' ? e.message : '';
  return texto ? texto.replace(/\s+/g, ' ').trim().slice(0, 400) : null;
}

export interface ImagenSubida {
  base64: string;
  mime: string;
}

export interface PlantillaCreada {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
}

export async function crearPlantillaEnMeta(
  plantilla: PlantillaNuevaValidada, imagen: ImagenSubida | null, reducir?: ReducirImagen,
): Promise<PlantillaCreada> {
  const { token, wabaId } = config.metaCloud;
  if (!token || !wabaId) throw new Error('Faltan credenciales de Meta');

  let handle = '';
  if (plantilla.encabezado.tipo === 'imagen') {
    if (!imagen || !MIME_IMAGEN.has(imagen.mime)) {
      throw new PlantillaInvalidaError('La imagen del encabezado debe ser JPG o PNG.');
    }
    const original = Buffer.from(imagen.base64, 'base64');
    if (!original.length) throw new PlantillaInvalidaError('La imagen del encabezado llegó vacía.');
    try {
      const { buffer, mime } = await ajustarAlTope('image', original, imagen.mime, reducir);
      handle = await subirImagenMuestra(buffer, mime);
    } catch (err) {
      if (err instanceof BroadcastValidationError) throw new PlantillaInvalidaError(err.message);
      const motivo = motivoDeMeta(err);
      console.error('[plantillas] imagen de muestra:', describeExternalError(err));
      throw new PlantillaInvalidaError(motivo ? `Meta no aceptó la imagen: ${motivo}` : 'No se pudo subir la imagen a Meta. Intenta de nuevo en unos minutos.');
    }
  }

  try {
    const r = await axios.post(`${GRAPH_URL}/${wabaId}/message_templates`, {
      name: plantilla.name,
      language: plantilla.language,
      category: plantilla.category,
      components: componentesParaMeta(plantilla, handle),
    }, { headers: { Authorization: `Bearer ${token}` }, timeout: 20_000 });
    clearTemplateCache();
    return {
      id: String(r.data?.id ?? ''),
      name: plantilla.name,
      language: plantilla.language,
      status: String(r.data?.status ?? 'PENDING').toUpperCase(),
      category: String(r.data?.category ?? plantilla.category).toUpperCase(),
    };
  } catch (err) {
    const motivo = motivoDeMeta(err);
    console.error('[plantillas] crear:', describeExternalError(err));
    if (motivo) throw new PlantillaInvalidaError(`Meta no aceptó la plantilla: ${motivo}`);
    throw new Error('No se pudo crear la plantilla en Meta');
  }
}
