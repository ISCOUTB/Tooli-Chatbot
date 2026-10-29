import axios from 'axios';
import { config } from '../config';
import {
  BroadcastValidationError,
  validarTemplateName, validarLanguage, clasificarDestinatarios, contarVariablesCuerpo,
} from './broadcastValidation';
import { describeExternalError } from './logSafe';

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
  const templates: ApprovedTemplate[] = [];
  const seenCursors = new Set<string>();
  let after: string | undefined;
  // Meta pagina los templates. Una lista parcial haría que un template
  // aprobado pareciera inexistente y bloquearía su envío.
  for (let page = 0; page < 100; page++) {
    const res = await axios.get(url, {
      params: { status: 'APPROVED', limit: 100, ...(after ? { after } : {}) },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15_000,
    });
    if (!Array.isArray(res.data?.data)) {
      throw new Error('Meta devolvió una lista de templates inválida');
    }
    for (const item of res.data.data as unknown[]) {
      if (!item || typeof item !== 'object') continue;
      const t = item as Record<string, unknown>;
      templates.push({
        name: String(t.name ?? ''),
        language: String(t.language ?? ''),
        category: String(t.category ?? ''),
        components: Array.isArray(t.components) ? (t.components as unknown[]) : [],
      });
    }
    // Reusar la URL fija y pasar solo el cursor evita seguir un `paging.next`
    // arbitrario incluido en una respuesta externa.
    const cursor = res.data?.paging?.cursors?.after;
    if (!res.data?.paging?.next) {
      cache = { data: templates, at: Date.now() };
      return templates;
    }
    if (typeof cursor !== 'string' || !cursor || seenCursors.has(cursor)) {
      throw new Error('Paginación de templates de Meta inválida');
    }
    seenCursors.add(cursor);
    after = cursor;
  }
  throw new Error('La lista de templates de Meta supera el límite de páginas');
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

  const enviados: string[] = [];
  const fallidos: { numero: string; error: string }[] = [...invalidos];

  for (let i = 0; i < validos.length; i++) {
    const to = validos[i];
    if (i > 0) await new Promise<void>(resolve => setTimeout(resolve, 300));
    try {
      await sendTemplateToRecipient(name, lang, to);
      enviados.push(to);
    } catch (err: unknown) {
      fallidos.push({ numero: to, error: extractError(err) });
    }
  }

  return { enviados, fallidos, solicitados, duplicadosOmitidos };
}

export const TEMPLATE_CON_VARIABLES =
  'Ese template usa variables {{1}}; envíalo como campaña, con los datos de cada destinatario';

/**
 * Preflight antes de crear un trabajo persistente o enviar un lote directo.
 * Devuelve cuántas variables `{{n}}` usa el cuerpo de la plantilla.
 */
export async function ensureApprovedTemplate(name: string, lang: string): Promise<number> {
  const approved = (await listApprovedTemplates()).find(t => t.name === name && t.language === lang);
  if (!approved) {
    throw new BroadcastValidationError(`El template ${name} (${lang}) no está aprobado o no existe`);
  }
  return contarVariablesCuerpo(approved.components);
}

/**
 * Un único intento externo. El job registra su inicio ANTES de llamar aquí.
 * `parametros` llena las variables del cuerpo en orden ({{1}}, {{2}}…).
 */
export async function sendTemplateToRecipient(name: string, lang: string, to: string, parametros: string[] = []): Promise<void> {
  const { token, phoneNumberId } = config.metaCloud;
  if (!token || !phoneNumberId) throw new Error('Faltan credenciales de Meta');
  const url = `${GRAPH_URL}/${phoneNumberId}/messages`;
  await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name,
            language: { code: lang },
            ...(parametros.length
              ? { components: [{ type: 'body', parameters: parametros.map(text => ({ type: 'text', text })) }] }
              : {}),
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
