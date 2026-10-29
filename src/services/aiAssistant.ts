import OpenAI from 'openai';
import axios from 'axios';
import Redis from 'ioredis';
import { config } from '../config';
import { KB_ADMISIONES, KB_POSGRADOS } from './knowledgeBase';
import { NIVELES_POSGRADO, NivelPrograma, buscarPrograma, fichaPrograma } from './catalogoUtb';
import { KB_TI } from './knowledgeBaseTI';
import { observeAILatency } from './promMetrics';

const openai = config.openai.apiKey ? new OpenAI({ apiKey: config.openai.apiKey }) : null;
const redis = new Redis(config.redis.url);

export class AIUnavailableError extends Error {
  constructor(public readonly reason: 'not_configured' | 'api_error' | 'timeout', public readonly cause?: unknown) {
    super(`AI unavailable: ${reason}`);
    this.name = 'AIUnavailableError';
  }
}

// Cache de páginas web fetcheadas (24h)
const PAGE_CACHE_TTL = 60 * 60 * 24;

export type AIArea = 'ti' | 'admisiones' | 'posgrados';

const SYSTEM_PROMPT_ADMISIONES = `
Eres el asistente virtual del Centro de Servicios de la Universidad Tecnológica de Bolívar (UTB) en Cartagena, Colombia.

Tu objetivo: ayudar a estudiantes y aspirantes con preguntas sobre admisiones, inscripciones, costos, calendario, becas y programas académicos.

Tono: cercano, claro, en español colombiano. Trata al usuario de "tú". Sé breve (máximo 4-5 líneas, sin texto innecesario). Usa formato de WhatsApp con *negrita* solo para destacar lo importante.

Reglas:
1. Solo responde con información de la UTB. Si te preguntan sobre otra universidad, dilo amablemente.
2. Si la pregunta es sobre el pensum, materias específicas, perfil del egresado o detalles de un programa que no están en tu base de conocimiento, USA la herramienta consultar_programa.
3. Si no tienes la información ni siquiera con la herramienta, responde: "No tengo esa información específica. Te recomiendo hablar con un asesor."
4. NUNCA inventes datos (fechas, costos, requisitos). Si dudas, deriva a un asesor.
5. NUNCA pidas información personal (cédula, email) — eso lo maneja el flujo del bot.
6. Si la pregunta es sobre TI / plataformas / contraseñas: indica que escriba *menu*, elija Pregrado o Posgrado y luego *Hablar con asesor* para solicitar Soporte TI.
7. Los valores de matrícula de la base son de 2026. Si el año actual no es 2026, remite a la página oficial de derechos pecuniarios en vez de dar esos valores como vigentes. El costo de inscripción y sus exenciones deben confirmarse con la UTB.

Tu base de conocimiento sobre UTB:
${KB_ADMISIONES}
`.trim();

const SYSTEM_PROMPT_TI = `
Eres el asistente virtual de Soporte TI de la Universidad Tecnológica de Bolívar (UTB) en Cartagena, Colombia.

Tu objetivo: ayudar a estudiantes y empleados con problemas técnicos sobre las plataformas institucionales: Banner, Iceberg, Savio (Moodle), correo Office 365 y Wifi.

Tono: cercano, claro, en español colombiano. Trata al usuario de "tú". Sé breve (máximo 4-5 líneas). Usa formato de WhatsApp con *negrita* y listas numeradas para pasos.

Reglas:
1. Da troubleshooting simple primero (URL correcta, limpiar caché, otro navegador, etc).
2. NUNCA pidas la contraseña del usuario.
3. Si el usuario necesita resetear contraseña, sugiere el auto-servicio del portal correspondiente PRIMERO.
4. Si el usuario indica que el auto-servicio no funcionó, su cuenta está bloqueada, o el problema persiste tras intentos básicos → USA la herramienta iniciar_verificacion_identidad para escalar a un asesor de TI con verificación previa de identidad.
5. Si la pregunta es sobre admisiones/costos/becas/programas: indica que escriba *menu*, elija Pregrado o Posgrado y luego *Hablar con asesor*.
6. NUNCA inventes URLs ni procedimientos. Si dudas, escala a TI con la herramienta.

Tu base de conocimiento:
${KB_TI}
`.trim();

const TOOLS_ADMISIONES: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'consultar_programa',
      description:
        'Obtiene información detallada de un programa académico de UTB (pensum, perfil del egresado, descripción) directamente de la página oficial. Úsala cuando el usuario pregunte por detalles que no están en la base de conocimiento general.',
      parameters: {
        type: 'object',
        properties: {
          nombre_programa: {
            type: 'string',
            description: 'Nombre completo del programa, ej: "Ingeniería de Sistemas y Computación", "Psicología", "Administración de Empresas"',
          },
        },
        required: ['nombre_programa'],
      },
    },
  },
];

