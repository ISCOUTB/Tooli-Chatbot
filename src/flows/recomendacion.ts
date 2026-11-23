/**
 * Flujo de recomendación de posgrados según el pregrado (pasos `reco_*`).
 * Ver `docs/flujo-recomendacion-posgrados.md`.
 *
 * Todo lo que se decide vive en la sesión (`relacion`, `pregradoId` o
 * `familiaId`, `nivel`, `soloVirtual`) y las recomendaciones se recalculan
 * con el motor en cada paso, así que nada depende de una lista guardada.
 * Recomendar no pide datos personales.
 */
import { config } from '../config';
import { Session, setSession } from '../services/session';
import { ContextoCampana, borrarContextoCampana, darDeBaja, leerContextoCampana } from '../services/campanaService';
import { CONFIRMACION_BAJA, RELACIONES_CAMPANA, parseRespuestaCampana, perfilDeContexto, saludoCampana } from './campanaReco';
import { MetricEvent, track } from '../services/metrics';
import { getPrograma } from '../services/catalogoUtb';
import { actualizarRegistroProspecto, guardarRegistroProspecto } from '../services/registroService';
import { agregarNota, getFicha, setEtiquetas } from '../services/crmService';
import { upsertContactoHubspot } from '../services/hubspotService';
import { registrarDecision } from '../services/consentimientoService';
import { completarPerfil, conLoRecordado, leerPerfil } from '../services/perfilService';
import { registrarNoReconocido } from '../services/noReconocidoService';
import { registrarIncidencia } from '../services/incidenciasService';
import { limpiarNombre } from './conversacionView';
import { describeExternalError } from '../services/logSafe';
import { FlowContext, messaging, salirAlMenuRaiz, sendMenu, sendMenuClasico, sendMenuPregrado } from './shared';
import { SessionData, parseGlobalCommand } from './commands';
import { sendAreasMenu } from './programas';
import { conectarConAsesorPosgrado } from './prospecto';
import { handleChattingWithAI } from './aiChat';
import { atenderAgenda } from './agendaFlowRuntime';
import { isBsuid } from '../services/whatsappId';
import {
  BOTONES_CANAL, BOTONES_NUMERO, BOTONES_REPETIR, CORREO_NO_VALIDO, CUANDO_SI, Contacto, ContactoEscrito, Franja, NUMERO_NO_VALIDO,
  PASO_CANAL, PASO_FRANJA, PASO_NUMERO, PASO_REPETIR, PASOS_DE_CONTACTO, PEDIR_NUMERO, PIE_CANAL, PREGUNTA_NUMERO,
  REPETIR_CANAL, TITULO_CONTACTO, avisoContacto, camposContacto, contactoAnterior, contactoListo, correoEnTexto, esElMismoCorreo,
  etiquetaContacto, filasFranja, franjaFueraDeHorario, franjasDelHorario, lineaContacto, noPuedeAhora, parseCanal, parseDia, parseFranja,
  parseNumero, parseRepetir, pedirCorreo, pedirNombreTrasCanal, preguntaCanal, preguntaFranja, preguntaRepetir, telefonoColombiano,
  traeNumero,
} from './contactoView';
import { CONFIG_ATENCION_DEFAULT, obtenerConfigAtencionCacheada, textoHorario } from '../services/atencionEquipoService';
import { enviarFlyerPrograma, esperarFlyers, fotosDisponibles } from './fotosPrograma';
import { FAMILIAS_EXTERNAS, PregradoInterpretado, interpretarPregrado, recomendar } from './recomendacionPregrado';
import {
  BOTONES_CONSENTIMIENTO,
  CONSENTIMIENTO_NEGADO,
  CORREO_REGEX,
  FILAS_TRAS_FICHA,
  ASESOR_CON_AUTORIZACION,
  ASESOR_POR_AQUI,
  pideLlamada,
  prefiereContactoSinCorreo,
  asesorConCorreoConocido,
  BOTONES_FICHA,
  PIE_BOTONES_FICHA,
  PREGUNTA_FICHA,
  formatearPlan,
  pieFicha,
  pieFlyer,
  pieFlyerRecomendado,
  piePrograma,
  preguntaCostos,
  BOTONES_TRAS_NO_UTIL,
  BOTONES_TRAS_UTIL,
  GRACIAS_UTIL_SIGUE,
  cuerpoListaConFotos,
  numeroFueraDeRango,
  esTextoLibre,
  GRACIAS_NO_UTIL,
  GRACIAS_UTIL,
  PIE_UTIL,
  PEDIR_CONSENTIMIENTO,
  PEDIR_NOMBRE,
  etiquetasCrmRecomendacion,
  notaCrmRecomendacion,
  pregradoLead,
  relacionLead,
  filasElegirPrograma,
  formatearFicha,
  idsMostrados,
  parseAccionFicha,
  programaInteresLead,
  programaPorNumero,
  resumenRecomendacion,
  BOTONES_CONFIRMAR,
  BOTONES_SIN_COINCIDENCIA,
  COINCIDENCIA_DESCARTADA,
  ContextoResultados,
  FILAS_GRUPOS,
  FILAS_NIVEL,
  FilaLista,
  GrupoPregrado,
  NivelElegido,
  PEDIR_PREGRADO_EXTERNO,
  Relacion,
  SIN_COINCIDENCIA,
  filasAcciones,
  filasPregrados,
  formatearResultados,
  getGrupo,
  parseAccion,
  parseGrupo,
  parseNivel,
  parsePregrado,
  parseRelacion,
  parseSiNo,
  parseSinCoincidencia,
  textoConfirmacion,
} from './recomendacionView';

const FOOTER = 'Escribe 0 para volver o menu para el inicio';

const EVENTO_RELACION: Record<Relacion, MetricEvent> = {
  estudiante_utb: 'reco_relacion_estudiante_utb',
  egresado_utb: 'reco_relacion_egresado_utb',
  externo: 'reco_relacion_externo',
};

// ── Envíos ──────────────────────────────────────────────────────────────────

async function enviarLista(to: string, title: string, description: string, seccion: string, rows: readonly FilaLista[]): Promise<void> {
  await messaging.sendList({
    to,
    title,
    description,
    footer: FOOTER,
    buttonText: 'Elegir',
    sections: [{ title: seccion, rows: [...rows] }],
  });
}

export const enviarGrupos = (to: string) =>
  enviarLista(to, '🎓 Tu pregrado', '¿En qué escuela está tu pregrado? También puedes escribir su nombre.', 'Escuelas UTB', FILAS_GRUPOS);

const enviarPregrados = (to: string, grupo: GrupoPregrado) =>
  enviarLista(to, `🎓 ${grupo.titulo}`, '¿Cuál es tu pregrado?', 'Pregrados', filasPregrados(grupo));

const enviarNivel = (to: string) =>
  enviarLista(to, '🎚️ Nivel de posgrado', '¿Qué nivel de posgrado te interesa?', 'Niveles', FILAS_NIVEL);

async function pedirPregradoExterno(to: string): Promise<void> {
  await messaging.sendText({ to, text: PEDIR_PREGRADO_EXTERNO });
}

