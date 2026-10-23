import { setSession } from '../services/session';
import { loginAndDownloadReceipt } from '../services/icebergService';
import { track } from '../services/metrics';
import { FlowContext, messaging, salirAlMenuRaiz, volverAlMenuDeOrigen, CODIGO_REGEX, CEDULA_REGEX } from './shared';
import { parseGlobalCommand, returnMenuStep } from './commands';
import { maskCode } from '../services/logSafe';
import { academicLookupEnabled, sendAcademicPortal } from './academicLookup';

export async function handleReciboCodigo(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  if (!academicLookupEnabled()) return sendAcademicPortal(from, 'recibo', session?.data);
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
      text: 'El código no es válido. Debe tener el formato T seguido de 8 dígitos.\nEjemplo: T12345678\n\nInténtalo de nuevo o escribe *menu*:',
    });
    return;
  }

  await setSession(from, { step: 'recibo_cedula', data: { ...session?.data, codigo: input } });
  await messaging.sendText({
    to: from,
    text: 'Ahora escribe tu *número de cédula* (solo dígitos, sin puntos ni guiones).',
  });
}

export async function handleReciboCedula(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  if (!academicLookupEnabled()) return sendAcademicPortal(from, 'recibo', session?.data);
  const command = parseGlobalCommand(text);

  if (command === 'menu' || command === 'salir') {
    await salirAlMenuRaiz(from);
    return;
  }

  if (command === 'volver') {
    await volverAlMenuDeOrigen(from, session?.data);
    return;
  }

  const input = text.trim();

  if (!CEDULA_REGEX.test(input)) {
    await messaging.sendText({
      to: from,
      text: 'La cédula no es válida. Debe tener entre 6 y 12 dígitos.\n\nInténtalo de nuevo o escribe *menu*:',
    });
    return;
  }

  const codigo = session?.data.codigo;
  if (!codigo) {
    await setSession(from, { step: 'menu', data: {} });
    await messaging.sendText({ to: from, text: 'Sesión expirada. Por favor inicia de nuevo escribiendo *menu*.' });
    return;
  }

  await messaging.sendText({
    to: from,
    text: '🔄 Estoy descargando tu recibo del portal. Esto puede tardar 30-60 segundos…',
  });

  try {
    const result = await loginAndDownloadReceipt(codigo, input);

    if (!result.ok) {
      await track('recibo_login_failed');
      console.error(`[recibo] fallo para ${maskCode(codigo)}`);
      await messaging.sendText({
        to: from,
        text: `No pude completar el proceso. ${result.error?.includes('Login falló') ? 'Verifica que el código y la cédula sean correctos.' : 'Intenta más tarde.'}\n\nEscribe *menu* para volver al inicio.`,
      });
    } else if (result.noRecibos) {
      await track('recibo_no_pendientes');
      const saludo = result.nombre ? `Hola *${result.nombre}*. ` : '';
      await messaging.sendText({
        to: from,
        text: `${saludo}No tienes recibos pendientes en el portal en este momento.\n\nEscribe *menu* para volver al inicio.`,
      });
    } else if (result.pdf) {
      await track('recibo_descargado');
      await messaging.sendDocument({
        to: from,
        buffer: result.pdf,
        fileName: `recibo-${codigo}.pdf`,
        mimetype: 'application/pdf',
        caption: `🧾 Recibo de matrícula${result.nombre ? ` — ${result.nombre}` : ''}`,
      });

      const nombre = result.nombre ? result.nombre.split(' ')[0] : null;
      const ordinaria = result.matriculas?.find(m => m.tipo === 'ORDINARIA');
      const extraordinaria = result.matriculas?.find(m => m.tipo === 'EXTRAORDINARIA');

      let msg = `✅ Listo${nombre ? `, *${nombre}*` : ''}. Aquí está tu recibo de matrícula.\n\n`;
      if (ordinaria) {
        msg += `📅 *Matrícula ordinaria:* paga antes del *${ordinaria.fechaVencimiento}* (sin recargo)\n`;
      }
      if (extraordinaria) {
        msg += `⚠️ *Matrícula extraordinaria:* hasta el *${extraordinaria.fechaVencimiento}* (+2% recargo)\n`;
      }
      msg += `\nEscribe *menu* para volver al inicio.`;

      await messaging.sendText({ to: from, text: msg });
    } else {
      await messaging.sendText({
        to: from,
        text: 'No pude descargar el recibo. Por favor intenta más tarde o escribe *menu*.',
      });
    }
  } catch {
    console.error('[recibo] error al consultar el portal');
    await track('recibo_error');
    await messaging.sendText({
      to: from,
      text: 'Ocurrió un error inesperado. Intenta más tarde o escribe *menu*.',
    });
  }

  // Al terminar vuelve al área de origen (fallback: raíz en sesiones legacy).
  await setSession(from, { step: returnMenuStep(session?.data), data: {} });
}
