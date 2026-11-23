/**
 * Flujo conversacional de posgrados (paso raíz `menu` con `FLUJO_CONVERSACIONAL=true`).
 *
 * La persona escribe (o manda un audio) y la IA le responde con la información
 * oficial. Entre respuesta y respuesta el bot hace una sola pregunta corta con
 * botones, como en NutrIA: si estudia o estudió en la UTB, qué carrera y qué
 * nivel le interesa. Con eso recomienda con el motor de siempre y, si la
 * persona quiere, la pasa a un asesor con su consentimiento. Si ignora una
 * pregunta, el bot no insiste en el siguiente turno. Cada respuesta de la IA
 * trae dos preguntas sugeridas para tocar, y quien vuelve (el perfil dura 90
 * días) retoma donde quedó en vez de contestar todo de nuevo. La primera vez
 * que alguien escribe, antes de todo, se le pide la autorización de datos
 * (Ley 1581) y, si acepta, su nombre para registrarlo en el CRM.
 */
import { config } from '../config';
import { getSession, setSession } from '../services/session';
import { preguntarAI, AIUnavailableError, ChatTurn } from '../services/aiAssistant';
import { track } from '../services/metrics';
import { NIVELES_POSGRADO, ProgramaUtb, buscarPrograma, getPrograma } from '../services/catalogoUtb';
import { darDeBaja, estaDadoDeBaja, quitarBaja } from '../services/campanaService';
import { programarSeguimiento } from '../services/seguimientoService';
import { agregarNota, getFicha, setEtiquetas } from '../services/crmService';
import { actualizarRegistroProspecto, guardarRegistroProspecto } from '../services/registroService';
import {
  completarPerfil, conLoRecordado, guardarPerfil, leerPerfil, pendienteVigente, perfilDeDatos, soloConsentimiento,
} from '../services/perfilService';
import { decisionGuardada, registrarDecision } from '../services/consentimientoService';
import { describeExternalError } from '../services/logSafe';
import { registrarNoReconocido } from '../services/noReconocidoService';
import { registrarIncidencia } from '../services/incidenciasService';
import { CONFIRMACION_BAJA } from './campanaReco';
import { enviarFlyerPrograma, esperarFlyers } from './fotosPrograma';
import { pieFlyer } from './recomendacionView';
import type { ButtonOption } from '../adapters/messaging/IMessagingAdapter';
import { FlowContext, messaging, sendMenu, sendMenuClasico, sendMenuPregrado } from './shared';
import { SessionData, parseGlobalCommand } from './commands';
import { FAMILIAS_EXTERNAS, interpretarPregrado } from './recomendacionPregrado';
import { contextoConversacion, parseRelacion, programaInteresLead, resumenRecomendacion } from './recomendacionView';
import { enviarGrupos, enviarSinCoincidencia, mostrarResultados, pedirConsentimiento } from './recomendacion';
import {
  BOTON_ASESOR, BOTONES_OFRECER_ASESOR, BOTONES_SIN_PREGRADO, CON_GUSTO, OFRECER_ASESOR, SIGUE_ARRIBA,
  CORREO_SIN_AUTORIZACION, DOCUMENTO_NO, ESPERO, QUEJA, SEGUIMOS, SIN_PREGUNTA_PENDIENTE, TELEFONO_YA, TE_EXPLICO,
  correoAnotado, datoPersonal, esConfusion, esEspera, esQueja, esRuido, BOTONES_TECNICO, BotonId, DATOS_RECHAZADOS, IA_NO_DISPONIBLE, INSTRUCCION_SUGERENCIAS,
  NO_RECONOCI_PREGRADO, PEDIR_PROGRAMA, PIE, PIE_SUGERENCIAS, INFO_RECHAZADA, PEDIR_NOMBRE_VALIDO, PREGUNTAS, Pendiente,
  SALUDO_CON_PREGUNTA, SALUDO_CONVERSACION, SALUDO_CORTO, SEGUIR_CON_SUGERENCIAS, SEGUIR_PREGUNTANDO, SIN_PREGRADO, SUGERIR_ASESOR, TECNICO, TITULO,
  TURNOS_ANTES_DE_ASESOR, botonesSugeridos, cabeConBotones, cambioDeNombre, carreraAnotada, datosAceptados, datosDeLaFrase,
  nombreCambiado, soloCuentaDatos, recordatorioSeguimiento, esBaja, esPedidoAsesor, esSaludo,
  infoAceptada, interpretarRespuestaEscrita, limpiarNombre, nivelDeBoton, pareceUnaPregunta, parseBoton,
  parseSugerencia, saludoCortoRegreso, saludoEnConversacion, saludoRegreso, SUGERENCIAS_SALUDO, IMAGEN_NO, separarSugerencias, sinPregrado, siguientePregunta,
  textoPregrado,
} from './conversacionView';

// ── Sesión y perfil ─────────────────────────────────────────────────────────

/** El perfil es una ayuda: si Redis falla al guardarlo, la conversación sigue. */
async function recordarPerfil(from: string, data: SessionData): Promise<void> {
  try {
    // Sin autorización de datos no se recuerda nada; si la negó, se borra lo que hubiera.
    if (data.datos === 'si') await guardarPerfil(from, { ...data, pendienteEn: data.pendiente ? String(Date.now()) : '' });
    else if (data.datos === 'no') await guardarPerfil(from, {});
  } catch (err) {
    console.error('[conversacion] no se pudo guardar el perfil:', describeExternalError(err));
    await registrarIncidencia('datos', 'No se pudo guardar el perfil de una persona (Redis)', err);
  }
}

async function perfilGuardado(from: string): Promise<SessionData | null> {
  try {
    const perfil = await leerPerfil(from);
    return perfil && Object.keys(perfil).length ? perfil : null;
  } catch (err) {
    console.error('[conversacion] no se pudo leer el perfil:', describeExternalError(err));
    return null;
  }
}

/** Guarda la sesión del paso raíz (una hora) y el perfil que se recuerda (90 días). */
async function guardarSesion(from: string, data: SessionData): Promise<void> {
  await setSession(from, { step: 'menu', data });
  await recordarPerfil(from, data);
}

