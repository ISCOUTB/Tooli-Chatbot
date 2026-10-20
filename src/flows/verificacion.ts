import { setSession } from '../services/session';
import { startVerification, checkCode, VerificationRateLimitError } from '../services/identityService';
import { track } from '../services/metrics';
import { FlowContext, messaging, salirAlMenuRaiz, volverAlMenuDeOrigen, EMAIL_REGEX } from './shared';
import { parseGlobalCommand, returnMenuStep } from './commands';
import type { FlowArea } from './commands';
import { RECURSOS_ACADEMICOS } from '../services/academicoLinks';

// Flujo de verificación de identidad por OTP al correo institucional.
// Estados: verif_email -> verif_codigo.
// `after` (opcional) recuerda a qué flujo volver tras verificar (p. ej. 'recibo').

export async function startVerificationFlow(from: string, after?: string, originArea?: FlowArea): Promise<void> {
  await setSession(from, { step: 'verif_email', data: { ...(after ? { after } : {}), ...(originArea ? { originArea } : {}) } });
  await messaging.sendText({
    to: from,
    text:
      '🔐 *Verificación de identidad*\n\n' +
      'Para proteger tus datos, primero confirmo que eres tú.\n\n' +
      'Escribe tu *correo institucional* (@utb.edu.co) y te enviaré un código.\n\n' +
      '_Escribe *menu* para cancelar._',
  });
}

export async function handleVerifEmail(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const command = parseGlobalCommand(text);
  if (command === 'menu' || command === 'salir') {
    await salirAlMenuRaiz(from);
    return;
  }
  if (command === 'volver') {
    await volverAlMenuDeOrigen(from, session?.data);
    return;
  }

  const email = text.trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    await messaging.sendText({
      to: from,
      text:
        'Ese correo no es válido. Debe ser tu correo institucional ' +
        '(@utb.edu.co o @utbvirtual.edu.co).\n\nInténtalo de nuevo o escribe *menu*.',
    });
    return;
  }

  try {
    await startVerification(from, email);
  } catch (error) {
    console.error('[verif] no se pudo enviar OTP');
    await messaging.sendText({
      to: from,
      text: error instanceof VerificationRateLimitError
        ? 'Espera un minuto antes de pedir otro código. Escribe *menu* para salir.'
        : 'No pude enviar el código en este momento. Intenta más tarde o escribe *menu*.',
    });
    return;
  }

  await setSession(from, { step: 'verif_codigo', data: { ...session?.data, email } });
  await messaging.sendText({
    to: from,
    text:
      `📧 Te envié un código de 6 dígitos a *${email}*.\n\n` +
      'Escríbelo aquí (revisa también la carpeta de *spam*).\n\n' +
      '_Escribe *menu* para cancelar._',
  });
}

export async function handleVerifCodigo(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const command = parseGlobalCommand(text);
  if (command === 'menu' || command === 'salir') {
    await salirAlMenuRaiz(from);
    return;
  }
  if (command === 'volver') {
    await volverAlMenuDeOrigen(from, session?.data);
    return;
  }

  const result = await checkCode(from, text);

  if (!result.ok) {
    if (result.reason === 'wrong') {
      // Sigue en verif_codigo para permitir reintento.
      await messaging.sendText({
        to: from,
        text: 'Código incorrecto. Inténtalo de nuevo o escribe *menu*.',
      });
      return;
    }
    const msg =
      result.reason === 'expired'
        ? 'El código expiró. Escribe *menu* y vuelve a empezar la verificación.'
        : '🔒 Demasiados intentos. Por seguridad cancelé la verificación. Escribe *menu* para reintentar.';
    await setSession(from, { step: 'menu', data: {} });
    await messaging.sendText({ to: from, text: msg });
    return;
  }

  // ✅ Verificado. Si venía de otro flujo, lo retomamos.
  await track('verificacion_completada');
  const after = session?.data.after;
  if (after === 'academico_cuenta') {
    const area = session?.data.originArea;
    if (area === 'pregrado' || area === 'posgrado') {
      await messaging.sendText({ to: from, text: '✅ Vinculé este WhatsApp con tu cuenta institucional verificada.' });
      const { sendAcademicAccount } = await import('./academicAccount');
      await sendAcademicAccount(from, area);
      return;
    }
  }
  if (after === 'savio') {
    const area = session?.data.originArea;
    if (area === 'pregrado' || area === 'posgrado') {
      const { sendSavioCourses } = await import('./savio');
      await sendSavioCourses(from, area);
      return;
    }
  }
  if (after === 'notas') {
    if (process.env.TOOLI_NOTAS_SSO_ENABLED !== '1') {
      const notasUrl = RECURSOS_ACADEMICOS.find((r) => r.id === 'notas')?.url ?? 'https://autoservicio4prod.utb.edu.co';
      await setSession(from, { step: returnMenuStep(session?.data), data: {} });
      await messaging.sendText({
        to: from,
        text: `✅ Identidad verificada. Consulta tus notas directamente en el autoservicio oficial: ${notasUrl}\n\nNo envíes tu contraseña por WhatsApp.`,
      });
      return;
    }
    await setSession(from, { step: 'notas_password', data: { ...session?.data, after: '' } });
    await messaging.sendText({
      to: from,
      text:
        '✅ ¡Identidad verificada!\n\n' +
        'Ahora inicio sesión en Banner por ti. Escribe tu *contraseña institucional* ' +
        '(la de Microsoft / correo @utb).\n\n⚠️ Solo se usa para esta consulta, *no se guarda*.',
    });
    return;
  }

  await setSession(from, { step: returnMenuStep(session?.data), data: {} });
  await messaging.sendText({
    to: from,
    text:
      '✅ ¡Identidad verificada! Ya puedes usar los servicios que requieren verificación.\n\n' +
      'Escribe *menu* para ver las opciones.',
  });
}