async function enviarConfirmacion(to: string, pregunta: string): Promise<void> {
  await messaging.sendButtons({
    to,
    title: '🎓 Tu pregrado',
    description: pregunta,
    footer: FOOTER,
    buttons: [...BOTONES_CONFIRMAR],
  });
}

export async function enviarSinCoincidencia(to: string, texto: string = SIN_COINCIDENCIA): Promise<void> {
  await messaging.sendButtons({
    to,
    title: '🎓 Tu pregrado',
    description: texto,
    footer: FOOTER,
    buttons: [...BOTONES_SIN_COINCIDENCIA],
  });
}

/** Responde que no entendió y lo deja medido (con el texto) para mejorar el bot. */
async function noReconocido(to: string, pista: string, paso: string, texto: string): Promise<void> {
  await registrarNoReconocido(paso, texto);
  await messaging.sendText({ to, text: `No reconocí esa opción 🤔\n\n${pista}` });
}

// ── Entrada ─────────────────────────────────────────────────────────────────

/**
 * Arranca el flujo desde cero en el paso raíz `menu`: saludo y pregunta por
 * la relación con la UTB (`sendMenu`).
 */
export async function iniciarRecomendacion(to: string): Promise<void> {
  await setSession(to, { step: 'menu', data: {} });
  await track('reco_inicio');
  await sendMenu(to);
}

/**
 * Atiende "menu"/"salir" (al inicio) y devuelve true; con "volver"/0 llama
 * a `atras`. Así cada paso solo resuelve su propia respuesta.
 */
async function comandos(from: string, text: string, atras: () => Promise<void>): Promise<boolean> {
  const comando = parseGlobalCommand(text);
  if (comando === 'menu' || comando === 'salir') {
    await salirAlMenuRaiz(from);
    return true;
  }
  if (comando === 'volver') {
    await atras();
    return true;
  }
  return false;
}

// ── 0. Respuesta a una campaña (cuando el bot escribió primero) ─────────────

/**
 * Si el bot contactó a la persona con una campaña y este mensaje le responde,
 * lo atiende y devuelve true. "Ver mis opciones" lleva directo al nivel con
 * el pregrado que traía la lista; "No me interesa" la da de baja. Un "sí" o
 * un "no" sueltos solo cuentan si estaba al inicio, y nunca se interrumpe una
 * conversación con un asesor.
 */
export async function atenderRespuestaCampana(from: string, text: string, session: Session | null): Promise<boolean> {
  if (session?.step === 'with_agent') return false;
  const respuesta = parseRespuestaCampana(text);
  if (!respuesta) return false;
  const enInicio = !session || session.step === 'menu';
  if (!enInicio && !respuesta.fuerte) return false;

  let contexto: ContextoCampana | null;
  try {
    contexto = await leerContextoCampana(from);
  } catch {
    return false;
  }
  if (!contexto) return false;

  if (respuesta.tipo === 'baja') {
    await darDeBaja(from);
    await track('reco_campana_baja');
    await setSession(from, { step: 'menu', data: {} });
    await messaging.sendText({ to: from, text: CONFIRMACION_BAJA });
    return true;
  }

  await borrarContextoCampana(from);
  await track('reco_campana_ver');
  const relacion = (RELACIONES_CAMPANA as readonly string[]).includes(contexto.relacion) ? contexto.relacion : 'externo';
  await messaging.sendText({ to: from, text: saludoCampana(contexto) });

  const perfil = perfilDeContexto(contexto);
  if (perfil) {
    await setSession(from, { step: 'reco_nivel', data: { relacion, ...perfil, campana: '1' } });
    await enviarNivel(from);
  } else if (relacion === 'externo') {
    // La lista no traía un pregrado reconocible: se pide como a cualquiera de afuera.
    await setSession(from, { step: 'reco_pregrado_externo', data: { relacion, campana: '1' } });
    await pedirPregradoExterno(from);
  } else {
    await setSession(from, { step: 'reco_pregrado_grupo', data: { relacion, campana: '1' } });
    await enviarGrupos(from);
  }
  return true;
}

// ── 1. Relación con la UTB (paso raíz `menu`) ───────────────────────────────

export async function handleRecoRelacion(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;

  const eleccion = parseRelacion(text);
  if (!eleccion) {
    // Primer mensaje de la conversación ("Hola") o un comando: saludo, sin regaño.
    if (!session || parseGlobalCommand(text)) {
      await iniciarRecomendacion(from);
      return;
    }
    await noReconocido(from, 'Elige una opción de la lista 👇', 'relacion', text);
    await track('menu_shown');
    await sendMenu(from);
    return;
  }

  if (eleccion.tipo === 'salida') {
    if (eleccion.salida === 'pregrado') {
      await track('reco_salida_pregrado');
      await setSession(from, { step: 'menu_pregrado', data: {} });
      await sendMenuPregrado(from);
    } else {
      await track('reco_salida_otras_gestiones');
      await setSession(from, { step: 'menu_clasico', data: {} });
      await sendMenuClasico(from);
    }
    return;
  }

  await track(EVENTO_RELACION[eleccion.relacion]);
  if (eleccion.relacion === 'externo') {
    await setSession(from, { step: 'reco_pregrado_externo', data: { relacion: eleccion.relacion } });
    await pedirPregradoExterno(from);
    return;
  }
  await setSession(from, { step: 'reco_pregrado_grupo', data: { relacion: eleccion.relacion } });
  await enviarGrupos(from);
}

// ── 2. Pregrado UTB: escuela y programa ─────────────────────────────────────

async function volverARelacion(from: string): Promise<void> {
  await setSession(from, { step: 'menu', data: {} });
  await sendMenu(from);
}

async function elegirPregradoUtb(from: string, data: SessionData, pregradoId: string): Promise<void> {
  await track('reco_pregrado_utb', { area: 'posgrados', pregrado: pregradoId });
  await setSession(from, { step: 'reco_nivel', data: { ...data, pregradoId, familiaId: '' } });
  await enviarNivel(from);
}

export async function handleRecoPregradoGrupo(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const data = session?.data ?? {};
  if (await comandos(from, text, () => volverARelacion(from))) return;

  const eleccion = parseGrupo(text);
  if (!eleccion) {
    await noReconocido(from, 'Elige la escuela de tu pregrado o escribe su nombre 👇', 'pregrado_grupo', text);
    await enviarGrupos(from);
    return;
  }
  if (eleccion.tipo === 'pregrado') {
    await elegirPregradoUtb(from, data, eleccion.pregradoId);
    return;
  }
  const grupo = getGrupo(eleccion.grupoId)!;
  await setSession(from, { step: 'reco_pregrado', data: { ...data, grupo: grupo.id } });
  await enviarPregrados(from, grupo);
}

async function volverAGrupos(from: string, data: SessionData): Promise<void> {
  await setSession(from, { step: 'reco_pregrado_grupo', data: { relacion: data.relacion ?? '' } });
  await enviarGrupos(from);
}

