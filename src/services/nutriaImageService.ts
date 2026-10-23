import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { config } from '../config';

const GRAPH_URL = 'https://graph.facebook.com/v20.0';

/** Directorio donde se guardan las imágenes dentro del contenedor */
const UPLOADS_DIR = path.join(__dirname, '../../uploads/nutria');

/** Asegura que el directorio de uploads exista */
function ensureDir(): void {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Descarga una imagen de la Media API de Meta y la guarda en disco.
 * Retorna una URL accesible solo con sesión de asesor.
 */
export async function guardarImagenMeta(
  mediaId: string,
  token: string
): Promise<string> {
  ensureDir();

  // Paso 1: obtener URL temporal del archivo
  const metaRes = await axios.get(`${GRAPH_URL}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15_000,
  });
  const { url, mime_type } = metaRes.data as { url: string; mime_type: string };

  // Paso 2: descargar el archivo
  if (mime_type !== 'image/jpeg' && mime_type !== 'image/png' && mime_type !== 'image/webp') {
    throw new Error('Tipo de imagen no permitido');
  }
  const ext = mime_type === 'image/png' ? 'png' : mime_type === 'image/webp' ? 'webp' : 'jpg';
  const filename = `${randomUUID()}.${ext}`;
  const filepath = path.join(UPLOADS_DIR, filename);

  const imgRes = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: 'arraybuffer',
    timeout: 30_000,
    maxContentLength: 10 * 1024 * 1024,
  });

  const bytes = Buffer.from(imgRes.data);
  if (bytes.length > 10 * 1024 * 1024) throw new Error('Imagen demasiado grande');
  fs.writeFileSync(filepath, bytes, { flag: 'wx', mode: 0o600 });

  const publicUrl = `${config.appBaseUrl}/uploads/nutria/${filename}`;
  console.log('[nutria] imagen guardada');
  return publicUrl;
}
