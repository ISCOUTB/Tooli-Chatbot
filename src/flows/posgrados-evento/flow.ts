import fs from 'fs';
import path from 'path';
import { Session } from '../../services/session';
import { getPosgradoSession, setPosgradoSession, posgradoMessaging } from './shared';
import {
  guardarRegistroPosgrado,
  actualizarPosgradoInteres,
  actualizarConsentimiento,
} from '../../services/posgradosEventoSheets';
import { upsertContactoHubspot } from '../../services/hubspotService';
import { describeExternalError } from '../../services/logSafe';

interface Ctx {
  from: string;
  text: string;
  session: Session | null;
}

// ── Constantes ────────────────────────────────────────────────────────────────
const BRAND = 'Escuela de Posgrados UTB';

const NOMBRE_ESP      = 'Especialización en Gestión de Tecnologías Disruptivas en los Negocios';
const NOMBRE_MAESTRIA = 'Maestría en Management de la Transformación Digital';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Flyer de la Beca País / ICETEX (recordatorio final)
const FLYER_POSGRADO = path.resolve(__dirname, '../../public/evento/flujo.jpeg');

function invalid(to: string): Promise<void> {
  return posgradoMessaging.sendText({ to, text: 'Por favor usa los botones 👆' });
}

function primerNombre(nombre: string): string {
  return (nombre ?? '').trim().split(/\s+/)[0] ?? '';
}

