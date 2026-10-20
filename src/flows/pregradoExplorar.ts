import { setSession } from '../services/session';
import { track } from '../services/metrics';
import { FlowContext, messaging, sendMenu, sendMenuPregrado } from './shared';
import { parseGlobalCommand } from './commands';
import {
  buildUndecidedLabel,
  formatAreasMessage,
  formatCareersMessage,
  getAreaById,
  parseAreaSelection,
  parseCareerSelection,
  parseExploreAction,
  selectedInterest,
  type PregradoAreaId,
} from './pregradoGuidance';

async function sendAreas(to: string, mode: 'initial' | 'invalid'): Promise<void> {
  await setSession(to, { step: 'pregrado_explorar_area', data: {} });
  await messaging.sendText({ to, text: formatAreasMessage(mode) + '\n_Escribe *0* para volver a Pregrado._' });
}

async function sendCareers(to: string, areaId: PregradoAreaId, mode: 'initial' | 'invalid'): Promise<void> {
  await setSession(to, { step: 'pregrado_explorar_carrera', data: { areaId } });
  await messaging.sendText({ to, text: formatCareersMessage(areaId, mode) + '\n_Escribe *0* para elegir otra área._' });
}

async function sendActions(to: string, carreraInteres: string): Promise<void> {
  await setSession(to, { step: 'pregrado_explorar_accion', data: { carreraInteres } });
  await messaging.sendText({
    to,
    text: `🎓 *${carreraInteres}*\n\nPuedes registrar tu interés para recibir información, hablar con un asesor o seguir explorando. No has compartido tus datos personales todavía.`,
  });
  await messaging.sendButtons({
    to,
    title: '¿Qué quieres hacer?',
    description: 'Tu elección de carrera se conservará si decides continuar.',
    buttons: [
      { id: '1', displayText: '📬 Registrarme' },
      { id: '2', displayText: '👤 Hablar con asesor' },
      { id: '3', displayText: '🧭 Otras áreas' },
    ],
  });
}

export async function iniciarExploracionPregrado(to: string): Promise<void> {
  await track('pregrado_explorar_iniciado');
  await sendAreas(to, 'initial');
}

async function handleExit(from: string, text: string): Promise<boolean> {
  const command = parseGlobalCommand(text);
  if (command === 'menu' || command === 'salir') {
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return true;
  }
  if (command === 'volver' && text.trim() !== '0') {
    await setSession(from, { step: 'menu_pregrado', data: {} });
    await sendMenuPregrado(from);
    return true;
  }
  return false;
}

export async function handleExplorarArea({ from, text }: FlowContext): Promise<void> {
  if (await handleExit(from, text)) return;
  if (text.trim() === '0') {
    await setSession(from, { step: 'menu_pregrado', data: {} });
    await sendMenuPregrado(from);
    return;
  }
  const areaId = parseAreaSelection(text);
  if (!areaId) return sendAreas(from, 'invalid');
  await track('pregrado_explorar_area');
  await sendCareers(from, areaId, 'initial');
}

export async function handleExplorarCarrera({ from, text, session }: FlowContext): Promise<void> {
  if (await handleExit(from, text)) return;
  if (text.trim() === '0') return sendAreas(from, 'initial');

  const areaId = session?.data.areaId as PregradoAreaId | undefined;
  if (!areaId || !getAreaById(areaId)) return sendAreas(from, 'invalid');
  const selection = parseCareerSelection(text, areaId);
  if (selection.kind === 'invalid') return sendCareers(from, areaId, 'invalid');

  const carreraInteres = selection.kind === 'undecided'
    ? buildUndecidedLabel(getAreaById(areaId)?.label ?? '')
    : selection.career;
  await track('pregrado_explorar_carrera');
  await sendActions(from, carreraInteres);
}

export async function handleExplorarAccion({ from, text, session }: FlowContext): Promise<void> {
  if (await handleExit(from, text)) return;
  if (text.trim() === '0') return sendAreas(from, 'initial');

  const carreraInteres = selectedInterest(session?.data);
  if (!carreraInteres) return sendAreas(from, 'invalid');
  const action = parseExploreAction(text);

  if (action === 'otra_area') return sendAreas(from, 'initial');
  if (action === 'registro') {
    await setSession(from, { step: 'pregrado_registro_nombre', data: { carreraInteres } });
    await messaging.sendText({
      to: from,
      text: `📬 *Registro de interés en Pregrado UTB*\n\nConservé tu elección: *${carreraInteres}*. Para enviarte información de admisiones, becas y novedades, ¿cuál es tu *nombre completo*?\n\n_Escribe *menu* para cancelar._`,
    });
    await track('registro_pregrado_iniciado');
    return;
  }
  if (action === 'asesor') {
    await setSession(from, { step: 'pregrado_prospecto_nombre', data: { carreraInteres, originArea: 'pregrado' } });
    await messaging.sendText({
      to: from,
      text: `🧑‍💼 *Conectar con asesor de Pregrado*\n\nConservé tu elección: *${carreraInteres}*. Para que el asesor pueda ayudarte, ¿cuál es tu *nombre completo*?\n\n_Escribe *menu* para cancelar._`,
    });
    await track('prospecto_pregrado_iniciado');
    return;
  }

  await messaging.sendText({ to: from, text: 'Elige una de las tres opciones, o escribe *0* para explorar otra área.' });
  await sendActions(from, carreraInteres);
}
