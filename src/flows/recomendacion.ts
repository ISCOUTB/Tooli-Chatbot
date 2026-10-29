/**
 * Flujo de recomendación de posgrados según el pregrado (pasos `reco_*`).
 * Ver `docs/flujo-recomendacion-posgrados.md`.
 *
 * Todo lo que se decide vive en la sesión (`relacion`, `pregradoId` o
 * `familiaId`, `nivel`, `soloVirtual`) y las recomendaciones se recalculan
 * con el motor en cada paso, así que nada depende de una lista guardada.
 * Recomendar no pide datos personales.
 */
import { setSession } from '../services/session';
import { MetricEvent, track } from '../services/metrics';
import { getPrograma } from '../services/catalogoUtb';
import { FlowContext, messaging, salirAlMenuRaiz, sendMenu, sendMenuPregrado } from './shared';
import { SessionData, parseGlobalCommand } from './commands';
import { sendAreasMenu } from './programas';
import { FAMILIAS_EXTERNAS, PregradoInterpretado, interpretarPregrado, recomendar } from './recomendacionPregrado';
import {
  BOTONES_CONFIRMAR,
  BOTONES_SIN_COINCIDENCIA,
  COINCIDENCIA_DESCARTADA,
  ContextoResultados,
  FILAS_GRUPOS,
  FILAS_NIVEL,
  FILAS_RELACION,
  FilaLista,
  GrupoPregrado,
  NivelElegido,
  PEDIR_PREGRADO_EXTERNO,
  Relacion,
  SALUDO_RELACION,
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

async function enviarRelacion(to: string): Promise<void> {
  await messaging.sendList({
    to,
    title: '🎓 Tooli UTB',
    description: SALUDO_RELACION,
    footer: 'Universidad Tecnológica de Bolívar',
    buttonText: 'Elegir',
    sections: [{ title: 'Tu relación con la UTB', rows: [...FILAS_RELACION] }],
  });
}

const enviarGrupos = (to: string) =>
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

async function enviarSinCoincidencia(to: string, texto: string = SIN_COINCIDENCIA): Promise<void> {
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

/** Arranca el flujo desde cero: saludo y pregunta por la relación con la UTB. */
export async function iniciarRecomendacion(to: string): Promise<void> {
  await setSession(to, { step: 'reco_relacion', data: {} });
  await track('reco_inicio');
  await enviarRelacion(to);
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

// ── 1. Relación con la UTB ──────────────────────────────────────────────────

export async function handleRecoRelacion(ctx: FlowContext): Promise<void> {
  const { from, text } = ctx;
  if (await comandos(from, text, () => enviarRelacion(from))) return;

  const eleccion = parseRelacion(text);
  if (!eleccion) {
    await noReconocido(from, 'Elige una opción de la lista 👇');
    await enviarRelacion(from);
    return;
  }

  if (eleccion.tipo === 'salida') {
    if (eleccion.salida === 'pregrado') {
      await track('reco_salida_pregrado');
      await setSession(from, { step: 'menu_pregrado', data: {} });
      await sendMenuPregrado(from);
    } else {
      await track('reco_salida_otras_gestiones');
      await setSession(from, { step: 'menu', data: {} });
      await sendMenu(from);
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
  await setSession(from, { step: 'reco_relacion', data: {} });
  await enviarRelacion(from);
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

async function enviarAcciones(from: string, data: SessionData): Promise<void> {
  const { resultado, ctx } = calcular(data);
  if (!ctx) return;
  await enviarLista(from, '¿Qué quieres hacer?', 'Elige una opción para continuar', 'Opciones', filasAcciones(resultado, ctx, data.vioMas === '1'));
}

async function mostrarResultados(from: string, data: SessionData, mas = false): Promise<void> {
  const { resultado, ctx } = calcular(data);
  if (!ctx || !resultado.recomendaciones.length) {
    // Sesión incompleta o vencida a mitad de camino: se empieza de nuevo en vez de inventar.
    await iniciarRecomendacion(from);
    return;
  }
  const mostrados = (mas ? resultado.recomendaciones.concat(resultado.resto) : resultado.recomendaciones).map((r) => r.programa.id);
  const nuevaData = { ...data, vioMas: mas ? '1' : data.vioMas ?? '', recomendados: JSON.stringify(mostrados) };
  await setSession(from, { step: 'reco_resultados', data: nuevaData });
  await track(mas ? 'reco_mas_opciones' : 'reco_resultados', { area: 'posgrados', nivel: data.nivel || 'todos' });
  await messaging.sendText({ to: from, text: formatearResultados(resultado, ctx, { mas }) });
  await enviarAcciones(from, nuevaData);
}

export async function handleRecoResultados(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  const data = session?.data ?? {};
  const aNivel = async () => {
    await setSession(from, { step: 'reco_nivel', data });
    await enviarNivel(from);
  };
  if (await comandos(from, text, aNivel)) return;

  const accion = parseAccion(text);
  if (accion === 'mas') return mostrarResultados(from, data, true);
  if (accion === 'virtual') return mostrarResultados(from, { ...data, soloVirtual: '1', vioMas: '' });
  if (accion === 'presencial') return mostrarResultados(from, { ...data, soloVirtual: '', vioMas: '' });
  if (accion === 'nivel') return aNivel();
  if (accion === 'pregrado') return iniciarRecomendacion(from);

  await noReconocido(from, 'Elige una opción de la lista 👇');
  await enviarAcciones(from, data);
}
