// Adaptador de Telnyx (Voice API / Call Control v2). Portado de FastFood (src/lib/voice/providers/telnyx.ts):
// mismo parseo, mismos comandos y mismo `command_id` (Telnyx ignora el repetido en 60 s: reintentos sin duplicar).
// Cambios en Tooli: cliente HTTP axios (el del repo), `stopSpeaking` para el barge-in, resultados parciales de la
// transcripción (interim) para detectar que la persona habla encima, y speak que puede encolarse.
//
// SIN PROBAR CON CUENTA REAL (FastFood tampoco lo probó): `playback_stop` sobre un `speak` en curso, `interim_results`
// del motor Google y que un `speak` sin `stop` se encole. Ver VOZ_PROGRESO.md.
import axios from 'axios';
import { verifyTelnyxSignature } from '../signature';
import type { ConnectionTestResult, HeaderBag, ProviderCredentials, SpeakOptions, VoiceEvent, VoiceEventKind, VoiceProvider } from './tipos';

export const TELNYX_API = 'https://api.telnyx.com/v2';

function kindOf(eventType: string): VoiceEventKind {
  switch (eventType) {
    case 'call.initiated': return 'incoming';
    case 'call.answered': return 'answered';
    case 'call.transcription': return 'speech';
    case 'call.speak.started': return 'speak_started';
    case 'call.speak.ended': return 'speak_ended';
    case 'call.hangup': return 'hangup';
    default: return 'other';
  }
}

function str(v: unknown, max = 200): string | null {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;
}

function header(headers: HeaderBag, name: string): string | null {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === 'string' ? v : null;
}

/** Parseo defensivo: cualquier campo raro queda en null; sin id de evento o de llamada, no hay evento. */
export function parseTelnyxEvent(rawBody: string): VoiceEvent | null {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const data = (body as { data?: Record<string, unknown> })?.data;
  if (!data || typeof data !== 'object') return null;
  const payload = (data.payload ?? {}) as Record<string, unknown>;
  const eventId = str(data.id, 120);
  const rawType = str(data.event_type, 80) ?? '';
  const callId = str(payload.call_control_id, 200);
  if (!eventId || !callId) return null;
  const kind = kindOf(rawType);
  const event: VoiceEvent = {
    eventId,
    kind,
    rawType,
    callId,
    from: str(payload.from, 40),
    to: str(payload.to, 40),
    direction: payload.direction === 'incoming' || payload.direction === 'outgoing' ? payload.direction : null,
    occurredAt: str(data.occurred_at, 40),
  };
  if (kind === 'speech') {
    const td = (payload.transcription_data ?? payload) as Record<string, unknown>;
    event.transcript = str(td.transcript, 1000) ?? '';
    event.isFinal = td.is_final === undefined ? true : td.is_final === true;
  }
  if (kind === 'hangup') {
    const start = Date.parse(String(payload.start_time ?? ''));
    const end = Date.parse(String(payload.end_time ?? ''));
    event.durationSeconds = Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.round((end - start) / 1000) : null;
    event.hangupCause = str(payload.hangup_cause, 60);
  }
  return event;
}

/** Cuerpo del comando speak (puro, se prueba). */
export function speakBody(text: string, opts: SpeakOptions): Record<string, unknown> {
  return {
    payload: text.slice(0, 2800),
    payload_type: 'text',
    voice: opts.voice,
    language: opts.language,
    service_level: 'premium',
    // Lo nuevo corta lo que estaba sonando, salvo la respuesta que va detrás de la frase puente.
    ...(opts.interrumpir === false ? {} : { stop: 'current' }),
    command_id: opts.commandId,
  };
}

export function listenBody(language: string, commandId: string): Record<string, unknown> {
  return {
    transcription_engine: 'Google',
    transcription_engine_config: { transcription_engine: 'Google', language: language.slice(0, 2), interim_results: true },
    transcription_tracks: 'inbound',
    command_id: commandId,
  };
}

