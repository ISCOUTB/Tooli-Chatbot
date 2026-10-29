import { config } from '../config';
import { setSession } from '../services/session';
import { ChatTurn } from '../services/aiAssistant';
import { getOrCreateContact, createConversation } from '../services/chatwootService';
import { track } from '../services/metrics';
import { messaging } from './shared';
import { parseOriginArea } from './commands';
import { resumenRecomendacion } from './recomendacionView';

export interface HandoffOptions {
  aiNoResolvio?: boolean;
  conVerificacionIdentidad?: boolean;
}

export async function iniciarVerificacionIdentidad(
  from: string,
  data: Record<string, string>
): Promise<void> {
  await setSession(from, {
    step: 'ti_collect_email',
    data: { ...data },
  });
  await track('ai_identity_verification_started');
  await messaging.sendText({
    to: from,
    text:
      '🔐 *Verificación de identidad*\n\n' +
      'Para escalar tu caso con un asesor de TI necesito 3 datos para verificar tu identidad.\n\n' +
      '¿Cuál es tu *correo institucional*?\n' +
      '_(@utb.edu.co o @utbvirtual.edu.co)_\n\n' +
      'Escribe *menu* para cancelar.',
  });
}

export async function iniciarConversacionAsesor(
  from: string,
  data: Record<string, string>,
  opts: HandoffOptions = {}
): Promise<void> {
  const fueraHorario = data.outsideHours === 'true';
  const area = data.area;
  const teamId =
    area === 'ti'
      ? parseInt(config.chatwoot.teamTiId)
      : parseInt(config.chatwoot.teamAdmisionesId);

  const ahora = new Date().toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    dateStyle: 'short',
    timeStyle: 'short',
  });

  const areaLabel =
    area === 'ti' ? 'Soporte TI' :
    area === 'posgrados' ? 'Interesado en Posgrado' :
    'Soporte Admisiones';

  // La primera línea es la vista previa de la conversación en la lista de
  // Chatwoot: le dice al asesor de qué se trata sin tener que abrirla.
  const asunto =
    area === 'ti' ? data.plataforma :
    area === 'posgrados' ? [data.posgradoInteres, data.nombre].filter(Boolean).join(' — ') :
    data.nivel;
  let contexto = `🆘 ${areaLabel}${asunto ? ` · ${asunto}` : ''}\n\n`;
  contexto += `📱 WhatsApp: +${from}\n`;
  contexto += `📅 Recibido: ${ahora}\n`;
  contexto += `🕐 Dentro de horario: ${fueraHorario ? '❌ NO (fuera de horario)' : '✅ Sí'}\n`;
  if (opts.aiNoResolvio) {
    contexto += `🤖 AI intentó resolver: ❌ usuario no quedó satisfecho\n`;
  }
  contexto += `\n`;

  if (area === 'ti') {
    contexto += `🔎 Plataforma: ${data.plataforma}\n`;
    contexto += `📝 Problema: ${data.descripcion}\n`;
  } else if (area === 'posgrados') {
    contexto += `👤 Nombre: ${data.nombre ?? '(no disponible)'}\n`;
    contexto += `📧 Correo: ${data.correo ?? '(no disponible)'}\n`;
    contexto += `🎓 Posgrado de interés: ${data.posgradoInteres ?? '(no especificado)'}\n`;
    if (data.nivel) contexto += `🏷️ Nivel: ${data.nivel}\n`;
    if (data.etapa) contexto += `📌 Etapa: ${data.etapa}\n`;
    if (data.descripcion) contexto += `📝 Consulta: ${data.descripcion}\n`;
    // Si viene del flujo de recomendación por pregrado (vía la IA)
    const recomendacion = resumenRecomendacion(data);
    if (recomendacion) contexto += `🧭 ${recomendacion}\n`;
  } else {
    contexto += `🎓 Nivel: ${data.nivel}\n`;
    contexto += `📌 Etapa: ${data.etapa}\n`;
    contexto += `📝 Pregunta: ${data.descripcion}\n`;
  }

  if (opts.conVerificacionIdentidad) {
    contexto += `\n🔐 *Identidad verificada por el bot:*\n`;
    contexto += `   📧 Correo: ${data.verifEmail ?? '(no disponible)'}\n`;
    contexto += `   🆔 Código: ${data.verifCodigo ?? '(no disponible)'}\n`;
    contexto += `   🪪 Cédula: ${data.verifCedula ?? '(no disponible)'}\n`;
  }

  contexto = contexto.trimEnd();

  let privateNote: string | undefined;
  if (opts.aiNoResolvio && data.aiHistory) {
    try {
      const history: ChatTurn[] = JSON.parse(data.aiHistory);
      const transcript = history
        .map(t => (t.role === 'user' ? `👤 *Usuario:* ${t.content}` : `🤖 *AI:* ${t.content}`))
        .join('\n\n');
      privateNote =
        `🤖 *Conversación previa con el AI:*\n\n${transcript}\n\n` +
        `_El usuario decidió hablar con un asesor humano._`;
    } catch {
      privateNote = `🤖 AI intentó ayudar pero no pudo. Pregunta original: ${data.descripcion}`;
    }
  } else if (opts.aiNoResolvio && data.aiAnswer) {
    privateNote =
      `🤖 *Intento previo del AI:*\n\n` +
      `Pregunta del usuario:\n${data.descripcion}\n\n` +
      `Respuesta del AI:\n${data.aiAnswer}\n\n` +
      `El usuario no quedó satisfecho con esta respuesta.`;
  }

  await messaging.sendText({ to: from, text: '⏳ Conectándote con un asesor…' });

  try {
    const contact = await getOrCreateContact(from, `Usuario ${from.slice(-4)}`);
    const labels: string[] = [];
    if (area === 'posgrados') labels.push('posgrado-prospecto');
    if (fueraHorario) labels.push('fuera-horario');
    if (opts.aiNoResolvio) labels.push('ai-no-resolvio');
    if (opts.conVerificacionIdentidad) labels.push('identidad-verificada');

    const conversationId = await createConversation({
      sourceId: contact.sourceId,
      contactId: contact.contactId,
      teamId,
      initialMessage: contexto,
      customAttributes: {
        area: areaLabel,
        ...(area === 'ti'
          ? { plataforma: data.plataforma }
          : area === 'posgrados'
          ? { nombre: data.nombre ?? '', correo: data.correo ?? '', posgrado_interes: data.posgradoInteres ?? '', ...(data.nivel ? { nivel: data.nivel } : {}), ...(data.etapa ? { etapa: data.etapa } : {}) }
          : { nivel: data.nivel, etapa: data.etapa }),
        ...(opts.conVerificacionIdentidad
          ? {
              email_verificado: data.verifEmail ?? '',
              codigo_verificado: data.verifCodigo ?? '',
              cedula_verificada: data.verifCedula ?? '',
            }
          : {}),
      },
      labels: labels.length ? labels : undefined,
      priority: opts.aiNoResolvio || opts.conVerificacionIdentidad ? 'urgent' : undefined,
      privateNote,
    });

    await setSession(from, {
      step: 'with_agent',
      data: { conversationId: String(conversationId), area, ...(parseOriginArea(data.originArea) ? { originArea: data.originArea } : {}) },
    });

    await track('agent_handoff', {
      area: area === 'ti' ? 'ti' : 'admisiones',
      reason: opts.aiNoResolvio ? 'ai_failed' : opts.conVerificacionIdentidad ? 'identity_verified' : 'direct',
    });

    if (fueraHorario) {
      await messaging.sendText({
        to: from,
        text:
          '✅ Tu mensaje quedó registrado. Un asesor te responderá *el próximo día hábil*.\n\n' +
          'Si quieres cancelar, escribe *salir*.',
      });
    } else {
      await messaging.sendText({
        to: from,
        text:
          '✅ Listo. Un asesor te responderá en breve.\n\n' +
          'Cualquier mensaje que escribas le llegará al asesor. Para terminar la conversación, escribe *salir*.',
      });
    }
  } catch {
    console.error('[chatwoot] no se pudo crear la conversación');
    await setSession(from, { step: 'menu', data: {} });
    await messaging.sendText({
      to: from,
      text: 'No pude conectarte con un asesor en este momento. Intenta más tarde o escribe *menu*.',
    });
  }
}