export async function handleRecoPregrado(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const data = session?.data ?? {};
  if (await comandos(from, text, () => volverAGrupos(from, data))) return;

  const grupo = getGrupo(data.grupo ?? '');
  const pregradoId = parsePregrado(text, grupo);
  if (!pregradoId) {
    await noReconocido(from, 'Elige tu pregrado de la lista o escribe su nombre 👇', 'pregrado', text);
    if (grupo) await enviarPregrados(from, grupo);
    else await volverAGrupos(from, data);
    return;
  }
  await elegirPregradoUtb(from, data, pregradoId);
}

// ── 2b. Pregrado de otra universidad ────────────────────────────────────────

/** Guarda lo escrito y pide confirmar la asociación, o muestra las alternativas si no hay ninguna. */
async function interpretarEscrito(from: string, data: SessionData, texto: string): Promise<void> {
  const pregradoTexto = texto.trim().slice(0, 100);
  const interpretado = interpretarPregrado(pregradoTexto);
  const pregunta = interpretado && textoConfirmacion(interpretado);
  if (!interpretado || !pregunta) {
    await track('reco_externo_sin_coincidencia');
    await registrarNoReconocido('carrera', pregradoTexto);
    await setSession(from, { step: 'reco_sin_coincidencia', data: { relacion: data.relacion ?? 'externo', pregradoTexto } });
    await enviarSinCoincidencia(from);
    return;
  }
  await setSession(from, {
    step: 'reco_confirmar',
    data: {
      relacion: data.relacion ?? 'externo',
      pregradoTexto,
      candidatoTipo: interpretado.tipo,
      candidatoId: interpretado.tipo === 'utb' ? interpretado.pregradoId : interpretado.familiaId,
    },
  });
  await enviarConfirmacion(from, pregunta);
}

async function volverAPregradoExterno(from: string, data: SessionData): Promise<void> {
  await setSession(from, { step: 'reco_pregrado_externo', data: { relacion: data.relacion ?? 'externo' } });
  await pedirPregradoExterno(from);
}

export async function handleRecoPregradoExterno(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const data = session?.data ?? {};
  if (await comandos(from, text, () => volverARelacion(from))) return;

  if (text.trim().length < 3) {
    await messaging.sendText({ to: from, text: 'Escribe el nombre de tu pregrado, por ejemplo *Contaduría* o *Medicina* ✍️' });
    return;
  }
  await interpretarEscrito(from, data, text);
}

function candidatoGuardado(data: SessionData): PregradoInterpretado | null {
  if (data.candidatoTipo === 'utb' && data.candidatoId) return { tipo: 'utb', pregradoId: data.candidatoId };
  if (data.candidatoTipo === 'familia' && data.candidatoId) return { tipo: 'familia', familiaId: data.candidatoId };
  return null;
}

export async function handleRecoConfirmar(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const data = session?.data ?? {};
  if (await comandos(from, text, () => volverAPregradoExterno(from, data))) return;

  const candidato = candidatoGuardado(data);
  const respuesta = parseSiNo(text);
  if (!candidato || !respuesta) {
    const pregunta = candidato && textoConfirmacion(candidato);
    if (!pregunta) {
      await volverAPregradoExterno(from, data);
      return;
    }
    await enviarConfirmacion(from, pregunta);
    return;
  }

  const base = { relacion: data.relacion ?? 'externo', pregradoTexto: data.pregradoTexto ?? '' };
  if (respuesta === 'no') {
    await setSession(from, { step: 'reco_sin_coincidencia', data: base });
    await enviarSinCoincidencia(from, COINCIDENCIA_DESCARTADA);
    return;
  }

  await track('reco_externo_coincide', { area: 'posgrados', pregrado: candidato.tipo === 'utb' ? candidato.pregradoId : candidato.familiaId });
  await setSession(from, {
    step: 'reco_nivel',
    data: candidato.tipo === 'utb'
      ? { ...base, pregradoId: candidato.pregradoId, familiaId: '' }
      : { ...base, pregradoId: '', familiaId: candidato.familiaId },
  });
  await enviarNivel(from);
}

export async function handleRecoSinCoincidencia(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const data = session?.data ?? {};
  if (await comandos(from, text, () => volverAPregradoExterno(from, data))) return;

  const eleccion = parseSinCoincidencia(text);
  if (eleccion === 'lista') {
    await setSession(from, { step: 'reco_pregrado_grupo', data: { relacion: data.relacion ?? 'externo', pregradoTexto: data.pregradoTexto ?? '' } });
    await enviarGrupos(from);
    return;
  }
  if (eleccion === 'area') {
    // Orientación por áreas que ya existe en "Ver programas"
    await setSession(from, { step: 'programas_categoria', data: { modo: 'ayuda', fase: 'areas' } });
    await sendAreasMenu(from);
    return;
  }
  if (eleccion === 'escribir') {
    await volverAPregradoExterno(from, data);
    return;
  }
  // Si escribió otro nombre en vez de tocar un botón, se intenta de nuevo con ese texto.
  if (text.trim().length >= 3) {
    await interpretarEscrito(from, data, text);
    return;
  }
  await enviarSinCoincidencia(from);
}

// ── 3. Nivel ────────────────────────────────────────────────────────────────

async function volverDesdeNivel(from: string, data: SessionData): Promise<void> {
  if (data.relacion === 'externo' && !data.grupo) {
    await volverAPregradoExterno(from, data);
    return;
  }
  const grupo = getGrupo(data.grupo ?? '');
  if (grupo) {
    await setSession(from, { step: 'reco_pregrado', data: { relacion: data.relacion ?? '', grupo: grupo.id } });
    await enviarPregrados(from, grupo);
    return;
  }
  await volverAGrupos(from, data);
}

export async function handleRecoNivel(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const data = session?.data ?? {};
  if (await comandos(from, text, () => volverDesdeNivel(from, data))) return;

  const nivel = parseNivel(text);
  if (nivel === null) {
    await noReconocido(from, 'Elige un nivel de la lista 👇', 'nivel', text);
    await enviarNivel(from);
    return;
  }
  await mostrarResultados(from, { ...data, nivel, soloVirtual: '', vioMas: '' });
}

// ── 4. Recomendaciones ──────────────────────────────────────────────────────

function etiquetaPregrado(data: SessionData): string | null {
  if (data.pregradoId) return getPrograma(data.pregradoId)?.nombre ?? null;
  if (data.familiaId) return FAMILIAS_EXTERNAS.find((f) => f.id === data.familiaId)?.etiqueta ?? null;
  return null;
}

function calcular(data: SessionData) {
  const nivel = (data.nivel ?? '') as NivelElegido;
  const soloVirtual = data.soloVirtual === '1';
  const resultado = recomendar(
    { pregradoId: data.pregradoId || undefined, familiaId: data.familiaId || undefined },
    { nivel: nivel || null, soloVirtual },
  );
  const etiqueta = etiquetaPregrado(data);
  const ctx: ContextoResultados | null = etiqueta
    ? { relacion: (data.relacion || 'externo') as Relacion, etiquetaPregrado: etiqueta, nivel, soloVirtual }
    : null;
  return { resultado, ctx };
}

async function enviarAcciones(from: string, data: SessionData, cuerpo = 'Elige una opción para continuar', conUtil = false): Promise<void> {
  const { resultado, ctx } = calcular(data);
  if (!ctx) return;
  await enviarLista(from, '¿Qué quieres hacer?', cuerpo, 'Opciones', filasAcciones(resultado, ctx, data.vioMas === '1', conUtil));
}

