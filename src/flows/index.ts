import { getSession, setSession } from '../services/session';
import { FlowContext, sendMenu } from './shared';
import { handleMenuClasico, handleMenuPosgrado, handleMenuPregrado } from './menu';
import { handleProgramasCategoria, handleProgramasDetalle } from './programas';
import { handleProspectoNombre, handleProspectoEmail, handleProspectoPrograma } from './prospecto';
import { handleRegistroNombre, handleRegistroEmail, handleRegistroPrograma } from './registro';
import {
  handlePregradoRegistroNombre, handlePregradoRegistroEmail, handlePregradoRegistroCarrera,
  handlePregradoProspectoNombre, handlePregradoProspectoEmail, handlePregradoProspectoCarrera,
} from './pregrado';
import { handleAcademicoMenu } from './academico';
import { handleAcademicAccount, handleAcademicUnlink } from './academicAccount';
import { handleExplorarArea, handleExplorarCarrera, handleExplorarAccion } from './pregradoExplorar';
import {
  handleRecoRelacion, handleRecoPregradoGrupo, handleRecoPregrado, handleRecoPregradoExterno,
  handleRecoConfirmar, handleRecoSinCoincidencia, handleRecoNivel, handleRecoResultados,
  handleRecoFichaElegir, handleRecoFicha, handleRecoConsentimiento, handleRecoNombre, handleRecoCorreo,
  atenderRespuestaCampana,
  atenderUtil,
  pedirConsentimiento,
} from './recomendacion';
import { handleChattingWithAI } from './aiChat';
import { agradecer, atenderBaja, handleConversacion, responderPreguntaSuelta } from './conversacion';
import { esAgradecimiento, esBaja, esPedidoAsesor, pareceUnaPregunta, parseBoton, parseSugerencia } from './conversacionView';
import { parseUtil } from './recomendacionView';
import type { Session } from '../services/session';
import { config } from '../config';
import { handleWithAgent } from './withAgent';
// Flujos legacy (turno, recibo, TI) — se mantienen por si algún usuario tiene sesión activa
import { handleEsperandoCodigo } from './turno';
import { handleReciboCodigo, handleReciboCedula } from './recibo';
import {
  handleAgentOutsideHours,
  handleAgentArea,
  handleAgentTiP1,
  handleAgentTiP2,
  handleAgentAdmisionesP1,
  handleAgentAdmisionesP2,
  handleAgentAdmisionesP3,
} from './agent';
import { handleTiCollectEmail, handleTiCollectCodigo, handleTiCollectCedula } from './identity';
import { handleVerifEmail, handleVerifCodigo } from './verificacion';
import { handleNotasPassword, handleNotasMfa } from './notas';
import { handleEncuestaAtencion } from './encuestaAtencion';

const HANDLERS: Record<string, (ctx: FlowContext) => Promise<void>> = {
  // ── Inicio: recomendación de posgrados según el pregrado ────────────────────
  menu: handleRecoRelacion,
  // "Otras gestiones": elegir Pregrado o Posgrado (antes era la entrada)
  menu_clasico: handleMenuClasico,
  // ── Posgrados ────────────────────────────────────────────────────────────────
  menu_posgrado: handleMenuPosgrado,
  programas_categoria: handleProgramasCategoria,
  programas_detalle: handleProgramasDetalle,
  prospecto_nombre: handleProspectoNombre,
  prospecto_email: handleProspectoEmail,
  prospecto_programa: handleProspectoPrograma,
  registro_nombre: handleRegistroNombre,
  registro_email: handleRegistroEmail,
  registro_programa: handleRegistroPrograma,
  // ── Recomendación de posgrados según el pregrado ────────────────────────────
  reco_pregrado_grupo: handleRecoPregradoGrupo,
  reco_pregrado: handleRecoPregrado,
  reco_pregrado_externo: handleRecoPregradoExterno,
  reco_confirmar: handleRecoConfirmar,
  reco_sin_coincidencia: handleRecoSinCoincidencia,
  reco_nivel: handleRecoNivel,
  reco_resultados: handleRecoResultados,
  reco_ficha_elegir: handleRecoFichaElegir,
  reco_ficha: handleRecoFicha,
  reco_consentimiento: handleRecoConsentimiento,
  reco_nombre: handleRecoNombre,
  reco_correo: handleRecoCorreo,
  // ── Pregrado ─────────────────────────────────────────────────────────────────
  menu_pregrado: handleMenuPregrado,
  pregrado_explorar_area: handleExplorarArea,
  pregrado_explorar_carrera: handleExplorarCarrera,
  pregrado_explorar_accion: handleExplorarAccion,
  pregrado_registro_nombre: handlePregradoRegistroNombre,
  pregrado_registro_email: handlePregradoRegistroEmail,
  pregrado_registro_carrera: handlePregradoRegistroCarrera,
  pregrado_prospecto_nombre: handlePregradoProspectoNombre,
  pregrado_prospecto_email: handlePregradoProspectoEmail,
  pregrado_prospecto_carrera: handlePregradoProspectoCarrera,
  // ── Compartido ───────────────────────────────────────────────────────────────
  // Verificación de identidad por OTP al correo institucional, y consulta real
  // de notas por SSO. Van aquí y no bajo un área porque un estudiante activo
  // puede ser de pregrado o de posgrado indistintamente.
  verif_email: handleVerifEmail,
  verif_codigo: handleVerifCodigo,
  notas_password: handleNotasPassword,
  notas_mfa: handleNotasMfa,
  academico_menu: handleAcademicoMenu,
  academico_cuenta: handleAcademicAccount,
  academico_desvincular: handleAcademicUnlink,
  chatting_with_ai: handleChattingWithAI,
  with_agent: handleWithAgent,
  encuesta_atencion: handleEncuestaAtencion,
  // ── Legacy (sesiones activas anteriores) ────────────────────────────────────
  esperando_codigo: handleEsperandoCodigo,
  recibo_codigo: handleReciboCodigo,
  recibo_cedula: handleReciboCedula,
  agent_outside_hours: handleAgentOutsideHours,
  agent_area: handleAgentArea,
  agent_ti_p1: handleAgentTiP1,
  agent_ti_p2: handleAgentTiP2,
  agent_admisiones_p1: handleAgentAdmisionesP1,
  agent_admisiones_p2: handleAgentAdmisionesP2,
  agent_admisiones_p3: handleAgentAdmisionesP3,
  ti_collect_email: handleTiCollectEmail,
  ti_collect_codigo: handleTiCollectCodigo,
  ti_collect_cedula: handleTiCollectCedula,
};