async function command(creds: ProviderCredentials, callId: string, action: string, body: Record<string, unknown>): Promise<void> {
  const url = `${TELNYX_API}/calls/${encodeURIComponent(callId)}/actions/${action}`;
  const headers = { Authorization: `Bearer ${creds.apiKey}`, 'Content-Type': 'application/json' };
  let lastErr: unknown = null;
  // Con command_id el reintento es seguro (Telnyx ignora el repetido).
  for (let intento = 0; intento < 2; intento++) {
    try {
      const res = await axios.post(url, body, { headers, timeout: 8000, validateStatus: () => true });
      if (res.status >= 200 && res.status < 300) return;
      lastErr = new Error(`Telnyx ${action} respondió ${res.status}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Telnyx ${action} falló`);
}

export const telnyxProvider: VoiceProvider = {
  id: 'telnyx',
  label: 'Telnyx',
  verifyWebhook({ rawBody, headers, publicKey, nowSeconds }) {
    return verifyTelnyxSignature({
      rawBody,
      signatureB64: header(headers, 'telnyx-signature-ed25519'),
      timestamp: header(headers, 'telnyx-timestamp'),
      publicKeyB64: publicKey,
      nowSeconds,
    });
  },
  parseEvent: parseTelnyxEvent,
  answer: (creds, callId, commandId) => command(creds, callId, 'answer', { command_id: commandId }),
  speak: (creds, callId, text, opts) => command(creds, callId, 'speak', speakBody(text, opts)),
  stopSpeaking: (creds, callId, commandId) => command(creds, callId, 'playback_stop', { stop: 'all', command_id: commandId }),
  startListening: (creds, callId, language, commandId) => command(creds, callId, 'transcription_start', listenBody(language, commandId)),
  transfer: (creds, callId, to, commandId) => command(creds, callId, 'transfer', { to, command_id: commandId }),
  hangup: (creds, callId, commandId) => command(creds, callId, 'hangup', { command_id: commandId }),
  startRecording: (creds, callId, commandId) =>
    command(creds, callId, 'record_start', { format: 'mp3', channels: 'single', command_id: commandId }),
  async estadoLlamada(creds, callId) {
    try {
      const res = await axios.get(`${TELNYX_API}/calls/${encodeURIComponent(callId)}`, {
        headers: { Authorization: `Bearer ${creds.apiKey}`, Accept: 'application/json' }, timeout: 8000, validateStatus: () => true,
      });
      // 404/422 (error 90015): la llamada no existe o terminó hace más de 10 min.
      if (res.status === 404 || res.status === 422) return { viva: false, duracionSeg: null };
      if (res.status < 200 || res.status >= 300) return null;
      const data = (res.data as { data?: { is_alive?: unknown; call_duration?: unknown } } | null)?.data;
      if (typeof data?.is_alive !== 'boolean') return null;
      const dur = Number(data.call_duration);
      return { viva: data.is_alive, duracionSeg: Number.isFinite(dur) && dur >= 0 ? Math.round(dur) : null };
    } catch {
      return null;
    }
  },
  async testConnection(creds, phoneNumber): Promise<ConnectionTestResult> {
    const headers = { Authorization: `Bearer ${creds.apiKey}`, Accept: 'application/json' };
    let balance: string | null = null;
    try {
      const res = await axios.get(`${TELNYX_API}/balance`, { headers, timeout: 8000, validateStatus: () => true });
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: 'Telnyx no aceptó la llave. Cópiala de nuevo desde «API Keys» en la cuenta.' };
      }
      if (res.status < 200 || res.status >= 300) return { ok: false, message: `Telnyx respondió ${res.status}. Inténtalo en un momento.` };
      const d = (res.data as { data?: { balance?: string; currency?: string } } | null)?.data;
      balance = d?.balance ? `${d.balance} ${d.currency ?? ''}`.trim() : null;
    } catch {
      return { ok: false, message: 'No se pudo contactar a Telnyx. Revisa la conexión a internet e inténtalo de nuevo.' };
    }
    let numberFound: boolean | null = null;
    if (phoneNumber) {
      try {
        const res = await axios.get(`${TELNYX_API}/phone_numbers`, {
          headers, timeout: 8000, validateStatus: () => true, params: { 'filter[phone_number]': phoneNumber },
        });
        if (res.status >= 200 && res.status < 300) {
          const j = res.data as { data?: unknown[] } | null;
          numberFound = Array.isArray(j?.data) && j!.data.length > 0;
        }
      } catch {
        numberFound = null;
      }
    }
    if (!creds.publicKey) {
      return { ok: false, balance, numberFound, message: 'La llave funciona, pero falta la llave pública para verificar las llamadas.' };
    }
    if (phoneNumber && numberFound === false) {
      return { ok: false, balance, numberFound, message: `La llave funciona, pero el número ${phoneNumber} no está en esta cuenta de Telnyx.` };
    }
    return { ok: true, balance, numberFound, message: `Conexión lista${balance ? ` · saldo ${balance}` : ''}.` };
  },
};
