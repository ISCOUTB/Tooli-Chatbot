/**
 * Registro de asistencia por QR, conectado al bot real. Los pasos están en
 * `asistenciaFlow.ts`; aquí solo se le entregan la mensajería, Redis y las
 * métricas de producción.
 *
 * Lleva su propia sesión (`asis:`), como el flujo del evento de posgrados:
 * no pisa el paso en que la persona estaba con el bot, y al terminar la
 * conversación sigue donde iba.
 */
import { deleteSession, getSession, setSession } from '../services/session';
import {
  getAsistentePorWhatsapp, getEvento, getEventoPorCodigo, registrarAsistente,
} from '../services/asistenciaService';
import { track } from '../services/metrics';
import { crearAtencionAsistencia } from './asistenciaFlow';
import { messaging } from './shared';

const sesion = (from: string) => `asis:${from}`;

/**
 * Atiende el mensaje si es de asistencia. Devuelve false cuando no lo es, y el
 * mensaje sigue al flujo normal del bot.
 */
export const atenderAsistencia = crearAtencionAsistencia({
  enviarTexto: (to, text) => messaging.sendText({ to, text }),
  enviarBotones: msg => messaging.sendButtons(msg),
  leerSesion: from => getSession(sesion(from)),
  guardarSesion: (from, session) => setSession(sesion(from), session),
  borrarSesion: from => deleteSession(sesion(from)),
  getEvento: id => getEvento(id),
  getEventoPorCodigo: codigo => getEventoPorCodigo(codigo),
  getAsistentePorWhatsapp: (eventoId, whatsapp) => getAsistentePorWhatsapp(eventoId, whatsapp),
  registrarAsistente: (eventoId, datos, opciones) => registrarAsistente(eventoId, datos, opciones),
  track: evento => track(evento),
});