interface LoQueDijo {
  data: SessionData;
  /** Lo nuevo que reconoció y conviene confirmar (la carrera, para que la corrija si no es). */
  avisos: string[];
  /** Cambió algo de lo que se sabía. */
  novedad: boolean;
  /** Dijo su relación con la UTB en la frase. */
  relacion: boolean;
  /** Dijo solo qué nivel busca ("una especialización"). */
  buscaNivel: boolean;
}

/**
 * Lo que la persona contó de sí en una frase (relación con la UTB, carrera,
 * nivel, «virtual») se suma a lo que ya se sabía: así nunca se le vuelve a
 * preguntar algo que ya dijo. Lo dicho después corrige lo de antes.
 */
function conLoQueDijo(data: SessionData, texto: string, pendiente: string): LoQueDijo {
  const dicho = datosDeLaFrase(texto);
  const nuevo: SessionData = { ...data };
  const avisos: string[] = [];
  // Una pregunta ("¿hay descuento para egresados de la UTB?") no corrige la relación que ya dijo; solo la llena.
  const esPregunta = texto.includes('?') || pareceUnaPregunta(texto);
  if (dicho.relacion && (!data.relacion || !esPregunta)) nuevo.relacion = dicho.relacion;
  // Mientras se pide la carrera, la respuesta la atiende atenderPregrado, con su propia confirmación.
  if (dicho.carrera && pendiente !== 'pregrado') {
    if (dicho.carrera.tipo === 'utb' && dicho.carrera.pregradoId !== data.pregradoId) {
      Object.assign(nuevo, { pregradoId: dicho.carrera.pregradoId, familiaId: '', sinPregrado: '' });
      avisos.push(carreraAnotada(getPrograma(dicho.carrera.pregradoId)?.nombre ?? 'tu carrera', false));
    } else if (dicho.carrera.tipo === 'familia' && dicho.carrera.familiaId !== data.familiaId) {
      const familiaId = dicho.carrera.familiaId;
      Object.assign(nuevo, { familiaId, pregradoId: '', sinPregrado: '' });
      avisos.push(carreraAnotada(FAMILIAS_EXTERNAS.find((f) => f.id === familiaId)?.etiqueta ?? 'tu carrera', true));
    }
  }
  if (dicho.buscaNivel) {
    // "Una especialización": busca ese nivel y quiere ayuda para elegir. "Posgrado" a secas no fija nivel.
    nuevo.modo = 'elegir';
    if (dicho.buscaNivel.nivel) Object.assign(nuevo, { nivel: dicho.buscaNivel.nivel, nivelListo: '1' });
    if (dicho.buscaNivel.virtual) nuevo.pideVirtual = '1';
  } else if (dicho.nivel && data.nivelListo !== '1') {
    Object.assign(nuevo, { nivel: dicho.nivel, nivelListo: '1' });
  }
  const novedad = Object.keys(nuevo).some((k) => (nuevo[k] ?? '') !== (data[k] ?? ''));
  return { data: nuevo, avisos, novedad, relacion: nuevo.relacion !== data.relacion || (!!dicho.relacion && !esPregunta), buscaNivel: !!dicho.buscaNivel };
}

/** La carrera de la última vez, para recordársela a quien vuelve. */
function carreraDe(data: SessionData): string | null {
  if (data.sinPregrado === '1') return null;
  if (data.pregradoId) return getPrograma(data.pregradoId)?.nombre ?? null;
  if (data.familiaId) return FAMILIAS_EXTERNAS.find((f) => f.id === data.familiaId)?.etiqueta ?? null;
  return null;
}

// ── Envíos ──────────────────────────────────────────────────────────────────

/** Preguntas que, si quedan sin respuesta, se recuerdan una vez (ver seguimientoService). */
const RECORDABLES: ReadonlySet<string> = new Set<Pendiente>([
  'tiene_programa', 'estudia_utb', 'egresado', 'pregrado', 'nivel', 'info', 'nombre_info', 'ofrecer',
]);

async function seguirSiNoContesta(from: string, data: SessionData, pendiente: string): Promise<void> {
  if (data.datos === 'si' && RECORDABLES.has(pendiente)) await programarSeguimiento(from, pendiente);
}

/** Hace la pregunta y la deja pendiente para entender la respuesta escrita. */
async function preguntar(from: string, data: SessionData, pendiente: Pendiente, prefijo?: string): Promise<void> {
  await guardarSesion(from, { ...data, pendiente, saltada: '' });
  const pregunta = PREGUNTAS[pendiente];
  const conPrefijo = (texto: string) => (prefijo ? `${prefijo}\n\n${texto}` : texto);
  if (pendiente === 'pregrado' || !pregunta.botones) {
    const texto = pendiente === 'pregrado' ? textoPregrado(data.relacion) : pregunta.texto;
    await messaging.sendText({ to: from, text: conPrefijo(texto) });
  } else {
    await messaging.sendButtons({
      to: from,
      title: TITULO,
      description: conPrefijo(pregunta.texto),
      footer: pregunta.pie ?? PIE,
      buttons: [...pregunta.botones],
    });
  }
  await seguirSiNoContesta(from, data, pendiente);
}

/**
 * Seguimiento de una pregunta sin contestar (lo llama seguimientoService). Solo
 * si la persona no está en otra cosa, sigue autorizando sus datos y no pidió
 * la baja. Devuelve si se le escribió.
 */
export async function recordarPendiente(from: string, pendiente: string): Promise<boolean> {
  if (!config.conversacion.activa || !RECORDABLES.has(pendiente)) return false;
  if (await getSession(from)) return false;
  if ((await decisionGuardada(from)) !== 'si') return false;
  if (await estaDadoDeBaja(from)) return false;
  const perfil = (await perfilGuardado(from)) ?? {};
  delete perfil.pendienteEn;
  await track('conv_seguimiento');
  await preguntar(from, { ...perfil, datos: 'si' }, pendiente as Pendiente, recordatorioSeguimiento(perfil.nombre));
  return true;
}

/**
 * Sigue con lo que falta. Si la persona pidió ayuda para elegir y ya está todo,
 * recomienda de una vez; si venía conversando, le ofrece la recomendación.
 */
