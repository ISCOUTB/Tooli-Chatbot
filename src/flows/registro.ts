import { setSession } from '../services/session';
import { guardarRegistroProspecto } from '../services/registroService';
import { track } from '../services/metrics';
import { FlowContext, messaging, sendMenu, sendMenuPosgrado } from './shared';
import { parseGlobalCommand } from './commands';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PROGRAMAS_OPCIONES: Record<string, string> = {
  '1': 'Especialización',
  '2': 'Maestría',
  '3': 'Doctorado',
  '4': 'Aún no lo sé',
};

async function salirDelRegistro(from: string, text: string): Promise<boolean> {
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

/** Paso 1: pedir nombre */
export async function handleRegistroNombre(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const nombre = text.trim();

  if (await salirDelRegistro(from, text)) return;

  if (nombre.length < 3) {
    await messaging.sendText({
      to: from,
      text: 'Por favor escribe tu *nombre completo* (mínimo 3 caracteres).\n\nEscribe *menu* para cancelar.',
    });
    return;
  }

  await setSession(from, {
    step: 'registro_email',
    data: { ...session?.data, nombre },
  });

  await messaging.sendText({
    to: from,
    text: `Perfecto, *${nombre}* 👋\n\n¿Cuál es tu *correo electrónico*?\n\n_Escribe *menu* para cancelar._`,
  });
}

/** Paso 2: pedir email */
export async function handleRegistroEmail(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;

  if (await salirDelRegistro(from, text)) return;

  const email = text.trim().toLowerCase();

  if (!EMAIL_REGEX.test(email)) {
    await messaging.sendText({
      to: from,
      text: 'El correo no parece válido. Por favor escríbelo de nuevo.\n_Ejemplo: tunombre@gmail.com_\n\nEscribe *menu* para cancelar.',
    });
    return;
  }

  await setSession(from, {
    step: 'registro_programa',
    data: { ...session?.data, email },
  });

  await messaging.sendList({
    to: from,
    title: '¿Qué programa te interesa?',
    description: 'Selecciona el tipo de posgrado de tu interés',
    footer: 'Escribe menu para cancelar',
    buttonText: 'Ver opciones',
    sections: [
      {
        title: 'Tipo de programa',
        rows: [
          { id: '1', title: '📚 Especialización',  description: '2 semestres · Presencial y virtual' },
          { id: '2', title: '🎓 Maestría',           description: '3-4 semestres · Presencial y virtual' },
          { id: '3', title: '🔬 Doctorado',           description: '8 semestres · Investigación' },
          { id: '4', title: '🤷 Aún no lo sé',        description: 'Te orientamos según tu perfil' },
        ],
      },
    ],
  });
}

/** Paso 3: pedir programa → guardar registro */
export async function handleRegistroPrograma(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim();

  if (await salirDelRegistro(from, text)) return;

  const programa = PROGRAMAS_OPCIONES[input];
  if (!programa) {
    await messaging.sendText({
      to: from,
      text:
        'Por favor responde con el *número* de la opción:\n\n' +
        '*1.* 📚 Especialización\n' +
        '*2.* 🎓 Maestría\n' +
        '*3.* 🔬 Doctorado\n' +
        '*4.* 🤷 Aún no lo sé\n\n' +
        '_Escribe *menu* para cancelar._',
    });
    return;
  }

  const nombre = session?.data.nombre ?? 'Desconocido';
  const email = session?.data.email ?? '';

  try {
    await guardarRegistroProspecto({ nombre, email, whatsapp: from, programa });
    await track('registro_completado');
  } catch (err) {
    console.error('[registro] error guardando en Sheets:', err);
  }

  await setSession(from, { step: 'menu', data: {} });

  await messaging.sendText({
    to: from,
    text:
      '✅ *¡Registro exitoso!*\n\n' +
      `📋 *Nombre:* ${nombre}\n` +
      `📧 *Correo:* ${email}\n` +
      `📱 *WhatsApp:* +${from}\n` +
      `🎓 *Programa:* ${programa}\n\n` +
      'Te contactaremos con información sobre los programas de posgrado de la UTB.\n\n' +
      '_Si tienes preguntas, escribe *menu* para volver al inicio._',
  });
}
