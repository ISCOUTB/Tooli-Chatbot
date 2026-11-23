import { setSession } from '../services/session';
import { startNotasLogin, submitNotasMfa, closeNotasSession } from '../services/notasService';
import { getIdentity, isVerified } from '../services/identityService';
import { track } from '../services/metrics';
import { FlowContext, messaging, salirAlMenuRaiz, volverAlMenuDeOrigen } from './shared';
import { startVerificationFlow } from './verificacion';
import { parseGlobalCommand, returnMenuStep } from './commands';
import type { FlowArea, SessionData } from './commands';
import { RECURSOS_ACADEMICOS } from '../services/academicoLinks';
import { caminoNotas, horasSesionNotas, interruptoresDeEntorno } from '../services/academico/interruptores';
import { reglaNotas } from '../services/academico/calculos';
import { academico, guardarSesionDeNotas, haySesionDeNotas } from '../services/academico/servicio';
import { procesarMfa, procesarPassword, type DepsNotasLogin } from './notasLogin';

// El login automatizado solicita la contraseña institucional por WhatsApp y
// aún no ha sido validado contra Banner con una cuenta de prueba. Se habilita
// únicamente tras esa revisión explícita (TOOLI_NOTAS_SSO_ENABLED=1); el enlace
// oficial sigue disponible mientras tanto.
const notasSsoEnabled = () => interruptoresDeEntorno.notas();
const notasUrl = RECURSOS_ACADEMICOS.find((r) => r.id === 'notas')?.url ?? 'https://autoservicio4prod.utb.edu.co';

/** Dependencias reales de notasLogin.ts (la lógica y sus pruebas viven allí). */
const depsLogin: DepsNotasLogin = {
  obtenerCorreo: async (from) => (await getIdentity(from))?.email ?? null,
  iniciarLogin: (from, email, password, opciones) => startNotasLogin(from, email, password, opciones),
  enviarMfa: (from, codigo) => submitNotasMfa(from, codigo),
  guardarSesion: (from, email, estado) => guardarSesionDeNotas(from, email, estado),
  setSession,
  enviar: (to, text) => messaging.sendText({ to, text }),
  track: (evento) => track(evento),
  regla: () => reglaNotas(),
};

async function ofrecerPortalOficial(from: string, data?: SessionData): Promise<void> {
  await closeNotasSession(from);
  await setSession(from, { step: returnMenuStep(data), data: {} });
  await messaging.sendText({
    to: from,
    text: 'Para consultar tus notas, entra directamente al autoservicio oficial de la UTB con tus credenciales institucionales:\n' +
      `${notasUrl}\n\nNo envíes tu contraseña por WhatsApp. Escribe *menu* para ver otras opciones.`,
  });
}

async function pedirPassword(from: string, data: SessionData): Promise<void> {
  await setSession(from, { step: 'notas_password', data });
  await messaging.sendText({
    to: from,
    text:
      'Para ver tus notas, inicio sesión por ti en Banner.\n\n' +
      'Escribe tu *contraseña institucional* (la de tu correo @utb / Microsoft).\n\n' +
      `⚠️ Se usa solo para esta consulta y *no se guarda*${data.guardar === '1' ? ' (solo recuerdo tu sesión, nunca la contraseña)' : ''}.\n\nEscribe *menu* para cancelar.`,
  });
}

/** Camino A: pregunta si puede recordar la sesión (cifrada y con vencimiento). */
async function pedirConsentimiento(from: string, data: SessionData): Promise<void> {
  await setSession(from, { step: 'notas_consentimiento', data });
  await messaging.sendButtons({
    to: from,
    title: '🔒 ¿Recordar tu sesión?',
    description:
      `Si aceptas, guardo tu *sesión* de Banner cifrada por ${horasSesionNotas()} horas para que la próxima vez no tengas que escribir la contraseña. ` +
      'Tu contraseña nunca se guarda. Puedes borrar la sesión cuando quieras desde *Mi semestre*.',
    buttons: [
      { id: '1', displayText: 'Sí, recordar' },
      { id: '2', displayText: 'No, solo esta vez' },
    ],
  });
}

/** Solo estos datos viajan en la sesión de Redis durante el flujo de notas. */
function datosDe(data?: SessionData): SessionData {
  const salida: SessionData = {};
  if (data?.originArea) salida.originArea = data.originArea;
  return salida;
}

/**
 * Consulta de notas — servicio compartido por Pregrado y Posgrado.
 *
 * Un estudiante activo puede ser de cualquiera de las dos ramas, así que el
 * punto de entrada vive aquí y lo llaman ambos menús (y el hub académico) en
 * vez de duplicarse. Si todavía no verificó su identidad, primero va el OTP al
 * correo institucional y al terminar retoma solo en las notas.
 */
export async function iniciarConsultaDeNotas(from: string, originArea?: FlowArea): Promise<void> {
  const data: SessionData = originArea ? { originArea } : {};
  if (!notasSsoEnabled()) {
    await ofrecerPortalOficial(from, data);
    return;
  }
  if (!(await isVerified(from))) {
    await startVerificationFlow(from, 'notas', originArea);
    await track('verificacion_iniciada');
    return;
  }
  if (caminoNotas() === 'A') {
    // Sesión guardada y vigente: se responde sin pedir contraseña (la misma vía que usa la voz).
    if (await haySesionDeNotas(from)) {
      const r = await academico.consultar(from, 'notas');
      if (r.ok || r.motivo !== 'sin_sesion') {
        await setSession(from, { step: returnMenuStep(data), data: {} });
        await messaging.sendText({ to: from, text: r.paraTexto });
        if (r.ok) await track('notas_consultadas');
        return;
      }
    }
    await pedirConsentimiento(from, data);
    return;
  }
  await pedirPassword(from, data);
}

/** Paso `notas_consentimiento`: SOLO botones. Lo que escriba NO se repite ni se interpreta (podría ser la contraseña). */
export async function handleNotasConsentimiento(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  if (!notasSsoEnabled()) return ofrecerPortalOficial(from, session?.data);
  const command = parseGlobalCommand(text);
  if (command === 'menu' || command === 'salir') return salirAlMenuRaiz(from);
  if (command === 'volver') return volverAlMenuDeOrigen(from, session?.data);
  const eleccion = text.trim();
  const data = datosDe(session?.data);
  if (eleccion !== '1' && eleccion !== '2') {
    await messaging.sendText({
      to: from,
      text: 'Elige una de las dos opciones con los botones. *Aún no escribas tu contraseña*: te la pido en el siguiente paso.',
    });
    await pedirConsentimiento(from, data);
    return;
  }
  if (eleccion === '1') data.guardar = '1';
  await pedirPassword(from, data);
}

export async function handleNotasPassword(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  if (!notasSsoEnabled()) return ofrecerPortalOficial(from, session?.data);
  const command = parseGlobalCommand(text);
  if (command === 'menu' || command === 'salir') return salirAlMenuRaiz(from);
  if (command === 'volver') return volverAlMenuDeOrigen(from, session?.data);
  await procesarPassword(depsLogin, from, text, session?.data);
}

export async function handleNotasMfa(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  if (!notasSsoEnabled()) return ofrecerPortalOficial(from, session?.data);
  const command = parseGlobalCommand(text);
  if (command === 'menu' || command === 'salir') {
    await closeNotasSession(from);
    return salirAlMenuRaiz(from);
  }
  if (command === 'volver') {
    await closeNotasSession(from);
    return volverAlMenuDeOrigen(from, session?.data);
  }
  await procesarMfa(depsLogin, from, text, session?.data);
}
