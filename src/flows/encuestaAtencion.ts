import { setSession } from '../services/session';
import { encuestaVencida, parsearCalificacion, registrarCsat } from '../services/atencionInformesService';
import { handleRecoRelacion } from './recomendacion';
import { FlowContext, messaging } from './shared';

export async function handleEncuestaAtencion(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const preguntadaEn = Number(session?.data.preguntadaEn);
  const calificacion = parsearCalificacion(text);
  const conversationId = Number(session?.data.conversationId);

  if (calificacion !== null && !encuestaVencida(preguntadaEn) && Number.isSafeInteger(conversationId) && conversationId > 0) {
    await registrarCsat(conversationId, calificacion);
    await setSession(from, { step: 'menu', data: {} });
    await messaging.sendText({ to: from, text: '¡Gracias por calificar la atención!' });
    return;
  }

  // Una respuesta tardía o ajena a la encuesta sigue siendo una entrada al
  // menú; así un "1" no queda atrapado cuando la pregunta ya venció.
  const menuSession = { step: 'menu', data: {} };
  await setSession(from, menuSession);
  await handleRecoRelacion({ from, text, session: menuSession });
}
