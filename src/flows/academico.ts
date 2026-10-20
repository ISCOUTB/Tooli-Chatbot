/**
 * "Mi vida académica" — hub de plataformas oficiales para estudiantes ya
 * matriculados (pregrado y posgrado).
 *
 * Hasta ahora el bot solo servía a *aspirantes* (programas, registro de interés,
 * asesor) y a dos trámites sueltos (turno y recibo). Un estudiante activo que
 * escribía preguntando por sus notas, su horario o una tarea no tenía a dónde ir.
 *
 * Las notas usan el flujo protegido de Banner. El recibo usa la consulta real
 * solo cuando está habilitada; horario y tareas conducen al portal oficial.
 */

import { setSession } from '../services/session';
import { MetricEvent, track } from '../services/metrics';
import { FlowContext, messaging, sendMenu, sendMenuPosgrado, sendMenuPregrado } from './shared';
import { parseGlobalCommand } from './commands';
import { AreaRecurso, getRecursos } from '../services/academicoLinks';
import { iniciarConsultaDeNotas } from './notas';
import { academicLookupEnabled, sendAcademicPortal } from './academicLookup';
import { sendAcademicAccount } from './academicAccount';
import { iniciarConsultaSavio } from './savio';
import type { FlowArea } from './commands';

/** Métrica por recurso: explícita (y no un template literal) para que el
 * compilador avise si alguien agrega un recurso sin su evento. */
const EVENTO_POR_RECURSO: Record<string, MetricEvent> = {
  notas: 'academico_notas',
  horario: 'academico_horario',
  savio: 'academico_savio',
  calendario: 'academico_calendario',
  recibo: 'academico_recibo',
  correo: 'academico_correo',
  becas: 'academico_becas',
  derechos: 'academico_derechos',
};

/** El área desde la que entró, para saber a qué menú devolverlo con "0". */
function areaDeSesion(data: Record<string, string> | undefined): FlowArea | null {
  if (data?.area === 'posgrado') return 'posgrado';
  if (data?.area === 'pregrado') return 'pregrado';
  return null;
}

async function volverAlMenuDeArea(from: string, area: AreaRecurso): Promise<void> {
  if (area === 'posgrado') {
    await setSession(from, { step: 'menu_posgrado', data: {} });
    await sendMenuPosgrado(from);
    return;
  }
  await setSession(from, { step: 'menu_pregrado', data: {} });
  await sendMenuPregrado(from);
}

/** Envía la lista de recursos académicos y deja la sesión esperando la elección. */
export async function sendMenuAcademico(to: string, area: AreaRecurso): Promise<void> {
  const recursos = getRecursos(area);

  await setSession(to, { step: 'academico_menu', data: { area } });

  await messaging.sendList({
    to,
    title: '🎒 Mi vida académica',
    description:
      'Te llevo directo a donde está tu información, sin dar vueltas por la página.\n\n' +
      '¿Qué necesitas consultar?',
    footer: 'Universidad Tecnológica de Bolívar',
    buttonText: 'Ver opciones',
    sections: [
      {
        title: 'Plataformas oficiales',
        rows: [
          ...recursos.map((r, i) => ({
            id: String(i + 1),
            title: `${r.emoji} ${r.titulo}`,
            description: r.resumen,
          })),
          { id: String(recursos.length + 1), title: '🔐 Mi cuenta vinculada', description: 'Vincular o desvincular este WhatsApp de tu cuenta UTB' },
          { id: '0', title: '🔙 Volver', description: 'Regresar al menú anterior' },
        ],
      },
    ],
  });

  await track('academico_menu_shown');
}

/** Paso: el usuario está viendo el hub y elige un recurso (o vuelve). */
export async function handleAcademicoMenu(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const input = text.trim();
  const command = parseGlobalCommand(text);

  if (command === 'menu' || command === 'salir') {
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return;
  }

  const area = areaDeSesion(session?.data);

  if (!area) {
    await setSession(from, { step: 'menu', data: {} });
    await sendMenu(from);
    return;
  }

  if (input === '0' || command === 'volver') {
    await volverAlMenuDeArea(from, area);
    return;
  }

  const recursos = getRecursos(area);
  if (input === String(recursos.length + 1)) {
    await sendAcademicAccount(from, area);
    return;
  }
  const elegido = /^\d+$/.test(input) ? recursos[Number(input) - 1] : undefined;

  // Las notas ya no se resuelven con un enlace: el bot las consulta de verdad
  // en Banner (verificando primero la identidad por OTP al correo). Mandar el
  // enlace aquí sería darle al estudiante el camino largo teniendo el corto.
  if (elegido?.id === 'notas') {
    await track('academico_notas');
    await iniciarConsultaDeNotas(from, area);
    return;
  }

  if (elegido?.id === 'recibo') {
    await track('academico_recibo');
    if (!academicLookupEnabled()) {
      await sendAcademicPortal(from, 'recibo', { originArea: area });
      return;
    }
    await setSession(from, { step: 'recibo_codigo', data: { originArea: area } });
    await messaging.sendText({
      to: from,
      text:
        '🧾 *Descargar recibo de matrícula*\n\n' +
        'Escribe tu *código estudiantil* (ejemplo: T12345678). Después te pediré tu cédula para entrar al portal.\n\n' +
        `_Para consultar otros movimientos financieros, usa el portal oficial: ${elegido.url}_\n\n` +
        'Escribe *0* para volver a tu menú o *menu* para ir al inicio.',
    });
    return;
  }

  if (elegido?.id === 'savio') {
    await track('academico_savio');
    await iniciarConsultaSavio(from, area);
    return;
  }

  if (!elegido) {
    await messaging.sendText({
      to: from,
      text: 'No reconocí esa opción 🤔\n\nElige una de la lista, escribe *0* para volver, o *menu* para ir al inicio.',
    });
    await sendMenuAcademico(from, area);
    return;
  }

  const bullets = elegido.queEncuentras.map((q) => `• ${q}`).join('\n');
  const acceso = elegido.acceso
    ? `\n🔑 *Entras con:* ${elegido.acceso}`
    : '\n🔓 Es información pública, no necesitas iniciar sesión.';

  await messaging.sendText({
    to: from,
    text:
      `${elegido.emoji} *${elegido.titulo}*\n\n` +
      `${bullets}\n` +
      `${acceso}\n\n` +
      `👉 ${elegido.url}\n\n` +
      '_Escribe *0* para ver otra opción, o *menu* para ir al inicio._',
  });

  const evento = EVENTO_POR_RECURSO[elegido.id];
  if (evento) await track(evento);

  // La sesión sigue en el hub: así puede pedir otro recurso escribiendo el número.
  await setSession(from, { step: 'academico_menu', data: { area } });
}
