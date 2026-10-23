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
  REDIS_URL: z.string().default('redis://redis:6379'),
  SESSION_TTL_SECONDS: z.string().default('3600'),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string(),
  OPENAI_API_KEY: z.string().optional(),
  // ── Meta WhatsApp Cloud API ──────────────────────────────────────────────────
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_WABA_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  // ── NutriA — bot de encuesta ─────────────────────────────────────────────────
  NUTRIA_WHATSAPP_TOKEN: z.string().optional(),
  NUTRIA_PHONE_NUMBER_ID: z.string().optional(),
  NUTRIA_WABA_ID: z.string().optional(),
  NUTRIA_SHEET_ID: z.string().optional(),
  // ── Voluntarios digitales (El Mundo Te Busca) — sale por el número de NutriA ──
  // 'true' hace que el número de NutriA atienda el registro de voluntarios en vez
  // de la encuesta. Apagar para devolver el número a NutriA.
  VOLUNTARIOS_ACTIVO: z.string().optional().default('false'),
  VOLUNTARIOS_SHEET_ID: z.string().optional(),
  // ── Google Sheets — registro de prospectos de posgrado ───────────────────────
  // ID del spreadsheet donde se guardan los registros (compartir con service account)
  POSGRADO_REGISTRO_SHEET_ID: z.string().optional(),
  // ── Evento Talento Tech — flujo temporal en el número de Posgrados ────────────
  // 'true' activa el flujo del evento (reemplaza el menú clásico). Apagar tras el evento.
  EVENTO_FLOW_ACTIVO: z.string().optional().default('false'),
  EVENTO_SHEET_ID: z.string().optional(),
  // ── Evento Posgrados (sábado) — capta interesados en posgrado con financiación ─
  POSGRADOS_EVENTO_ACTIVO: z.string().optional().default('false'),
  POSGRADOS_EVENTO_SHEET_ID: z.string().optional(),
  // ── HubSpot CRM (UTB) — empuja leads que dan consentimiento ───────────────────
  HUBSPOT_ACTIVO: z.string().optional().default('false'),
  HUBSPOT_TOKEN: z.string().optional(), // Private App token (scope crm.objects.contacts.write)
  HUBSPOT_FUENTE_VALOR: z.string().optional().default('Bot WhatsApp - Evento Posgrados'),
  // Nombres internos de propiedades personalizadas (vacío = no se envían)
  HUBSPOT_PROP_POSGRADO: z.string().optional(),
  HUBSPOT_PROP_FUENTE: z.string().optional(),
  HUBSPOT_PROP_CONSENTIMIENTO: z.string().optional(),
  HUBSPOT_PROP_FINANCIACION: z.string().optional(),
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
  APP_BASE_URL: z.string().default('https://tooli-stand.duckdns.org'),
  // ── Verificación por correo (OTP) — Resend ───────────────────────────────────
  // API key de https://resend.com. MAIL_FROM debe ser de un dominio verificado
  // en Resend para producción (sin dominio solo se puede enviar al correo propio).
  RESEND_API_KEY: z.string().optional().default(''),
  MAIL_FROM: z.string().optional().default('onboarding@resend.dev'),
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
  },
  redis: {
    url: env.REDIS_URL,
    sessionTtl: parseInt(env.SESSION_TTL_SECONDS),
  },
  nutria: {
    token: env.NUTRIA_WHATSAPP_TOKEN ?? '',
    phoneNumberId: env.NUTRIA_PHONE_NUMBER_ID ?? '',
    wabaId: env.NUTRIA_WABA_ID ?? '',
    sheetId: env.NUTRIA_SHEET_ID ?? '',
  },
  voluntarios: {
    activo: env.VOLUNTARIOS_ACTIVO === 'true',
    sheetId: env.VOLUNTARIOS_SHEET_ID ?? '',
  },
  google: {
    serviceAccount: JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON),
    registroPosgradoSheetId: env.POSGRADO_REGISTRO_SHEET_ID ?? '',
  },
  evento: {
    activo: env.EVENTO_FLOW_ACTIVO === 'true',
    sheetId: env.EVENTO_SHEET_ID ?? '',
  },
  posgradosEvento: {
    activo: env.POSGRADOS_EVENTO_ACTIVO === 'true',
    sheetId: env.POSGRADOS_EVENTO_SHEET_ID ?? '',
  },
  hubspot: {
    activo: env.HUBSPOT_ACTIVO === 'true',
    token: env.HUBSPOT_TOKEN ?? '',
    fuenteValor: env.HUBSPOT_FUENTE_VALOR ?? 'Bot WhatsApp - Evento Posgrados',
    propPosgrado: env.HUBSPOT_PROP_POSGRADO ?? '',
    propFuente: env.HUBSPOT_PROP_FUENTE ?? '',
    propConsentimiento: env.HUBSPOT_PROP_CONSENTIMIENTO ?? '',
    propFinanciacion: env.HUBSPOT_PROP_FINANCIACION ?? '',
  },
  openai: {
    apiKey: env.OPENAI_API_KEY,
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
  },
  appBaseUrl: env.APP_BASE_URL,
  mail: {
    apiKey: env.RESEND_API_KEY ?? '',
    from: env.MAIL_FROM ?? 'onboarding@resend.dev',
  },
};