async function continuar(from: string, data: SessionData): Promise<void> {
  const falta = siguientePregunta(data);
  if (falta) return preguntar(from, data, falta);
  // Sin pregrado no hay posgrado que recomendar: sus opciones son otras.
  if (data.sinPregrado === '1') return enviarSinPregrado(from, data, 'ninguno');
  if (data.modo === 'elegir') {
    await recordarPerfil(from, data);
    // Solo virtuales si lo pidió al contestar el nivel ("algo virtual").
    return mostrarResultados(from, { ...data, pendiente: '', soloVirtual: data.pideVirtual === '1' ? '1' : '', pideVirtual: '', vioMas: '' });
  }
  return preguntar(from, { ...data, ofrecido: '1' }, 'ofrecer');
}

/** Empieza de nuevo: olvida lo que buscaba, pero no el nombre ni la autorización. */
async function reiniciar(from: string, data: SessionData): Promise<void> {
  const base = soloConsentimiento(data);
  await recordarPerfil(from, base);
  await sendMenu(from, base);
}

/** Quien vuelve después de una hora y saluda: se le recuerda lo que buscaba. */
async function ofrecerRetomar(from: string, perfil: SessionData, carrera: string): Promise<void> {
  await track('conv_regreso');
  await setSession(from, { step: 'menu', data: { ...perfil, pendiente: 'regreso', saltada: '' } });
  await messaging.sendButtons({
    to: from,
    title: TITULO,
    description: saludoRegreso(perfil.nombre, carrera, perfil.nivelListo === '1' ? perfil.nivel : undefined),
    footer: PIE,
    buttons: [...(PREGUNTAS.regreso.botones ?? [])],
  });
}

/** Un saludo a mitad de conversación: la presentación con preguntas para tocar. */
async function saludarEnConversacion(from: string, data: SessionData): Promise<void> {
  await setSession(from, { step: 'menu', data: { ...data, pendiente: '' } });
  await messaging.sendButtons({
    to: from,
    title: '',
    description: saludoEnConversacion(data.nombre),
    footer: PIE_SUGERENCIAS,
    buttons: botonesSugeridos(SUGERENCIAS_SALUDO, 'posgrados'),
  });
}

/**
 * La respuesta de la IA con botones para seguir, así la conversación nunca
 * queda sin algo que tocar. Si no cabe en un mensaje con botones, van aparte.
 */
async function enviarConSugerencias(from: string, respuesta: string, botones: ButtonOption[]): Promise<void> {
  if (cabeConBotones(respuesta)) {
    await messaging.sendButtons({ to: from, title: '', description: respuesta, footer: PIE_SUGERENCIAS, buttons: botones });
    return;
  }
  await messaging.sendText({ to: from, text: respuesta });
  await messaging.sendButtons({ to: from, title: '', description: SEGUIR_CON_SUGERENCIAS, footer: PIE_SUGERENCIAS, buttons: botones });
}

// ── Botones ─────────────────────────────────────────────────────────────────

async function atenderBoton(from: string, data: SessionData, boton: BotonId): Promise<void> {
  const nivel = nivelDeBoton(boton);
  if (nivel) return continuar(from, { ...data, nivel, nivelListo: '1' });

  switch (boton) {
    case 'conv_tengo':
      await guardarSesion(from, { ...data, pendiente: '' });
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
      return continuar(from, { ...data, modo: 'elegir' });
    case 'conv_asesor':
      return pedirConsentimiento(from, { ...data, pendiente: '' });
    case 'conv_seguir_perfil':
      // Con todo lo de la última vez recomienda de una; si falta algo, lo pregunta.
      return continuar(from, { ...data, modo: 'elegir', pendiente: '' });
    case 'conv_reiniciar':
      return reiniciar(from, data);
    case 'conv_pregrados':
      await setSession(from, { step: 'menu_pregrado', data: {} });
      await sendMenuPregrado(from);
      return;
    case 'conv_seguir':
      await guardarSesion(from, { ...data, pendiente: '' });
      await messaging.sendText({ to: from, text: SEGUIR_PREGUNTANDO });
      return;
    case 'conv_info_si':
      // El nombre ya conocido (por ejemplo, de un registro anterior) no se vuelve a pedir.
      if (data.nombre) return registrarSuscripcion(from, { ...data, info: 'si' }, data.nombre);
      return preguntar(from, { ...data, info: 'si' }, 'nombre_info');
    case 'conv_datos_si': {
      await track('datos_acepta');
      await registrarDecision(from, 'si');
      const autorizado: SessionData = { ...data, datos: 'si', info: 'si', registro: 'datos' };
      if (data.nombre) return registrarSuscripcion(from, autorizado, data.nombre);
      // "Hola, me llamo Laura, …" en el primer mensaje: el nombre ya está, no se vuelve a pedir.
      const dicho = data.preguntaInicial ? cambioDeNombre(data.preguntaInicial) : null;
      if (dicho && 'nombre' in dicho) {
        return registrarSuscripcion(from, { ...autorizado, preguntaInicial: dicho.resto.slice(0, 500) }, dicho.nombre);
      }
      return preguntar(from, autorizado, 'nombre_info');
    }
    case 'conv_datos_no':
      await track('datos_rechaza');
      await negarDatos(from);
      await messaging.sendText({ to: from, text: DATOS_RECHAZADOS });
      return seguirTrasAutorizar(from, { ...data, datos: 'no', info: 'no' });
    case 'conv_info_no':
      await track('info_rechaza');
      try {
        await darDeBaja(from);
      } catch (err) {
        console.error('[conversacion] no se pudo registrar la baja:', describeExternalError(err));
      }
      await messaging.sendText({ to: from, text: INFO_RECHAZADA });
      return continuar(from, { ...data, info: 'no' });
    default:
      return undefined;
  }
}

// ── Autorización de datos y de recibir información ──────────────────────────

/** Sin autorización: queda la constancia y no se le envía información. */
async function negarDatos(from: string): Promise<void> {
  await registrarDecision(from, 'no');
  try {
    await darDeBaja(from);
  } catch (err) {
    console.error('[conversacion] no se pudo registrar la baja:', describeExternalError(err));
  }
}

