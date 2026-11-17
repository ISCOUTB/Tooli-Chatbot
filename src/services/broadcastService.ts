import axios from 'axios';
import { config } from '../config';
import {
  BroadcastValidationError, type Ranura, type TipoEncabezado,
  validarTemplateName, validarLanguage, clasificarDestinatarios, encabezadoMediaDe, ranurasDePlantilla, valorParaRanura,
} from './broadcastValidation';
import { describeExternalError } from './logSafe';
import { metaRecipient } from './whatsappId';
import type { ReducirImagen } from './imagenLigera';

// Re-exportados para que la ruta valide el formato sin tocar la API de Meta.
export { BroadcastValidationError, validarTemplateName, validarLanguage };

const GRAPH_URL = 'https://graph.facebook.com/v20.0';

// ── Tipos (forma real que responde Meta) ────────────────────────────────────

export interface ApprovedTemplate {
  name: string;
  language: string;
  category: string;
  components: unknown[];
}

// Cache en memoria: evita golpear la API de Meta en cada render del panel
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
let cache: { data: ApprovedTemplate[]; at: number } | null = null;

// ── Listado de templates aprobados ──────────────────────────────────────────

/**
 * Todas las páginas de plantillas de la cuenta. Meta pagina la lista: una
 * lista parcial haría que una plantilla aprobada pareciera inexistente y
 * bloquearía su envío.
 */
async function leerPlantillasDeMeta(params: Record<string, string | number>): Promise<Record<string, unknown>[]> {
  const { wabaId, token } = config.metaCloud;
  const url = `${GRAPH_URL}/${wabaId}/message_templates`;
  const items: Record<string, unknown>[] = [];
  const seenCursors = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < 100; page++) {
    const res = await axios.get(url, {
      params: { ...params, limit: 100, ...(after ? { after } : {}) },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15_000,
    });
    if (!Array.isArray(res.data?.data)) {
      throw new Error('Meta devolvió una lista de templates inválida');
    }
    for (const item of res.data.data as unknown[]) {
      if (item && typeof item === 'object') items.push(item as Record<string, unknown>);
    }
    // Reusar la URL fija y pasar solo el cursor evita seguir un `paging.next`
    // arbitrario incluido en una respuesta externa.
    const cursor = res.data?.paging?.cursors?.after;
    if (!res.data?.paging?.next) return items;
    if (typeof cursor !== 'string' || !cursor || seenCursors.has(cursor)) {
      throw new Error('Paginación de templates de Meta inválida');
    }
    seenCursors.add(cursor);
    after = cursor;
  }
  throw new Error('La lista de templates de Meta supera el límite de páginas');
}

function aPlantilla(t: Record<string, unknown>): ApprovedTemplate {
  return {
    name: String(t.name ?? ''),
    language: String(t.language ?? ''),
    category: String(t.category ?? ''),
    components: Array.isArray(t.components) ? (t.components as unknown[]) : [],
  };
}

/**
 * Lista templates con status=APPROVED del WABA configurado.
 * Respuesta real de Meta: { data: [{ name, language, category, components, ... }] }
 * Requiere WHATSAPP_WABA_ID y WHATSAPP_TOKEN válidos.
 */
export async function listApprovedTemplates(): Promise<ApprovedTemplate[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }
  const { wabaId, token } = config.metaCloud;
  if (!wabaId || !token) {
    // Sin credenciales no hay templates — devolver vacío honesto, no inventar
    return [];
  }
  const templates = (await leerPlantillasDeMeta({ status: 'APPROVED' })).map(aPlantilla);
  cache = { data: templates, at: Date.now() };
  return templates;
}

export interface PlantillaConEstado extends ApprovedTemplate {
  id: string;
  /** APPROVED, PENDING, REJECTED, PAUSED, DISABLED, IN_APPEAL… tal como lo da Meta. */
  status: string;
  /** Código de Meta (PROMOTIONAL, INVALID_FORMAT…) o '' si no fue rechazada. */
  rejectedReason: string;
}

/**
 * Todas las plantillas de la cuenta con su estado, para que el panel muestre
 * también las que Meta está revisando o rechazó. De paso refresca la lista de
 * aprobadas: una plantilla que el panel ya ve aprobada se puede enviar enseguida.
 */
