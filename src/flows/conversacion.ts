/**
 * Flujo conversacional de posgrados (paso raíz `menu` con `FLUJO_CONVERSACIONAL=true`).
 *
 * La persona escribe (o manda un audio) y la IA le responde con la información
 * oficial. Entre respuesta y respuesta el bot hace una sola pregunta corta con
 * botones, como en NutrIA: si estudia o estudió en la UTB, qué carrera y qué
 * nivel le interesa. Con eso recomienda con el motor de siempre y, si la
 * persona quiere, la pasa a un asesor con su consentimiento. Si ignora una
 * pregunta, el bot no insiste en el siguiente turno.
 */
import { setSession } from '../services/session';
import { preguntarAI, AIUnavailableError, ChatTurn } from '../services/aiAssistant';
import { track } from '../services/metrics';
import { getPrograma } from '../services/catalogoUtb';
import { FlowContext, messaging, sendMenu, sendMenuClasico, sendMenuPregrado } from './shared';
import { SessionData, parseGlobalCommand } from './commands';
import { FAMILIAS_EXTERNAS, interpretarPregrado } from './recomendacionPregrado';
import { parseRelacion, resumenRecomendacion } from './recomendacionView';
import { enviarGrupos, mostrarResultados, pedirConsentimiento } from './recomendacion';
import {
  BotonId, IA_NO_DISPONIBLE, NO_RECONOCI_PREGRADO, PEDIR_PROGRAMA, PIE, PREGUNTAS, Pendiente, SALUDO_CORTO,
  SUGERIR_ASESOR, TITULO, TURNOS_ANTES_DE_ASESOR, detectarPerfil, esPedidoAsesor, esSaludo,
  interpretarRespuestaEscrita, nivelDeBoton, pareceUnaPregunta, parseBoton, siguientePregunta, textoPregrado,
} from './conversacionView';

// ── Envíos ──────────────────────────────────────────────────────────────────

/** Hace la pregunta y la deja pendiente para entender la respuesta escrita. */
async function preguntar(from: string, data: SessionData, pendiente: Pendiente): Promise<void> {
  await setSession(from, { step: 'menu', data: { ...data, pendiente, saltada: '' } });
  const pregunta = PREGUNTAS[pendiente];
  if (pendiente === 'pregrado') {
    await messaging.sendText({ to: from, text: textoPregrado(data.relacion) });
    return;
  }
  await messaging.sendButtons({
    to: from,
    title: TITULO,
    description: pregunta.texto,
    footer: pregunta.pie ?? PIE,
    buttons: [...(pregunta.botones ?? [])],
  });
}

/**
 * Sigue con lo que falta. Si la persona pidió ayuda para elegir y ya está todo,
 * recomienda de una vez; si venía conversando, le ofrece la recomendación.
 */
async function continuar(from: string, data: SessionData): Promise<void> {
  const falta = siguientePregunta(data);
  if (falta) return preguntar(from, data, falta);
  if (data.modo === 'elegir') return mostrarResultados(from, { ...data, pendiente: '', soloVirtual: '', vioMas: '' });
  return preguntar(from, { ...data, ofrecido: '1' }, 'ofrecer');
}

async function reiniciar(from: string): Promise<void> {
  await setSession(from, { step: 'menu', data: {} });
  await sendMenu(from);
}

// ── Botones ─────────────────────────────────────────────────────────────────

