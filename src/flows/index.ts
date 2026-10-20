import { getSession, setSession } from '../services/session';
import { FlowContext, sendMenu } from './shared';
import { handleMenu, handleMenuPosgrado, handleMenuPregrado } from './menu';
import { handleProgramasCategoria, handleProgramasDetalle } from './programas';
import { handleProspectoNombre, handleProspectoEmail, handleProspectoPrograma } from './prospecto';
import { handleRegistroNombre, handleRegistroEmail, handleRegistroPrograma } from './registro';
import {
  handlePregradoRegistroNombre, handlePregradoRegistroEmail, handlePregradoRegistroCarrera,
  handlePregradoProspectoNombre, handlePregradoProspectoEmail, handlePregradoProspectoCarrera,
} from './pregrado';
import { handleAcademicoMenu } from './academico';
import { handleExplorarArea, handleExplorarCarrera, handleExplorarAccion } from './pregradoExplorar';
import { handleChattingWithAI } from './aiChat';
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

const HANDLERS: Record<string, (ctx: FlowContext) => Promise<void>> = {
  // ── Inicio (elige Pregrado / Posgrado) ──────────────────────────────────────
  menu: handleMenu,
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
  chatting_with_ai: handleChattingWithAI,
  with_agent: handleWithAgent,
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

export async function handleMessage(from: string, text: string): Promise<void> {
  const session = await getSession(from);
  const step = session?.step ?? 'menu';

  const handler = HANDLERS[step];
  if (!handler) {
    console.warn(`[flows] step desconocido "${step}", recuperando al menú`);
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return;
  }

  await handler({ from, text, session });
}
