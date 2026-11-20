import type { InboundMessage } from '../adapters/messaging/IMessagingAdapter';
import { config } from '../config';
import { handleMessage } from '../flows';
import { handlePosgradoMessage } from '../flows/posgrados-evento';
import { messaging } from '../flows/shared';
import { checkUserRateLimit } from './rateLimit';
import { isBanned, recordActivity } from './botUserService';
import { track } from './metrics';
import { describeExternalError, maskPhone } from './logSafe';
import { resolveWhatsAppContact } from './whatsappContactService';
import { getSession } from './session';
import { iniciarRecomendacion } from '../flows/recomendacion';
import { atenderAsistencia } from '../flows/asistencia';
import { AudioError, mensajeAudioFallido, mensajeEntendido, transcribirAudioDeMeta } from './transcripcionAudio';

export type InboundSource = 'meta' | 'evolution' | 'chatwoot';

function describeUnsupportedMedia(mediaType?: string): string {
  return mediaType === 'audio' || mediaType === 'voice' ? 'un audio'
    : mediaType === 'sticker' ? 'un sticker'
    : mediaType === 'video' ? 'un video'
    : mediaType === 'document' ? 'un documento'
    : mediaType === 'location' ? 'una ubicación'
    : mediaType === 'contacts' ? 'un contacto'
    : 'un mensaje que WhatsApp no deja leer';
}

let avisoLeidoFallido = false;

/**
 * Marca el mensaje como leído (los dos chulitos azules) y, si el bot va a
 * responder, muestra "escribiendo…" mientras la IA piensa. No se espera: si
 * WhatsApp no lo acepta, la respuesta sale igual (y el error se anota una vez).
 */
function marcarLeido(inbound: InboundMessage, escribiendo: boolean): void {
  if (!messaging.marcarLeido || !inbound.messageId) return;
  messaging.marcarLeido(inbound.messageId, escribiendo).catch((err: unknown) => {
    if (avisoLeidoFallido) return;
    avisoLeidoFallido = true;
    console.warn('[inbound] no se pudo marcar como leído:', describeExternalError(err));
  });
}

/**
 * Convierte una nota de voz en el texto con el que sigue la conversación.
 * Devuelve null cuando ya se le respondió a la persona y no hay nada más que hacer.
 */
async function atenderAudio(from: string, inbound: InboundMessage): Promise<string | null> {
  const session = await getSession(from);
  const conAsesor = session?.step === 'with_agent';
  if (!config.audios.transcribir || !inbound.mediaId) {
    await recordActivity(from, 'in', '📎 Envió un audio');
    await messaging.sendText({ to: from, text: 'Por ahora solo puedo leer mensajes de texto 🙏 Escríbeme lo que necesitas.' });
    if (!session) await iniciarRecomendacion(from);
    return null;
  }
  try {
    const texto = await transcribirAudioDeMeta(inbound.mediaId);
    await track('audio_transcrito');
    await recordActivity(from, 'in', `🎤 ${texto}`);
    // El asesor recibe la transcripción en Chatwoot; a la persona no hace falta repetírsela.
    if (conAsesor) return `🎤 Audio: ${texto}`;
    await messaging.sendText({ to: from, text: mensajeEntendido(texto) });
    return texto;
  } catch (err) {
    const motivo = err instanceof AudioError ? err.motivo : 'transcripcion';
    await track('audio_fallido');
    console.warn('[inbound] audio sin transcribir:', motivo, maskPhone(from));
    await recordActivity(from, 'in', '🎤 Envió un audio (no se pudo transcribir)');
    if (conAsesor) {
      await handleMessage(from, '🎤 Envió un audio que el bot no pudo transcribir');
      await messaging.sendText({ to: from, text: 'No pude pasarle tu audio al asesor 🙏 ¿Se lo escribes?' });
      return null;
    }
    await messaging.sendText({ to: from, text: mensajeAudioFallido(motivo) });
    if (!session) await iniciarRecomendacion(from);
    return null;
  }
}

/** Ejecutado por el inbox, nunca por el webhook HTTP después del ACK. */
export async function processInboundMessage(
  source: InboundSource, inbound: InboundMessage,
): Promise<'handled' | 'ignored'> {
  if (source === 'chatwoot') {
    const { forwardChatwootEvent } = await import('../routes/chatwootWebhook');
    await forwardChatwootEvent(JSON.parse(inbound.text));
    return 'handled';
  }
  const from = source === 'meta'
    ? await resolveWhatsAppContact(inbound)
    : await messaging.resolveSenderId(inbound.from);
  if (from.endsWith('@lid')) {
    console.warn('[inbound] número @lid sin resolver:', maskPhone(from));
    return 'ignored';
  }
  if (await isBanned(from)) return 'ignored';

  // El audio se registra después de transcribirlo, con lo que dijo la persona.
  const esAudio = inbound.text === '__audio__';
  if (!esAudio) {
    await recordActivity(
      from,
      'in',
      inbound.text === '__unsupported__'
        ? `📎 Envió ${describeUnsupportedMedia(inbound.mediaType)}`
        : inbound.text,
    );
  }
  // El límite va antes de transcribir: un audio repetido no debe gastar en la IA.
  const limit = await checkUserRateLimit(from);
  if (!limit.allowed) {
    if (esAudio) await recordActivity(from, 'in', '🎤 Envió un audio');
    await track('rate_limited');
    if (limit.firstBlock) {
      await messaging.sendText({
        to: from,
        text: `⚠️ Estás enviando mensajes muy rápido. Espera ${limit.retryAfterSec}s e intenta de nuevo.`,
      });
    }
    return 'ignored';
  }

  // Con un asesor el bot no marca nada: los chulitos azules los pone quien lee en Chatwoot.
  if (source === 'meta') {
    const actual = await getSession(from);
    if (actual?.step !== 'with_agent') marcarLeido(inbound, inbound.text !== '__unsupported__');
  }

  if (inbound.text === '__unsupported__') {
    const session = await getSession(from);
    if (session?.step === 'with_agent') {
      const tipo = describeUnsupportedMedia(inbound.mediaType);
      await handleMessage(from, `📎 Envió ${tipo} (el bot todavía no reenvía este tipo de mensaje)`);
      await messaging.sendText({
        to: from,
        text: 'Tu asesor por ahora solo recibe texto 🙏 Escríbele tu mensaje.',
      });
      return 'handled';
    }
    await messaging.sendText({
      to: from,
      text: 'Por ahora solo puedo leer mensajes de texto 🙏 Escríbeme lo que necesitas.',
    });
    if (!session) await iniciarRecomendacion(from);
    return 'handled';
  }

  let texto = inbound.text;
  if (esAudio) {
    const transcrito = await atenderAudio(from, inbound);
    if (transcrito === null) return 'handled';
    texto = transcrito;
  }

  // El QR de un evento escribe "Registrar mi asistencia: CÓDIGO". Va antes de
  // los flujos porque no depende del paso en que esté la conversación.
  if (await atenderAsistencia(from, texto, inbound.profileName ?? '')) return 'handled';

  if (config.posgradosEvento.activo) {
    await handlePosgradoMessage(from, texto, { ...inbound, text: texto });
  } else {
    await handleMessage(from, texto);
  }
  return 'handled';
}