async function atenderBoton(from: string, data: SessionData, boton: BotonId): Promise<void> {
  const nivel = nivelDeBoton(boton);
  if (nivel) return continuar(from, { ...data, nivel, nivelListo: '1' });

  switch (boton) {
    case 'conv_tengo':
      await setSession(from, { step: 'menu', data: { ...data, pendiente: '' } });
      await messaging.sendText({ to: from, text: PEDIR_PROGRAMA });
      return;
    case 'conv_elegir':
      await track('reco_inicio');
      return continuar(from, { ...data, modo: 'elegir' });
    case 'conv_utb_si':
      return preguntar(from, data, 'egresado');
    case 'conv_utb_no':
      await track('reco_relacion_externo');
      return continuar(from, { ...data, relacion: 'externo' });
    case 'conv_egresado':
      await track('reco_relacion_egresado_utb');
      return continuar(from, { ...data, relacion: 'egresado_utb' });
    case 'conv_estudiante':
      await track('reco_relacion_estudiante_utb');
      return continuar(from, { ...data, relacion: 'estudiante_utb' });
    case 'conv_reco':
      if (siguientePregunta(data)) return continuar(from, { ...data, modo: 'elegir' });
      return mostrarResultados(from, { ...data, pendiente: '', soloVirtual: '', vioMas: '' });
    case 'conv_asesor':
      return pedirConsentimiento(from, { ...data, pendiente: '' });
    default:
      return undefined;
  }
}

// ── Carrera escrita ─────────────────────────────────────────────────────────

async function atenderPregrado(from: string, data: SessionData, texto: string): Promise<void> {
  const interpretado = interpretarPregrado(texto.trim().slice(0, 100));
  if (!interpretado) {
    await messaging.sendText({ to: from, text: NO_RECONOCI_PREGRADO });
    return;
  }
  if (interpretado.tipo === 'utb') {
    const nombre = getPrograma(interpretado.pregradoId)?.nombre ?? '';
    await track('reco_pregrado_utb', { area: 'posgrados', pregrado: interpretado.pregradoId });
    await messaging.sendText({ to: from, text: `Listo: *${nombre}* ✅` });
    return continuar(from, { ...data, pregradoId: interpretado.pregradoId, familiaId: '', pendiente: '' });
  }
  const familia = FAMILIAS_EXTERNAS.find((f) => f.id === interpretado.familiaId);
  await track('reco_externo_coincide');
  await messaging.sendText({
    to: from,
    text: `Listo: lo tomo como *${familia?.etiqueta ?? 'tu carrera'}* ✅\n_Si no es así, escríbemela de nuevo._`,
  });
  return continuar(from, { ...data, familiaId: interpretado.familiaId, pregradoId: '', pendiente: '' });
}

// ── IA ──────────────────────────────────────────────────────────────────────

