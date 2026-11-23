// Interfaz común de proveedores de telefonía con voz. Portado de FastFood (src/lib/voice/providers/types.ts).
// Telnyx es el primero; otro proveedor implementa esto mismo y el resto del canal de voz no cambia.
// Añadido en Tooli: `stopSpeaking` (barge-in) y `interrumpir` en speak.

export type VoiceEventKind = 'incoming' | 'answered' | 'speech' | 'speak_started' | 'speak_ended' | 'hangup' | 'other';

export interface VoiceEvent {
  /** Id único del evento (idempotencia). */
  eventId: string;
  kind: VoiceEventKind;
  rawType: string;
  /** Id del proveedor para dar órdenes a esta llamada. */
  callId: string;
  from: string | null;
  to: string | null;
  direction: 'incoming' | 'outgoing' | null;
  /** Solo `speech`: lo que dijo quien llama. */
  transcript?: string;
  /** Solo `speech`: false = resultado parcial (sirve para el barge-in, no para responder). */
  isFinal?: boolean;
  occurredAt: string | null;
  /** Solo `hangup`: duración en segundos si el proveedor la manda. */
  durationSeconds?: number | null;
  hangupCause?: string | null;
  /**
   * Estado que la app pegó a la llamada (Telnyx `client_state`, ya decodificado). Así se reconoce la pata saliente de
   * una transferencia, que llega con otro id de llamada (`target_leg_client_state`).
   */
  clientState?: string | null;
}

export interface TransferOptions {
  /** Duración máxima de la pata saliente (s). Sin esto, Telnyx deja hasta 4 h. */
  limiteSeg?: number;
  /** Estado que llevarán los eventos de la pata saliente (para atarla a la llamada original). */
  estadoPata?: string;
  /**
   * Cuánto timbra el asesor antes de dar la transferencia por fallida (`timeout_secs`, 5-600; Telnyx usa 30 por
   * defecto). Más corto que el buzón de voz del celular: si el buzón contesta primero, Telnyx manda `call.answered` y
   * quien llama queda hablándole al buzón (revisión 23-nov).
   */
  timbreSeg?: number;
}

export interface ProviderCredentials {
  apiKey: string;
  publicKey: string | null;
  connectionId: string | null;
}

export interface SpeakOptions {
  voice: string;
  language: string;
  /** Idempotencia del comando en el proveedor. */
  commandId: string;
  /** true (por defecto): corta lo que esté sonando. false: se encola detrás (respuesta después de la frase puente). */
  interrumpir?: boolean;
}

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  balance?: string | null;
  numberFound?: boolean | null;
}

export type HeaderBag = Record<string, string | string[] | undefined>;

export interface VoiceProvider {
  id: string;
  label: string;
  verifyWebhook(args: { rawBody: string; headers: HeaderBag; publicKey: string | null; nowSeconds?: number }): { ok: true } | { ok: false; reason: string };
  parseEvent(rawBody: string): VoiceEvent | null;
  answer(creds: ProviderCredentials, callId: string, commandId: string): Promise<void>;
  speak(creds: ProviderCredentials, callId: string, text: string, opts: SpeakOptions): Promise<void>;
  /** Corta lo que está sonando (barge-in: la persona habló encima). */
  stopSpeaking(creds: ProviderCredentials, callId: string, commandId: string): Promise<void>;
  startListening(creds: ProviderCredentials, callId: string, language: string, commandId: string): Promise<void>;
  /** Deja de transcribir (al transferir: la charla con el asesor no es para el bot). */
  stopListening(creds: ProviderCredentials, callId: string, commandId: string): Promise<void>;
  transfer(creds: ProviderCredentials, callId: string, to: string, commandId: string, opts?: TransferOptions): Promise<void>;
  hangup(creds: ProviderCredentials, callId: string, commandId: string): Promise<void>;
  startRecording(creds: ProviderCredentials, callId: string, commandId: string): Promise<void>;
  /**
   * Estado de una llamada en el proveedor (reconciliar una que quedó «activa»). null = no se pudo saber. Telnyx:
   * GET /v2/calls/{call_control_id} (`is_alive`, `call_duration`; guarda el dato 10 min después de colgar).
   */
  estadoLlamada?(creds: ProviderCredentials, callId: string): Promise<{ viva: boolean; duracionSeg: number | null } | null>;
  testConnection(creds: ProviderCredentials, phoneNumber: string | null): Promise<ConnectionTestResult>;
}