/** Primera vez que escribe: el saludo y la autorización. Lo que preguntó se responde después. */
async function pedirAutorizacion(from: string, data: SessionData, texto: string): Promise<void> {
  const t = texto.trim();
  const esPregunta = !!t && !esSaludo(t) && !parseBoton(t) && !parseSugerencia(t) && !parseGlobalCommand(t) &&
    !t.startsWith('__') && !esRuido(t) && !esEspera(t) && !esConfusion(t) && !datoPersonal(t);
  const inicial = esPregunta ? t.slice(0, 500) : '';
  await messaging.sendText({ to: from, text: inicial ? SALUDO_CON_PREGUNTA : SALUDO_CONVERSACION });
  return preguntar(from, { ...data, preguntaInicial: inicial }, 'datos');
}

/** Después de decidir: responde lo que había preguntado o empieza con la primera pregunta. */
async function seguirTrasAutorizar(from: string, data: SessionData): Promise<void> {
  const pregunta = data.preguntaInicial ?? '';
  let sigue: SessionData = { ...data, preguntaInicial: '', registro: '', pendiente: '' };
  if (pregunta) {
    if (esPedidoAsesor(pregunta)) return pedirConsentimiento(from, sigue);
    // El primer mensaje solo contaba datos ("estudio derecho en la UTB"): se anotan y se sigue sin la IA.
    const dicho = conLoQueDijo(sigue, pregunta, '');
    if (!dicho.novedad || !(dicho.buscaNivel || soloCuentaDatos(pregunta))) return responderConIa(from, sigue, pregunta);
    if (dicho.avisos.length) await messaging.sendText({ to: from, text: dicho.avisos.join('\n') });
    sigue = dicho.data;
  }
  if (!sigue.relacion && !sigue.modo) return preguntar(from, sigue, 'tiene_programa');
  return continuar(from, sigue);
}

const AUTOR_BOT = 'Tooli (bot)';

/**
 * Quien acepta recibir información entra al CRM del panel: una fila en la hoja
 * de registros (sin correo todavía) y, en su ficha, la etiqueta y una nota con
 * la autorización. Si después pide un asesor, esa misma fila se completa.
 */
async function registrarSuscripcion(from: string, data: SessionData, nombre: string): Promise<void> {
  await track('info_acepta');
  let filaCrm = data.filaCrm ?? '';
  try {
    await quitarBaja(from);
  } catch (err) {
    console.error('[conversacion] no se pudo quitar la baja:', describeExternalError(err));
  }
  if (!filaCrm) {
    try {
      const fila = await guardarRegistroProspecto({
        nombre, email: '', whatsapp: from, programa: programaInteresLead(data), area: 'Posgrado',
      });
      filaCrm = fila ? String(fila) : '';
    } catch (err) {
      console.error('[conversacion] no se pudo guardar en el CRM:', describeExternalError(err));
      await registrarIncidencia('crm', 'No se pudo guardar en la hoja del CRM a alguien que autorizó sus datos', err);
    }
  }
  const alEmpezar = data.registro === 'datos';
  try {
    const resumen = resumenRecomendacion(data);
    const autorizacion = alEmpezar
      ? '🔒 Autorizó el tratamiento de sus datos y recibir información de posgrados por WhatsApp (Ley 1581 de 2012) en su primer mensaje al bot.'
      : '📬 Autorizó recibir información de posgrados por WhatsApp (Ley 1581 de 2012).';
    await agregarNota(from, `${autorizacion}${resumen ? `\n🧭 ${resumen}` : ''}`, AUTOR_BOT);
    const ficha = await getFicha(from);
    await setEtiquetas(from, [...new Set([...ficha.etiquetas, 'acepta-informacion', 'bot-conversacion'])], AUTOR_BOT);
  } catch (err) {
    console.error('[conversacion] no se pudo anotar en la ficha:', describeExternalError(err));
    await registrarIncidencia('crm', 'No se pudo anotar la autorización en la ficha del CRM', err);
  }
  await messaging.sendText({ to: from, text: alEmpezar ? datosAceptados(nombre) : infoAceptada(nombre) });
  return seguirTrasAutorizar(from, { ...data, datos: 'si', info: 'si', nombre, filaCrm });
}

// ── Cambio de nombre ────────────────────────────────────────────────────────

/**
 * Cambia el nombre en cualquier momento. Con autorización de datos queda en el
 * perfil, en una nota de la ficha del CRM y en la fila de la hoja de registros;
 * sin ella, solo en esta conversación. Devuelve los datos nuevos y el mensaje
 * corto que lo confirma, o null si ya lo atendió el registro (primera vez).
 */
async function cambiarNombre(from: string, data: SessionData, nombre: string): Promise<{ data: SessionData; aviso: string } | null> {
  const anterior = data.nombre ?? '';
  // Autorizó, pero nunca alcanzó a dar el nombre: este es su registro.
  if (data.datos === 'si' && data.info === 'si' && !anterior && !data.filaCrm) {
    await registrarSuscripcion(from, { ...data, pendiente: '' }, nombre);
    return null;
  }
  const nuevo: SessionData = { ...data, nombre };
  const aviso = nombreCambiado(nombre, anterior);
  if (data.datos !== 'si' || anterior === nombre) return { data: nuevo, aviso };
  try {
    await agregarNota(from, `✏️ Cambió su nombre en el chat: «${anterior || 'sin nombre'}» → «${nombre}».`, AUTOR_BOT);
  } catch (err) {
    console.error('[conversacion] no se pudo anotar el cambio de nombre:', describeExternalError(err));
    await registrarIncidencia('crm', 'No se pudo anotar en la ficha del CRM un cambio de nombre', err);
  }
  const fila = Number(data.filaCrm);
  if (Number.isInteger(fila) && fila >= 2) {
    try {
      await actualizarRegistroProspecto(fila, {
        nombre, email: data.correo ?? '', whatsapp: from, programa: programaInteresLead(data), area: 'Posgrado',
      });
    } catch (err) {
      console.error('[conversacion] no se pudo actualizar la fila del CRM:', describeExternalError(err));
      await registrarIncidencia('crm', 'No se pudo cambiar el nombre en la hoja del CRM', err);
    }
  }
  return { data: nuevo, aviso };
}

/** Tras cambiar el nombre: lo confirma y repite lo que estaba pendiente. */
async function seguirTrasNombre(from: string, data: SessionData, aviso: string): Promise<void> {
  const pendiente = (data.pendiente ?? '') as Pendiente | '';
  if (pendiente && PREGUNTAS[pendiente]) return preguntar(from, data, pendiente, aviso);
  await guardarSesion(from, data);
  await messaging.sendText({ to: from, text: aviso });
}