export async function mostrarResultados(from: string, data: SessionData, mas = false): Promise<void> {
  const { resultado, ctx } = calcular(data);
  if (!ctx || !resultado.recomendaciones.length) {
    // Sesión incompleta o vencida a mitad de camino: se empieza de nuevo en vez de inventar.
    await iniciarRecomendacion(from);
    return;
  }
  const mostrados = (mas ? resultado.recomendaciones.concat(resultado.resto) : resultado.recomendaciones).map((r) => r.programa.id);
  const preguntarUtil = data.utilPreguntada !== '1';
  const nuevaData = {
    ...data, vioMas: mas ? '1' : data.vioMas ?? '', recomendados: JSON.stringify(mostrados), utilPreguntada: '1',
  };
  await setSession(from, { step: 'reco_resultados', data: nuevaData });
  await track(mas ? 'reco_mas_opciones' : 'reco_resultados', { area: 'posgrados', nivel: data.nivel || 'todos' });
  if (fotosDisponibles()) {
    // Un flyer por programa (foto oficial + datos); sin flyer, el mismo programa en texto.
    const lista = mas ? resultado.resto : resultado.recomendaciones;
    const desde = mas ? resultado.recomendaciones.length + 1 : 1;
    // Los flyers y después un solo mensaje con el encabezado, el cierre y las opciones (con "¿te sirvió?").
    for (const [i, r] of lista.entries()) {
      if (!await enviarFlyerPrograma(from, r.programa, pieFlyerRecomendado(r, desde + i))) {
        await messaging.sendText({ to: from, text: piePrograma(r, desde + i) });
      }
    }
    // "¿Qué quieres hacer?" siempre de último, después del último flyer.
    await esperarFlyers(from);
    await enviarAcciones(from, nuevaData, cuerpoListaConFotos(resultado, ctx, { mas }), preguntarUtil);
  } else {
    await messaging.sendText({ to: from, text: formatearResultados(resultado, ctx, { mas }) });
    await enviarAcciones(from, nuevaData, 'Elige una opción para continuar', preguntarUtil);
  }
}

/**
 * 👍/👎 sobre la recomendación: queda la métrica y, si autorizó sus datos, una
 * nota en su ficha para el asesor. No cambia el paso en que está la persona.
 */
export async function atenderUtil(from: string, valor: 'si' | 'no', data: SessionData, paso?: string): Promise<void> {
  await track(valor === 'si' ? 'reco_util_si' : 'reco_util_no', { area: 'posgrados' });
  if (data.datos === 'si') {
    try {
      const nota = valor === 'si'
        ? '👍 Le sirvió la recomendación del bot.'
        : '👎 La recomendación del bot no le sirvió mucho: conviene orientarle.';
      await agregarNota(from, nota, AUTOR_BOT);
    } catch (err) {
      console.error('[reco] no se pudo anotar la calificación:', describeExternalError(err));
    }
  }
  // En las recomendaciones, la conversación sigue con botones; desde otro paso, solo el agradecimiento.
  if (paso === 'reco_resultados') {
    await messaging.sendButtons({
      to: from, title: '', description: valor === 'si' ? GRACIAS_UTIL_SIGUE : GRACIAS_NO_UTIL, footer: PIE_UTIL,
      buttons: [...(valor === 'si' ? BOTONES_TRAS_UTIL : BOTONES_TRAS_NO_UTIL)],
    });
    return;
  }
  await messaging.sendText({ to: from, text: valor === 'si' ? GRACIAS_UTIL : GRACIAS_NO_UTIL });
}

export async function handleRecoResultados(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const data = session?.data ?? {};
  const aNivel = async () => {
    await setSession(from, { step: 'reco_nivel', data });
    await enviarNivel(from);
  };
  if (await comandos(from, text, aNivel)) return;

  const mostrados = idsMostrados(data.recomendados);
  // Escribir el número de un programa abre su ficha directamente.
  const porNumero = programaPorNumero(text, mostrados);
  if (porNumero) return mostrarFicha(from, data, porNumero);
  if (/^\d+$/.test(text.trim()) && mostrados.length) {
    await messaging.sendText({ to: from, text: numeroFueraDeRango(mostrados.length) });
    await enviarAcciones(from, data);
    return;
  }

  const accion = parseAccion(text);
  if (accion === 'ficha') {
    if (mostrados.length === 1) return mostrarFicha(from, data, mostrados[0]);
    await setSession(from, { step: 'reco_ficha_elegir', data });
    await enviarLista(from, '📄 Ver un programa', '¿Cuál programa quieres ver en detalle?', 'Programas', filasElegirPrograma(mostrados));
    return;
  }
  if (accion === 'ia') return iniciarIa(from, data);
  if (accion === 'asesor') return pedirConsentimiento(from, data);
  if (accion === 'mas') return mostrarResultados(from, data, true);
  if (accion === 'virtual') return mostrarResultados(from, { ...data, soloVirtual: '1', vioMas: '' });
  if (accion === 'presencial') return mostrarResultados(from, { ...data, soloVirtual: '', vioMas: '' });
  if (accion === 'nivel') return aNivel();
  if (accion === 'pregrado') return iniciarRecomendacion(from);
  // Una frase o una pregunta ("¿cuál es más barata?", "algo de salud mental") va a la IA.
  if (esTextoLibre(text)) return responderConIaDesdeResultados(from, data, text);

  await noReconocido(from, 'Elige una opción de la lista o escribe el número de un programa 👇', 'resultados', text);
  await enviarAcciones(from, data);
}

/** Vuelve a las recomendaciones principales (sin "más opciones"). */
const volverARecomendaciones = (from: string, data: SessionData) => mostrarResultados(from, { ...data, vioMas: '' });

// ── 5. Ficha de un programa ─────────────────────────────────────────────────

export async function handleRecoFichaElegir(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const data = session?.data ?? {};
  if (await comandos(from, text, () => volverARecomendaciones(from, data))) return;

  const mostrados = idsMostrados(data.recomendados);
  const id = programaPorNumero(text, mostrados);
  if (!id) {
    await noReconocido(from, 'Elige el programa de la lista 👇', 'ficha_elegir', text);
    await enviarLista(from, '📄 Ver un programa', '¿Cuál programa quieres ver en detalle?', 'Programas', filasElegirPrograma(mostrados));
    return;
  }
  await mostrarFicha(from, data, id);
}

async function mostrarFicha(from: string, data: SessionData, id: string): Promise<void> {
  const programa = getPrograma(id);
  if (!programa) return volverARecomendaciones(from, data);
  await setSession(from, { step: 'reco_ficha', data: { ...data, programaInteres: id } });
  await track('reco_ficha', { area: 'posgrados', programa: id });
  if (!fotosDisponibles()) {
    await messaging.sendText({ to: from, text: formatearFicha(programa) });
    await enviarLista(from, '¿Qué quieres hacer?', 'Elige una opción para continuar', 'Opciones', FILAS_TRAS_FICHA);
    return;
  }
  // El flyer con lo esencial; lo demás lo pregunta con un botón o escribiendo.
  if (!await enviarFlyerPrograma(from, programa, pieFlyer(programa))) await messaging.sendText({ to: from, text: pieFicha(programa) });
  await esperarFlyers(from);
  await enviarBotonesFicha(from);
}

