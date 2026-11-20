/**
 * Notas de voz de WhatsApp → texto.
 *
 * El inbox procesa el mensaje después del ACK a Meta, así que descargar y
 * transcribir aquí no arriesga reintentos del webhook. El audio vive solo en
 * memoria: no se guarda en disco ni en Redis, y los registros nunca llevan la
 * transcripción, solo el motivo cuando algo falla.
 */
import axios from 'axios';
import OpenAI, { toFile } from 'openai';
import { config } from '../config';

const GRAPH_URL = 'https://graph.facebook.com/v20.0';

/** Una nota de voz de WhatsApp (Opus) ocupa unos 100–250 KB por minuto. */
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
/** Lo que pasa a la conversación; el resto se corta para no inflar la IA. */
export const MAX_TRANSCRIPCION = 1000;

/** Formatos que acepta la transcripción de OpenAI, por tipo MIME base. */
const EXTENSIONES: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
};

/** Hosts a los que se puede mandar el token de Meta para bajar el archivo. */
const HOSTS_MEDIA = ['fbsbx.com', 'facebook.com', 'whatsapp.net'];

export type MotivoFalloAudio = 'sin_configurar' | 'muy_grande' | 'formato' | 'descarga' | 'transcripcion' | 'vacio';

export class AudioError extends Error {
  constructor(public readonly motivo: MotivoFalloAudio, public readonly causa?: unknown) {
    super(`audio: ${motivo}`);
    this.name = 'AudioError';
  }
}

export interface AudioDescargado {
  buffer: Buffer;
  mimeType: string;
}

/** 'audio/ogg; codecs=opus' → 'ogg'. Sin formato soportado devuelve null. */
export function extensionDeAudio(mimeType: string | undefined): string | null {
  const base = String(mimeType ?? '').split(';')[0].trim().toLowerCase();
  return EXTENSIONES[base] ?? null;
}

/** Espacios normalizados y longitud acotada. */
export function limpiarTranscripcion(texto: string | undefined): string {
  const limpio = String(texto ?? '').replace(/\s+/g, ' ').trim();
  return limpio.length > MAX_TRANSCRIPCION ? `${limpio.slice(0, MAX_TRANSCRIPCION - 1).trimEnd()}…` : limpio;
}

/** Lo que se le confirma a la persona para que sepa qué entendió el bot. */
export function mensajeEntendido(texto: string): string {
  const corto = texto.length > 180 ? `${texto.slice(0, 179).trimEnd()}…` : texto;
  return `🎧 Te entendí: «${corto}»`;
}

/** Respuesta cuando el audio no se pudo usar. */
export function mensajeAudioFallido(motivo: MotivoFalloAudio): string {
  if (motivo === 'muy_grande') return 'Tu audio es muy largo para mí 🙏 ¿Me lo mandas más corto o por escrito?';
  if (motivo === 'formato') return 'No pude abrir ese audio 🙏 ¿Me lo escribes o me mandas una nota de voz?';
  return 'No pude escuchar tu audio 🙏 ¿Me lo escribes?';
}

export function urlMediaPermitida(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && HOSTS_MEDIA.some(host => u.hostname === host || u.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

type ClienteHttp = Pick<typeof axios, 'get'>;

/** Pide a Meta la URL temporal del archivo y lo baja con el mismo token. */
export async function descargarAudioMeta(
  mediaId: string,
  deps: { http?: ClienteHttp; token?: string } = {},
): Promise<AudioDescargado> {
  const http = deps.http ?? axios;
  const token = deps.token ?? config.metaCloud.token;
  if (!token) throw new AudioError('sin_configurar');
  const headers = { Authorization: `Bearer ${token}` };

  let info: { url?: string; mime_type?: string; file_size?: number };
  try {
    const res = await http.get(`${GRAPH_URL}/${encodeURIComponent(mediaId)}`, { headers, timeout: 15_000 });
    info = res.data ?? {};
  } catch (err) {
    throw new AudioError('descarga', err);
  }
  if (!info.url || !urlMediaPermitida(info.url)) throw new AudioError('descarga');
  if ((info.file_size ?? 0) > MAX_AUDIO_BYTES) throw new AudioError('muy_grande');
  if (!extensionDeAudio(info.mime_type)) throw new AudioError('formato');

  try {
    const res = await http.get(info.url, {
      headers,
      responseType: 'arraybuffer',
      timeout: 30_000,
      maxContentLength: MAX_AUDIO_BYTES,
    });
    return { buffer: Buffer.from(res.data), mimeType: String(info.mime_type) };
  } catch (err) {
    const tamano = (err as { message?: string })?.message?.includes('maxContentLength');
    throw new AudioError(tamano ? 'muy_grande' : 'descarga', err);
  }
}

type ClienteTranscripcion = { audio: { transcriptions: { create: OpenAI['audio']['transcriptions']['create'] } } };

let clientePorDefecto: ClienteTranscripcion | null | undefined;
function cliente(): ClienteTranscripcion | null {
  if (clientePorDefecto === undefined) {
    clientePorDefecto = config.openai.apiKey ? new OpenAI({ apiKey: config.openai.apiKey }) : null;
  }
  return clientePorDefecto;
}

/** Transcribe en español con el modelo configurado. */
export async function transcribirAudio(
  audio: AudioDescargado,
  deps: { openai?: ClienteTranscripcion | null; modelo?: string } = {},
): Promise<string> {
  const openai = deps.openai === undefined ? cliente() : deps.openai;
  if (!openai) throw new AudioError('sin_configurar');
  const extension = extensionDeAudio(audio.mimeType);
  if (!extension) throw new AudioError('formato');

  let texto: string;
  try {
    const archivo = await toFile(audio.buffer, `nota-de-voz.${extension}`, { type: audio.mimeType.split(';')[0] });
    const res = await openai.audio.transcriptions.create({
      file: archivo,
      model: deps.modelo ?? config.openai.transcribeModel,
      language: 'es',
    });
    texto = limpiarTranscripcion(res.text);
  } catch (err) {
    throw new AudioError('transcripcion', err);
  }
  if (!texto) throw new AudioError('vacio');
  return texto;
}

/** Descarga de Meta y transcripción en un solo paso. */
export async function transcribirAudioDeMeta(mediaId: string): Promise<string> {
  return transcribirAudio(await descargarAudioMeta(mediaId));
}