/** Pausa breve para que el texto se entregue antes de la imagen. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── 0. Inicio → bienvenida + consentimiento (Ley 1581) ───────────────────────

export async function handlePosgradoInicio(ctx: Ctx): Promise<void> {
  const { from } = ctx;

  await posgradoMessaging.sendText({
    to: from,
    text:
      '🎓 *¡Bienvenido/a a la Escuela de Posgrados UTB!*\n\n' +
      '¡Gracias por participar en el meetup digital *"Retos del Management Digital"*! 🙌\n\n' +
      'Te haré unas preguntas rápidas (1 min). ✍️',
  });

  await setPosgradoSession(from, { step: 'posg_consent', data: {} });

  await posgradoMessaging.sendButtons({
    to: from,
    title: BRAND,
    description:
      '🔒 ¿Autorizas que un asesor de la UTB te contacte y el tratamiento de tus datos personales conforme a la *Ley 1581 de 2012*?',
    footer: 'Tus datos se usan solo para fines de admisión',
    buttons: [
      { id: 'si', displayText: '✅ Sí, autorizo' },
      { id: 'no', displayText: '❌ No' },
    ],
  });
}

// ── 1. Consentimiento → (Sí) pide nombre; (No) cierre simple ─────────────────

export async function handlePosgradoConsent(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();
  if (input !== 'si' && input !== 'no') { await invalid(from); return; }

  // No autoriza → cerrar respetando su decisión (no se recogen datos)
  if (input === 'no') {
    await setPosgradoSession(from, { step: 'posg_completada', data: {} });
    await posgradoMessaging.sendText({
      to: from,
      text:
        '¡Entendido! 🙌 Respetamos tu decisión y no trataremos tus datos.\n\n' +
        '¡Gracias por participar! 🎓',
    });
    return;
  }

  // Autoriza → guardamos el consentimiento y pedimos el nombre
  await setPosgradoSession(from, {
    step: 'posg_nombre',
    data: { ...session?.data, consentimiento: 'Sí' },
  });

  await posgradoMessaging.sendText({
    to: from,
    text: '✍️ ¿Cuál es tu *nombre completo*?',
  });
}

// ── 2. Nombre → pide correo ──────────────────────────────────────────────────

export async function handlePosgradoNombre(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const nombre = text.trim();

  if (nombre.length < 2) {
    await posgradoMessaging.sendText({ to: from, text: 'Por favor escribe tu nombre 🙂' });
    return;
  }

  await setPosgradoSession(from, { step: 'posg_correo', data: { ...session?.data, nombre } });

  await posgradoMessaging.sendText({
    to: from,
    text: `¡Gracias, ${primerNombre(nombre)}! 📧\n\n¿Cuál es tu *correo electrónico*?`,
  });
}

// ── 3. Correo → pregunta el programa de interés ──────────────────────────────

export async function handlePosgradoCorreo(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const correo = text.trim();

  if (!EMAIL_RE.test(correo)) {
    await posgradoMessaging.sendText({
      to: from,
      text: '📧 Ese correo no parece válido. Escríbelo de nuevo, por ejemplo: *nombre@correo.com*',
    });
    return;
  }

  await setPosgradoSession(from, { step: 'posg_programa', data: { ...session?.data, correo } });

  await posgradoMessaging.sendButtons({
    to: from,
    title: BRAND,
    description:
      '🎓 *¿Qué programa te interesa?*\n\n' +
      `🎯 *${NOMBRE_ESP}*\n\n` +
      `🎓 *${NOMBRE_MAESTRIA}*`,
    footer: 'Elige una opción 👇',
    buttons: [
      { id: 'esp',      displayText: '🎯 Especialización' },
      { id: 'maestria', displayText: '🎓 Maestría' },
      { id: 'nose',     displayText: '🤔 Aún no sé' },
    ],
  });
}

// ── 4. Programa de interés → guarda (Sheets + CRM) + cierre simple ────────────

export async function handlePosgradoPrograma(ctx: Ctx): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim().toLowerCase();
  if (!['esp', 'maestria', 'nose'].includes(input)) { await invalid(from); return; }

  const d = session?.data ?? {};
  const programa =
    input === 'esp'      ? NOMBRE_ESP :
    input === 'maestria' ? NOMBRE_MAESTRIA :
    'Aún no decide';

  // Confirmar la fila antes de cerrar el registro.
  try {
    const fila = await guardarRegistroPosgrado({
      whatsapp:            from,
      nombre:              d.nombre ?? '',
      correo:              d.correo ?? '',
      interesFinanciacion: '',
    });
    if (!fila) throw new Error('Registro sin fila confirmada');
    await actualizarPosgradoInteres(fila, programa);
    await actualizarConsentimiento(fila, 'Sí');
  } catch (err) {
    console.error('[posgrados] error guardando registro:', describeExternalError(err));
    await setPosgradoSession(from, { step: 'posg_registro_pendiente', data: { ...d, programa } });
    await posgradoMessaging.sendText({
      to: from,
      text: 'No pude confirmar que tus datos quedaran registrados. Por favor, contacta al equipo de admisiones para verificarlo antes de volver a enviar tus datos.',
    });
    return;
  }

  // Enviar el lead a HubSpot (CRM de la UTB) — sin bloquear el flujo
  void upsertContactoHubspot({
    email:               d.correo ?? '',
    nombre:              d.nombre ?? '',
    whatsapp:            from,
    posgradoInteres:     programa,
    interesFinanciacion: '',
    consentimiento:      true,
  });

  // Cierre + recordatorio de la Beca País (imagen) para que quede sonando
  await setPosgradoSession(from, { step: 'posg_completada', data: {} });
  await posgradoMessaging.sendText({
    to: from,
    text:
      '¡Listo, tus datos han sido guardados con éxito! 🙌\n\n' +
      'Muchas gracias por tu interés. Un asesor de nuestro equipo tomará tu solicitud y se comunicará contigo para guiarte en tu proceso.\n\n' +
      '¡Que tengas un excelente día! 🎓',
  });

  await sleep(1500);
  try {
    const flyer = fs.readFileSync(FLYER_POSGRADO);
    await posgradoMessaging.sendImage({
      to: from,
      buffer: flyer,
      mimetype: 'image/jpeg',
      caption:
        '💰 *No lo olvides:* con el *Posgrado País de ICETEX* pagas el *40% mientras estudias* y el *60% después de graduarte*.\n\n' +
        '¡Tu posgrado está más cerca de lo que crees! 🚀',
    });
  } catch (err) {
    console.error('[posgrados] error enviando flyer de cierre:', describeExternalError(err));
  }
}

// ── Completada (si vuelve a escribir) ─────────────────────────────────────────

export async function handlePosgradoCompletada(ctx: Ctx): Promise<void> {
  const { from } = ctx;
  await posgradoMessaging.sendText({
    to: from,
    text:
      '✅ ¡Ya tenemos tus datos! Un asesor de la UTB te contactará pronto. 🎓\n\n' +
      '¡Gracias por participar!',
  });
}

export async function handlePosgradoRegistroPendiente(ctx: Ctx): Promise<void> {
  await posgradoMessaging.sendText({
    to: ctx.from,
    text: 'Tu registro aún requiere verificación. Por favor, contacta al equipo de admisiones antes de volver a enviar tus datos.',
  });
}