export async function listarPlantillasConEstado(): Promise<PlantillaConEstado[]> {
  const { wabaId, token } = config.metaCloud;
  if (!wabaId || !token) return [];
  const todas = (await leerPlantillasDeMeta({ fields: 'id,name,status,language,category,components,rejected_reason' }))
    .map(t => ({
      ...aPlantilla(t),
      id: String(t.id ?? ''),
      status: String(t.status ?? '').toUpperCase(),
      rejectedReason: t.rejected_reason && t.rejected_reason !== 'NONE' ? String(t.rejected_reason) : '',
    }));
  cache = { data: todas.filter(t => t.status === 'APPROVED').map(aPlantilla), at: Date.now() };
  return todas;
}

/** Limpia el cache (útil para tests). */
export function clearTemplateCache(): void {
  cache = null;
}

// ── Envío masivo ────────────────────────────────────────────────────────────

export interface BroadcastResult {
  enviados: string[];
  fallidos: { numero: string; error: string }[];
  solicitados: number;
  duplicadosOmitidos: number;
}

/**
 * Envía un template APROBADO a una lista de números. Nunca texto libre: fuera
 * de la ventana de 24 h de Meta solo un template aprobado puede iniciar la
 * conversación, y este servicio no ofrece otro formato.
 *
 * Limitación documentada: solo templates SIN placeholders {{1}} por ahora.
 * Si el template requiere parámetros, la API de Meta responderá error;
 * ese caso se reporta en `fallidos` sin tumbar el resto.
 *
 * Cada número se intenta independientemente (sin fail-fast): los números con
 * formato inválido van directo a `fallidos` con el motivo, sin bloquear a los
 * demás. Solo se cuenta `enviado` tras la confirmación de Meta, nunca antes.
 * Delay de ~300ms entre envíos para no golpear rate limits de golpe.
 *
 * Privacidad: acá no se loguea ningún teléfono ni payload. El detalle por
 * número vuelve en el resultado (visible solo para el admin que emite) y la
 * ruta solo registra template + conteos.
 */
export async function sendBroadcast(
  templateName: string,
  language: string,
  recipients: string[],
): Promise<BroadcastResult> {
  const name = validarTemplateName(templateName);
  const lang = validarLanguage(language);
  // Normaliza (dígitos), valida E.164, deduplica y aplica el tope de lote.
  // Los inválidos ya vienen clasificados para el resumen parcial.
  const { validos, invalidos, solicitados, duplicadosOmitidos } = clasificarDestinatarios(recipients);
  if (validos.length === 0) {
    return { enviados: [], fallidos: invalidos, solicitados, duplicadosOmitidos };
  }
  const { token, phoneNumberId, wabaId } = config.metaCloud;
  if (!token || !phoneNumberId || !wabaId) {
    throw new Error('Faltan credenciales de Meta (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_WABA_ID)');
  }

  // Preflight único: evita intentar hasta 200 envíos con un template que no
  // existe, no está aprobado para el idioma o exige parámetros. Este envío
  // directo no lleva datos por destinatario; las campañas usan la cola.
  if (await ensureApprovedTemplate(name, lang) > 0) {
    throw new BroadcastValidationError(TEMPLATE_CON_VARIABLES);
  }
  const encabezado = await prepararEncabezado(name, lang);

  const enviados: string[] = [];
  const fallidos: { numero: string; error: string }[] = [...invalidos];

  for (let i = 0; i < validos.length; i++) {
    const to = validos[i];
    if (i > 0) await new Promise<void>(resolve => setTimeout(resolve, 300));
    try {
      await sendTemplateToRecipient(name, lang, to, [], encabezado);
      enviados.push(to);
    } catch (err: unknown) {
      fallidos.push({ numero: to, error: extractError(err) });
    }
  }

  return { enviados, fallidos, solicitados, duplicadosOmitidos };
}

export const TEMPLATE_CON_VARIABLES =
  'Esa plantilla usa variables ({{1}}…): hay que enviar los datos de cada destinatario';

/**
 * Preflight antes de crear un trabajo persistente o enviar un lote directo.
 * Devuelve los lugares que hay que llenar (cuerpo, encabezado y botones).
 */
export async function ranurasAprobadas(name: string, lang: string): Promise<Ranura[]> {
  const approved = (await listApprovedTemplates()).find(t => t.name === name && t.language === lang);
  if (!approved) {
    throw new BroadcastValidationError(`El template ${name} (${lang}) no está aprobado o no existe`);
  }
  return ranurasDePlantilla(approved.components);
}

/** Cuántos valores pide la plantilla por destinatario. */
export async function ensureApprovedTemplate(name: string, lang: string): Promise<number> {
  return (await ranurasAprobadas(name, lang)).length;
}

