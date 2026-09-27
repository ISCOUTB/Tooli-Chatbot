import { setSession } from '../services/session';
import { guardarRegistroProspecto } from '../services/registroService';
import { getOrCreateContact, createConversation } from '../services/chatwootService';
import { config } from '../config';
import { track } from '../services/metrics';
import { FlowContext, messaging, sendMenu, sendMenuPregrado } from './shared';
import { parseGlobalCommand } from './commands';

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

/* ===== Registro de interés (guarda en el mismo sheet que posgrado,
   distinguido por la columna "área" — ver registroService.ts) =====
   No existe un listado fijo de carreras de pregrado en el sistema (a
   diferencia de posgrado, que sí tiene categorías fijas), así que se
   pregunta la carrera como texto libre en vez de inventar una lista. */

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
    text: '¿Qué *carrera* te interesa?\n\n_Puedes ser específico (ej: "Ingeniería de Sistemas") o general (ej: "algo de salud", "no sé aún")._\n\nEscribe *menu* para cancelar.',
  });
}

export async function handlePregradoRegistroCarrera(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const carrera = text.trim();

  if (await salirDelPregrado(from, text)) return;

  if (carrera.length < 2) {
    await messaging.sendText({
      to: from,
      text: 'Por favor dime qué carrera te interesa (mínimo 2 caracteres).\n_Ejemplo: "Ingeniería de Sistemas" o "no sé aún"._\n\nEscribe *menu* para cancelar.',
    });
    return;
  }

  const nombre = session?.data.nombre ?? 'Desconocido';
  const email = session?.data.email ?? '';

  try {
    await guardarRegistroProspecto({ nombre, email, whatsapp: from, programa: carrera, area: 'Pregrado' });
    await track('registro_pregrado_completado');
  } catch (err) {
    console.error('[pregrado] error guardando en Sheets:', err);
  }

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
    text: '¿Qué *carrera* te interesa?\n\n_Puedes ser específico (ej: "Ingeniería de Sistemas") o general (ej: "algo de salud", "no sé aún")._\n\nEscribe *menu* para cancelar.',
  });
}

export async function handlePregradoProspectoCarrera(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const carrera = text.trim();

  if (await salirDelPregrado(from, text)) return;

  if (carrera.length < 2) {
    await messaging.sendText({
      to: from,
      text: 'Por favor dime qué carrera te interesa (mínimo 2 caracteres).\n_Ejemplo: "Ingeniería de Sistemas" o "no sé aún"._\n\nEscribe *menu* para cancelar.',
    });
    return;
  }

  const data = session?.data ?? {};

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
  } catch (err) {
    console.error('[pregrado-prospecto] error creando conversación Chatwoot:', err);
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
