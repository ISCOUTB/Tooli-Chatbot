import { setSession } from '../services/session';
import { guardarRegistroProspecto } from '../services/registroService';
import { getOrCreateContact, createConversation } from '../services/chatwootService';
import { config } from '../config';
import { track } from '../services/metrics';
import { FlowContext, messaging, sendMenu, sendMenuPregrado } from './shared';
import { parseGlobalCommand } from './commands';
import {
  buildUndecidedLabel,
  formatAreasMessage,
  formatCareersMessage,
  getAreaById,
  getGuidanceState,
  parseAreaSelection,
  parseCareerSelection,
  isGuidanceRequest,
  withGuidance,
  withoutGuidance,
  type PregradoAreaId,
} from './pregradoGuidance';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function salirDelPregrado(from: string, text: string): Promise<boolean> {
  const command = parseGlobalCommand(text);
  if (command === 'menu' || command === 'salir') {
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return true;
  }
  if (command === 'volver') {
    await setSession(from, { step: 'menu_pregrado', data: {} });
    await sendMenuPregrado(from);
    return true;
  }
  return false;
}

type PregradoCarreraStep = 'pregrado_registro_carrera' | 'pregrado_prospecto_carrera';

/* ===== Subnavegación de orientación (P02) =====
   Vive en los datos de sesión (`pregrado_guidance_stage` /
   `pregrado_guidance_area`) dentro del mismo paso de carrera, así que no
   se agregan handlers al índice. Los comandos globales se atienden antes
   (ver `salirDelPregrado`), por eso `0` sigue siendo "volver". */

async function goToAreaSelection(
  from: string,
  step: PregradoCarreraStep,
  data: Record<string, string>,
  mode: 'initial' | 'invalid',
): Promise<void> {
  await setSession(from, { step, data: withGuidance(data, { stage: 'area' }) });
  await messaging.sendText({ to: from, text: formatAreasMessage(mode) });
}

async function goToCareerSelection(
  from: string,
  step: PregradoCarreraStep,
  data: Record<string, string>,
  areaId: PregradoAreaId,
  mode: 'initial' | 'invalid',
): Promise<void> {
  await setSession(from, { step, data: withGuidance(data, { stage: 'career', areaId }) });
  await messaging.sendText({ to: from, text: formatCareersMessage(areaId, mode) });
}

/**
 * Resuelve un mensaje recibido dentro del paso de carrera contra la guía.
 * Devuelve la carrera final (concreta del catálogo o "Aún no sé" etiquetado
 * con el área) o null cuando ya respondió al usuario y el handler debe parar.
 */
async function resolveGuidedCarrera(
  from: string,
  step: PregradoCarreraStep,
  text: string,
  data: Record<string, string>,
): Promise<string | null> {
  const guidance = getGuidanceState(data);

  if (data.pregrado_guidance_stage && !guidance) {
    await goToAreaSelection(from, step, withoutGuidance(data), 'invalid');
    return null;
  }

  if (guidance?.stage === 'area') {
    const areaId = parseAreaSelection(text);
    if (!areaId) {
      await goToAreaSelection(from, step, data, 'invalid');
      return null;
    }
    await goToCareerSelection(from, step, data, areaId, 'initial');
    return null;
  }

  if (guidance?.stage === 'career' && guidance.areaId) {
    const selection = parseCareerSelection(text, guidance.areaId);
    if (selection.kind === 'invalid') {
      await goToCareerSelection(from, step, data, guidance.areaId, 'invalid');
      return null;
    }
    if (selection.kind === 'undecided') {
      const label = getAreaById(guidance.areaId)?.label ?? '';
      return buildUndecidedLabel(label);
    }
    return selection.career;
  }

  if (isGuidanceRequest(text)) {
    await goToAreaSelection(from, step, data, 'initial');
    return null;
  }

  return text.trim();
}

/* ===== Registro de interés (guarda en el mismo sheet que posgrado,
   distinguido por la columna "área" — ver registroService.ts) =====
   La carrera se puede escribir como texto libre; quien escribe una
   variante de "no sé" entra a la guía por áreas de `pregradoGuidance.ts`
   (catálogo de `knowledgeBase.ts`) sin que "no sé" quede como carrera. */