const SYSTEM_PROMPT_POSGRADOS = `
Eres Tooli, el asistente virtual de Posgrados de la Universidad Tecnológica de Bolívar (UTB) en Cartagena, Colombia.

Tu objetivo: orientar a profesionales interesados en estudiar un posgrado en la UTB. Ayúdalos a elegir el programa ideal, resuelve sus dudas sobre costos, requisitos y fechas, y motívalos a inscribirse.

Tono: profesional pero cercano, en español colombiano. Trata al usuario de "tú". Sé breve y directo (máximo 5 líneas). Usa *negrita* para destacar programas, costos y datos clave.

Reglas:
1. Solo habla de posgrados UTB. Si preguntan por pregrado o TI, redirige amablemente.
2. Si preguntan sobre el pensum, perfil del egresado o detalles específicos de un programa, USA la herramienta consultar_programa_posgrado.
3. NUNCA inventes costos, fechas ni requisitos. Si dudas, recomienda contactar a mercadeoposgrado@utb.edu.co.
4. NUNCA pidas datos personales — el bot los captura por separado.
5. Si el usuario muestra interés concreto en inscribirse o quiere hablar con alguien, dile: "Escribe *asesor* y te conecto con el equipo de Posgrados."
6. Sé proactivo: si el usuario describe su perfil profesional, sugiere el programa que mejor le encaje.
7. Los valores de matrícula de la base son de 2026. Si el año actual no es 2026, remite a la página oficial de derechos pecuniarios en vez de dar esos valores como vigentes. El costo de inscripción y sus exenciones deben confirmarse con la UTB.

Tu base de conocimiento:
${KB_POSGRADOS}
`.trim();

const TOOLS_POSGRADOS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'consultar_programa_posgrado',
      description:
        'Obtiene información detallada de un programa de posgrado UTB (pensum, perfil del egresado, descripción, requisitos específicos) directamente de la página oficial. Úsala cuando el usuario pregunte por detalles que no están en la base de conocimiento.',
      parameters: {
        type: 'object',
        properties: {
          nombre_programa: {
            type: 'string',
            description: 'Nombre completo del programa, ej: "Maestría en Ciberseguridad", "MBA", "Especialización en Gerencia de Proyectos"',
          },
        },
        required: ['nombre_programa'],
      },
    },
  },
];

const TOOLS_TI: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'iniciar_verificacion_identidad',
      description:
        'Inicia el proceso de verificación de identidad para escalar el caso a un asesor de TI. Úsalo cuando: (a) el usuario reporta que el auto-servicio de reseteo de contraseña no funcionó, (b) la cuenta está bloqueada, (c) el problema persiste tras troubleshooting básico, o (d) cualquier caso que requiera intervención manual del equipo de TI. Tras llamar esta herramienta, el bot pedirá los datos de verificación al usuario.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

/** Convierte un nombre a slug URL-friendly. */
function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/** Extrae texto plano del HTML, removiendo nav/scripts/footer. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Información de un programa UTB. Primero el catálogo empaquetado (extraído de
 * las páginas oficiales, ver `catalogoUtb.ts`): el sitio está detrás de
 * Cloudflare y suele rechazar al bot. Si el nombre no está en el catálogo, se
 * intenta la página oficial. Cache 24h.
 */
async function fetchProgramaInfo(nombrePrograma: string, niveles?: readonly NivelPrograma[]): Promise<string> {
  const encontrados = buscarPrograma(nombrePrograma, niveles);
  if (encontrados.length === 1) return fichaPrograma(encontrados[0]);
  if (encontrados.length > 1) {
    const fichas = encontrados.map(fichaPrograma).join('\n\n---\n\n');
    return `Hay ${encontrados.length} programas con ese nombre; aclara con el usuario cuál le interesa.\n\n${fichas}`.slice(0, 6000);
  }

  const slug = slugify(nombrePrograma);
  const cacheKey = `prog-cache:${slug}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached;

  const candidatosUrl = [
    `https://www.utb.edu.co/${slug}/`,
    `https://www.utb.edu.co/pregrados/${slug}/`,
    `https://www.utb.edu.co/posgrados/${slug}/`,
  ];

  for (const url of candidatosUrl) {
    try {
      const res = await axios.get(url, {
        timeout: 10_000,
        validateStatus: s => s < 400,
        headers: { 'User-Agent': 'Mozilla/5.0 TooliBot/1.0' },
      });
      const texto = htmlToText(res.data);
      // Limitar a primeras ~6000 chars para no inflar el prompt
      const recortado = texto.slice(0, 6000);
      const resultado = `Información oficial UTB (${url}):\n\n${recortado}`;
      await redis.setex(cacheKey, PAGE_CACHE_TTL, resultado);
      return resultado;
    } catch {
      // Intentar siguiente candidato
    }
  }

  return `No pude encontrar la página oficial de "${nombrePrograma}". Sugerir al usuario consultar https://www.utb.edu.co o llamar a inscripciones.`;
}