async function enviarBotonesFicha(from: string): Promise<void> {
  await messaging.sendButtons({
    to: from, title: '', description: PREGUNTA_FICHA, footer: PIE_BOTONES_FICHA, buttons: [...BOTONES_FICHA],
  });
}

export async function handleRecoFicha(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const data = session?.data ?? {};
  if (await comandos(from, text, () => volverARecomendaciones(from, data))) return;

  const accion = parseAccionFicha(text);
  const programa = data.programaInteres ? getPrograma(data.programaInteres) : undefined;
  if (accion === 'ia') return iniciarIa(from, data);
  if (accion === 'asesor') return pedirConsentimiento(from, data);
  if (accion === 'recomendaciones') return volverARecomendaciones(from, data);
  if (accion === 'plan' && programa) {
    await messaging.sendText({ to: from, text: formatearPlan(programa) });
    await enviarBotonesFicha(from);
    return;
  }
  if (accion === 'costos' && programa) return responderConIaDesdeResultados(from, data, preguntaCostos(programa));
  // Cualquier otra cosa escrita es una pregunta sobre el programa: la responde la IA con su contexto.
  if (programa && text.trim() && !/^\d+$/.test(text.trim()) && !text.startsWith('__')) {
    return responderConIaDesdeResultados(from, data, text);
  }

  await noReconocido(from, 'Elige una opción de la lista 👇', 'ficha', text);
  await enviarLista(from, '¿Qué quieres hacer?', 'Elige una opción para continuar', 'Opciones', FILAS_TRAS_FICHA);
}

// ── 6. IA con el contexto del pregrado ──────────────────────────────────────

/**
 * La sesión de la IA de posgrados con el contexto de lo recomendado. Solo pasan
 * campos cerrados (IDs y valores fijos); `aiChat` arma el resumen con `resumenRecomendacion`.
 */
function sesionIa(data: SessionData): Session {
  return {
    step: 'chatting_with_ai',
    data: {
      area: 'posgrados',
      originArea: 'posgrado',
      relacion: data.relacion ?? '',
      pregradoId: data.pregradoId ?? '',
      familiaId: data.familiaId ?? '',
      nivel: data.nivel ?? '',
      recomendados: data.recomendados ?? '[]',
      ...(data.programaInteres ? { programaInteres: data.programaInteres } : {}),
      ...(data.campana === '1' ? { campana: '1' } : {}),
      ...(data.datos ? { datos: data.datos } : {}),
    },
  };
}

/**
 * Lo que escribió (una pregunta, lo que buscaba) lo responde la IA de la
 * conversación: con sugerencias, el flyer del programa y el asesor si hace falta.
 */
async function responderConIaDesdeResultados(from: string, data: SessionData, texto: string): Promise<void> {
  await track('reco_ia', { area: 'posgrados' });
  if (config.conversacion.activa) {
    const { responderEnConversacion } = await import('./conversacion');
    return responderEnConversacion(from, data, texto);
  }
  const sesion = sesionIa(data);
  await setSession(from, sesion);
  await handleChattingWithAI({ from, text: texto, session: sesion });
}

async function iniciarIa(from: string, data: SessionData): Promise<void> {
  await track('reco_ia', { area: 'posgrados' });
  if (config.conversacion.activa) {
    const { abrirPreguntasEnConversacion } = await import('./conversacion');
    return abrirPreguntasEnConversacion(from, data);
  }
  await setSession(from, sesionIa(data));
  await messaging.sendText({
    to: from,
    text:
      '🤖 *Asistente IA de Posgrados*\n\n' +
      'Pregúntame lo que quieras sobre estos programas: requisitos, plan de estudios, diferencias entre ellos, horarios o financiación.\n\n' +
      '_Escribe *asesor* para hablar con una persona, o *menu* para volver._',
  });
}

// ── 7. Asesor: consentimiento, canal de contacto, nombre y lead ─────────────

const correoValido = (correo?: string) => (correo && CORREO_REGEX.test(correo) ? correo : '');

/**
 * Con la autorización dada, la persona elige cómo la contacta el asesor: por
 * este chat, con una llamada o al correo. Quien ya eligió antes (o dejó su
 * correo) solo confirma "igual que la vez pasada". El nombre se pide al final
 * si falta. Con `intro`, va en el mismo mensaje que la pregunta.
 */
async function pedirDatosDeContacto(from: string, data: SessionData, intro?: string, pedido?: ContactoEscrito | null): Promise<void> {
  // "Quiero que un asesor me escriba por aquí", "llámenme al 300…": el canal ya lo dijo, no se le pregunta.
  if (pedido) {
    if (intro && pedido.canal !== 'chat') await messaging.sendText({ to: from, text: intro });
    return aplicarCanal(from, { ...data, consentimiento: 'Sí', canalPedido: '' }, pedido);
  }
  const autorizado = await conContactoRecordado(from, { ...data, consentimiento: 'Sí' });
  const anterior = contactoAnterior(autorizado, from);
  // Una franja en que el equipo ya no llama (la noche) no se ofrece repetir.
  const { disponibles } = await horarioDeLlamadas();
  const previo = anterior?.franja && anterior.franja !== 'cita' && !disponibles.includes(anterior.franja)
    ? { ...anterior, franja: undefined } : anterior;
  if (!previo) return preguntarCanal(from, autorizado, intro);
  await setSession(from, { step: PASO_REPETIR, data: autorizado });
  await messaging.sendButtons({
    to: from, title: TITULO_CONTACTO, description: preguntaRepetir(previo, intro), footer: PIE_CANAL, buttons: [...BOTONES_REPETIR],
  });
}

/** La sesión puede venir sin el canal de la vez pasada: el perfil lo recuerda (solo con autorización). */
async function conContactoRecordado(from: string, data: SessionData): Promise<SessionData> {
  if (data.datos !== 'si' || data.contactoCanal) return data;
  try {
    const perfil = await leerPerfil(from);
    const recordado: SessionData = {};
    for (const campo of ['contactoCanal', 'contactoTel', 'contactoFranja', 'correo'] as const) {
      if (perfil?.[campo] && !data[campo]) recordado[campo] = perfil[campo];
    }
    return { ...data, ...recordado };
  } catch {
    // Sin el perfil se pregunta el canal: no se pierde nada.
    return data;
  }
}

async function preguntarCanal(from: string, data: SessionData, intro?: string, noEntendio = false): Promise<void> {
  await setSession(from, { step: PASO_CANAL, data });
  await messaging.sendButtons({
    to: from,
    title: TITULO_CONTACTO,
    description: noEntendio ? REPETIR_CANAL : preguntaCanal(intro),
    footer: PIE_CANAL,
    buttons: [...BOTONES_CANAL],
  });
}

