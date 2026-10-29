import { setSession } from '../services/session';
import { sendIncomingMessage } from '../services/chatwootService';
import { publicarAtencion } from '../services/atencionEventos';
import { describeExternalError } from '../services/logSafe';
import { FlowContext, messaging, normalize } from './shared';

export async function handleWithAgent(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const input = normalize(text);
  if (input === 'salir' || input === 'menu') {
    await setSession(from, { step: 'menu', data: {} });
    await messaging.sendText({
      to: from,
      text: '✅ Saliste del chat con el asesor.\n\nEscribe cualquier cosa para ver el menú.',
    });
    return;
  }
  const conversationId = parseInt(session?.data.conversationId ?? '0');
  if (!conversationId) {
    await setSession(from, { step: 'menu', data: {} });
    await messaging.sendText({ to: from, text: 'Sesión expirada. Escribe *menu* para volver.' });
    return;
  }
  try {
    await sendIncomingMessage(conversationId, text);
    publicarAtencion({ tipo: 'mensaje', conversacionId: conversationId, entrante: true, nombre: session?.data.nombre, texto: text });
  } catch (err) {
    console.error('[with_agent] error reenviando a Chatwoot:', describeExternalError(err));
    await messaging.sendText({
      to: from,
      text: 'No pude enviar tu mensaje al asesor. Intenta de nuevo o escribe *salir* para volver al menú.',
    });
  }
}
