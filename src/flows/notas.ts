import { setSession } from '../services/session';
import { startNotasLogin, submitNotasMfa, closeNotasSession, NotasLoginResult } from '../services/notasService';
import { getIdentity, isVerified } from '../services/identityService';
import { track } from '../services/metrics';
import { FlowContext, messaging, salirAlMenuRaiz, volverAlMenuDeOrigen } from './shared';
import { startVerificationFlow } from './verificacion';
import { parseGlobalCommand, returnMenuStep } from './commands';
import type { FlowArea, SessionData } from './commands';
import { RECURSOS_ACADEMICOS } from '../services/academicoLinks';

// El login automatizado solicita la contraseña institucional por WhatsApp y
// aún no ha sido validado contra Banner con una cuenta de prueba. Se habilita
// únicamente tras esa revisión explícita; el enlace oficial sigue disponible.
const notasSsoEnabled = () => process.env.TOOLI_NOTAS_SSO_ENABLED === '1';
const notasUrl = RECURSOS_ACADEMICOS.find((r) => r.id === 'notas')?.url ?? 'https://autoservicio4prod.utb.edu.co';

async function ofrecerPortalOficial(from: string, data?: SessionData): Promise<void> {
  await closeNotasSession(from);
  await setSession(from, { step: returnMenuStep(data), data: {} });
  await messaging.sendText({
    to: from,
    text: 'Para consultar tus notas, entra directamente al autoservicio oficial de la UTB con tus credenciales institucionales:\n' +
      `${notasUrl}\n\nNo envíes tu contraseña por WhatsApp. Escribe *menu* para ver otras opciones.`,
  });
}

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
  if (!notasSsoEnabled()) {
    await ofrecerPortalOficial(from, data);
    return;
  }
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
  if (!notasSsoEnabled()) {
    await ofrecerPortalOficial(from, session?.data);
    return;
  }
  const command = parseGlobalCommand(text);
  if (command === 'menu' || command === 'salir') {
    await salirAlMenuRaiz(from);
    return;
  }
  if (command === 'volver') {
    await volverAlMenuDeOrigen(from, session?.data);
    return;
  }

  if (/@/.test(text.trim())) {
    await messaging.sendText({
      to: from,
      text: 'Eso parece un correo 🙂. Necesito tu *contraseña* institucional (la de Microsoft), no el correo. Escríbela, o *menu* para cancelar.',
    });
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
  if (!notasSsoEnabled()) {
    await ofrecerPortalOficial(from, session?.data);
    return;
  }
  const command = parseGlobalCommand(text);
  if (command === 'menu' || command === 'salir') {
    await closeNotasSession(from);
    await salirAlMenuRaiz(from);
    return;
  }
  if (command === 'volver') {
    await closeNotasSession(from);
    await volverAlMenuDeOrigen(from, session?.data);
    return;
  }

  await messaging.sendText({ to: from, text: '🔄 Verificando el código…' });
  const res = await submitNotasMfa(from, text.trim());
  await entregarNotas(from, res, session?.data);
}
