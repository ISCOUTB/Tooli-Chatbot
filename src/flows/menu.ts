import { setSession } from '../services/session';
import { track } from '../services/metrics';
import { FlowContext, messaging, sendMenu, sendMenuPosgrado, sendMenuPregrado, sendAreaPrompt } from './shared';
import { parseGlobalCommand } from './commands';
import { iniciarConsultaDeNotas } from './notas';
import { sendCategoriasMenu } from './programas';
import { sendMenuAcademico } from './academico';

/** Paso 0 — el usuario todavía no eligió Pregrado o Posgrado. */
export async function handleMenu(ctx: FlowContext): Promise<void> {
  const { from, text } = ctx;
  const input = text.trim();

  if (input === '1') {
    await setSession(from, { step: 'menu_pregrado', data: {} });
    await sendMenuPregrado(from);
    return;
  }

  if (input === '2') {
    await setSession(from, { step: 'menu_posgrado', data: {} });
    await sendMenuPosgrado(from);
    return;
  }

  if (parseGlobalCommand(text) === null) {
    await messaging.sendText({
      to: from,
      text: 'No reconocí esa opción 🤔\n\nElige *1* para Pregrado o *2* para Posgrado.',
    });
  }
  await track('menu_shown');
  await sendMenu(from);
}

/** Menú de Posgrado. */
export async function handleMenuPosgrado(ctx: FlowContext): Promise<void> {
  const { from, text } = ctx;
  const input = text.trim();

  if (input === '0' || parseGlobalCommand(text) !== null) {
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return;
  }

  // 1 — Ver notas (verifica identidad por OTP la primera vez)
  if (input === '1') {
    await iniciarConsultaDeNotas(from);
    return;
  }

  // 2 — Ver programas de posgrado
  if (input === '2') {
    await setSession(from, { step: 'programas_categoria', data: {} });
    await sendCategoriasMenu(from);
    return;
  }

  // 3 — Asistente IA
  if (input === '3') {
    await setSession(from, { step: 'chatting_with_ai', data: { area: 'posgrados' } });
    await messaging.sendText({
      to: from,
      text:
        '🤖 *Asistente IA*\n\n' +
        'Pregúntame lo que necesites sobre la UTB: trámites, fechas, requisitos, programas…\n\n' +
        '_Escribe *asesor* para hablar con una persona, o *menu* para volver._',
    });
    return;
  }

  // 4 — Registrarse en base de datos
  if (input === '4') {
    await setSession(from, { step: 'registro_nombre', data: {} });
    await messaging.sendText({
      to: from,
      text:
        '📬 *Registro en base de datos de Posgrados UTB*\n\n' +
        'Te agregaremos para enviarte información sobre programas, becas y novedades.\n\n' +
        '¿Cuál es tu *nombre completo*?\n\n' +
        '_Escribe *menu* para cancelar._',
    });
    await track('registro_iniciado');
    return;
  }

  // 5 — Turno de matrícula
  if (input === '5') {
    await setSession(from, { step: 'esperando_codigo', data: {} });
    await messaging.sendText({
      to: from,
      text: 'Por favor escribe tu *código estudiantil*.\n_Ejemplo: T000XXXXX_\n\nEscribe *menu* para cancelar.',
    });
    return;
  }

  // 6 — Recibo de matrícula
  if (input === '6') {
    await setSession(from, { step: 'recibo_codigo', data: {} });
    await messaging.sendText({
      to: from,
      text:
        'Para descargar tu recibo necesito tus credenciales del portal.\n\n' +
        'Por favor escribe tu *código estudiantil*.\n_Ejemplo: T000XXXXX_\n\nEscribe *menu* para cancelar.',
    });
    return;
  }

  // 7 — Hablar con asesor (handoff por área: TI / Admisiones)
  if (input === '7') {
    await setSession(from, { step: 'agent_area', data: {} });
    await sendAreaPrompt(from);
    return;
  }

  // 8 — Mi vida académica (estudiantes ya matriculados)
  if (input === '8') {
    await sendMenuAcademico(from, 'posgrado');
    return;
  }

  await messaging.sendText({
    to: from,
    text: 'No reconocí esa opción 🤔\n\nElige un número de la lista, o escribe *menu* para volver al inicio.',
  });
  await track('menu_shown');
  await sendMenuPosgrado(from);
}