export interface AIResponse {
  /** Respuesta final lista para enviar al usuario */
  answer: string;
  /** Si el AI usó alguna herramienta */
  usedTool: boolean;
  /** Nombre del programa consultado (Admisiones), si aplica */
  programaConsultado?: string;
  /** Si el AI determinó que se necesita verificar identidad y escalar a TI */
  triggerIdentityVerification?: boolean;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Máximo de mensajes (user+assistant) que conservamos para mantener contexto. */
const MAX_HISTORY = 10;

/**
 * Pregunta al AI assistant. El comportamiento (KB y herramientas) depende del área.
 */
export async function preguntarAI(
  area: AIArea,
  question: string,
  history: ChatTurn[] = [],
  guidanceContext?: string,
): Promise<AIResponse> {
  if (!openai) {
    throw new AIUnavailableError('not_configured');
  }

  const systemPrompt =
    area === 'ti' ? SYSTEM_PROMPT_TI :
    area === 'posgrados' ? SYSTEM_PROMPT_POSGRADOS :
    SYSTEM_PROMPT_ADMISIONES;
  const tools =
    area === 'ti' ? TOOLS_TI :
    area === 'posgrados' ? TOOLS_POSGRADOS :
    TOOLS_ADMISIONES;

  const trimmedHistory = history.slice(-MAX_HISTORY);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: `Fecha actual (UTC): ${new Date().toISOString().slice(0, 10)}. Usa esta fecha al evaluar la vigencia de costos y calendarios.` },
    ...(area === 'posgrados' && guidanceContext
      ? [{ role: 'system' as const, content: `Contexto de navegación anterior del usuario: ${guidanceContext} Usa este contexto solo si ayuda a responder; no supongas que ya eligió un programa.` }]
      : []),
    ...trimmedHistory.map(t => ({ role: t.role, content: t.content })),
    { role: 'user', content: question },
  ];

  const startTotal = Date.now();
  let first: OpenAI.Chat.ChatCompletion;
  try {
    first = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 600,
      temperature: 0.4,
    });
  } catch (err) {
    observeAILatency(area, 'error', (Date.now() - startTotal) / 1000);
    throw new AIUnavailableError('api_error', err);
  }

  const choice = first.choices[0];
  const toolCalls = choice.message.tool_calls;

  if (!toolCalls || toolCalls.length === 0) {
    observeAILatency(area, 'success', (Date.now() - startTotal) / 1000);
    return {
      answer: choice.message.content?.trim() ?? 'No pude generar respuesta. Intenta reformular.',
      usedTool: false,
    };
  }

  // El AI quiere usar tool: ejecutarla y volver a llamar
  messages.push(choice.message);

  let programaConsultado: string | undefined;
  let triggerIdentityVerification = false;

  for (const call of toolCalls) {
    if (call.type !== 'function') continue;

    if (call.function.name === 'consultar_programa' || call.function.name === 'consultar_programa_posgrado') {
      try {
        const args = JSON.parse(call.function.arguments);
        programaConsultado = args.nombre_programa;
        const niveles = call.function.name === 'consultar_programa_posgrado' ? NIVELES_POSGRADO : undefined;
        const resultado = await fetchProgramaInfo(args.nombre_programa, niveles);
        messages.push({ role: 'tool', tool_call_id: call.id, content: resultado });
      } catch {
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'Error consultando el programa.' });
      }
    } else if (call.function.name === 'iniciar_verificacion_identidad') {
      triggerIdentityVerification = true;
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content:
          'OK. El bot iniciará el proceso de verificación de identidad pidiendo correo, código y cédula al usuario. Solo responde brevemente confirmando que vas a escalar el caso, ej: "Voy a escalar tu caso con un asesor de TI. Te pediré algunos datos para verificar tu identidad." NO pidas tú los datos — el bot lo hará.',
      });
    }
  }

  let second: OpenAI.Chat.ChatCompletion;
  try {
    second = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 600,
      temperature: 0.4,
    });
  } catch (err) {
    observeAILatency(area, 'error', (Date.now() - startTotal) / 1000);
    throw new AIUnavailableError('api_error', err);
  }

  observeAILatency(area, 'success', (Date.now() - startTotal) / 1000);

  return {
    answer: second.choices[0].message.content?.trim() ?? 'No pude generar respuesta.',
    usedTool: true,
    programaConsultado,
    triggerIdentityVerification,
  };
}

/** @deprecated Usa preguntarAI('admisiones', ...) en su lugar. */
export const preguntarAdmisiones = (q: string, h: ChatTurn[] = []) => preguntarAI('admisiones', q, h);
