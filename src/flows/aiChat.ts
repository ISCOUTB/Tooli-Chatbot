import { setSession } from '../services/session';
import { preguntarAI, AIUnavailableError, ChatTurn } from '../services/aiAssistant';
import { track } from '../services/metrics';
import { isAiDisabled } from '../services/botUserService';
import { FlowContext, messaging, sendMenu, sendAiHint, normalize, volverAlMenuDeOrigen } from './shared';
import { iniciarConversacionAsesor, iniciarVerificacionIdentidad } from './agentHandoff';
import { parseGlobalCommand, resolveAiArea } from './commands';
import { resumenOrientacion } from './programasCatalog';

const TURN_LIMIT_SUGGEST_AGENT = 15;

export async function handleChattingWithAI(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const input = normalize(text);
  const command = parseGlobalCommand(text);
  const data = session?.data ?? {};

  // “volver”/`0` regresa al menú del área de origen (fallback: raíz).
  if (command === 'volver') {
    await volverAlMenuDeOrigen(from, data);
    return;
  }

  if (command === 'salir' || command === 'menu') {
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return;
  }

  // Un asesor apagó la IA para esta conversación puntual (toggle en el panel
  // de Conversaciones) — en vez de responder con el modelo, escala directo a
  // atención humana sin necesidad de banear al usuario.
  if (await isAiDisabled(from)) {
    await track('ai_disabled_escalation', {});
    await iniciarConversacionAsesor(from, session?.data ?? {}, { aiNoResolvio: false });
    return;
  }

  if (
    input === 'gracias' ||
    input === 'listo' ||
    input === 'terminar'
  ) {
    await setSession(from, { step: 'menu', data: {} });
    await messaging.sendText({
      to: from,
      text: '¡Genial! 🙌 Vuelve cuando necesites algo más.\n\nEscribe *menu* para ver las opciones.',
    });
    return;
  }

  if (input === 'asesor' || input === 'humano' || input === 'agente') {
    await track('ai_escalated_to_agent', { reason: 'user_requested' });
    await iniciarConversacionAsesor(from, session?.data ?? {}, { aiNoResolvio: true });
    return;
  }

  // Sin área válida no se asume Posgrado: se usa `originArea` o recuperación explícita.
  const area = resolveAiArea(data);
  if (!area) {
    await setSession(from, { step: 'menu', data: {} });
    await messaging.sendText({
      to: from,
      text:
        '⚠️ Perdí el contexto de esta conversación (área desconocida).\n\nTe llevo al inicio para que elijas de nuevo.',
    });
    await sendMenu(from);
    return;
  }
  let history: ChatTurn[] = [];
  try {
    const parsed: unknown = JSON.parse(data.aiHistory ?? '[]');
    if (Array.isArray(parsed)) {
      history = parsed.filter((turn): turn is ChatTurn =>
        turn != null &&
        (turn.role === 'user' || turn.role === 'assistant') &&
        typeof turn.content === 'string',
      );
    }
  } catch {
    // Una sesión antigua dañada no debe impedir que la persona continúe.
  }
  const turnCount = Number.parseInt(data.aiTurnCount ?? '0', 10) || 0;
  const tituloAsistente =
    area === 'ti' ? '🤖 *Asistente TI*' :
    area === 'admisiones' ? '🤖 *Asistente Admisiones UTB*' :
    '🤖 *Asistente Posgrados UTB*';

  await track('ai_request', { area: area as 'ti' | 'admisiones' | 'posgrados' });

  try {
    const orientacion = area === 'posgrados' ? resumenOrientacion(data.orientacionArea ?? '') : null;
    const ai = await preguntarAI(area, text.trim(), history, orientacion ?? undefined);

    await messaging.sendText({ to: from, text: `${tituloAsistente}\n\n${ai.answer}` });

    if (ai.usedTool) await track('ai_used_tool', { area });
    await track('ai_resolved', { area });

    if (ai.triggerIdentityVerification && area === 'ti') {
      const newHistory: ChatTurn[] = [
        ...history,
        { role: 'user', content: text.trim() },
        { role: 'assistant', content: ai.answer },
      ];
      await iniciarVerificacionIdentidad(from, {
        ...session?.data,
        aiHistory: JSON.stringify(newHistory),
      });
      return;
    }

    const newHistory: ChatTurn[] = [
      ...history,
      { role: 'user', content: text.trim() },
      { role: 'assistant', content: ai.answer },
    ];
    const newTurnCount = turnCount + 1;

    await setSession(from, {
      step: 'chatting_with_ai',
      data: {
        ...session?.data,
        aiHistory: JSON.stringify(newHistory),
        aiTurnCount: String(newTurnCount),
      },
    });

    if (newTurnCount >= TURN_LIMIT_SUGGEST_AGENT) {
      await messaging.sendText({
        to: from,
        text:
          '🤔 Hemos hablado bastante. Si sientes que aún no resuelves tu duda, ' +
          'te recomiendo *hablar con un asesor humano* — escribe *asesor*.',
      });
      return;
    }

    if (newTurnCount % 3 === 1 && newTurnCount > 1) {
      await sendAiHint(from);
    }
  } catch (err) {
    console.error('[chatting_with_ai] error:', err instanceof AIUnavailableError ? err.reason : 'unknown');
    await track('ai_failed', { area, reason: err instanceof AIUnavailableError ? err.reason : 'unknown' });

    if (err instanceof AIUnavailableError) {
      await messaging.sendText({
        to: from,
        text:
          '⚠️ El asistente automático no está disponible en este momento.\n\n' +
          '¿Quieres que te conecte con un *asesor humano*? Escribe *asesor* para hacerlo, o *salir* para terminar.',
      });
      return;
    }

    await messaging.sendText({
      to: from,
      text:
        'Tuve un problema procesando tu pregunta. ¿Quieres *intentar de nuevo* o escribir *asesor* para hablar con un humano?',
    });
  }
}
