import { EvolutionAPIAdapter } from '../adapters/messaging/EvolutionAPIAdapter';
import { MetaCloudAdapter } from '../adapters/messaging/MetaCloudAdapter';
import { IMessagingAdapter } from '../adapters/messaging/IMessagingAdapter';
import { config } from '../config';
import { Session, setSession } from '../services/session';
import { returnMenuStep } from './commands';
import type { FlowArea, SessionData } from './commands';

export const messaging: IMessagingAdapter =
  config.messagingAdapter === 'meta'
    ? new MetaCloudAdapter()
    : new EvolutionAPIAdapter();

// Reexportadas desde validation.ts (puras y probadas allí); se mantienen aquí
// para no tocar los ~20 archivos que ya las importan desde este módulo.
export { CODIGO_REGEX, CEDULA_REGEX, EMAIL_REGEX, normalize, isMenuCommand } from './validation';
import { normalize } from './validation';

export const PLATAFORMAS_TI: Record<string, string> = {
  '1': 'Banner / Autoservicio',
  '2': 'Iceberg / Portal Financiero',
  '3': 'Correo institucional',
  '4': 'Aulas virtuales (Moodle)',
  '5': 'Wifi / Red',
  '6': 'Otro',
};

export const NIVELES_ADMISIONES: Record<string, string> = {
  '1': 'Pregrado',
  '2': 'Posgrado (maestría / especialización)',
  '3': 'Educación continua / cursos',
  '4': 'No estoy seguro',
};

export const ETAPAS_ADMISIONES: Record<string, string> = {
  '1': 'Información general',
  '2': 'Aplicando / inscribiéndose',
  '3': 'Ya admitido con dudas',
  '4': 'Estudiante actual con duda',
};

export interface FlowContext {
  from: string;
  text: string;
  session: Session | null;
}


export async function sendAiHint(to: string): Promise<void> {
  await messaging.sendText({
    to,
    text:
      '_Pregúntame lo que necesites. Escribe *asesor* para hablar con un humano, ' +
      'o *salir* cuando termines._',
  });
}

export async function sendAreaPrompt(to: string, originArea?: FlowArea): Promise<void> {
  const desdePosgrado = originArea === 'posgrado';
  await messaging.sendButtons({
    to,
    title: '🧑‍💼 Hablar con un asesor',
    description: desdePosgrado
      ? '¿En qué área necesitas ayuda? (vienes del menú de Posgrado)'
      : '¿En qué área necesitas ayuda?',
    footer: 'Escribe menu para volver al inicio',
    buttons: [
      { id: '1', displayText: '🖥️ Soporte TI' },
      { id: '2', displayText: desdePosgrado ? '📝 Admisiones Posgrados' : '📝 Admisiones' },
    ],
  });
}

/** Salida compartida al menú raíz (“menu”/“salir”). */
export async function salirAlMenuRaiz(to: string): Promise<void> {
  await setSession(to, { step: 'menu', data: {} });
  await sendMenu(to);
}

/**
 * Retorno compartido al menú del área de origen (“volver”/`0`).
 * Sin origen válido cae explícitamente al menú raíz (sesiones legacy/corruptas).
 */
export async function volverAlMenuDeOrigen(to: string, data: SessionData | undefined | null): Promise<void> {
  const step = returnMenuStep(data);
  if (step === 'menu_posgrado') {
    await setSession(to, { step, data: {} });
    await sendMenuPosgrado(to);
    return;
  }
  if (step === 'menu_pregrado') {
    await setSession(to, { step, data: {} });
    await sendMenuPregrado(to);
    return;
  }
  await setSession(to, { step: 'menu', data: {} });
  await sendMenu(to);
}

/** Punto de entrada del bot: primero se identifica si es un contacto de
 * Pregrado o Posgrado, porque cada uno tiene su propio menú, registro y
 * equipo de asesores — antes todo el bot estaba forzado bajo la marca
 * "Posgrados UTB" aunque Turno/Recibo son trámites de pregrado. */
export async function sendMenu(to: string): Promise<void> {
  await messaging.sendButtons({
    to,
    title: '🎓 Tooli UTB',
    description: 'Hola 👋 Soy el asistente virtual de la Universidad Tecnológica de Bolívar.\n\n¿Sobre qué quieres información?',
    footer: 'Universidad Tecnológica de Bolívar',
    buttons: [
      { id: '1', displayText: '🏫 Pregrado' },
      { id: '2', displayText: '🎓 Posgrado' },
    ],
  });
}

export async function sendMenuPosgrado(to: string): Promise<void> {
  await messaging.sendList({
    to,
    title: '🎓 Posgrados UTB',
    description: '¿En qué te puedo ayudar hoy?',
    footer: 'Universidad Tecnológica de Bolívar',
    buttonText: 'Ver opciones',
    sections: [
      {
        title: 'Menú de posgrados',
        rows: [
          { id: '1', title: '📊 Ver notas',          description: 'Consulta tus calificaciones (verifica tu correo UTB)' },
          { id: '2', title: '🎓 Ver programas',      description: 'Especializaciones, maestrías y doctorados' },
          { id: '3', title: '🤖 Asistente IA',        description: 'Costos, requisitos, diferencias de programas' },
          { id: '4', title: '📬 Registrarme',         description: 'Recibe novedades de posgrados por WhatsApp' },
          { id: '5', title: '📋 Turno matrícula',     description: 'Consulta tu turno y fecha asignada' },
          { id: '6', title: '🧾 Recibo matrícula',    description: 'Descarga el PDF de tu recibo de pago' },
          { id: '7', title: '👤 Hablar con asesor',   description: 'Conecta con el equipo de admisiones' },
          { id: '8', title: '🎒 Mi vida académica',   description: 'Horario, Savio, calendario y becas' },
          { id: '0', title: '🔙 Cambiar a Pregrado',  description: 'Volver al menú de inicio' },
        ],
      },
    ],
  });
}

export async function sendMenuPregrado(to: string): Promise<void> {
  await messaging.sendList({
    to,
    title: '🏫 Pregrado UTB',
    description: '¿En qué te puedo ayudar hoy?',
    footer: 'Universidad Tecnológica de Bolívar',
    buttonText: 'Ver opciones',
    sections: [
      {
        title: 'Menú de pregrado',
        rows: [
          { id: '1', title: '📊 Ver notas',          description: 'Consulta tus calificaciones (verifica tu correo UTB)' },
          { id: '2', title: '🤖 Asistente IA',        description: 'Carreras, admisiones, costos, proceso de inscripción' },
          { id: '3', title: '📬 Registrarme',         description: 'Cuéntanos qué carrera te interesa' },
          { id: '4', title: '📋 Turno matrícula',     description: 'Consulta tu turno y fecha asignada' },
          { id: '5', title: '🧾 Recibo matrícula',    description: 'Descarga el PDF de tu recibo de pago' },
          { id: '6', title: '👤 Hablar con asesor',   description: 'Conecta con el equipo de admisiones' },
          { id: '7', title: '🎒 Mi vida académica',   description: 'Horario, Savio, calendario y becas' },
          { id: '0', title: '🔙 Cambiar a Posgrado',  description: 'Volver al menú de inicio' },
        ],
      },
    ],
  });
}
