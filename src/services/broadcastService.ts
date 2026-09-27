import axios from 'axios';
import { config } from '../config';
import {
  BroadcastValidationError,
  validarTemplateName, validarLanguage, clasificarDestinatarios,
} from './broadcastValidation';
import { describeError } from './logSafe';

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

  const url = `${GRAPH_URL}/${wabaId}/message_templates`;
  const res = await axios.get(url, {
    params: { status: 'APPROVED' },
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15_000,
  });

  // Meta responde { data: [...] } — si no hay data, devolver vacío
  const raw: unknown[] = res.data?.data ?? [];
  const templates: ApprovedTemplate[] = raw.map((item: unknown) => {
    const t = item as Record<string, unknown>;
    return {
      name: String(t.name ?? ''),
      language: String(t.language ?? ''),
      category: String(t.category ?? ''),
      components: Array.isArray(t.components) ? (t.components as unknown[]) : [],
    };
  });

  cache = { data: templates, at: Date.now() };
  return templates;
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
  // existe, no está aprobado para el idioma o exige parámetros no soportados.
  const approved = (await listApprovedTemplates()).find(t => t.name === name && t.language === lang);
  if (!approved) {
    throw new BroadcastValidationError(`El template ${name} (${lang}) no está aprobado o no existe`);
  }
  if (JSON.stringify(approved.components).includes('{{')) {
    throw new BroadcastValidationError('Ese template requiere parámetros y todavía no es compatible con envíos masivos');
  }

  const url = `${GRAPH_URL}/${phoneNumberId}/messages`;
  const enviados: string[] = [];
  const fallidos: { numero: string; error: string }[] = [...invalidos];

  for (let i = 0; i < validos.length; i++) {
    const to = validos[i];
    // Delay entre envíos (excepto el primero) para no saturar rate limit
    if (i > 0) {
      await new Promise<void>(resolve => setTimeout(resolve, 300));
    }
    try {
      await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: { name, language: { code: lang } },
        },
        {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          timeout: 15_000,
        },
      );
      enviados.push(to);
    } catch (err: unknown) {
      const msg = extractError(err);
      fallidos.push({ numero: to, error: msg });
    }
  }

  return { enviados, fallidos, solicitados, duplicadosOmitidos };
}

function extractError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as Record<string, unknown> | undefined;
    // Forma real de error de Meta: { error: { message, error_user_msg, code } }
    const metaErr = data?.error as Record<string, unknown> | undefined;
    if (metaErr?.message) return describeError(String(metaErr.message));
    if (data?.error) return describeError(String(data.error));
    if (err.message) return describeError(err);
  }
  return describeError(err);
}