/**
 * Los componentes del mensaje. Sin `ranuras` (trabajos creados antes de que
 * existieran) todos los valores van al cuerpo, en orden.
 */
export function componentesDelEnvio(
  parametros: string[], encabezado: EncabezadoEnvio | null, ranuras?: Ranura[],
): Record<string, unknown>[] {
  const lugares: Ranura[] = ranuras ?? parametros.map((_v, i) => ({ lugar: 'cuerpo' as const, numero: i + 1 }));
  const valor = (lugar: Ranura, i: number) => ({ type: 'text', text: valorParaRanura(lugar, parametros[i] ?? '') });
  const cuerpo = lugares.flatMap((r, i) => (r.lugar === 'cuerpo' ? [valor(r, i)] : []));
  const textoEncabezado = lugares.flatMap((r, i) => (r.lugar === 'encabezado' ? [valor(r, i)] : []));
  const componentes: Record<string, unknown>[] = [];
  if (encabezado) {
    componentes.push({ type: 'header', parameters: [{ type: encabezado.tipo, [encabezado.tipo]: { id: encabezado.mediaId } }] });
  } else if (textoEncabezado.length) {
    componentes.push({ type: 'header', parameters: textoEncabezado });
  }
  if (cuerpo.length) componentes.push({ type: 'body', parameters: cuerpo });
  lugares.forEach((r, i) => {
    if (r.lugar === 'boton') {
      componentes.push({ type: 'button', sub_type: 'url', index: String(r.indice), parameters: [valor(r, i)] });
    }
  });
  return componentes;
}

/** Archivo ya subido a Meta, listo para adjuntarse como encabezado de la plantilla. */
export interface EncabezadoEnvio {
  tipo: TipoEncabezado;
  mediaId: string;
}

/** Topes de WhatsApp por tipo de archivo; el de documentos se acota para no cargar la memoria. */
export const MAX_BYTES_ENCABEZADO: Record<TipoEncabezado, number> = {
  image: 5 * 1024 * 1024, video: 16 * 1024 * 1024, document: 20 * 1024 * 1024,
};
/** Una imagen más pesada que el tope se reduce; más allá de esto ni se descarga. */
const MAX_BYTES_IMAGEN_ORIGINAL = 25 * 1024 * 1024;

const megas = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;

/**
 * Deja un archivo dentro del tope de WhatsApp. Una imagen pesada se convierte
 * en un JPEG más liviano (Meta aprueba plantillas con imágenes que después no
 * deja enviar); un video o documento pesado no se puede achicar aquí.
 */
export async function ajustarAlTope(
  tipo: TipoEncabezado, buffer: Buffer, mime: string, reducir?: ReducirImagen,
): Promise<{ buffer: Buffer; mime: string; reducida: boolean }> {
  if (buffer.length <= MAX_BYTES_ENCABEZADO[tipo]) return { buffer, mime, reducida: false };
  if (tipo !== 'image') {
    throw new BroadcastValidationError(
      `El ${tipo === 'video' ? 'video' : 'documento'} pesa ${megas(buffer.length)} y WhatsApp admite hasta ${megas(MAX_BYTES_ENCABEZADO[tipo])}. ` +
      'Usa una versión más liviana.',
    );
  }
  const reductor = reducir ?? (await import('./imagenLigera')).reducirImagen;
  try {
    const ligera = await reductor(buffer, mime);
    if (ligera.buffer.length > MAX_BYTES_ENCABEZADO.image) throw new Error('sigue pasando el tope');
    return { buffer: ligera.buffer, mime: ligera.mime, reducida: true };
  } catch (err) {
    console.error('[broadcast] reducir imagen:', describeExternalError(err));
    throw new BroadcastValidationError(
      `La imagen pesa ${megas(buffer.length)}, más de los 5 MB que admite WhatsApp, y no se pudo reducir. Usa una imagen más liviana.`,
    );
  }
}
// Meta conserva un archivo subido 30 días; aquí se reutiliza unas horas.
const ENCABEZADO_TTL_MS = 6 * 60 * 60 * 1000;
const encabezados = new Map<string, { encabezado: EncabezadoEnvio; at: number }>();

/** Limpia la caché de archivos subidos (útil para tests). */
export function clearEncabezadoCache(): void {
  encabezados.clear();
}