// ── Carrera escrita ─────────────────────────────────────────────────────────

/** Sin pregrado todavía: pregrados de la UTB o seguir preguntando (a la IA de admisiones). */
async function enviarSinPregrado(from: string, data: SessionData, tipo: 'ninguno' | 'tecnico'): Promise<void> {
  await guardarSesion(from, { ...data, pendiente: '', modo: '', sinPregrado: '1' });
  await messaging.sendButtons({
    to: from,
    title: TITULO,
    description: tipo === 'tecnico' ? TECNICO : SIN_PREGRADO,
    footer: PIE,
    buttons: [...(tipo === 'tecnico' ? BOTONES_TECNICO : BOTONES_SIN_PREGRADO)],
  });
}

async function atenderPregrado(from: string, data: SessionData, texto: string): Promise<void> {
  const sinTitulo = sinPregrado(texto);
  if (sinTitulo) return enviarSinPregrado(from, data, sinTitulo);
  const pregradoTexto = texto.trim().slice(0, 100);
  const interpretado = interpretarPregrado(pregradoTexto);
  if (!interpretado) {
    // Las mismas salidas del flujo de recomendación: la lista, un área o escribirla de nuevo.
    await track('reco_externo_sin_coincidencia');
    await registrarNoReconocido('carrera', pregradoTexto);
    await setSession(from, { step: 'reco_sin_coincidencia', data: { relacion: data.relacion || 'externo', pregradoTexto } });
    await enviarSinCoincidencia(from, NO_RECONOCI_PREGRADO);
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

/** El posgrado que consultó la IA, si el nombre corresponde a uno solo. */
function programaDeLaConsulta(nombre?: string): ProgramaUtb | null {
  if (!nombre) return null;
  const encontrados = buscarPrograma(nombre, NIVELES_POSGRADO);
  return encontrados.length === 1 ? encontrados[0] : null;
}

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
async function responderConIa(from: string, data: SessionData, texto: string, saludo?: string): Promise<void> {
  // Lo que contó de sí mientras pregunta ("soy egresado de sistemas, ¿cuánto cuesta…?") también se anota.
  const dicho = conLoQueDijo(data, texto, data.pendiente ?? '');
  const conPerfil: SessionData = dicho.data;

  if (saludo) await messaging.sendText({ to: from, text: saludo });
  if (dicho.avisos.length) await messaging.sendText({ to: from, text: dicho.avisos.join('\n') });
  // Quien todavía no tiene pregrado pregunta por carreras: la IA de admisiones sabe de eso.
  const area = conPerfil.sinPregrado === '1' ? 'admisiones' : 'posgrados';
  await track('ai_request', { area });

  const anterior = historial(conPerfil);
  let respuesta: string;
  let sugerencias: string[];
  let necesitaAsesor = false;
  let consultado: ProgramaUtb | null = null;
  try {
    const contexto = area === 'posgrados' ? contextoConversacion(conPerfil, anterior.length > 0) : undefined;
    const ai = await preguntarAI(area, texto.trim(), anterior, contexto, INSTRUCCION_SUGERENCIAS, { frecuentes: true });
    if (ai.reutilizada) await track('ai_reutilizada', { area });
    if (ai.corregida) await track('ia_corregida', { area });
    const separada = separarSugerencias(ai.answer);
    respuesta = separada.texto || ai.answer;
    sugerencias = separada.sugerencias;
    necesitaAsesor = separada.asesor;
    // Lo que la IA no encontró en la información oficial: para completar el catálogo.
    if (separada.sinDato) await registrarNoReconocido('ia_sin_dato', texto);
    consultado = programaDeLaConsulta(ai.programaConsultado);
    if (ai.usedTool) await track('ai_used_tool', { area });
    await track('ai_resolved', { area });
  } catch (err) {
    console.error('[conversacion] IA:', err instanceof AIUnavailableError ? err.reason : 'error');
    await track('ai_failed', { area, reason: err instanceof AIUnavailableError ? err.reason : 'unknown' });
    await registrarIncidencia('ia', `La IA no respondió en la conversación (${err instanceof AIUnavailableError ? err.reason : 'error'}); se ofreció un asesor`);
    await guardarSesion(from, { ...conPerfil, pendiente: 'ofrecer' });
    await messaging.sendButtons({
      to: from, title: TITULO, description: IA_NO_DISPONIBLE, footer: PIE,
      buttons: [BOTON_ASESOR],
    });
    return;
  }

  // Si la IA habló de un programa, primero su flyer con lo esencial (una vez por conversación).
  const vistas = (conPerfil.fotosVistas ?? '').split(',').filter(Boolean);
  if (consultado && !vistas.includes(consultado.id)) {
    if (await enviarFlyerPrograma(from, consultado, pieFlyer(consultado))) vistas.push(consultado.id);
    await esperarFlyers(from);
  }

  const botones = botonesSugeridos(sugerencias, area, texto);
  const turnos = (Number.parseInt(conPerfil.aiTurnCount ?? '0', 10) || 0) + 1;
  const nuevo: SessionData = {
    ...conPerfil,
    aiHistory: JSON.stringify([...anterior, { role: 'user', content: texto.trim() }, { role: 'assistant', content: respuesta }]),
    aiTurnCount: String(turnos),
    preguntaInicial: '',
    fotosVistas: vistas.slice(-10).join(','),
    ...(consultado ? { programaInteres: consultado.id } : {}),
  };

  // La IA marcó que esto lo resuelve mejor una persona: se ofrece el asesor (una vez por conversación).
  if (necesitaAsesor && conPerfil.asesorOfrecido !== '1') {
    await track('conv_asesor_sugerido');
    await messaging.sendText({ to: from, text: respuesta });
    await guardarSesion(from, { ...nuevo, asesorOfrecido: '1' });
    await messaging.sendButtons({
      to: from, title: TITULO, description: OFRECER_ASESOR, footer: PIE, buttons: [...BOTONES_OFRECER_ASESOR],
    });
    return;
  }

  if (turnos === TURNOS_ANTES_DE_ASESOR) {
    await messaging.sendText({ to: from, text: respuesta });
    await guardarSesion(from, { ...nuevo, pendiente: 'ofrecer' });
    await messaging.sendButtons({
      to: from, title: TITULO, description: SUGERIR_ASESOR, footer: PIE, buttons: [BOTON_ASESOR],
    });
    return;
  }
  // Pregunta ignorada una vez: solo se responde (con sugerencias) y la pregunta sigue pendiente.
  if (conPerfil.pendiente && conPerfil.saltada !== '1') {
    await guardarSesion(from, { ...nuevo, saltada: '1' });
    await enviarConSugerencias(from, respuesta, botones);
    await seguirSiNoContesta(from, nuevo, conPerfil.pendiente);
    return;
  }
  // Si falta algo, después de la respuesta va la pregunta: esa es la interacción de este turno.
  const falta = siguientePregunta(nuevo);
  const ofrecer = !falta && nuevo.ofrecido !== '1' && nuevo.sinPregrado !== '1';
  if (falta || ofrecer) {
    await messaging.sendText({ to: from, text: respuesta });
    return falta ? preguntar(from, nuevo, falta) : preguntar(from, { ...nuevo, ofrecido: '1' }, 'ofrecer');
  }
  await guardarSesion(from, { ...nuevo, pendiente: '', saltada: '' });
  await enviarConSugerencias(from, respuesta, botones);
}

// ── Desde cualquier paso ────────────────────────────────────────────────────

/**
 * BAJA revoca la autorización en cualquier paso, como promete el mensaje de
 * autorización: queda la constancia en "no", sale de las campañas y se confirma.
 */
export async function atenderBaja(from: string, data: SessionData): Promise<void> {
  await track('info_baja');
  try {
    await darDeBaja(from);
  } catch (err) {
    console.error('[conversacion] no se pudo registrar la baja:', describeExternalError(err));
  }
  await registrarDecision(from, 'no');
  await guardarSesion(from, { ...soloConsentimiento(data), ...lugar(data), datos: 'no', info: 'no', pendiente: '' });
  await messaging.sendText({ to: from, text: CONFIRMACION_BAJA });
}

/** Lo que se sabe de la persona (sin la autorización), para seguir donde iba. */
function lugar(data: SessionData): SessionData {
  const { relacion, pregradoId, familiaId, nivel, nivelListo, sinPregrado: sin } = data;
  return Object.fromEntries(Object.entries({ relacion, pregradoId, familiaId, nivel, nivelListo, sinPregrado: sin })
    .filter(([, v]) => v)) as SessionData;
}

/**
 * Una pregunta escrita en un paso de lista (nivel, confirmar carrera…): la IA la
 * responde con el contexto que haya y la persona sigue con la lista de arriba.
 * Si hace falta una persona, se ofrece el asesor.
 */
export async function responderPreguntaSuelta(from: string, data: SessionData, texto: string, sigue = SIGUE_ARRIBA): Promise<void> {
  await track('ai_request', { area: 'posgrados' });
  try {
    const ai = await preguntarAI('posgrados', texto.trim(), [], resumenRecomendacion(data) ?? undefined, INSTRUCCION_SUGERENCIAS, { frecuentes: true });
    if (ai.reutilizada) await track('ai_reutilizada', { area: 'posgrados' });
    if (ai.corregida) await track('ia_corregida', { area: 'posgrados' });
    const separada = separarSugerencias(ai.answer);
    await track('ai_resolved', { area: 'posgrados' });
    if (separada.sinDato) await registrarNoReconocido('ia_sin_dato', texto);
    await messaging.sendText({ to: from, text: `${separada.texto || ai.answer}\n\n${sigue}` });
    if (separada.asesor) {
      await track('conv_asesor_sugerido');
      await messaging.sendButtons({ to: from, title: TITULO, description: OFRECER_ASESOR, footer: PIE, buttons: [...BOTONES_OFRECER_ASESOR] });
    }
  } catch (err) {
    await track('ai_failed', { area: 'posgrados', reason: err instanceof AIUnavailableError ? err.reason : 'unknown' });
    await registrarIncidencia('ia', `La IA no respondió una pregunta en un paso de lista (${err instanceof AIUnavailableError ? err.reason : 'error'})`);
    await messaging.sendText({ to: from, text: `${IA_NO_DISPONIBLE}\n\n${sigue}` });
  }
}

/**
 * Mensajes sin una pregunta que responder: "espera", ruido ("mmm", "😂"),
 * confusión ("no entiendo"), quejas y datos personales sueltos. Ninguno va a la
 * IA (los datos personales nunca); se repite la pregunta pendiente o se ofrece
 * qué hacer. Devuelve si lo atendió.
 */
async function atenderSinPregunta(from: string, data: SessionData, texto: string, pendiente: Pendiente | ''): Promise<boolean> {
  const area = data.sinPregrado === '1' ? 'admisiones' : 'posgrados';
  const ofrecerOpciones = async (prefijo: string, conDatos: SessionData = data) => {
    if (pendiente) return preguntar(from, conDatos, pendiente, prefijo);
    await guardarSesion(from, conDatos);
    await messaging.sendButtons({
      to: from, title: '', description: `${prefijo}\n\n${SIN_PREGUNTA_PENDIENTE}`.trim(), footer: PIE_SUGERENCIAS,
      buttons: botonesSugeridos([], area),
    });
  };
  if (esEspera(texto)) {
    await messaging.sendText({ to: from, text: ESPERO });
    return true;
  }
  if (esQueja(texto)) {
    await track('conv_asesor_sugerido');
    await registrarNoReconocido('queja', texto);
    await guardarSesion(from, { ...data, asesorOfrecido: '1' });
    await messaging.sendButtons({ to: from, title: TITULO, description: QUEJA, footer: PIE, buttons: [...BOTONES_OFRECER_ASESOR] });
    return true;
  }
  if (esConfusion(texto)) {
    await registrarNoReconocido('confusion', `${texto} · ${pendiente ? `al preguntar «${PREGUNTAS[pendiente]?.texto.slice(0, 50) ?? pendiente}»` : 'sin pregunta pendiente'}`);
    await ofrecerOpciones(pendiente ? TE_EXPLICO : '');
    return true;
  }
  // "0" o "volver" en la conversación: no hay un paso atrás; se repite la pregunta o se ofrecen opciones.
  if (parseGlobalCommand(texto) === 'volver') { await ofrecerOpciones(pendiente ? 'Listo 👍' : ''); return true; }
  if (esRuido(texto)) { await ofrecerOpciones(pendiente ? SEGUIMOS : ''); return true; }
  const dato = datoPersonal(texto);
  if (!dato) return false;
  if (dato.tipo === 'correo') {
    if (data.datos === 'si') await ofrecerOpciones(correoAnotado(dato.valor), { ...data, correo: dato.valor });
    else await ofrecerOpciones(CORREO_SIN_AUTORIZACION);
    return true;
  }
  await ofrecerOpciones(dato.tipo === 'telefono' ? TELEFONO_YA : DOCUMENTO_NO);
  return true;
}

/** En un paso de lista (flujo de recomendación): lo mismo, sin perder la lista de arriba. */
export async function atenderSinPreguntaEnLista(from: string, data: SessionData, texto: string): Promise<boolean> {
  if (esEspera(texto)) {
    await messaging.sendText({ to: from, text: ESPERO });
    return true;
  }
  if (esQueja(texto)) {
    await track('conv_asesor_sugerido');
    await registrarNoReconocido('queja', texto);
    await messaging.sendButtons({ to: from, title: TITULO, description: QUEJA, footer: PIE, buttons: [...BOTONES_OFRECER_ASESOR] });
    return true;
  }
  const dato = datoPersonal(texto);
  const aviso = esConfusion(texto) ? 'Perdón si no fui claro 🙏'
    : esRuido(texto) ? SEGUIMOS
      : dato?.tipo === 'telefono' ? TELEFONO_YA : dato?.tipo === 'documento' ? DOCUMENTO_NO
        : dato?.tipo === 'correo' ? (data.datos === 'si' ? correoAnotado(dato.valor) : CORREO_SIN_AUTORIZACION) : null;
  if (!aviso) return false;
  if (dato?.tipo === 'correo' && data.datos === 'si') {
    await completarPerfil(from, { correo: dato.valor, datos: 'si' }).catch(() => undefined);
  }
  await messaging.sendText({ to: from, text: `${aviso}\n\n👆 Elige una opción de arriba o escríbeme tu pregunta.` });
  return true;
}

/** Un "gracias" o "👍" en un paso de lista: se agradece sin tomarlo como opción inválida. */
export async function agradecer(from: string): Promise<void> {
  await messaging.sendText({ to: from, text: CON_GUSTO });
}

/**
 * Una pregunta desde las recomendaciones o la ficha sigue en la conversación:
 * la responde la misma IA, con sugerencias, flyer del programa y asesor si hace falta.
 */
export async function responderEnConversacion(from: string, data: SessionData, texto: string): Promise<void> {
  const enConversacion: SessionData = { ...data, pendiente: '', saltada: '', ofrecido: '1', modo: '' };
  await guardarSesion(from, enConversacion);
  return responderConIa(from, enConversacion, texto);
}

/** "🤖 Preguntar a la IA" desde las recomendaciones: sigue en la conversación. */
export async function abrirPreguntasEnConversacion(from: string, data: SessionData): Promise<void> {
  await guardarSesion(from, { ...data, pendiente: '', saltada: '', ofrecido: '1', modo: '' });
  await messaging.sendText({
    to: from,
    text: '🤖 Pregúntame lo que quieras sobre estos programas: requisitos, plan de estudios, diferencias, horarios o financiación 👇',
  });
}

// ── Entrada ─────────────────────────────────────────────────────────────────

export async function handleConversacion(ctx: FlowContext): Promise<void> {
  const { from, text, session } = ctx;
  // Sin sesión (pasó más de una hora) se parte de lo que se recuerda de la última vez.
  // Sin sesión es una conversación nueva (primera vez o más de una hora después).
  if (!session) await track('conv_inicio');
  const perfil = session ? null : await perfilGuardado(from);
  const data: SessionData = { ...(session?.data ?? perfil ?? {}) };
  const saludo = session ? undefined : perfil ? saludoCortoRegreso(perfil.nombre) : SALUDO_CORTO;
  if (!session) {
    const decision = await decisionGuardada(from);
    if (decision) data.datos = decision;
    // La pregunta que quedó sin contestar vale hasta un día después; un saludo empieza de cero.
    if (!pendienteVigente(data) || esSaludo(text)) data.pendiente = '';
    delete data.pendienteEn;
  }
  // Una sesión reiniciada por otro paso (el asesor, el menú anterior) no trae la
  // decisión sobre los datos: se recupera para no volver a pedir autorización ni nombre.
  if (session && !data.datos) Object.assign(data, await conLoRecordado(from, data).catch(() => data));
  // Quien ya respondió lo de recibir información decidió también sobre sus datos.
  if (!data.datos && data.info) data.datos = data.info;

  // La primera vez que escribe, antes de todo, la autorización de datos (Ley 1581).
  if (!session && !data.datos && !esBaja(text)) return pedirAutorizacion(from, data, text);

  const comando = parseGlobalCommand(text);
  if (comando === 'menu' || comando === 'salir') return reiniciar(from, data);
  if (esPedidoAsesor(text)) return pedirConsentimiento(from, { ...data, pendiente: '' });
  if (esBaja(text)) return atenderBaja(from, data);

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

  // Una foto no es el nombre, la carrera ni una pregunta: se avisa y se repite lo pendiente.
  if (text === '__image__') {
    await registrarNoReconocido('imagen', 'una imagen');
    const pendienteImagen = (data.pendiente ?? '') as Pendiente | '';
    if (pendienteImagen && PREGUNTAS[pendienteImagen]) return preguntar(from, data, pendienteImagen, IMAGEN_NO);
    await messaging.sendText({ to: from, text: IMAGEN_NO });
    return;
  }

  // Una pregunta sugerida tocada es una pregunta escrita: va directo a la IA.
  const sugerencia = parseSugerencia(text);
  if (sugerencia) {
    await track('conv_sugerencia');
    return responderConIa(from, data, sugerencia, saludo);
  }

  const boton = parseBoton(text);
  if (boton) return atenderBoton(from, data, boton);

  let pendiente = (data.pendiente ?? '') as Pendiente | '';
  let texto = text;

  // Pidió cambiar el nombre y se le preguntó cuál: lo escrito es el nombre nuevo.
  if (pendiente === 'nombre_nuevo') {
    const antes = (data.pendienteAntes ?? '') as Pendiente | '';
    const dicho = cambioDeNombre(text);
    const nombre = dicho && 'nombre' in dicho ? dicho.nombre : pareceUnaPregunta(text) ? null : limpiarNombre(text);
    if (nombre) {
      const cambio = await cambiarNombre(from, { ...data, pendiente: antes, pendienteAntes: '' }, nombre);
      if (cambio) return seguirTrasNombre(from, cambio.data, cambio.aviso);
      return;
    }
    if (!pareceUnaPregunta(text)) {
      await messaging.sendText({ to: from, text: PEDIR_NOMBRE_VALIDO });
      return;
    }
    // Una pregunta en vez del nombre: se responde y se sigue con lo de antes.
    data.pendiente = antes;
    data.pendienteAntes = '';
    pendiente = antes;
  }

  // "Me llamo Laura", "ese no es mi nombre, soy Laura": el nombre se cambia en cualquier momento.
  // Al pedir el nombre para el registro lo atiende ese paso, y antes de autorizar no se toma.
  const nombreDicho = pendiente !== 'nombre_info' && pendiente !== 'datos' && data.datos ? cambioDeNombre(text) : null;
  if (nombreDicho && 'pedir' in nombreDicho) return preguntar(from, { ...data, pendienteAntes: pendiente }, 'nombre_nuevo');
  if (nombreDicho) {
    const cambio = await cambiarNombre(from, data, nombreDicho.nombre);
    if (!cambio) return;
    if (!nombreDicho.resto) return seguirTrasNombre(from, cambio.data, cambio.aviso);
    // "Me llamo Laura, estudio derecho": se confirma el nombre y se sigue con lo demás.
    await messaging.sendText({ to: from, text: cambio.aviso });
    Object.assign(data, cambio.data);
    texto = nombreDicho.resto;
  }

  // Lo que cuenta de sí (relación, carrera, nivel) se anota en cualquier respuesta: no se vuelve a preguntar.
  const dicho = pendiente === 'datos' ? { data, avisos: [], novedad: false, relacion: false, buscaNivel: false } : conLoQueDijo(data, texto, pendiente);
  const conDicho = dicho.data;
  const confirmar = async () => {
    if (dicho.avisos.length) await messaging.sendText({ to: from, text: dicho.avisos.join('\n') });
  };

  const escrita = interpretarRespuestaEscrita(pendiente, texto);
  // "Egresado de otra universidad": la relación dicha vale más que el botón que parece.
  if (dicho.relacion && (pendiente === 'estudia_utb' || pendiente === 'egresado') && !pareceUnaPregunta(texto)) {
    await confirmar();
    return continuar(from, { ...conDicho, pendiente: '' });
  }
  if (escrita && 'boton' in escrita) {
    await confirmar();
    return atenderBoton(from, conDicho, escrita.boton);
  }
  if (escrita && 'nivel' in escrita) {
    await confirmar();
    return continuar(from, { ...conDicho, nivel: escrita.nivel, nivelListo: '1', ...(escrita.virtual ? { pideVirtual: '1' } : {}) });
  }

  // Un saludo con una pregunta pendiente la repite: no es el nombre ni la carrera.
  if (pendiente && session && esSaludo(texto) && pendiente !== 'datos') {
    return preguntar(from, data, pendiente, saludoCortoRegreso(data.nombre));
  }
  // Ruido, espera, confusión, quejas y datos sueltos: no son nombre ni carrera, ni van a la IA.
  if (await atenderSinPregunta(from, data, texto, pendiente)) return;

  if (pendiente === 'nombre_info' && !pareceUnaPregunta(texto)) {
    const presentado = cambioDeNombre(texto);
    const nombre = presentado && 'nombre' in presentado ? presentado.nombre : limpiarNombre(texto);
    if (!nombre) {
      // "Estudio derecho" en vez del nombre: se anota la carrera y se vuelve a pedir el nombre.
      if (dicho.novedad) {
        await confirmar();
        return preguntar(from, conDicho, 'nombre_info');
      }
      await messaging.sendText({ to: from, text: PEDIR_NOMBRE_VALIDO });
      return;
    }
    await confirmar();
    return registrarSuscripcion(from, conDicho, nombre);
  }

  if (pendiente === 'pregrado' && !pareceUnaPregunta(texto)) {
    const n = texto.trim().toLowerCase();
    if (n === 'lista' && data.relacion && data.relacion !== 'externo') {
      await setSession(from, { step: 'reco_pregrado_grupo', data: { relacion: data.relacion } });
      await enviarGrupos(from);
      return;
    }
    // Lo demás que dijo junto a la carrera ("estudio derecho en la UTB") también queda.
    return atenderPregrado(from, conDicho, texto);
  }

  // Contó algo de sí sin preguntar nada ("estudio sistemas", "busco una maestría"): se anota y se
  // sigue con lo que falta, sin la IA.
  if (dicho.novedad && (dicho.buscaNivel || soloCuentaDatos(texto))) {
    await confirmar();
    return continuar(from, { ...conDicho, pendiente: '' });
  }

  // Un saludo suelto al empezar: presentación y primera pregunta. Quien vuelve retoma.
  if (esSaludo(texto)) {
    if (pendiente === 'datos') return preguntar(from, data, 'datos');
    const carrera = perfil ? carreraDe(perfil) : null;
    if (perfil && carrera) return ofrecerRetomar(from, data, carrera);
    if (!session || (!data.aiHistory && !data.relacion)) {
      // Empieza con lo que ya se sabe; si no tenía pregrado, se le vuelve a preguntar.
      const conocido = perfilDeDatos(data);
      delete conocido.sinPregrado;
      return sendMenu(from, conocido);
    }
    // Ya venía conversando: se presenta otra vez y recuerda de qué puede preguntar, sin la IA.
    return saludarEnConversacion(from, data);
  }
  // A la IA va con lo que ya se sabía: responderConIa anota (y confirma) lo que la frase trae.
  return responderConIa(from, data, texto, saludo);
}