/** "Volver" desde el canal o el nombre: con la autorización dada al empezar, sale del paso del asesor. */
function salirDelAsesor(from: string, data: SessionData): () => Promise<void> {
  if (data.datos !== 'si') return () => pedirConsentimiento(from, data);
  if (data.recomendados) return () => volverAntesDeAsesor(from, data);
  return () => volverALaConversacion(from, data, 'Listo 👍 Puedes seguir preguntándome lo que quieras.');
}

/** Lo elegido (botón o escrito) lleva a lo que falta: el correo, el número, la franja o el nombre. */
async function aplicarCanal(from: string, data: SessionData, e: ContactoEscrito): Promise<void> {
  const base: SessionData = {
    ...data, contactoCanal: e.canal, contactoTel: '', contactoFranja: '', contactoDia: '', contactoPideNumero: '', pideLlamada: '',
  };
  if (e.canal === 'chat') return completarContacto(from, base, { canal: 'chat' });
  if (e.canal === 'correo') {
    if (e.correo) return completarContacto(from, base, { canal: 'correo', correo: e.correo });
    await setSession(from, { step: 'reco_correo', data: base });
    await messaging.sendText({ to: from, text: pedirCorreo(correoValido(data.correo) || undefined) });
    return;
  }
  // Un WhatsApp sin teléfono (BSUID) no tiene "este número": se le pide uno.
  const telefono = e.telefono ?? (e.mismoNumero && !isBsuid(from) ? 'este' : '');
  return seguirLlamada(from, { ...base, pideLlamada: '1', contactoTel: telefono, contactoFranja: e.franja ?? '', contactoDia: e.dia ?? '' });
}

/** El horario en que llama el equipo (por defecto de lunes a viernes, de 8 a 18) y las franjas que alcanza. */
async function horarioDeLlamadas(): Promise<{ disponibles: Franja[]; texto: string }> {
  const horario = await obtenerConfigAtencionCacheada().then((c) => c.horario).catch(() => CONFIG_ATENCION_DEFAULT.horario);
  return { disponibles: franjasDelHorario(horario), texto: textoHorario(horario) };
}

/** La llamada necesita el número y la franja (o la cita, con la agenda encendida). */
async function seguirLlamada(from: string, data: SessionData, aviso?: string): Promise<void> {
  if (!data.contactoTel) {
    await setSession(from, { step: PASO_NUMERO, data });
    if (isBsuid(from) || data.contactoPideNumero === '1') {
      await messaging.sendText({ to: from, text: PEDIR_NUMERO });
      return;
    }
    await messaging.sendButtons({
      to: from, title: '📞 Llamada', description: PREGUNTA_NUMERO, footer: 'También puedes escribir el número', buttons: [...BOTONES_NUMERO],
    });
    return;
  }
  const conAgenda = config.agenda.activa;
  const horario = await horarioDeLlamadas();
  const pedida = (data.contactoFranja ?? '') as Franja | '';
  // La noche (o lo que quede fuera del horario del equipo) no se promete: se dice y se pregunta otra.
  const fuera = !!pedida && pedida !== 'cita' && !horario.disponibles.includes(pedida);
  const franja = (pedida === 'cita' && !conAgenda) || fuera ? '' : pedida;
  if (!franja) {
    const dia = data.contactoDia === 'manana' || data.contactoDia === 'pasado' ? data.contactoDia : undefined;
    const pregunta = fuera && pedida ? franjaFueraDeHorario(pedida, horario.texto) : preguntaFranja(conAgenda, horario.texto, dia);
    await setSession(from, { step: PASO_FRANJA, data: { ...data, contactoFranja: '' } });
    await messaging.sendList({
      to: from,
      title: '📞 Llamada',
      description: aviso ? `${aviso}\n\n${pregunta}` : pregunta,
      footer: 'También puedes escribirlo',
      buttonText: 'Elegir',
      sections: [{ title: '¿Cuándo te llamamos?', rows: filasFranja(conAgenda, horario.disponibles) }],
    });
    return;
  }
  const listo = contactoListo(data);
  if (listo) return completarContacto(from, data, listo);
}

/** Con el canal completo: si falta el nombre se pide (un solo mensaje); si no, se conecta. */
async function completarContacto(from: string, data: SessionData, c: Contacto): Promise<void> {
  const listo: SessionData = { ...data, ...camposContacto(c), contactoPideNumero: '' };
  if (!listo.nombre) {
    await setSession(from, { step: 'reco_nombre', data: listo });
    await messaging.sendText({ to: from, text: pedirNombreTrasCanal(c) });
    return;
  }
  return conectarSegunCanal(from, listo, c);
}

async function conectarSegunCanal(from: string, data: SessionData, c: Contacto): Promise<void> {
  // Por chat sigue como antes: se avisa que el asesor escribe por aquí (y que tiene el correo, si lo dio).
  if (c.canal === 'chat') {
    const correo = correoValido(data.correo);
    await messaging.sendText({ to: from, text: correo ? asesorConCorreoConocido(correo) : ASESOR_POR_AQUI });
  }
  await registrarLeadYConectar(from, data, c);
  // La cita: el asesor ya tiene la conversación; la agenda abre las franjas de Posgrados.
  if (c.canal === 'llamada' && c.franja === 'cita' && config.agenda.activa) {
    await atenderAgenda(from, 'ag:ofrecer', { step: 'with_agent', data: { area: 'posgrados', nombre: data.nombre ?? '' } });
  }
}

export async function handleRecoContacto(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const data = session?.data ?? {};
  if (await comandos(from, text, salirDelAsesor(from, data))) return;
  const elegido = parseCanal(text);
  if (elegido) return aplicarCanal(from, data, elegido);
  await registrarNoReconocido(PASO_CANAL, text);
  return preguntarCanal(from, data, undefined, true);
}

export async function handleRecoContactoRepetir(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const data = session?.data ?? {};
  if (await comandos(from, text, salirDelAsesor(from, data))) return;
  // "Mejor llámenme" o "sí, pero por correo": el canal escrito vale como la elección de una vez.
  const elegido = parseCanal(text);
  if (elegido) return aplicarCanal(from, data, elegido);
  const respuesta = parseRepetir(text);
  const previo = contactoAnterior(data, from);
  if (respuesta === 'igual' && previo) {
    if (previo.canal !== 'llamada') return completarContacto(from, data, previo);
    return seguirLlamada(from, { ...data, ...camposContacto(previo), contactoFranja: previo.franja ?? '' });
  }
  if (respuesta) return preguntarCanal(from, data);
  await registrarNoReconocido(PASO_REPETIR, text);
  if (!previo) return preguntarCanal(from, data);
  await messaging.sendButtons({
    to: from, title: TITULO_CONTACTO, description: preguntaRepetir(previo), footer: PIE_CANAL, buttons: [...BOTONES_REPETIR],
  });
}

