import { setSession } from '../services/session';
import { startNotasLogin, submitNotasMfa, NotasLoginResult } from '../services/notasService';
import { getIdentity, isVerified } from '../services/identityService';
import { track } from '../services/metrics';
import { FlowContext, messaging, salirAlMenuRaiz, volverAlMenuDeOrigen } from './shared';
import { startVerificationFlow } from './verificacion';
import { parseGlobalCommand, returnMenuStep } from './commands';
import type { FlowArea, SessionData } from './commands';

/**
 * Consulta de notas — servicio compartido por Pregrado y Posgrado.
 *
 * Un estudiante activo puede ser de cualquiera de las dos ramas, así que el
 * punto de entrada vive aquí y lo llaman ambos menús (y el hub académico) en
 * vez de duplicarse. Si todavía no verificó su identidad, primero va el OTP al
 * correo institucional y al terminar retoma solo en las notas.
 */
export async function iniciarConsultaDeNotas(from: string, originArea?: FlowArea): Promise<void> {
  const data: SessionData = originArea ? { originArea } : {};
  if (await isVerified(from)) {
    await setSession(from, { step: 'notas_password', data });
    await messaging.sendText({
      to: from,
      text:
        'Para ver tus notas, inicio sesión por ti en Banner.\n\n' +
        'Escribe tu *contraseña institucional* (la de tu correo @utb / Microsoft).\n\n' +
        '⚠️ Se usa solo para esta consulta y *no se guarda*.\n\nEscribe *menu* para cancelar.',
    });
    return;
  }

  await startVerificationFlow(from, 'notas', originArea);
  await track('verificacion_iniciada');
}

// Flujo de NOTAS (opción B: login SSO automatizado con Playwright).
// Se llega aquí SOLO tras verificar identidad por OTP (tenemos el correo @utb).
// Estados: notas_password → (si hay MFA) notas_mfa.

async function entregarNotas(from: string, res: NotasLoginResult, data?: SessionData): Promise<void> {
  if (res.status === 'ok') {
    await track('notas_consultadas');
    let msg = '📊 *Tus notas del período*\n\n';
    for (const c of res.cursos) msg += `• ${c.titulo}: *${c.notaFinal}*\n`;
    msg += '\n_Escribe *menu* para volver al inicio._';
    await messaging.sendText({ to: from, text: msg });
  } else if (res.status === 'error') {
    await track('notas_no_encontradas');
    await messaging.sendText({ to: from, text: `No pude traer tus notas. ${res.error}\n\nEscribe *menu* para volver.` });
  }
  await setSession(from, { step: returnMenuStep(data), data: {} });
}

export async function handleNotasPassword(ctx: FlowContext): Promise<void> {
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

  const identity = await getIdentity(from);
  if (!identity) {
    await setSession(from, { step: 'menu', data: {} });
    await messaging.sendText({
      to: from,
      text: 'Necesitas verificar tu identidad primero. Escribe *menu* y elige *Ver notas*.',
    });
    return;
  }

  await messaging.sendText({ to: from, text: '🔄 Iniciando sesión en Banner por ti… (puede tardar hasta 1 min)' });

  const res = await startNotasLogin(from, identity.email, text);

  if (res.status === 'mfa') {
    await setSession(from, { step: 'notas_mfa', data: { ...session?.data } });
    await messaging.sendText({ to: from, text: `🔐 ${res.prompt}\n\n_Escribe *menu* para cancelar._` });
    return;
  }
  await entregarNotas(from, res, session?.data);
}

export async function handleNotasMfa(ctx: FlowContext): Promise<void> {
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

  await messaging.sendText({ to: from, text: '🔄 Verificando el código…' });
  const res = await submitNotasMfa(from, text.trim());
  await entregarNotas(from, res, session?.data);
}