/**
 * Si la plantilla lleva imagen, video o documento en el encabezado, deja ese
 * archivo subido a Meta y devuelve su identificador; si no, null.
 *
 * Se usa el mismo archivo con el que Meta aprobó la plantilla: el asesor no
 * tiene que adjuntar nada y el mensaje sale igual al que se aprobó. Se sube a
 * Meta en vez de enviar la dirección porque esa dirección está firmada y vence.
 */
export async function prepararEncabezado(
  name: string, lang: string, reducir?: ReducirImagen,
): Promise<EncabezadoEnvio | null> {
  const approved = (await listApprovedTemplates()).find(t => t.name === name && t.language === lang);
  if (!approved) {
    throw new BroadcastValidationError(`El template ${name} (${lang}) no está aprobado o no existe`);
  }
  const media = encabezadoMediaDe(approved.components);
  if (!media) return null;

  // La firma de la dirección cambia; la ruta identifica el archivo.
  const clave = `${name}|${lang}|${new URL(media.ejemplo).pathname}`;
  const guardado = encabezados.get(clave);
  if (guardado && Date.now() - guardado.at < ENCABEZADO_TTL_MS) return guardado.encabezado;

  const { token, phoneNumberId } = config.metaCloud;
  if (!token || !phoneNumberId) throw new Error('Faltan credenciales de Meta');
  try {
    const descarga = await axios.get<ArrayBuffer>(media.ejemplo, {
      responseType: 'arraybuffer', timeout: 30_000, maxRedirects: 0,
      maxContentLength: media.tipo === 'image' ? MAX_BYTES_IMAGEN_ORIGINAL : MAX_BYTES_ENCABEZADO[media.tipo],
    });
    const mimeOriginal = String(descarga.headers?.['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!mimeOriginal || (media.tipo !== 'document' && !mimeOriginal.startsWith(`${media.tipo}/`))) {
      throw new BroadcastValidationError('El archivo del encabezado no es del tipo que declara la plantilla');
    }
    const { buffer, mime } = await ajustarAlTope(media.tipo, Buffer.from(descarga.data), mimeOriginal, reducir);
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mime }), `encabezado.${mime.split('/')[1] ?? 'bin'}`);
    form.append('messaging_product', 'whatsapp');
    form.append('type', mime);
    const subida = await axios.post(`${GRAPH_URL}/${phoneNumberId}/media`, form, {
      headers: { Authorization: `Bearer ${token}` }, timeout: 60_000,
    });
    const mediaId = String(subida.data?.id ?? '');
    if (!/^\d{5,40}$/.test(mediaId)) throw new Error('Meta no devolvió el identificador del archivo');
    const encabezado: EncabezadoEnvio = { tipo: media.tipo, mediaId };
    encabezados.set(clave, { encabezado, at: Date.now() });
    return encabezado;
  } catch (err) {
    if (err instanceof BroadcastValidationError) throw err;
    console.error('[broadcast] encabezado:', describeExternalError(err));
    // Mensaje para el asesor: el envío no se creó y nadie recibió nada.
    throw new BroadcastValidationError(
      'No se pudo preparar el archivo del encabezado de la plantilla en Meta. Intenta de nuevo en unos minutos.',
    );
  }
}

/**
 * Un único intento externo. El job registra su inicio ANTES de llamar aquí.
 * `parametros` llena las variables del cuerpo en orden ({{1}}, {{2}}…);
 * `encabezado` adjunta el archivo de las plantillas que lo exigen.
 */
export async function sendTemplateToRecipient(
  name: string, lang: string, to: string, parametros: string[] = [], encabezado: EncabezadoEnvio | null = null,
  ranuras?: Ranura[],
): Promise<void> {
  const { token, phoneNumberId } = config.metaCloud;
  if (!token || !phoneNumberId) throw new Error('Faltan credenciales de Meta');
  const url = `${GRAPH_URL}/${phoneNumberId}/messages`;
  const components = componentesDelEnvio(parametros, encabezado, ranuras);
  await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          ...metaRecipient(to),
          type: 'template',
          template: {
            name,
            language: { code: lang },
            ...(components.length ? { components } : {}),
          },
        },
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          timeout: 15_000,
        },
      );
}

export function extractError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const metaCode = err.response?.data?.error?.code;
      const code = Number.isInteger(metaCode) ? `, código ${metaCode}` : '';
      return `Meta rechazó el envío (HTTP ${status}${code})`;
    }
    return 'Resultado del envío no confirmado; revisar antes de reenviar.';
  }
  return describeExternalError(err);
}
