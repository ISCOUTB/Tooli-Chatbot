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
  transfer(creds: ProviderCredentials, callId: string, to: string, commandId: string): Promise<void>;
  hangup(creds: ProviderCredentials, callId: string, commandId: string): Promise<void>;
  startRecording(creds: ProviderCredentials, callId: string, commandId: string): Promise<void>;
  testConnection(creds: ProviderCredentials, phoneNumber: string | null): Promise<ConnectionTestResult>;
}
