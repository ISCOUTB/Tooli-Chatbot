import { getIdentity } from '../services/identityService';
import { setSession } from '../services/session';
import { getSavioCoursesForEmail, savioEnabled } from '../services/savioService';
import { track } from '../services/metrics';
import { messaging } from './shared';
import { startVerificationFlow } from './verificacion';
import { menuStepForArea } from './commands';
import type { FlowArea } from './commands';

const SAVIO_URL = 'https://savio.utb.edu.co/my/';

async function sendPortal(from: string, area: FlowArea): Promise<void> {
  await setSession(from, { step: menuStepForArea(area), data: {} });
  await messaging.sendText({
    to: from,
    text: `Consulta tus cursos y actividades en Savio con tu cuenta institucional: ${SAVIO_URL}\n\nNo envíes tu contraseña ni tu cédula por WhatsApp. Escribe *menu* para otras opciones.`,
  });
}

export async function iniciarConsultaSavio(from: string, area: FlowArea): Promise<void> {
  if (!savioEnabled()) return sendPortal(from, area);
  const identity = await getIdentity(from);
  if (!identity) return startVerificationFlow(from, 'savio', area);
  await sendSavioCourses(from, area);
}

export async function sendSavioCourses(from: string, area: FlowArea): Promise<void> {
  if (!savioEnabled()) return sendPortal(from, area);
  const identity = await getIdentity(from);
  if (!identity) return startVerificationFlow(from, 'savio', area);
  const token = process.env.SAVIO_WS_TOKEN?.trim();
  if (!token) return sendPortal(from, area);

  try {
    const result = await getSavioCoursesForEmail(identity.email, token);
    // Una transferencia o revocación durante la llamada a Moodle invalida
    // esta respuesta antes de enviarla al número anterior.
    if ((await getIdentity(from))?.email !== identity.email) {
      await setSession(from, { step: menuStepForArea(area), data: {} });
      await messaging.sendText({ to: from, text: 'Tu vínculo institucional cambió. Vuelve a vincular este WhatsApp para consultar Savio.' });
      return;
    }
    await setSession(from, { step: menuStepForArea(area), data: {} });
    if (!result.accountFound) {
      await track('savio_cuenta_no_encontrada');
      await messaging.sendText({
        to: from,
        text: `No encontré en Savio una cuenta con tu correo institucional verificado. Revisa tu acceso directamente en ${SAVIO_URL} o consulta con Soporte TI.`,
      });
      return;
    }
    await track('savio_cursos_consultados');
    if (result.courses.length === 0) {
      await messaging.sendText({
        to: from,
        text: `No aparecen cursos asociados a tu cuenta de Savio en este momento. Revisa el portal: ${SAVIO_URL}`,
      });
      return;
    }
    const shown = result.courses.slice(0, 10);
    const lines = shown.map((course) => `• ${course.name}\n  ${course.url}`).join('\n');
    const more = result.courses.length > shown.length ? '\n\nConsulta los demás cursos en Savio.' : '';
    await messaging.sendText({
      to: from,
      text: `📚 *Tus cursos en Savio*\n\n${lines}${more}\n\nPara tareas y entregas entra al portal: ${SAVIO_URL}\n_Escribe *menu* para otras opciones._`,
    });
  } catch {
    await track('savio_error');
    await setSession(from, { step: menuStepForArea(area), data: {} });
    await messaging.sendText({
      to: from,
      text: `No pude consultar tus cursos en Savio ahora. Puedes entrar directamente: ${SAVIO_URL}\n\nEscribe *menu* para otras opciones.`,
    });
  }
}