function historial(data: SessionData): ChatTurn[] {
  try {
    const parsed: unknown = JSON.parse(data.aiHistory ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is ChatTurn =>
      t != null && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string');
  } catch {
    return [];
  }
}

/**
 * Responde con la IA y después, si falta algo, hace una pregunta. Si la última
 * pregunta quedó sin respuesta, esta vez solo responde, pero la pregunta sigue
 * viva: un "no" escrito después todavía la contesta. Al turno siguiente se repite.
 */
async function responderConIa(from: string, data: SessionData, texto: string, primerMensaje: boolean): Promise<void> {
  const perfil = detectarPerfil(texto);
  const conPerfil: SessionData = {
    ...data,
    ...(perfil.relacion && !data.relacion ? { relacion: perfil.relacion } : {}),
    ...(perfil.nivel && data.nivelListo !== '1' ? { nivel: perfil.nivel, nivelListo: '1' } : {}),
  };

  if (primerMensaje) await messaging.sendText({ to: from, text: SALUDO_CORTO });
  await track('ai_request', { area: 'posgrados' });

  const anterior = historial(conPerfil);
  let respuesta: string;
  try {
    const ai = await preguntarAI('posgrados', texto.trim(), anterior, resumenRecomendacion(conPerfil) ?? undefined);
    respuesta = ai.answer;
    if (ai.usedTool) await track('ai_used_tool', { area: 'posgrados' });
    await track('ai_resolved', { area: 'posgrados' });
  } catch (err) {
    console.error('[conversacion] IA:', err instanceof AIUnavailableError ? err.reason : 'error');
    await track('ai_failed', { area: 'posgrados', reason: err instanceof AIUnavailableError ? err.reason : 'unknown' });
    await setSession(from, { step: 'menu', data: { ...conPerfil, pendiente: 'ofrecer' } });
    await messaging.sendButtons({
      to: from, title: TITULO, description: IA_NO_DISPONIBLE, footer: PIE,
      buttons: [{ id: 'conv_asesor', displayText: '👤 Hablar con asesor' }],
    });
    return;
  }

  await messaging.sendText({ to: from, text: respuesta });
  const turnos = (Number.parseInt(conPerfil.aiTurnCount ?? '0', 10) || 0) + 1;
  const nuevo: SessionData = {
    ...conPerfil,
    aiHistory: JSON.stringify([...anterior, { role: 'user', content: texto.trim() }, { role: 'assistant', content: respuesta }]),
    aiTurnCount: String(turnos),
  };

  if (turnos === TURNOS_ANTES_DE_ASESOR) {
    await setSession(from, { step: 'menu', data: { ...nuevo, pendiente: 'ofrecer' } });
    await messaging.sendButtons({
      to: from, title: TITULO, description: SUGERIR_ASESOR, footer: PIE,
      buttons: [{ id: 'conv_asesor', displayText: '👤 Hablar con asesor' }],
    });
    return;
  }
  // Pregunta ignorada una vez: solo se responde y se conserva la pregunta pendiente.
  if (conPerfil.pendiente && conPerfil.saltada !== '1') {
    await setSession(from, { step: 'menu', data: { ...nuevo, saltada: '1' } });
    return;
  }
  const falta = siguientePregunta(nuevo);
  if (falta) return preguntar(from, nuevo, falta);
  if (nuevo.ofrecido !== '1') return preguntar(from, { ...nuevo, ofrecido: '1' }, 'ofrecer');
  await setSession(from, { step: 'menu', data: { ...nuevo, pendiente: '', saltada: '' } });
}

// ── Entrada ─────────────────────────────────────────────────────────────────

export async function handleConversacion(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const data: SessionData = { ...(session?.data ?? {}) };

  const comando = parseGlobalCommand(text);
  if (comando === 'menu' || comando === 'salir') return reiniciar(from);
  if (esPedidoAsesor(text)) return pedirConsentimiento(from, { ...data, pendiente: '' });

  // Las salidas del menú anterior ("Busco pregrado", "Otras gestiones") siguen sirviendo.
  const salida = parseRelacion(text);
  if (salida?.tipo === 'salida') {
    if (salida.salida === 'pregrado') {
      await setSession(from, { step: 'menu_pregrado', data: {} });
      await sendMenuPregrado(from);
    } else {
      await setSession(from, { step: 'menu_clasico', data: {} });
      await sendMenuClasico(from);
    }
    return;
  }

  const boton = parseBoton(text);
  if (boton) return atenderBoton(from, data, boton);

  const pendiente = (data.pendiente ?? '') as Pendiente | '';
  const escrita = interpretarRespuestaEscrita(pendiente, text);
  if (escrita && 'boton' in escrita) return atenderBoton(from, data, escrita.boton);
  if (escrita && 'nivel' in escrita) return continuar(from, { ...data, nivel: escrita.nivel, nivelListo: '1' });

  if (pendiente === 'pregrado' && !pareceUnaPregunta(text)) {
    const n = text.trim().toLowerCase();
    if (n === 'lista' && data.relacion && data.relacion !== 'externo') {
      await setSession(from, { step: 'reco_pregrado_grupo', data: { relacion: data.relacion } });
      await enviarGrupos(from);
      return;
    }
    return atenderPregrado(from, data, text);
  }

  // Un saludo suelto al empezar: presentación y primera pregunta.
  if (esSaludo(text) && (!session || (!data.aiHistory && !data.relacion))) return reiniciar(from);
  if (text === '__image__') {
    await messaging.sendText({ to: from, text: 'Por ahora no puedo ver imágenes 🙏 Escríbeme o mándame un audio 🎤' });
    return;
  }

  return responderConIa(from, data, text, !session);
}
