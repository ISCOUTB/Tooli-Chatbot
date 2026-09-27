import { setSession } from '../services/session';
import { getOrCreateContact, createConversation } from '../services/chatwootService';
import { config } from '../config';
import { track } from '../services/metrics';
import { FlowContext, messaging, sendMenu, sendMenuPosgrado } from './shared';
import { parseGlobalCommand } from './commands';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function salirDelProspecto(from: string, text: string): Promise<boolean> {
  const command = parseGlobalCommand(text);
  if (command === 'menu' || command === 'salir') {
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return true;
  }
  if (command === 'volver') {
    await setSession(from, { step: 'menu_posgrado', data: {} });
    await sendMenuPosgrado(from);
    return true;
  }
  return false;
}

/** Paso 1: recoger nombre */
export async function handleProspectoNombre(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const nombre = text.trim();

  if (await salirDelProspecto(from, text)) return;

  if (nombre.length < 3) {
    await messaging.sendText({
      to: from,
      text: 'Por favor escribe tu nombre completo (mínimo 3 caracteres).\n\n_Escribe *menu* para cancelar._',
    });
    return;
  }

  await setSession(from, {
    step: 'prospecto_email',
    data: { ...session?.data, nombre },
  });

  await messaging.sendText({
    to: from,
    text: `Gracias, *${nombre}* 👋\n\n¿Cuál es tu *correo electrónico*?\n\n_Escribe *menu* para cancelar._`,
  });
}

/** Paso 2: recoger email */
export async function handleProspectoEmail(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;

  if (await salirDelProspecto(from, text)) return;

  const email = text.trim().toLowerCase();

  if (!EMAIL_REGEX.test(email)) {
    await messaging.sendText({
      to: from,
      text: 'El correo no parece válido. Por favor escríbelo de nuevo.\n_Ejemplo: nombre@gmail.com_\n\n_Escribe *menu* para cancelar._',
    });
    return;
  }

  await setSession(from, {
    step: 'prospecto_programa',
    data: { ...session?.data, email },
  });

  await messaging.sendText({
    to: from,
    text:
      '¿Qué programa o área de posgrado te interesa?\n\n' +
      '_Puedes ser específico (ej: "MBA", "Maestría en Ciberseguridad") o general (ej: "algo de ingeniería", "no sé aún")._\n\n' +
      '_Escribe *menu* para cancelar._',
  });
}

/** Paso 3: recoger programa de interés → conectar a Chatwoot */
export async function handleProspectoPrograma(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;

  if (await salirDelProspecto(from, text)) return;

  const programa = text.trim();
  const data = session?.data ?? {};

  const nombre = data.nombre ?? 'Prospecto';
  const email = data.email ?? '';
  const categoria = data.categoria ?? '';

  await track('prospecto_completado');

  await messaging.sendText({ to: from, text: '⏳ Conectándote con un asesor de posgrados…' });

  const ahora = new Date().toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  const contexto =
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🎓 Nuevo prospecto — Posgrados UTB\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 Nombre: ${nombre}\n` +
    `📱 WhatsApp: +${from}\n` +
    `📧 Email: ${email}\n` +
    `🎯 Programa de interés: ${programa}\n` +
    (categoria ? `📚 Categoría vista: ${categoria}\n` : '') +
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
        area: 'Posgrados',
        programa_interes: programa,
        email_prospecto: email,
      },
      labels: ['posgrado-prospecto'],
      priority: 'medium',
    });

    await setSession(from, {
      step: 'with_agent',
      data: {
        conversationId: String(conversationId),
        area: 'admisiones',
        nombre,
        email,
        programa,
      },
    });

    await messaging.sendText({
      to: from,
      text:
        `✅ *Listo, ${nombre}!*\n\n` +
        'Un asesor de Posgrados te responderá en breve.\n\n' +
        'Cualquier mensaje que escribas le llegará directamente.\n' +
        'Para terminar la conversación, escribe *salir*.',
    });
  } catch (err) {
    console.error('[prospecto] error creando conversación Chatwoot:', err);
    await setSession(from, { step: 'menu', data: {} });
    await messaging.sendText({
      to: from,
      text:
        '⚠️ No pude conectarte en este momento. Por favor contáctanos directamente:\n\n' +
        '📧 mercadeoposgrado@utb.edu.co\n' +
        '📞 311 3405776\n\n' +
        'Escribe *menu* para volver al inicio.',
    });
  }
}