export async function handlePregradoRegistroNombre(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const nombre = text.trim();

  if (await salirDelPregrado(from, text)) return;

  if (nombre.length < 3) {
    await messaging.sendText({
      to: from,
      text: 'Por favor escribe tu *nombre completo* (mínimo 3 caracteres).\n\nEscribe *menu* para cancelar.',
    });
    return;
  }

  await setSession(from, { step: 'pregrado_registro_email', data: { ...session?.data, nombre } });
  await messaging.sendText({
    to: from,
    text: `Perfecto, *${nombre}* 👋\n\n¿Cuál es tu *correo electrónico*?\n\n_Escribe *menu* para cancelar._`,
  });
}

export async function handlePregradoRegistroEmail(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;

  if (await salirDelPregrado(from, text)) return;

  const email = text.trim().toLowerCase();

  if (!EMAIL_REGEX.test(email)) {
    await messaging.sendText({
      to: from,
      text: 'El correo no parece válido. Por favor escríbelo de nuevo.\n_Ejemplo: tunombre@gmail.com_\n\nEscribe *menu* para cancelar.',
    });
    return;
  }

  await setSession(from, { step: 'pregrado_registro_carrera', data: { ...session?.data, email } });
  await messaging.sendText({
    to: from,
    text: '¿Qué *carrera* te interesa?\n\n_Puedes escribirla directamente (ej: "Ingeniería de Sistemas"). Si aún no lo sabes, escribe *"no sé"* y te muestro las áreas para explorar._\n\nEscribe *menu* para cancelar.',
  });
}

export async function handlePregradoRegistroCarrera(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;

  if (await salirDelPregrado(from, text)) return;

  const data = { ...(session?.data ?? {}) };
  const carrera = await resolveGuidedCarrera(from, 'pregrado_registro_carrera', text, data);
  if (carrera === null) return;

  if (carrera.length < 2) {
    await messaging.sendText({
      to: from,
      text: 'Por favor dime qué carrera te interesa (mínimo 2 caracteres).\n_Ejemplo: "Ingeniería de Sistemas". Si aún no lo sabes, escribe *"no sé"* y te ayudo a explorar._\n\nEscribe *menu* para cancelar.',
    });
    return;
  }

  const cleanData = withoutGuidance(data);
  const nombre = cleanData.nombre ?? 'Desconocido';
  const email = cleanData.email ?? '';

  try {
    await guardarRegistroProspecto({ nombre, email, whatsapp: from, programa: carrera, area: 'Pregrado' });
  } catch {
    console.error('[pregrado] no se pudo confirmar el guardado en Sheets');
    await messaging.sendText({
      to: from,
      text: 'No pude confirmar que tu registro se haya guardado. Por favor vuelve a enviar tu última respuesta sobre la carrera para intentarlo de nuevo, o escribe *menu* para salir.',
    });
    return;
  }

  await track('registro_pregrado_completado');

  await setSession(from, { step: 'menu', data: {} });
  await messaging.sendText({
    to: from,
    text:
      '✅ *¡Registro exitoso!*\n\n' +
      `📋 *Nombre:* ${nombre}\n` +
      `📧 *Correo:* ${email}\n` +
      `📱 *WhatsApp:* +${from}\n` +
      `🏫 *Carrera de interés:* ${carrera}\n\n` +
      'Te contactaremos con información sobre el proceso de admisión a pregrado de la UTB.\n\n' +
      '_Si tienes preguntas, escribe *menu* para volver al inicio._',
  });
}

/* ===== Conectar con asesor humano de Pregrado (Chatwoot) =====
   Reutiliza el mismo equipo de admisiones (no existe un team ID separado
   para pregrado en la configuración) pero etiqueta la conversación como
   "pregrado-prospecto" y área "Pregrado" para que se pueda distinguir. */

