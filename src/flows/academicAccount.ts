import { getIdentity, revokeIdentity } from '../services/identityService';
import { config } from '../config';
import { setSession } from '../services/session';
import { FlowContext, messaging, sendMenu } from './shared';
import { parseGlobalCommand, parseOriginArea } from './commands';
import { startVerificationFlow } from './verificacion';
import type { FlowArea } from './commands';
import { maskInstitutionalEmail } from './academicAccountView';

export async function sendAcademicAccount(to: string, area: FlowArea): Promise<void> {
  const identity = await getIdentity(to);
  await setSession(to, { step: 'academico_cuenta', data: { originArea: area } });
  if (!identity) {
    const available = Boolean(config.mail.apiKey);
    await messaging.sendButtons({
      to,
      title: '🔐 Mi cuenta institucional',
      description: available
        ? 'Vincula este WhatsApp verificando tu correo UTB. No necesitas escribir tu cédula ni tu contraseña.'
        : 'La vinculación por correo todavía no está disponible. Intenta más tarde.',
      buttons: available
        ? [{ id: '1', displayText: 'Vincular cuenta' }, { id: '0', displayText: 'Volver' }]
        : [{ id: '0', displayText: 'Volver' }],
    });
    return;
  }
  await messaging.sendText({
    to,
    text: `✅ Este WhatsApp está vinculado a *${maskInstitutionalEmail(identity.email)}*.\n\n${config.mail.apiKey ? 'Puedes cambiar la cuenta o retirar el vínculo cuando quieras.' : 'Puedes retirar el vínculo cuando quieras.'} La verificación caduca automáticamente después de 120 días.`,
  });
  await messaging.sendButtons({
    to,
    title: '🔐 Mi cuenta institucional',
    description: '¿Qué quieres hacer?',
    buttons: [
      ...(config.mail.apiKey ? [{ id: '1', displayText: 'Cambiar cuenta' }] : []),
      { id: '2', displayText: 'Desvincular' },
      { id: '0', displayText: 'Volver' },
    ],
  });
}

async function returnToAcademicMenu(from: string, area: FlowArea): Promise<void> {
  const { sendMenuAcademico } = await import('./academico');
  await sendMenuAcademico(from, area);
}

export async function handleAcademicAccount({ from, text, session }: FlowContext): Promise<void> {
  const command = parseGlobalCommand(text);
  if (command === 'menu' || command === 'salir') {
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return;
  }
  const area = parseOriginArea(session?.data.originArea);
  if (!area) {
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return;
  }
  if (command === 'volver') return returnToAcademicMenu(from, area);
  if (text.trim() === '1' && config.mail.apiKey) return startVerificationFlow(from, 'academico_cuenta', area);
  if (text.trim() === '2' && await getIdentity(from)) {
    await setSession(from, { step: 'academico_desvincular', data: { originArea: area } });
    await messaging.sendButtons({
      to: from,
      title: 'Desvincular cuenta',
      description: 'Este número perderá el acceso a los servicios vinculados. ¿Confirmas?',
      buttons: [
        { id: '1', displayText: 'Sí, desvincular' },
        { id: '0', displayText: 'Cancelar' },
      ],
    });
    return;
  }
  await sendAcademicAccount(from, area);
}

export async function handleAcademicUnlink({ from, text, session }: FlowContext): Promise<void> {
  const command = parseGlobalCommand(text);
  if (command === 'menu' || command === 'salir') {
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return;
  }
  const area = parseOriginArea(session?.data.originArea);
  if (!area) {
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return;
  }
  if (command === 'volver') return sendAcademicAccount(from, area);
  if (text.trim() !== '1') {
    await messaging.sendText({ to: from, text: 'Elige *1* para confirmar o *0* para cancelar.' });
    return;
  }
  await revokeIdentity(from);
  await messaging.sendText({ to: from, text: '✅ Desvinculé tu cuenta institucional de este WhatsApp.' });
  await sendAcademicAccount(from, area);
}
