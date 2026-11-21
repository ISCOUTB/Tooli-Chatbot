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
import { describeExternalError } from '../services/logSafe';
import { FlowContext, messaging, salirAlMenuRaiz, sendMenu, sendMenuClasico, sendMenuPregrado } from './shared';
import { SessionData, parseGlobalCommand } from './commands';
import { sendAreasMenu } from './programas';
import { conectarConAsesorPosgrado } from './prospecto';
import { handleChattingWithAI } from './aiChat';
import { enviarFlyerPrograma, fotosDisponibles } from './fotosPrograma';
import { FAMILIAS_EXTERNAS, PregradoInterpretado, interpretarPregrado, recomendar } from './recomendacionPregrado';
import {
  BOTONES_CONSENTIMIENTO,
  CONSENTIMIENTO_NEGADO,
  CORREO_REGEX,
  FILAS_TRAS_FICHA,
  ASESOR_CON_AUTORIZACION,
  BOTONES_FICHA,
  CIERRE_CON_FOTOS,
  PIE_BOTONES_FICHA,
  PREGUNTA_FICHA,
  encabezadoConFotos,
  formatearPlan,
  pieFicha,
  pieFlyer,
  pieFlyerRecomendado,
  piePrograma,
  preguntaCostos,
  BOTONES_UTIL,
  esTextoLibre,
  GRACIAS_NO_UTIL,
  GRACIAS_UTIL,
  PIE_UTIL,
  PREGUNTA_UTIL,
  PEDIR_SOLO_CORREO,
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
  pedirCorreo,
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

async function noReconocido(to: string, pista: string): Promise<void> {
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
    await noReconocido(from, 'Elige una opción de la lista 👇');
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
    await noReconocido(from, 'Elige la escuela de tu pregrado o escribe su nombre 👇');
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
    await noReconocido(from, 'Elige tu pregrado de la lista o escribe su nombre 👇');
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
    await noReconocido(from, 'Elige un nivel de la lista 👇');
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

async function enviarAcciones(from: string, data: SessionData, cuerpo = 'Elige una opción para continuar'): Promise<void> {
  const { resultado, ctx } = calcular(data);
  if (!ctx) return;
  await enviarLista(from, '¿Qué quieres hacer?', cuerpo, 'Opciones', filasAcciones(resultado, ctx, data.vioMas === '1'));
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
    await messaging.sendText({ to: from, text: encabezadoConFotos(resultado, ctx, { mas }) });
    for (const [i, r] of lista.entries()) {
      if (!await enviarFlyerPrograma(from, r.programa, pieFlyerRecomendado(r, desde + i))) {
        await messaging.sendText({ to: from, text: piePrograma(r, desde + i) });
      }
    }
    await enviarAcciones(from, nuevaData, CIERRE_CON_FOTOS);
  } else {
    await messaging.sendText({ to: from, text: formatearResultados(resultado, ctx, { mas }) });
    await enviarAcciones(from, nuevaData);
  }
  if (preguntarUtil) {
    await messaging.sendButtons({
      to: from, title: '', description: PREGUNTA_UTIL, footer: PIE_UTIL, buttons: [...BOTONES_UTIL],
    });
  }
}

/**
 * 👍/👎 sobre la recomendación: queda la métrica y, si autorizó sus datos, una
 * nota en su ficha para el asesor. No cambia el paso en que está la persona.
 */
export async function atenderUtil(from: string, valor: 'si' | 'no', data: SessionData): Promise<void> {
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

  await noReconocido(from, 'Elige una opción de la lista o escribe el número de un programa 👇');
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
    await noReconocido(from, 'Elige el programa de la lista 👇');
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

  await noReconocido(from, 'Elige una opción de la lista 👇');
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

/** Lo que escribió (una pregunta, lo que buscaba) lo responde la IA de una vez. */
async function responderConIaDesdeResultados(from: string, data: SessionData, texto: string): Promise<void> {
  await track('reco_ia', { area: 'posgrados' });
  const sesion = sesionIa(data);
  await setSession(from, sesion);
  await handleChattingWithAI({ from, text: texto, session: sesion });
}

async function iniciarIa(from: string, data: SessionData): Promise<void> {
  await track('reco_ia', { area: 'posgrados' });
  await setSession(from, sesionIa(data));
  await messaging.sendText({
    to: from,
    text:
      '🤖 *Asistente IA de Posgrados*\n\n' +
      'Pregúntame lo que quieras sobre estos programas: requisitos, plan de estudios, diferencias entre ellos, horarios o financiación.\n\n' +
      '_Escribe *asesor* para hablar con una persona, o *menu* para volver._',
  });
}

// ── 7. Asesor: consentimiento, nombre, correo y lead ────────────────────────

/**
 * Con la autorización dada, al asesor solo le faltan el nombre (si no lo dio) y
 * el correo. Con `intro`, va un solo mensaje que explica para qué son.
 */
async function pedirDatosDeContacto(from: string, data: SessionData, intro?: string): Promise<void> {
  const autorizado: SessionData = { ...data, consentimiento: 'Sí' };
  if (data.nombre) {
    await setSession(from, { step: 'reco_correo', data: autorizado });
    await messaging.sendText({ to: from, text: intro ? `${intro}\n\n${PEDIR_SOLO_CORREO}` : pedirCorreo(data.nombre) });
    return;
  }
  await setSession(from, { step: 'reco_nombre', data: autorizado });
  await messaging.sendText({ to: from, text: intro ? `${intro}\n\n${PEDIR_NOMBRE}` : PEDIR_NOMBRE });
}

/** Desde la conversación libre no hay recomendaciones a las cuales volver. */
async function volverALaConversacion(from: string, data: SessionData, texto: string): Promise<void> {
  await setSession(from, { step: 'menu', data: { ...data, pendiente: '' } });
  await messaging.sendText({ to: from, text: texto });
}

export async function pedirConsentimiento(from: string, data: SessionData): Promise<void> {
  await track('reco_asesor', { area: 'posgrados' });
  // Quien autorizó el tratamiento de sus datos al empezar no tiene que autorizar de nuevo.
  if (data.datos === 'si') return pedirDatosDeContacto(from, data, ASESOR_CON_AUTORIZACION);
  await setSession(from, { step: 'reco_consentimiento', data });
  await messaging.sendButtons({
    to: from,
    title: '👤 Hablar con un asesor',
    description: PEDIR_CONSENTIMIENTO,
    footer: 'Tus datos se usan solo para fines de admisión',
    buttons: [...BOTONES_CONSENTIMIENTO],
  });
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
    // Si ya dio su nombre al aceptar recibir información, solo falta el correo.
    return pedirDatosDeContacto(from, { ...data, datos: 'si' });
  }
  if (respuesta === 'no') {
    await track('reco_consentimiento_no', { area: 'posgrados' });
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
  const atras = data.datos !== 'si'
    ? () => pedirConsentimiento(from, data)
    : data.recomendados
      ? () => volverAntesDeAsesor(from, data)
      : () => volverALaConversacion(from, data, 'Listo 👍 Puedes seguir preguntándome lo que quieras.');
  if (await comandos(from, text, atras)) return;

  const nombre = text.trim().replace(/\s+/g, ' ').slice(0, 80);
  if (nombre.length < 3) {
    await messaging.sendText({ to: from, text: 'Por favor escribe tu nombre completo (mínimo 3 caracteres) ✍️' });
    return;
  }
  await setSession(from, { step: 'reco_correo', data: { ...data, nombre } });
  await messaging.sendText({ to: from, text: pedirCorreo(nombre) });
}

export async function handleRecoCorreo(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const data = session?.data ?? {};
  const aNombre = async () => {
    await setSession(from, { step: 'reco_nombre', data });
    await messaging.sendText({ to: from, text: PEDIR_NOMBRE });
  };
  if (await comandos(from, text, aNombre)) return;

  const correo = text.trim().toLowerCase();
  if (!CORREO_REGEX.test(correo)) {
    await messaging.sendText({ to: from, text: '📧 Ese correo no parece válido. Escríbelo de nuevo, por ejemplo: *nombre@correo.com*' });
    return;
  }
  await registrarLeadYConectar(from, { ...data, correo });
}

const AUTOR_BOT = 'Tooli (bot)';

/**
 * Deja en la ficha del CRM del panel la nota con el pregrado y las
 * recomendaciones, y las etiquetas del flujo. Nunca bloquea al asesor.
 */
async function anotarEnCrm(from: string, data: SessionData): Promise<void> {
  try {
    const nota = notaCrmRecomendacion(data);
    if (nota) await agregarNota(from, nota, AUTOR_BOT);
    const ficha = await getFicha(from);
    await setEtiquetas(from, [...ficha.etiquetas, ...etiquetasCrmRecomendacion(data)], AUTOR_BOT);
  } catch (err) {
    console.error('[reco] no se pudo anotar en el CRM:', describeExternalError(err));
  }
}

/**
 * Guarda el lead (Sheets, ficha del CRM y HubSpot) y abre la conversación
 * con el asesor. El asesor es lo que la persona pidió: si Sheets o el CRM
 * fallan se registra el error y se sigue, porque Chatwoot ya lleva los datos.
 */
async function registrarLeadYConectar(from: string, data: SessionData): Promise<void> {
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
  }
  await anotarEnCrm(from, data);

  // HubSpot (CRM de la UTB) sin bloquear el flujo, como en la campaña de posgrados
  void upsertContactoHubspot({
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
  await conectarConAsesorPosgrado(from, {
    nombre,
    email: correo,
    programa: interes,
    lineas: [
      ...(resumen ? [`🧭 ${resumen}`] : []),
      '🔒 Autorizó el tratamiento de datos (Ley 1581 de 2012)',
    ],
    etiquetas: etiquetasCrmRecomendacion(data),
  });
}