export async function handleRecoLlamadaNumero(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const data = session?.data ?? {};
  if (await comandos(from, text, () => preguntarCanal(from, data))) return;
  // "Al mismo, en la tarde" o "a este, mañana": la franja y el día que vengan en la respuesta también quedan.
  const franja = parseFranja(text);
  const dia = parseDia(text);
  const conFranja: SessionData = { ...(franja && franja !== 'cita' ? { contactoFranja: franja } : {}), ...(dia ? { contactoDia: dia } : {}) };
  const r = parseNumero(text);
  if (r && 'telefono' in r) return seguirLlamada(from, { ...data, contactoTel: r.telefono, contactoPideNumero: '', ...conFranja });
  if (r && 'este' in r && !isBsuid(from)) return seguirLlamada(from, { ...data, contactoTel: 'este', contactoPideNumero: '', ...conFranja });
  const otroCanal = parseCanal(text);
  if (otroCanal && otroCanal.canal !== 'llamada') return aplicarCanal(from, data, otroCanal);
  if (r && 'otro' in r) return seguirLlamada(from, { ...data, contactoPideNumero: '1', ...conFranja });
  if (traeNumero(text)) {
    await messaging.sendText({ to: from, text: NUMERO_NO_VALIDO });
    return;
  }
  await registrarNoReconocido(PASO_NUMERO, text);
  return seguirLlamada(from, data);
}

export async function handleRecoLlamadaFranja(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const data = session?.data ?? {};
  if (await comandos(from, text, () => preguntarCanal(from, data))) return;
  // Un número escrito aquí corrige al que se llama; "mañana" anota el día y vuelve a preguntar la franja.
  const telefono = telefonoColombiano(text);
  const dia = parseDia(text);
  const datos: SessionData = { ...data, ...(telefono ? { contactoTel: telefono } : {}), ...(dia ? { contactoDia: dia } : {}) };
  let franja = parseFranja(text);
  // "Mañana" otra vez, con el día ya anotado: ahora es la franja de la mañana.
  if (!franja && dia === 'manana' && data.contactoDia === 'manana') franja = 'manana';
  if (franja && (franja !== 'cita' || config.agenda.activa)) return seguirLlamada(from, { ...datos, contactoFranja: franja });
  // "No puedo hablar ahora": no es una franja ni otro canal; se pregunta cuándo sí.
  if (noPuedeAhora(text)) return seguirLlamada(from, datos, CUANDO_SI);
  if (dia) return seguirLlamada(from, datos);
  const otroCanal = parseCanal(text);
  if (otroCanal && otroCanal.canal !== 'llamada') return aplicarCanal(from, data, otroCanal);
  if (!telefono) await registrarNoReconocido(PASO_FRANJA, text);
  return seguirLlamada(from, datos);
}

/** Desde la conversación libre no hay recomendaciones a las cuales volver. */
async function volverALaConversacion(from: string, data: SessionData, texto: string): Promise<void> {
  await setSession(from, { step: 'menu', data: { ...data, pendiente: '' } });
  await messaging.sendText({ to: from, text: texto });
}

/**
 * Pide el asesor. `texto` es el pedido escrito: si ya dice el canal ("que me
 * escriban por aquí", "llámenme al 300…", "a mi correo ana@x.com"), no se le
 * pregunta; sin autorización todavía, el canal espera en la sesión.
 */
export async function pedirConsentimiento(from: string, datosSesion: SessionData, texto?: string): Promise<void> {
  await track('reco_asesor', { area: 'posgrados' });
  // Una sesión reiniciada no trae la autorización ni el nombre: se recuperan si ya se dieron.
  const data = await conLoRecordado(from, datosSesion).catch(() => datosSesion);
  const pedido = texto ? parseCanal(texto) : null;
  // Quien autorizó el tratamiento de sus datos al empezar no tiene que autorizar de nuevo.
  if (data.datos === 'si') return pedirDatosDeContacto(from, data, ASESOR_CON_AUTORIZACION, pedido);
  await setSession(from, { step: 'reco_consentimiento', data: { ...data, canalPedido: pedido ? JSON.stringify(pedido) : '' } });
  await messaging.sendButtons({
    to: from,
    title: '👤 Hablar con un asesor',
    description: PEDIR_CONSENTIMIENTO,
    footer: 'Tus datos se usan solo para fines de admisión',
    buttons: [...BOTONES_CONSENTIMIENTO],
  });
}

/** El canal que dijo al pedir el asesor antes de autorizar sus datos. */
function canalPedido(data: SessionData): ContactoEscrito | null {
  try {
    const e = JSON.parse(data.canalPedido || 'null') as ContactoEscrito | null;
    return e && ['chat', 'llamada', 'correo'].includes(e.canal) ? e : null;
  } catch {
    return null;
  }
}

/** Pasos del asesor: el canal, el número, la franja, el correo y el nombre. */
const PASOS_DEL_ASESOR: ReadonlySet<string> = new Set([...PASOS_DE_CONTACTO, 'reco_correo', 'reco_nombre']);

/**
 * "Quiero hablar con un asesor" estando ya en los pasos del asesor: no se le
 * vuelve a preguntar lo mismo (el círculo que arregló 92a0f9a). Si dijo el
 * canal, ese; si estaba eligiendo la franja de la llamada, el asesor llama
 * apenas pueda; si no, por este chat, que es lo inmediato. En el paso del
 * nombre solo falta el nombre. Fuera de esos pasos es un pedido de asesor normal.
 */
export async function pedirAsesorDesdePaso(from: string, step: string, data: SessionData, texto: string): Promise<void> {
  if (!PASOS_DEL_ASESOR.has(step)) return pedirConsentimiento(from, data, texto);
  if (step === 'reco_nombre') {
    await messaging.sendText({ to: from, text: '👤 ¡Ya casi! Para pasarte con el asesor solo me falta tu *nombre completo* ✍️' });
    return;
  }
  const autorizado: SessionData = { ...data, consentimiento: 'Sí' };
  const pedido = parseCanal(texto);
  if (pedido) return aplicarCanal(from, autorizado, pedido);
  if (data.contactoCanal === 'llamada' && data.contactoTel) return seguirLlamada(from, { ...autorizado, contactoFranja: 'cualquiera' });
  return aplicarCanal(from, autorizado, { canal: 'chat' });
}

/** Al paso anterior al consentimiento: la ficha si estaba viendo una, si no las recomendaciones. */
async function volverAntesDeAsesor(from: string, data: SessionData): Promise<void> {
  if (data.programaInteres) return mostrarFicha(from, data, data.programaInteres);
  return volverARecomendaciones(from, data);
}

export async function handleRecoConsentimiento(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const data = session?.data ?? {};
  if (await comandos(from, text, () => volverAntesDeAsesor(from, data))) return;

  const respuesta = parseSiNo(text);
  if (respuesta === 'si') {
    await registrarDecision(from, 'si');
    // El canal que dijo al pedir el asesor ("llámenme al 300…") no se le vuelve a preguntar.
    return pedirDatosDeContacto(from, { ...data, datos: 'si', canalPedido: '' }, undefined, canalPedido(data));
  }
  if (respuesta === 'no') {
    await track('reco_consentimiento_no', { area: 'posgrados' });
    // Sin autorización no se guarda el número ni el correo que traía el pedido.
    delete data.canalPedido;
    if (!data.recomendados) {
      return volverALaConversacion(from, data, 'Entendido, no guardaré tus datos 👍\n\nPuedes seguir preguntándome lo que quieras.');
    }
    await setSession(from, { step: 'reco_resultados', data });
    await messaging.sendText({ to: from, text: CONSENTIMIENTO_NEGADO });
    await enviarAcciones(from, data);
    return;
  }
  await messaging.sendButtons({
    to: from,
    title: '👤 Hablar con un asesor',
    description: PEDIR_CONSENTIMIENTO,
    footer: 'Tus datos se usan solo para fines de admisión',
    buttons: [...BOTONES_CONSENTIMIENTO],
  });
}