/** Pasos del flujo de recomendación que esperan una opción (lista o botones). */
const PASOS_DE_OPCION: ReadonlySet<string> = new Set([
  'reco_relacion', 'reco_nivel', 'reco_confirmar', 'reco_pregrado_grupo', 'reco_pregrado', 'reco_sin_coincidencia',
  'reco_resultados', 'reco_ficha', 'reco_ficha_elegir', 'reco_consentimiento',
]);
/** Pasos del flujo de recomendación que esperan un texto (carrera, nombre, correo). */
const PASOS_DE_TEXTO: ReadonlySet<string> = new Set(['reco_pregrado_externo', 'reco_nombre', 'reco_correo']);
/** En recomendaciones y ficha, el texto libre ya lo responde la IA en la conversación. */
const PASOS_CON_IA: ReadonlySet<string> = new Set(['reco_resultados', 'reco_ficha']);

/**
 * Lo que vale en cualquier paso del flujo de recomendación (con el inicio
 * conversacional): BAJA, los botones de la conversación, pedir un asesor, un
 * "gracias" y una pregunta escrita. Así ningún paso responde "No reconocí" a eso.
 */
async function atajos(from: string, text: string, session: Session | null): Promise<boolean> {
  if (!config.conversacion.activa || !session) return false;
  const { step } = session;
  const data = session.data ?? {};
  if (step === 'menu' || step === 'with_agent') return false;
  if (esBaja(text)) {
    await atenderBaja(from, data);
    return true;
  }
  if (!PASOS_DE_OPCION.has(step) && !PASOS_DE_TEXTO.has(step)) return false;
  // Botones de la conversación (ofrecer asesor, sugerencias) tocados desde un paso del flujo de recomendación.
  if (parseBoton(text) || parseSugerencia(text)) {
    await handleConversacion({ from, text, session: { step: 'menu', data: { ...data, pendiente: '' } } });
    return true;
  }
  if (!PASOS_DE_OPCION.has(step)) return false;
  if (esPedidoAsesor(text) && step !== 'reco_consentimiento') {
    await pedirConsentimiento(from, data);
    return true;
  }
  if (esAgradecimiento(text)) {
    if (/me sirvi/i.test(text) && data.utilPreguntada === '1') await atenderUtil(from, 'si', data, step);
    else await agradecer(from);
    return true;
  }
  if (pareceUnaPregunta(text) && !/^\d+$/.test(text.trim()) && !PASOS_CON_IA.has(step)) {
    await responderPreguntaSuelta(from, data, text);
    return true;
  }
  return false;
}

export async function handleMessage(from: string, text: string): Promise<void> {
  const session = await getSession(from);
  // Respuesta a una campaña que inició el bot ("Ver mis opciones", "No me interesa")
  if (await atenderRespuestaCampana(from, text, session)) return;
  // 👍/👎 de la recomendación: vale desde cualquier paso y no lo cambia.
  const util = parseUtil(text);
  if (util) return atenderUtil(from, util, session?.data ?? {}, session?.step);
  if (await atajos(from, text, session)) return;
  const step = session?.step ?? 'menu';

  // Con el inicio conversacional, el paso raíz lo atiende la IA con preguntas de botones.
  const handler = step === 'menu' && config.conversacion.activa ? handleConversacion : HANDLERS[step];
  if (!handler) {
    console.warn(`[flows] step desconocido "${step}", recuperando al menú`);
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return;
  }

  await handler({ from, text, session });
}
