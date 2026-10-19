import { setSession } from '../services/session';
import { consultarTurno } from '../services/turnosService';
import { track } from '../services/metrics';
import { FlowContext, messaging, salirAlMenuRaiz, volverAlMenuDeOrigen, CODIGO_REGEX } from './shared';
import { parseGlobalCommand, returnMenuStep } from './commands';
import { academicLookupEnabled, sendAcademicPortal } from './academicLookup';

export async function handleEsperandoCodigo(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  if (!academicLookupEnabled()) return sendAcademicPortal(from, 'turno', session?.data);
  const command = parseGlobalCommand(text);

  if (command === 'menu' || command === 'salir') {
    await salirAlMenuRaiz(from);
    return;
  }

  if (command === 'volver') {
    await volverAlMenuDeOrigen(from, session?.data);
    return;
  }

  const input = text.trim().toUpperCase();

  if (!CODIGO_REGEX.test(input)) {
    await messaging.sendText({
      to: from,
      text: 'El código no es válido. Debe tener el formato T seguido de 8 dígitos.\nEjemplo: T12345678\n\nInténtalo de nuevo:',
    });
    return;
  }

  try {
    const turno = await consultarTurno(input);

    if (!turno) {
      await track('turno_no_encontrado');
      await messaging.sendText({
        to: from,
        text: `No encontré información para el código *${input}*.\n\nVerifica que sea correcto o escribe *menu* para volver al inicio.`,
      });
      // Conserva el paso: el usuario acaba de recibir la opción de corregirlo.
      return;
    } else {
      await track('turno_consultado');
      await messaging.sendText({
        to: from,
        text: `📋 *Turno de matrícula*\n\n👤 ${turno.nombre} ${turno.apellido}\n🎓 ${turno.programa}\n🔢 Turno: *${turno.turno}*\n📅 Fecha: ${turno.fecha}\n⏰ Hora: ${turno.hora}\n\nEscribe *menu* para volver al inicio.`,
      });
      await setSession(from, { step: returnMenuStep(session?.data), data: {} });
    }
  } catch {
    await messaging.sendText({
      to: from,
      text: 'Ocurrió un error consultando tu turno. Por favor intenta más tarde o escribe *menu* para volver al inicio.',
    });
  }
}