export async function handleRecoNombre(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const data = session?.data ?? {};
  // Con la autorización dada al empezar, "volver" sale del paso del asesor en vez de repetirlo.
  if (await comandos(from, text, salirDelAsesor(from, data))) return;

  // Solo un nombre: "jajaja", "un momento" o "soy de Barranquilla" no se registran.
  const nombre = limpiarNombre(text);
  if (!nombre) {
    await messaging.sendText({ to: from, text: 'Escríbeme tu nombre completo, por ejemplo: *Laura Gómez* ✍️' });
    return;
  }
  // El nombre queda de una vez (con autorización): si no termina, no se le vuelve a pedir.
  if (data.datos === 'si') {
    await completarPerfil(from, { nombre, datos: 'si' }).catch((err) =>
      console.error('[reco] no se pudo guardar el perfil:', describeExternalError(err)));
  }
  // El canal ya elegido se conecta; una sesión de antes (sin canal) lo elige ahora.
  const conNombre = { ...data, nombre };
  const contacto = contactoListo(conNombre);
  if (contacto) return conectarSegunCanal(from, conNombre, contacto);
  return preguntarCanal(from, conNombre);
}

/** El correo del canal 📧 (y el de sesiones viejas, que lo pedían después del nombre). */
export async function handleRecoCorreo(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const data = session?.data ?? {};
  if (await comandos(from, text, () => preguntarCanal(from, data))) return;

  // "Es ana@x.com", "ANA@X.COM." o "ese" (el que ya tenía).
  const conocido = correoValido(data.correo);
  const correo = correoEnTexto(text) ?? (conocido && esElMismoCorreo(text) ? conocido : null);
  if (correo) return completarContacto(from, { ...data, contactoCanal: 'correo' }, { canal: 'correo', correo });
  // "No tengo correo", "mejor por acá" → por este chat; "mejor llámenme" → la llamada.
  const otroCanal = parseCanal(text);
  if (otroCanal && otroCanal.canal !== 'correo') return aplicarCanal(from, data, otroCanal);
  if (prefiereContactoSinCorreo(text)) return aplicarCanal(from, data, { canal: pideLlamada(text) ? 'llamada' : 'chat' });
  await messaging.sendText({ to: from, text: CORREO_NO_VALIDO });
}

const AUTOR_BOT = 'Tooli (bot)';

/**
 * Deja en la ficha del CRM del panel la nota con el pregrado y las
 * recomendaciones, y las etiquetas del flujo. Nunca bloquea al asesor.
 */
async function anotarEnCrm(from: string, data: SessionData, c: Contacto): Promise<void> {
  try {
    const nota = notaCrmRecomendacion(data);
    if (nota) await agregarNota(from, nota, AUTOR_BOT);
    // Cómo pidió que lo contacten, en su propia nota: quien llega desde la conversación libre no trae recomendación.
    await agregarNota(from, `Contacto preferido (bot): ${lineaContacto(c, from)}`, AUTOR_BOT);
    const ficha = await getFicha(from);
    await setEtiquetas(from, [...ficha.etiquetas, ...etiquetasCrmRecomendacion(data), etiquetaContacto(c)], AUTOR_BOT);
  } catch (err) {
    console.error('[reco] no se pudo anotar en el CRM:', describeExternalError(err));
    await registrarIncidencia('crm', 'No se pudo anotar la recomendación en la ficha del CRM', err);
  }
}

/** El canal queda en el perfil para ofrecer "igual que la vez pasada"; la cita no se repite. */
function camposDePerfil(c: Contacto): Record<string, string> {
  const { contactoCanal, contactoTel, contactoFranja } = camposContacto(c);
  return { contactoCanal, contactoTel, contactoFranja: contactoFranja === 'cita' ? '' : contactoFranja };
}

/**
 * Guarda el lead (Sheets, ficha del CRM y HubSpot) y abre la conversación
 * con el asesor. El asesor es lo que la persona pidió: si Sheets o el CRM
 * fallan se registra el error y se sigue, porque Chatwoot ya lleva los datos.
 */
async function registrarLeadYConectar(from: string, data: SessionData, c: Contacto): Promise<void> {
  const nombre = data.nombre ?? '';
  const correo = data.correo ?? '';
  const interes = programaInteresLead(data);
  const resumen = resumenRecomendacion(data);

  try {
    // Solo el programa (o el nivel buscado): el CRM clasifica la fila con este texto.
    // Quien ya estaba en el CRM por aceptar recibir información completa su misma fila.
    const registro = { nombre, email: correo, whatsapp: from, programa: interes, area: 'Posgrado' as const };
    const fila = Number(data.filaCrm);
    if (fila) await actualizarRegistroProspecto(fila, registro);
    else await guardarRegistroProspecto(registro);
  } catch (err) {
    console.error('[reco] no se pudo guardar el lead en Sheets:', describeExternalError(err));
    await registrarIncidencia('crm', 'No se pudo guardar en la hoja del CRM a alguien que pidió asesor', err);
  }
  await anotarEnCrm(from, data, c);

  // HubSpot (CRM de la UTB) sin bloquear el flujo; guarda los contactos por correo, así que sin correo se omite.
  if (correo) void upsertContactoHubspot({
    email: correo,
    nombre,
    whatsapp: from,
    posgradoInteres: interes,
    interesFinanciacion: '',
    consentimiento: true,
    fuente: data.campana === '1' ? config.hubspot.fuenteCampana : config.hubspot.fuenteRecomendacion,
    pregrado: pregradoLead(data),
    relacion: relacionLead(data),
  });

  await track('reco_lead_completado', { area: 'posgrados' });
  // Nombre y correo quedan en el perfil (con autorización) para no volver a pedirlos.
  if (data.datos === 'si') {
    // Lo que ya no aplica (el número y la franja de una llamada anterior, si ahora es por chat) se vacía.
    const contacto = camposDePerfil(c);
    const vaciar = Object.entries(contacto).filter(([, v]) => !v).map(([k]) => k);
    await completarPerfil(from, { nombre, correo, datos: 'si', ...contacto }, vaciar).catch((err) =>
      console.error('[reco] no se pudo guardar el perfil:', describeExternalError(err)));
  }
  await conectarConAsesorPosgrado(from, {
    nombre,
    email: correo,
    programa: interes,
    lineas: [
      ...(resumen ? [`🧭 ${resumen}`] : []),
      lineaContacto(c, from),
      '🔒 Autorizó el tratamiento de datos (Ley 1581 de 2012)',
    ],
    etiquetas: [...etiquetasCrmRecomendacion(data), etiquetaContacto(c)],
    // Quien pidió llamada o correo lee eso, no "te responderá en breve".
    ...(c.canal !== 'chat' ? { aviso: (proxima: string | null) => avisoContacto(c, proxima) } : {}),
  });
}