/** Menú de Pregrado (antes solo existían Turno/Recibo sueltos, sin registro de
 * interés ni asesor propio para aspirantes de pregrado). */
export async function handleMenuPregrado(ctx: FlowContext): Promise<void> {
  const { from, text } = ctx;
  const input = text.trim();

  if (input === '0' || parseGlobalCommand(text) !== null) {
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return;
  }

  // 1 — Ver notas (verifica identidad por OTP la primera vez)
  if (input === '1') {
    await iniciarConsultaDeNotas(from);
    return;
  }

  // 2 — Asistente IA (usa el área "admisiones": es la general/pregrado, ya
  // tiene su propia base de conocimiento y busca páginas de /pregrado/)
  if (input === '2') {
    await setSession(from, { step: 'chatting_with_ai', data: { area: 'admisiones' } });
    await messaging.sendText({
      to: from,
      text:
        '🤖 *Asistente IA de Pregrado*\n\n' +
        'Cuéntame qué quieres saber: carreras, proceso de inscripción, costos, fechas de admisión…\n\n' +
        '_Escribe *asesor* para hablar con una persona, o *menu* para volver._',
    });
    return;
  }

  // 3 — Registrarse en base de datos
  if (input === '3') {
    await setSession(from, { step: 'pregrado_registro_nombre', data: {} });
    await messaging.sendText({
      to: from,
      text:
        '📬 *Registro de interés en Pregrado UTB*\n\n' +
        'Te agregaremos a nuestra base de datos para enviarte información sobre admisiones, becas y novedades.\n\n' +
        '¿Cuál es tu *nombre completo*?\n\n' +
        '_Escribe *menu* para cancelar._',
    });
    await track('registro_pregrado_iniciado');
    return;
  }

  // 4 — Turno de matrícula
  if (input === '4') {
    await setSession(from, { step: 'esperando_codigo', data: {} });
    await messaging.sendText({
      to: from,
      text: 'Por favor escribe tu *código estudiantil*.\n_Ejemplo: T000XXXXX_\n\nEscribe *menu* para cancelar.',
    });
    return;
  }

  // 5 — Recibo de matrícula
  if (input === '5') {
    await setSession(from, { step: 'recibo_codigo', data: {} });
    await messaging.sendText({
      to: from,
      text:
        'Para descargar tu recibo necesito tus credenciales del portal.\n\n' +
        'Por favor escribe tu *código estudiantil*.\n_Ejemplo: T000XXXXX_\n\nEscribe *menu* para cancelar.',
    });
    return;
  }

  // 6 — Hablar con asesor
  if (input === '6') {
    await setSession(from, { step: 'pregrado_prospecto_nombre', data: {} });
    await messaging.sendText({
      to: from,
      text:
        '🧑‍💼 *Conectar con asesor de Pregrado*\n\n' +
        'Para que el asesor pueda ayudarte mejor, necesito algunos datos rápidos.\n\n' +
        '¿Cuál es tu *nombre completo*?\n\n' +
        '_Escribe *menu* para cancelar._',
    });
    await track('prospecto_pregrado_iniciado');
    return;
  }

  // 7 — Mi vida académica (estudiantes ya matriculados)
  if (input === '7') {
    await sendMenuAcademico(from, 'pregrado');
    return;
  }

  await messaging.sendText({
    to: from,
    text: 'No reconocí esa opción 🤔\n\nElige un número de la lista, o escribe *menu* para volver al inicio.',
  });
  await track('menu_pregrado_shown');
  await sendMenuPregrado(from);
}
