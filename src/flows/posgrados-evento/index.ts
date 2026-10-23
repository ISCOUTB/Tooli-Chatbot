import { getSession } from '../../services/session';
import { handleMessage } from '../index';
import { getPosgradoSession } from './shared';
import {
  handlePosgradoInicio,
  handlePosgradoNombre,
  handlePosgradoCorreo,
  handlePosgradoPrograma,
  handlePosgradoConsent,
  handlePosgradoCompletada,
  handlePosgradoRegistroPendiente,
} from './flow';

type Handler = (ctx: { from: string; text: string; session: any }) => Promise<void>;

const HANDLERS: Record<string, Handler> = {
  posg_consent:    handlePosgradoConsent,
  posg_nombre:     handlePosgradoNombre,
  posg_correo:     handlePosgradoCorreo,
  posg_programa:   handlePosgradoPrograma,
  posg_completada: handlePosgradoCompletada,
  posg_registro_pendiente: handlePosgradoRegistroPendiente,
};

// Pasos del flujo principal a los que cedemos el control (IA / asesor humano)
const MAIN_BRIDGE_STEPS = ['chatting_with_ai', 'with_agent'];

export async function handlePosgradoMessage(from: string, text: string, _inbound?: any): Promise<void> {
  // ── Puente ──────────────────────────────────────────────────────────────────
  // Si el usuario ya fue transferido al asistente IA o a un asesor (sesión
  // principal), delegamos al flujo principal en vez de re-procesar posgrados.
  const mainSession = await getSession(from);
  if (mainSession && MAIN_BRIDGE_STEPS.includes(mainSession.step)) {
    return handleMessage(from, text);
  }

  const session = await getPosgradoSession(from);
  const step    = session?.step ?? 'posg_inicio';

  const handler = HANDLERS[step] ?? handlePosgradoInicio;

  await handler({ from, text, session });
}
