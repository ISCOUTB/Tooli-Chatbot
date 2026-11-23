import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.string().default('3000'),
  // Selecciona el adaptador de mensajería activo: 'evolution' (Baileys) o 'meta' (Meta Cloud API)
  MESSAGING_ADAPTER: z.enum(['evolution', 'meta']).default('evolution'),
  EVOLUTION_API_BASE_URL: z.string().url().optional().default('http://localhost:8080'),
  EVOLUTION_API_INSTANCE: z.string().optional().default('tooli'),
  EVOLUTION_API_KEY: z.string().optional().default(''),
  WEBHOOK_SECRET: z.string(),
  // Token propio para /metrics y /dashboard; si falta se usa WEBHOOK_SECRET.
  METRICS_TOKEN: z.string().optional(),
  REDIS_URL: z.string().default('redis://redis:6379'),
  SESSION_TTL_SECONDS: z.string().default('3600'),
  // Cuántas personas atiende el bot a la vez (cada una en orden). Con 1, si 20 escriben juntas la última espera ~40 s.
  INBOUND_CONCURRENCIA: z.string().default('6'),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string(),
  OPENAI_API_KEY: z.string().optional(),
  // Notas de voz: se transcriben y siguen la conversación como texto. 'false' las rechaza como antes.
  TRANSCRIBIR_AUDIOS: z.string().optional().default('true'),
  // Inicio conversacional de posgrados: la IA responde y el bot pregunta con botones. 'true' lo activa.
  FLUJO_CONVERSACIONAL: z.string().optional().default('false'),
  // Una sola vez, 3 horas después, a quien deja sin contestar una pregunta del flujo. 'false' lo apaga.
  SEGUIMIENTO_CONVERSACION: z.string().optional().default('true'),
  // Agenda de asesores por WhatsApp y voz (ofrecer cita fuera de horario, «agendar», «mis citas»). APAGADA por
  // defecto: lo nuevo se enciende a propósito con 'true'.
  AGENDA_ACTIVA: z.string().optional().default('false'),
  // Recomendaciones y fichas con el flyer de cada posgrado (foto oficial + datos). 'false' vuelve al texto.
  FOTOS_PROGRAMAS: z.string().optional().default('true'),
  OPENAI_TRANSCRIBE_MODEL: z.string().optional().default('gpt-4o-mini-transcribe'),
  // ── Meta WhatsApp Cloud API ──────────────────────────────────────────────────
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_WABA_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  // Número del bot para los enlaces wa.me de los QR (solo dígitos, con indicativo).
  // Opcional: con Meta Cloud se consulta solo si no se define.
  WHATSAPP_PUBLIC_NUMBER: z.string().optional(),
  // ── Google Sheets — registro de prospectos de posgrado ───────────────────────
  // ID del spreadsheet donde se guardan los registros (compartir con service account)
  POSGRADO_REGISTRO_SHEET_ID: z.string().optional(),
  // ── Evento Posgrados (sábado) — capta interesados en posgrado con financiación ─
  POSGRADOS_EVENTO_ACTIVO: z.string().optional().default('false'),
  POSGRADOS_EVENTO_SHEET_ID: z.string().optional(),
  // ── HubSpot CRM (UTB) — empuja leads que dan consentimiento ───────────────────
  HUBSPOT_ACTIVO: z.string().optional().default('false'),
  HUBSPOT_TOKEN: z.string().optional(), // Private App token (scope crm.objects.contacts.write)
  HUBSPOT_FUENTE_VALOR: z.string().optional().default('Bot WhatsApp - Evento Posgrados'),
  // Fuente de los leads del flujo de recomendación por pregrado y de sus campañas
  HUBSPOT_FUENTE_RECOMENDACION: z.string().optional().default('Bot WhatsApp - Recomendación por pregrado'),
  HUBSPOT_FUENTE_CAMPANA: z.string().optional().default('Bot WhatsApp - Campaña por pregrado'),
  // Nombres internos de propiedades personalizadas (vacío = no se envían)
  HUBSPOT_PROP_POSGRADO: z.string().optional(),
  HUBSPOT_PROP_FUENTE: z.string().optional(),
  HUBSPOT_PROP_CONSENTIMIENTO: z.string().optional(),
  HUBSPOT_PROP_FINANCIACION: z.string().optional(),
  HUBSPOT_PROP_PREGRADO: z.string().optional(),
  HUBSPOT_PROP_RELACION: z.string().optional(),
  // ─────────────────────────────────────────────────────────────────────────────
  CHATWOOT_URL: z.string().optional(),
  CHATWOOT_ACCOUNT_ID: z.string().optional(),
  CHATWOOT_INBOX_ID: z.string().optional(),
  CHATWOOT_API_TOKEN: z.string().optional(),
  CHATWOOT_HMAC_TOKEN: z.string().optional(),
  CHATWOOT_WEBHOOK_TOKEN: z.string().optional(),
  CHATWOOT_INBOX_IDENTIFIER: z.string().optional(),
  CHATWOOT_TEAM_TI_ID: z.string().optional(),
  CHATWOOT_TEAM_ADMISIONES_ID: z.string().optional(),
  CHATWOOT_PLATFORM_TOKEN: z.string().optional(),
  JWT_SECRET: z.string().min(16).default('cambia-este-secreto-largo-para-jwt-tooli-2026'),
  ADMIN_USER: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().default('admin'),
  PUBLIC_CHATWOOT_URL: z.string().default('http://localhost:3001'),
  PUBLIC_GRAFANA_URL: z.string().default('http://localhost:3002'),
  PUBLIC_PANEL_URL: z.string().default('https://tooli-utb.duckdns.org'),
  APP_BASE_URL: z.string().default('https://tooli-stand.duckdns.org'),
  // ── Verificación por correo (OTP) — Resend ───────────────────────────────────
  // API key de https://resend.com. MAIL_FROM debe ser de un dominio verificado
  // en Resend para producción (sin dominio solo se puede enviar al correo propio).
  RESEND_API_KEY: z.string().optional().default(''),
  MAIL_FROM: z.string().optional().default('onboarding@resend.dev'),
  // ── Línea de voz (Telnyx Call Control v2) — sin estas llaves la línea queda apagada y solo corre el simulador ──
  TELNYX_API_KEY: z.string().optional().default(''),
  TELNYX_PUBLIC_KEY: z.string().optional().default(''),
  TELNYX_CONNECTION_ID: z.string().optional().default(''),
  TELNYX_PHONE_NUMBER: z.string().optional().default(''),
  // Clave larga y aleatoria que va en la URL del webhook: /voice/telnyx/<clave>
  VOICE_WEBHOOK_KEY: z.string().optional().default(''),
  VOICE_AI_MODEL: z.string().optional().default('gpt-4o-mini'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  port: parseInt(env.PORT),
  messagingAdapter: env.MESSAGING_ADAPTER,
  webhookSecret: env.WEBHOOK_SECRET,
  metricsToken: env.METRICS_TOKEN || env.WEBHOOK_SECRET,
  evolutionApi: {
    baseUrl: env.EVOLUTION_API_BASE_URL ?? 'http://localhost:8080',
    instance: env.EVOLUTION_API_INSTANCE ?? 'tooli',
    apiKey: env.EVOLUTION_API_KEY ?? '',
  },
  metaCloud: {
    token: env.WHATSAPP_TOKEN ?? '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    wabaId: env.WHATSAPP_WABA_ID ?? '',
    verifyToken: env.WHATSAPP_VERIFY_TOKEN ?? env.WEBHOOK_SECRET,
    appSecret: env.META_APP_SECRET ?? '',
    publicNumber: (env.WHATSAPP_PUBLIC_NUMBER ?? '').replace(/\D/g, ''),
  },
  redis: {
    url: env.REDIS_URL,
    sessionTtl: parseInt(env.SESSION_TTL_SECONDS),
  },
  inbound: {
    concurrencia: Math.max(1, Math.min(20, parseInt(env.INBOUND_CONCURRENCIA, 10) || 6)),
  },
  google: {
    serviceAccount: JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON),
    registroPosgradoSheetId: env.POSGRADO_REGISTRO_SHEET_ID ?? '',
  },
  posgradosEvento: {
    activo: env.POSGRADOS_EVENTO_ACTIVO === 'true',
    sheetId: env.POSGRADOS_EVENTO_SHEET_ID ?? '',
  },
  hubspot: {
    activo: env.HUBSPOT_ACTIVO === 'true',
    token: env.HUBSPOT_TOKEN ?? '',
    fuenteValor: env.HUBSPOT_FUENTE_VALOR ?? 'Bot WhatsApp - Evento Posgrados',
    fuenteRecomendacion: env.HUBSPOT_FUENTE_RECOMENDACION ?? 'Bot WhatsApp - Recomendación por pregrado',
    fuenteCampana: env.HUBSPOT_FUENTE_CAMPANA ?? 'Bot WhatsApp - Campaña por pregrado',
    propPosgrado: env.HUBSPOT_PROP_POSGRADO ?? '',
    propFuente: env.HUBSPOT_PROP_FUENTE ?? '',
    propConsentimiento: env.HUBSPOT_PROP_CONSENTIMIENTO ?? '',
    propFinanciacion: env.HUBSPOT_PROP_FINANCIACION ?? '',
    propPregrado: env.HUBSPOT_PROP_PREGRADO ?? '',
    propRelacion: env.HUBSPOT_PROP_RELACION ?? '',
  },
  openai: {
    apiKey: env.OPENAI_API_KEY,
    transcribeModel: env.OPENAI_TRANSCRIBE_MODEL ?? 'gpt-4o-mini-transcribe',
  },
  audios: {
    transcribir: env.TRANSCRIBIR_AUDIOS !== 'false',
  },
  conversacion: {
    activa: env.FLUJO_CONVERSACIONAL === 'true',
  },
  seguimiento: {
    activo: env.SEGUIMIENTO_CONVERSACION !== 'false',
  },
  agenda: {
    activa: env.AGENDA_ACTIVA === 'true',
  },
  fotos: {
    activas: env.FOTOS_PROGRAMAS !== 'false',
  },
  chatwoot: {
    url: env.CHATWOOT_URL ?? '',
    accountId: env.CHATWOOT_ACCOUNT_ID ?? '',
    inboxId: env.CHATWOOT_INBOX_ID ?? '',
    apiToken: env.CHATWOOT_API_TOKEN ?? '',
    hmacToken: env.CHATWOOT_HMAC_TOKEN ?? '',
    webhookToken: env.CHATWOOT_WEBHOOK_TOKEN ?? '',
    inboxIdentifier: env.CHATWOOT_INBOX_IDENTIFIER ?? '',
    teamTiId: env.CHATWOOT_TEAM_TI_ID ?? '',
    teamAdmisionesId: env.CHATWOOT_TEAM_ADMISIONES_ID ?? '',
    platformToken: env.CHATWOOT_PLATFORM_TOKEN ?? '',
  },
  auth: {
    jwtSecret: env.JWT_SECRET,
    adminUser: env.ADMIN_USER,
    adminPassword: env.ADMIN_PASSWORD,
  },
  publicUrls: {
    chatwoot: env.PUBLIC_CHATWOOT_URL,
    grafana: env.PUBLIC_GRAFANA_URL,
    panel: env.PUBLIC_PANEL_URL,
  },
  appBaseUrl: env.APP_BASE_URL,
  mail: {
    apiKey: env.RESEND_API_KEY ?? '',
    from: env.MAIL_FROM ?? 'onboarding@resend.dev',
  },
  voz: {
    telnyxApiKey: env.TELNYX_API_KEY ?? '',
    telnyxPublicKey: env.TELNYX_PUBLIC_KEY ?? '',
    telnyxConnectionId: env.TELNYX_CONNECTION_ID ?? '',
    telnyxPhoneNumber: env.TELNYX_PHONE_NUMBER ?? '',
    webhookKey: env.VOICE_WEBHOOK_KEY ?? '',
    aiModel: env.VOICE_AI_MODEL || 'gpt-4o-mini',
  },
};