export async function handlePregradoProspectoNombre(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const nombre = text.trim();

  if (await salirDelPregrado(from, text)) return;

  if (nombre.length < 3) {
    await messaging.sendText({
      to: from,
      text: 'Por favor escribe tu *nombre completo* (mínimo 3 caracteres).\n\nEscribe *menu* para cancelar.',
    });
    return;
  }

  await setSession(from, { step: 'pregrado_prospecto_email', data: { ...session?.data, nombre } });
  await messaging.sendText({
    to: from,
    text: `Gracias, *${nombre}* 👋\n\n¿Cuál es tu *correo electrónico*?\n\n_Escribe *menu* para cancelar._`,
  });
}

export async function handlePregradoProspectoEmail(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;

  if (await salirDelPregrado(from, text)) return;

  const email = text.trim().toLowerCase();

  if (!EMAIL_REGEX.test(email)) {
    await messaging.sendText({
      to: from,
      text: 'El correo no parece válido. Por favor escríbelo de nuevo.\n_Ejemplo: tunombre@gmail.com_\n\nEscribe *menu* para cancelar.',
    });
    return;
  }

  await setSession(from, { step: 'pregrado_prospecto_carrera', data: { ...session?.data, email } });
  await messaging.sendText({
    to: from,
    text: '¿Qué *carrera* te interesa?\n\n_Puedes escribirla directamente (ej: "Ingeniería de Sistemas"). Si aún no lo sabes, escribe *"no sé"* y te muestro las áreas para explorar._\n\nEscribe *menu* para cancelar.',
  });
}

export async function handlePregradoProspectoCarrera(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;

  if (await salirDelPregrado(from, text)) return;

  const rawData = { ...(session?.data ?? {}) };
  const carrera = await resolveGuidedCarrera(from, 'pregrado_prospecto_carrera', text, rawData);
  if (carrera === null) return;

  if (carrera.length < 2) {
    await messaging.sendText({
      to: from,
      text: 'Por favor dime qué carrera te interesa (mínimo 2 caracteres).\n_Ejemplo: "Ingeniería de Sistemas". Si aún no lo sabes, escribe *"no sé"* y te ayudo a explorar._\n\nEscribe *menu* para cancelar.',
    });
    return;
  }

  const data = withoutGuidance(rawData);

  const nombre = data.nombre ?? 'Prospecto';
  const email = data.email ?? '';

  await track('prospecto_pregrado_completado');
  await messaging.sendText({ to: from, text: '⏳ Conectándote con un asesor de pregrado…' });

  const ahora = new Date().toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  const contexto =
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🏫 Nuevo prospecto — Pregrado UTB\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 Nombre: ${nombre}\n` +
    `📱 WhatsApp: +${from}\n` +
    `📧 Email: ${email}\n` +
    `🎯 Carrera de interés: ${carrera}\n` +
    `📅 Recibido: ${ahora}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  try {
    const contact = await getOrCreateContact(from, nombre);
    const teamId = parseInt(config.chatwoot.teamAdmisionesId);

    const conversationId = await createConversation({
      sourceId: contact.sourceId,
      contactId: contact.contactId,
      teamId,
      initialMessage: contexto,
      customAttributes: {
        area: 'Pregrado',
        programa_interes: carrera,
        email_prospecto: email,
      },
      labels: ['pregrado-prospecto'],
      priority: 'medium',
    });

    await setSession(from, {
      step: 'with_agent',
      data: {
        conversationId: String(conversationId),
        area: 'admisiones',
        nombre,
        email,
        programa: carrera,
      },
    });

    await messaging.sendText({
      to: from,
      text:
        `✅ *Listo, ${nombre}!*\n\n` +
        'Un asesor de Pregrado te responderá en breve.\n\n' +
        'Cualquier mensaje que escribas le llegará directamente.\n' +
        'Para terminar la conversación, escribe *salir*.',
    });
  } catch {
    console.error('[pregrado-prospecto] no se pudo crear conversación Chatwoot');
    await setSession(from, { step: 'menu', data: {} });
    await messaging.sendText({
      to: from,
      text:
        '⚠️ No pude conectarte en este momento. Por favor contáctanos directamente:\n\n' +
        '📧 admisiones@utb.edu.co\n' +
        '📞 311 3405776\n\n' +
        'Escribe *menu* para volver al inicio.',
    });
  }
}
