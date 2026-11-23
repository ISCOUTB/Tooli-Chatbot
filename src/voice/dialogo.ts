// Un turno de la conversación: recibe lo que dijo quien llama y el estado, decide en el SERVIDOR qué hacer y arma lo
// que se dice. Reemplaza dialog.ts + engine.ts de FastFood (dominio restaurante) con el de Tooli: posgrados, datos del
// estudiante verificado y asesor (transferencia, agenda o devolución). Sin red propia: todo llega por `DepsTurno`
// (contratos AcademicoApi y AgendaApi por inyección, IA por inyección), así el simulador y las pruebas usan el mismo
// motor que la llamada real.
import type { AcademicoApi, ResultadoConfirmacion, ResultadoEnvioVerificacion, TipoConsulta } from '../contratos/academico';
import type { AgendaApi, AreaAgenda, Cita } from '../contratos/agenda';
import { crearCodigoWhatsAppVoz, pendientesVozEnMemoria, type CodigoWhatsAppVoz } from '../services/academico/verificacionVoz';
import { entender, entenderPorReglas, type ClienteIa, type Intencion } from './entender';
import {
  getPosgrado, listaAreaHablada, listaHablada, nivelesMencionados, nombreHablado, programaPorNombre, programasDeAreas,
  programasMencionados, respuestaAspectos, respuestaPrograma,
} from './posgrados';
import {
  INJECTION_REPLY, cleanForSpeech, codigoEstudiantilDictado, digitosDictados, fechaHablada, isCallbackRequest, isExplicitNo,
  isExplicitYes, isGoodbye, isHoldRequest, isHumanRequest, isNoiseOnly, isRepeatRequest, lineCheck, looksLikeInjection,
  normalizeSpeech, palabrasConContenido, sanitizeCallerText, soloDictado,
} from './texto';
import { DIALOGO_VACIO, type Accion, type EstadoDialogo, type Resultado } from './tipos';
import type { Genero } from './ajustes';

export interface DepsTurno {
  academico: AcademicoApi | null;
  agenda: AgendaApi | null;
  ia: ClienteIa | null;
  /**
   * Código por WhatsApp: pasa por el almacén atómico del código al correo (espera, topes por hora y por día, bloqueo e
   * intentos atómicos; issue #34). El manejador pone siempre uno compartido; sin él (pruebas que llaman `correrTurno`
   * directo) se usa uno en memoria por cada objeto de dependencias.
   */
  codigoWhatsApp?: CodigoWhatsAppVoz;
  /** Manda el código de verificación al WhatsApp vinculado. false = no se pudo. */
  enviarCodigo: (telefono: string, codigo: string) => Promise<boolean>;
  /** Manda un texto por WhatsApp al número que llama (p. ej. cómo seguir con el recibo). Sin esto no se ofrece. */
  enviarWhatsApp?: (telefono: string, texto: string) => Promise<boolean>;
  generarCodigo?: () => string;
  /** Secreto para la huella del código (nunca se guarda el código en claro). Vacío = no se verifica por voz. */
  secreto: string;
  ahora: () => Date;
  /** Número que llama (E.164 sin '+', como en los flujos de WhatsApp). */
  telefonoLlamante: string;
  /** En horario de asesores y con número de desvío: se puede transferir en vivo. */
  asesoresEnVivo: boolean;
  /** true en el simulador: la cita no se reserva de verdad (la agenda inyectada ya es simulada). */
  simulada?: boolean;
  /** Género de la voz: «el asistente» o «la asistente» (el manejador lo pone según la voz elegida; por defecto, 'm'). */
  generoAgente?: Genero;
  timeoutIaMs?: number;
}

export interface ResultadoTurno {
  respuesta: string;
  accion: Accion;
  estado: EstadoDialogo;
  resultado?: Resultado;
  /** Se leyeron datos académicos (la transcripción guarda solo «[datos académicos leídos: …]», no lo leído). */
  datosLeidos?: TipoConsulta;
  /** Nota corta para el panel (transferencia, cita, devolución). */
  aviso?: string | null;
  cita?: Cita | null;
  /** Usó (o descartó) los dígitos que venían de frases anteriores: el manejador los borra. */
  dictadoUsado?: boolean;
  /**
   * La verificación por voz no se pudo ofrecer: 'espera' = marca de 60 s o tope de códigos por hora; 'tope_dia' = 10
   * envíos al correo o al WhatsApp en un día (sin verificación por voz hasta 24 h); 'bloqueado' = se agotaron los
   * intentos varias veces (1 h). El panel lo muestra (#35).
   */
  verificacionNegada?: 'espera' | 'tope_dia' | 'bloqueado';
}

export interface OpcionesTurno {
  /** Dígitos de las frases anteriores que eran solo un dictado (el código partido en varias frases, punto 13). */
  digitosPrevios?: string;
}

const OTP_TTL_MS = 10 * 60_000;
const MAX_INTENTOS_OTP = 3;
const MAX_INTENTOS_CODIGO = 3;

const MENU = 'Te puedo contar de los posgrados de la UTB, consultar tus datos de estudiante o comunicarte con un asesor. ¿Qué necesitas?';

const NOMBRE_CONSULTA: Record<TipoConsulta, string> = {
  notas: 'tus notas', recibo: 'tu recibo de matrícula', turno: 'tu turno', horario: 'tu horario', cursos: 'tus cursos',
};

const respaldoCodigos = new WeakMap<DepsTurno, CodigoWhatsAppVoz>();
function codigosDe(deps: DepsTurno): CodigoWhatsAppVoz {
  if (deps.codigoWhatsApp) return deps.codigoWhatsApp;
  let c = respaldoCodigos.get(deps);
  if (!c) {
    c = crearCodigoWhatsAppVoz(pendientesVozEnMemoria());
    respaldoCodigos.set(deps, c);
  }
  return c;
}

const digitos = (t: string) => t.replace(/\D/g, '');

/** «el asistente virtual» o «la asistente virtual», según el género de la voz elegida. */
export const asistenteVirtual = (genero: Genero = 'm') => (genero === 'f' ? 'la asistente virtual' : 'el asistente virtual');

/** Saludo con aviso de transcripción (y grabación si aplica), como en FastFood, más la retención por Ley 1581. */
export function textoSaludo(args: { saludo: string; nombreAgente: string; grabar: boolean; retencionDias: number; genero?: Genero }): string {
  const hola = args.saludo.trim() || `Hola, gracias por llamar a Posgrados de la UTB. Te atiende ${args.nombreAgente}, ${asistenteVirtual(args.genero)}.`;
  const aviso = args.grabar
    ? ` Esta llamada se graba y se transcribe para atenderte, y se guarda ${args.retencionDias} días.`
    : ` Esta llamada se transcribe para atenderte, y se guarda ${args.retencionDias} días.`;
  return cleanForSpeech(`${hola}${aviso} Si prefieres hablar con un asesor, dilo cuando quieras. ¿En qué te ayudo?`);
}

/** Frase puente: se dice al instante si pensar tarda (IA, datos académicos, agenda). */
export const FRASES_PUENTE = ['Claro, déjame revisar.', 'Un momento, ya lo busco.', 'Dame un segundo, lo reviso.'];
export function frasePuente(turno: number): string {
  return FRASES_PUENTE[Math.abs(turno) % FRASES_PUENTE.length];
}

export const SIGUES_AHI = '¿Sigues ahí? Si necesitas algo, dímelo.';
export const DESPEDIDA_SILENCIO = 'Como no te escucho, voy a colgar. Si necesitas algo, vuelve a llamar o escríbenos por WhatsApp. ¡Que estés muy bien!';
export const DESPEDIDA = '¡Con gusto! Que tengas un excelente día.';

// ------------------------------------------------------------------ el turno

export async function correrTurno(textoCrudo: string, estadoPrevio: EstadoDialogo, deps: DepsTurno, opciones: OpcionesTurno = {}): Promise<ResultadoTurno> {
  const texto = sanitizeCallerText(textoCrudo);
  let s: EstadoDialogo = { ...DIALOGO_VACIO, ...estadoPrevio, turnos: estadoPrevio.turnos + 1 };
  const fin = (respuesta: string, extra: Partial<ResultadoTurno> = {}): ResultadoTurno => {
    const limpio = cleanForSpeech(respuesta);
    // Con la respuesta se guarda si leyó datos: «repítemelo» los repite con el mismo marcador en la transcripción.
    return { respuesta: limpio, accion: 'none', ...extra, estado: { ...(extra.estado ?? s), ultimaRespuesta: limpio, ultimaDatos: extra.datosLeidos ?? null } };
  };

  // «¿Aló?», «¿me escucha?», «¿hay alguien?»: se contesta corto y se sigue donde se iba, sin reiniciar ni contar fallo.
  const linea = lineCheck(texto);
  if (linea === 'corta' || (linea === 'al_final' && ['otro', 'saludo'].includes(entenderPorReglas(texto).herramienta))) {
    return soloDecir(`Sí, te escucho. ${preguntaPendiente(s)}`, s);
  }

  if (isNoiseOnly(texto)) {
    s = { ...s, fallos: s.fallos + 1 };
    if (s.fallos >= 3) return ofrecerAsesor(s, deps, 'Disculpa, no te estoy escuchando bien.', fin);
    return fin('Perdona, no te escuché bien. ¿Me lo repites?');
  }

  // Intentos de cambiar las reglas o de sacar datos de otra persona: texto fijo, nunca llegan a la IA.
  if (looksLikeInjection(texto)) {
    s = { ...s, inyecciones: s.inyecciones + 1 };
    if (s.inyecciones >= 3) return fin(`${INJECTION_REPLY.split('.')[0]}. Voy a terminar la llamada. ¡Hasta luego!`, { accion: 'hangup' });
    return fin(INJECTION_REPLY);
  }

  // Soporte técnico (clave, no puede entrar…): si termina en cita, va a TI. Se recuerda durante la llamada.
  if (!s.soporte && PIDE_SOPORTE.test(normalizeSpeech(texto))) s = { ...s, soporte: true };

  if (isGoodbye(texto)) return fin(DESPEDIDA, { accion: 'hangup' });
  // Repetir lo que leyó datos académicos vuelve a marcarlo: la transcripción guarda el marcador, nunca lo leído (#33).
  if (isRepeatRequest(texto) && s.ultimaRespuesta) {
    return { respuesta: s.ultimaRespuesta, accion: 'none', estado: s, ...(s.ultimaDatos ? { datosLeidos: s.ultimaDatos } : {}) };
  }
  // «Espere», «un momento», «ya voy»: se espera sin cambiar nada (tampoco cancela lo que estaba por confirmar).
  if (isHoldRequest(texto)) return soloDecir('Claro, aquí te espero.', s);

  // Fases que esperan algo concreto.
  const t = normalizeSpeech(texto);
  switch (s.fase) {
    case 'pide_otp': {
      if (isHumanRequest(texto) || isCallbackRequest(texto)) break;
      const dig = digitosDictados(texto);
      const previos = opciones.digitosPrevios ?? '';
      // El código puede llegar partido en frases seguidas («cuatro ocho dos» / «nueve uno tres»).
      const codigo = dig.length === 6 ? dig : previos && (previos + dig).length === 6 ? previos + dig : null;
      if (codigo) return { ...(await verificarOtp(codigo, s, deps, fin)), dictadoUsado: true };
      if (dig.length && (previos + dig).length < 6 && soloDictado(texto)) return soloDecir('Ajá, sigue.', s);
      if (previos) return { ...fin('Se me mezclaron los números. Dime los seis dígitos del código otra vez, por favor.'), dictadoUsado: true };
      if (/\b(no (me )?(llego|ha llegado)|no tengo|no lo tengo|no puedo|reenvia|otra vez el codigo)\b/.test(t)) {
        return ofrecerAsesor({ ...s, fase: 'libre', verificacion: null }, deps, 'Entiendo.', fin);
      }
      const donde = s.verificacion?.canal === 'correo' ? 'a tu correo institucional' : 'al WhatsApp';
      return fin(`Necesito los seis dígitos del código que te llegó ${donde}. Díctamelos uno por uno, por favor.`);
    }
    case 'pide_codigo_estudiantil': {
      if (isHumanRequest(texto) || isCallbackRequest(texto)) break;
      const codigo = codigoEstudiantilDictado(texto);
      if (!codigo) {
        if (isExplicitNo(texto) || /\bno (me lo se|lo se|lo tengo|recuerdo)\b/.test(t)) {
          return ofrecerAsesor({ ...s, fase: 'libre', consultaPendiente: null }, deps, 'No hay problema.', fin);
        }
        return fin('Tu código estudiantil empieza por la letra T y tiene ocho números. Díctamelo, por favor.');
      }
      return buscarYEnviarCodigo(codigo, s, deps, fin);
    }
    case 'elige_programa': {
      const elegido = elegirCandidato(texto, s.candidatos);
      if (elegido) {
        const p = getPosgrado(elegido);
        if (p) {
          const r = respuestaPrograma(p, 'general');
          return fin(r.texto, { estado: { ...s, fase: r.ofreceAsesor ? 'ofrece_asesor' : 'libre', programa: p.id, candidatos: [] }, resultado: 'consulta' });
        }
      }
      s = { ...s, fase: 'libre', candidatos: [] };
      break;
    }
    case 'elige_franja': {
      if (isHumanRequest(texto) || isCallbackRequest(texto)) break;
      const i = elegirFranja(texto, s.franjas.map((f) => f.inicio));
      if (i === null) {
        if (isExplicitNo(texto) || /\bninguna\b/.test(t)) return ofrecerDevolucion({ ...s, fase: 'libre', franjas: [] }, 'Listo.', fin);
        // Cambió de tema («¿y eso es virtual?», «mis notas»): se atiende; las franjas se pueden pedir otra vez.
        if (!['otro', 'saludo', 'asesor', 'identidad'].includes(entenderPorReglas(texto).herramienta)) {
          s = { ...s, fase: 'libre', franjas: [], franjaElegida: null };
          break;
        }
        return fin(`Dime cuál te sirve: ${s.franjas.map((f, k) => `${ORDINAL[k]}, ${fechaHablada(f.inicio)}`).join('; ')}.`);
      }
      const f = s.franjas[i];
      return fin(`Te agendo con ${f.asesorNombre} el ${fechaHablada(f.inicio)}. ¿Lo confirmo?`, { estado: { ...s, fase: 'confirma_franja', franjaElegida: i } });
    }
    case 'confirma_franja': {
      if (isExplicitYes(texto)) return reservarFranja(s, deps, fin);
      if (isExplicitNo(texto)) return fin('Listo, no la agendo. ¿Te ayudo con algo más?', { estado: { ...s, fase: 'libre', franjas: [], franjaElegida: null } });
      const f = s.franjaElegida !== null ? s.franjas[s.franjaElegida] : null;
      if (!f) { s = { ...s, fase: 'libre' }; break; }
      // Cualquier cosa que no sea un sí explícito vuelve a preguntar: nunca se agenda por una duda.
      return fin(`Para confirmar, dime sí o no: ¿te agendo con ${f.asesorNombre} el ${fechaHablada(f.inicio)}?`);
    }
    case 'ofrece_devolucion': {
      if (isExplicitYes(texto)) {
        return fin('Listo, un asesor te devolverá la llamada a este número en horario de atención. ¿Algo más en lo que te ayude?', {
          estado: { ...s, fase: 'libre' }, resultado: 'devolver_llamada', aviso: 'Pidió que le devuelvan la llamada',
        });
      }
      if (noSolo(texto)) return fin('Está bien. ¿Te ayudo con algo más?', { estado: { ...s, fase: 'libre' } });
      s = { ...s, fase: 'libre' };
      break;
    }
    case 'ofrece_whatsapp_recibo': {
      if (isExplicitYes(texto)) {
        let ok = false;
        try {
          ok = deps.enviarWhatsApp ? await deps.enviarWhatsApp(deps.telefonoLlamante, TEXTO_RECIBO_WHATSAPP) : false;
        } catch {
          ok = false;
        }
        if (ok) return fin('Listo, te escribí por WhatsApp. Ahí entra a Mi semestre y pide el recibo. ¿Te ayudo con algo más?', { estado: { ...s, fase: 'libre' } });
        return ofrecerAsesor({ ...s, fase: 'libre' }, deps, 'No pude escribirte por WhatsApp a este número.', fin);
      }
      if (noSolo(texto)) return fin('Está bien. ¿Te ayudo con algo más?', { estado: { ...s, fase: 'libre' } });
      s = { ...s, fase: 'libre' };
      break;
    }
    case 'ofrece_asesor': {
      if (isExplicitYes(texto)) return herramientaAsesor({ ...s, fase: 'libre' }, deps, fin);
      if (noSolo(texto)) return fin('Perfecto. ¿Te ayudo con algo más?', { estado: { ...s, fase: 'libre' } });
      s = { ...s, fase: 'libre' };
      break;
    }
    default:
      break;
  }

  const intencion = await entender(texto, { programaActual: s.programa }, deps.ia, deps.timeoutIaMs);
  return aplicarHerramienta(intencion, texto, s, deps, fin);
}

type Fin = (respuesta: string, extra?: Partial<ResultadoTurno>) => ResultadoTurno;

/**
 * «No» a lo que se le ofreció. «No, no es de notas, es de la homologación…» no es rechazar: trae otra pregunta, y se
 * atiende esa.
 */
function noSolo(texto: string): boolean {
  if (!isExplicitNo(texto)) return false;
  return palabrasConContenido(normalizeSpeech(texto)).length <= 4 || ['otro', 'saludo'].includes(entenderPorReglas(texto).herramienta);
}

/** Respuesta que no cambia nada del estado (ni la última respuesta, que «repite» debe seguir diciendo). */
function soloDecir(respuesta: string, s: EstadoDialogo): ResultadoTurno {
  return { respuesta: cleanForSpeech(respuesta), accion: 'none', estado: s };
}

/** Lo que la línea estaba esperando: la última pregunta, si había una fase en curso. */
function preguntaPendiente(s: EstadoDialogo): string {
  if (s.fase === 'libre' || !s.ultimaRespuesta) return '¿En qué te ayudo?';
  const pregunta = s.ultimaRespuesta.match(/¿[^¿?]*\?\s*$/)?.[0];
  // Si lo último leyó datos, nunca se repite entero (iría en claro a la transcripción): solo la pregunta.
  return pregunta ?? (s.ultimaDatos ? '¿En qué te ayudo?' : s.ultimaRespuesta);
}

const FUERA_TRAMITE = 'Eso no lo tengo en la información de posgrados que manejo por aquí, y prefiero no darte un dato equivocado.';
const FUERA_PREGRADO = 'Esta línea atiende los posgrados de la UTB: especializaciones, maestrías y doctorados. De pregrado no tengo la información.';
const identidad = (genero?: Genero) =>
  `Hablas con ${asistenteVirtual(genero)} de Posgrados de la UTB. Si prefieres un asesor, dímelo cuando quieras. ¿En qué te ayudo?`;

const ORDINAL = ['la primera', 'la segunda', 'la tercera'];

async function aplicarHerramienta(it: Intencion, texto: string, s: EstadoDialogo, deps: DepsTurno, fin0: Fin): Promise<ResultadoTurno> {
  const fin: Fin = (r, extra = {}) => fin0(r, { estado: s, ...extra });
  switch (it.herramienta) {
    case 'asesor':
      return herramientaAsesor({ ...s, fallos: 0 }, deps, fin);
    case 'devolucion':
      return herramientaDevolucion({ ...s, fallos: 0 }, deps, fin);
    case 'fuera_alcance': {
      const pregrado = it.fuera === 'pregrado';
      return ofrecerAsesor({ ...s, fallos: 0, pregrado: s.pregrado || pregrado }, deps, pregrado ? FUERA_PREGRADO : FUERA_TRAMITE, fin);
    }
    case 'identidad':
      return fin(identidad(deps.generoAgente), { estado: { ...s, fallos: 0 } });
    case 'datos_estudiante':
      return herramientaDatos(it.tipo, { ...s, fallos: 0 }, deps, fin, it.codigo ?? null);
    case 'listar_programas': {
      if (it.areas?.length) {
        const progs = programasDeAreas(it.areas, nivelesMencionados(texto), /\bvirtual(es)?\b/.test(normalizeSpeech(texto)));
        // Con una sola opción, «¿y cuánto cuesta?» ya se refiere a ella.
        const programa = progs.length === 1 ? progs[0].id : s.programa;
        return fin(listaAreaHablada(it.areas, progs), { estado: { ...s, fallos: 0, programa }, resultado: 'consulta' });
      }
      return fin(listaHablada(it.nivel), { estado: { ...s, fallos: 0 }, resultado: 'consulta' });
    }
    case 'info_programa': {
      s = { ...s, fallos: 0 };
      if (it.inexistente) {
        return fin('No encuentro ese programa en la oferta de posgrados de la UTB. ¿Me dices el nombre de otra forma, o te comunico con un asesor?', { estado: { ...s, fase: 'ofrece_asesor' }, resultado: 'consulta' });
      }
      const aspectos = it.aspectos?.length ? it.aspectos : [it.aspecto];
      // Programa: el que dijo (validado contra el catálogo) o el que veníamos hablando.
      let candidatos = it.programa ? programaPorNombre(it.programa) : [];
      if (!candidatos.length) candidatos = programasMencionados(texto);
      if (!candidatos.length && it.programa) {
        return fin('No encuentro ese programa en la oferta de posgrados de la UTB. ¿Me dices el nombre de otra forma, o te comunico con un asesor?', { estado: { ...s, fase: 'ofrece_asesor' } });
      }
      if (candidatos.length > 1) {
        const ops = candidatos.map((p) => nombreHablado(p));
        return fin(`¿Te refieres a ${ops.slice(0, -1).join(', ')} o a ${ops[ops.length - 1]}?`, { estado: { ...s, fase: 'elige_programa', candidatos: candidatos.map((p) => p.id) } });
      }
      const p = candidatos[0] ?? getPosgrado(s.programa);
      if (!p) {
        // Preguntas generales sin programa: requisitos, financiación y fechas se pueden responder igual.
        const general = respuestaAspectos(null, aspectos, it.nivel);
        if (general) return fin(general.texto, { estado: { ...s, fase: general.ofreceAsesor ? 'ofrece_asesor' : s.fase }, resultado: 'consulta' });
        return fin('¿De qué posgrado me hablas? Por ejemplo, la maestría en administración o la especialización en finanzas.');
      }
      const r0 = respuestaAspectos(p, aspectos) ?? respuestaPrograma(p, it.aspecto);
      // Preguntó además por un trámite (visa, homologación…): lo que hay del catálogo, y lo demás con un asesor.
      const r = it.fuera === 'tramite'
        ? { texto: `${r0.texto.replace(/\s*¿[^¿?]*\?\s*$/, '')} Lo demás que preguntas no está en la información que manejo; te lo confirma un asesor. ¿Quieres que te comunique con uno?`, ofreceAsesor: true }
        : r0;
      return fin(r.texto, { estado: { ...s, programa: p.id, fase: r.ofreceAsesor ? 'ofrece_asesor' : 'libre' }, resultado: 'consulta' });
    }
    case 'saludo':
      return fin(`¡Hola! ${MENU}`);
    case 'otro':
    default: {
      s = { ...s, fallos: s.fallos + 1 };
      if (s.fallos >= 3) return ofrecerAsesor(s, deps, 'Creo que no te estoy entendiendo bien.', fin);
      return fin(s.fallos === 1 ? `Perdona, no te entendí. ${MENU}` : 'Dímelo con otras palabras, por ejemplo: «cuánto cuesta la maestría en finanzas», «quiero mis notas» o «quiero un asesor».');
    }
  }
}

// ------------------------------------------------------------------ datos del estudiante

async function herramientaDatos(tipo: TipoConsulta | null, s: EstadoDialogo, deps: DepsTurno, fin0: Fin, codigo: string | null = null): Promise<ResultadoTurno> {
  const fin: Fin = (r, extra = {}) => fin0(r, { estado: s, ...extra });
  if (codigo && !s.verificado) s = { ...s, codigoDictado: codigo };
  if (!tipo) return fin('¿Qué quieres consultar: tus notas, tu recibo, tu turno, tu horario o tus cursos?', { estado: s });
  if (!deps.academico) {
    return ofrecerAsesor(s, deps, 'En este momento no puedo consultar datos de estudiantes por teléfono.', fin);
  }
  if (s.verificado) return leerConsulta(s.verificado, tipo, s, deps, fin);
  // Sin número que llama (oculto o anónimo) no hay a qué atar el código ni sus topes: no se ofrece verificación (R4).
  if (!/^\d{7,15}$/.test(digitos(deps.telefonoLlamante))) {
    return ofrecerAsesor(
      { ...s, fase: 'libre', consultaPendiente: null, codigoDictado: null }, deps,
      'No me aparece el número desde el que llamas, y sin él no puedo verificarte por teléfono para darte datos de estudiante. Puedes llamar desde tu celular o escribirle a Tooli por WhatsApp.', fin,
    );
  }
  s = { ...s, consultaPendiente: tipo };
  // El número que llama: si está vinculado a un estudiante verificado, se le manda el código ahí mismo.
  let vinculado: Awaited<ReturnType<AcademicoApi['estudianteDe']>> = null;
  try {
    vinculado = await deps.academico.estudianteDe(deps.telefonoLlamante);
  } catch {
    vinculado = null;
  }
  // El número que llama se puede falsificar: aunque esté vinculado, NUNCA basta para leer datos. Se manda el código.
  if (vinculado) {
    return enviarOtp(vinculado.telefono, s, deps, fin, `Para proteger ${NOMBRE_CONSULTA[tipo]}, te mandé un código de seis dígitos al WhatsApp de este número.`);
  }
  if (s.intentosCodigoEstudiantil >= MAX_INTENTOS_CODIGO) return ofrecerAsesor(s, deps, 'No pude verificarte por aquí.', fin);
  // Ya dictó el código (en esta frase o antes): no se le pide otra vez.
  if (s.codigoDictado) return buscarYEnviarCodigo(s.codigoDictado, { ...s, codigoDictado: null, fase: 'pide_codigo_estudiantil' }, deps, fin);
  return fin(`Para consultar ${NOMBRE_CONSULTA[tipo]} primero te verifico. ¿Cuál es tu código estudiantil? Empieza por la letra T.`, { estado: { ...s, fase: 'pide_codigo_estudiantil' } });
}

async function buscarYEnviarCodigo(codigo: string, s: EstadoDialogo, deps: DepsTurno, fin0: Fin): Promise<ResultadoTurno> {
  const fin: Fin = (r, extra = {}) => fin0(r, { estado: s, ...extra });
  s = { ...s, intentosCodigoEstudiantil: s.intentosCodigoEstudiantil + 1 };
  const api = deps.academico!;
  const noSePudo = (): ResultadoTurno => {
    if (s.intentosCodigoEstudiantil >= MAX_INTENTOS_CODIGO) return ofrecerAsesor({ ...s, fase: 'libre', consultaPendiente: null }, deps, 'No pude verificarte con ese código.', fin);
    // No se dice si el código existe sin WhatsApp: solo que no se pudo verificar así.
    return fin('Con ese código no puedo verificarte por teléfono. Revisa que empiece por T y tenga ocho números, y dímelo otra vez.', { estado: s });
  };

  // Camino del contrato (servicio real): el código va al correo institucional y lo comprueba el servicio académico.
  if (api.iniciarVerificacionPorDato && api.confirmarVerificacion) {
    let r: ResultadoEnvioVerificacion;
    try {
      r = await api.iniciarVerificacionPorDato(deps.telefonoLlamante, { codigo });
    } catch {
      return ofrecerAsesor({ ...s, fase: 'libre' }, deps, 'No pude consultar el sistema en este momento.', fin);
    }
    if (r.estado === 'enviado') {
      const verificacion = {
        telefono: deps.telefonoLlamante, huella: '', expira: deps.ahora().getTime() + OTP_TTL_MS, intentos: 0, final: '', canal: 'correo' as const,
      };
      return fin('Te mandé un código de seis dígitos a tu correo institucional. Cuando te llegue, díctamelo.', { estado: { ...s, fase: 'pide_otp', verificacion } });
    }
    if (r.estado === 'espera') return { ...ofrecerAsesor({ ...s, fase: 'libre' }, deps, CODIGOS_RECIENTES, fin), verificacionNegada: 'espera' };
    if (r.estado === 'tope_dia') return { ...ofrecerAsesor({ ...s, fase: 'libre' }, deps, CODIGOS_DEL_DIA, fin), verificacionNegada: 'tope_dia' };
    // Bloqueo de una hora tras agotar los intentos: se dice tal cual y no se vuelve a pedir el código en esta llamada.
    if (r.estado === 'bloqueado') {
      const pausa = ofrecerAsesor({ ...s, fase: 'libre', consultaPendiente: null, intentosCodigoEstudiantil: MAX_INTENTOS_CODIGO }, deps, PAUSA_VERIFICACION, fin);
      return { ...pausa, verificacionNegada: 'bloqueado' };
    }
    if (r.estado === 'error') return ofrecerAsesor({ ...s, fase: 'libre' }, deps, 'No pude enviarte el código de verificación.', fin);
    return noSePudo();
  }

  // Sin esos métodos (fakes, simulador): WhatsApp vinculado, solo si es un número completo. El contrato real lo
  // devuelve enmascarado (****1234) y mandarle algo a eso sería mandarlo a un número equivocado.
  let r: Awaited<ReturnType<AcademicoApi['buscarParaVerificar']>>;
  try {
    r = await api.buscarParaVerificar({ codigo });
  } catch {
    return ofrecerAsesor({ ...s, fase: 'libre' }, deps, 'No pude consultar el sistema en este momento.', fin);
  }
  if (!r.encontrado || !r.telefonoVinculado || !/^\d{8,15}$/.test(r.telefonoVinculado)) return noSePudo();
  return enviarOtp(r.telefonoVinculado, s, deps, fin, 'Te mandé un código de seis dígitos al WhatsApp que tienes registrado');
}

const PAUSA_VERIFICACION = 'Hubo demasiados intentos de verificación, así que por seguridad la pausé. Puedes intentarlo de nuevo en una hora.';
// La espera es de 60 s o del tope por hora: se libera en menos de una hora. El del día se dice aparte.
const CODIGOS_RECIENTES = 'Ya se pidieron varios códigos de verificación, así que por seguridad no puedo mandar otro ahora. Vuelve a intentarlo más tarde.';
const CODIGOS_DEL_DIA = 'Hoy ya se pidieron demasiados códigos de verificación para ese estudiante, así que por seguridad no puedo mandar otro. Podrás intentarlo de nuevo mañana.';

async function enviarOtp(telefono: string, s: EstadoDialogo, deps: DepsTurno, fin0: Fin, intro: string): Promise<ResultadoTurno> {
  const fin: Fin = (r, extra = {}) => fin0(r, { estado: s, ...extra });
  // Espera, topes por hora y por día y bloqueo: en el almacén atómico compartido con el código al correo (#34).
  const envio = await codigosDe(deps).iniciar({
    llamante: deps.telefonoLlamante, destino: telefono, secreto: deps.secreto, ahora: deps.ahora().getTime(),
    enviar: deps.enviarCodigo, generarCodigo: deps.generarCodigo,
  });
  if (envio === 'espera') {
    const espera = ofrecerAsesor({ ...s, fase: 'libre' }, deps, 'Ya se mandaron códigos a ese WhatsApp hace poco, así que por seguridad no puedo mandar otro ahora.', fin);
    return { ...espera, verificacionNegada: 'espera' };
  }
  if (envio === 'tope_dia') {
    return { ...ofrecerAsesor({ ...s, fase: 'libre' }, deps, CODIGOS_DEL_DIA, fin), verificacionNegada: 'tope_dia' };
  }
  if (envio === 'bloqueado') {
    const pausa = ofrecerAsesor({ ...s, fase: 'libre', consultaPendiente: null, intentosCodigoEstudiantil: MAX_INTENTOS_CODIGO }, deps, PAUSA_VERIFICACION, fin);
    return { ...pausa, verificacionNegada: 'bloqueado' };
  }
  if (envio !== 'enviado') return ofrecerAsesor({ ...s, fase: 'libre' }, deps, 'No pude enviarte el código de verificación.', fin);
  const final = digitos(telefono).slice(-2);
  // El código y su huella viven en el almacén atómico; aquí solo a qué WhatsApp se mandó y hasta cuándo vale.
  const verificacion = {
    telefono, huella: '', expira: deps.ahora().getTime() + OTP_TTL_MS, intentos: 0, final, canal: 'whatsapp' as const,
  };
  const terminado = intro.endsWith('.') ? intro : `${intro}, el que termina en ${final.split('').join(' ')}.`;
  return fin(`${terminado} Cuando te llegue, díctamelo.`, { estado: { ...s, fase: 'pide_otp', verificacion } });
}

async function verificarOtp(dig: string, s: EstadoDialogo, deps: DepsTurno, fin0: Fin): Promise<ResultadoTurno> {
  const fin: Fin = (r, extra = {}) => fin0(r, { estado: s, ...extra });
  const v = s.verificacion;
  if (!v || deps.ahora().getTime() > v.expira) {
    return fin('Ese código ya venció. Si quieres, te mando uno nuevo: dime otra vez qué quieres consultar.', { estado: { ...s, fase: 'libre', verificacion: null } });
  }
  if (v.canal === 'correo') return confirmarPorCorreo(dig, v, s, deps, fin);
  // Comparar, contar el intento y consumir: un solo paso en el almacén (los intentos no viven en la llamada, R6).
  const r = await codigosDe(deps).confirmar({ llamante: deps.telefonoLlamante, destino: v.telefono, secreto: deps.secreto, codigo: dig, ahora: deps.ahora().getTime() });
  if (r === 'ok') {
    const listo = { ...s, fase: 'libre' as const, verificado: v.telefono, verificacion: null };
    if (listo.consultaPendiente) return leerConsulta(v.telefono, listo.consultaPendiente, { ...listo, consultaPendiente: null }, deps, fin, '¡Listo, quedaste verificado! ');
    return fin('¡Listo, quedaste verificado! ¿Qué quieres consultar?', { estado: listo });
  }
  if (r === 'vencido') {
    return fin('Ese código ya venció. Si quieres, te mando uno nuevo: dime otra vez qué quieres consultar.', { estado: { ...s, fase: 'libre', verificacion: null } });
  }
  const intentos = v.intentos + 1;
  if (r === 'demasiados' || intentos >= MAX_INTENTOS_OTP) {
    return ofrecerAsesor({ ...s, fase: 'libre', verificacion: null, consultaPendiente: null }, deps, 'Ese código no coincide y ya no puedo intentarlo más en esta llamada.', fin);
  }
  return fin('Ese código no coincide. Revísalo y dímelo otra vez, número por número.', { estado: { ...s, verificacion: { ...v, intentos } } });
}

async function confirmarPorCorreo(
  dig: string, v: NonNullable<EstadoDialogo['verificacion']>, s: EstadoDialogo, deps: DepsTurno, fin: Fin,
): Promise<ResultadoTurno> {
  let r: ResultadoConfirmacion;
  try {
    r = deps.academico?.confirmarVerificacion
      ? await deps.academico.confirmarVerificacion(deps.telefonoLlamante, dig)
      : { ok: false, motivo: 'vencido' };
  } catch {
    return ofrecerAsesor({ ...s, fase: 'libre', verificacion: null }, deps, 'No pude comprobar el código en este momento.', fin);
  }
  if (r.ok) {
    // Verificación SOLO PARA ESTA LLAMADA: el servicio académico no vinculó ni movió nada; devuelve el teléfono del
    // vínculo real, que queda en el estado del servidor (nunca se dice por voz) y es el único con el que se consulta.
    // Nunca se consulta con el número de quien llama.
    const estudiante = typeof r.telefonoEstudiante === 'string' ? r.telefonoEstudiante : '';
    if (!/^\d{8,15}$/.test(estudiante)) {
      return ofrecerAsesor({ ...s, fase: 'libre', verificacion: null, consultaPendiente: null }, deps, 'No pude comprobar el código en este momento.', fin);
    }
    const listo = { ...s, fase: 'libre' as const, verificado: estudiante, verificacion: null };
    if (listo.consultaPendiente) return leerConsulta(estudiante, listo.consultaPendiente, { ...listo, consultaPendiente: null }, deps, fin, '¡Listo, quedaste verificado! ');
    return fin('¡Listo, quedaste verificado! ¿Qué quieres consultar?', { estado: listo });
  }
  if (r.motivo === 'vencido') {
    return fin('Ese código ya venció. Si quieres, te mando uno nuevo: dime otra vez qué quieres consultar.', { estado: { ...s, fase: 'libre', verificacion: null } });
  }
  const intentos = v.intentos + 1;
  if (r.motivo === 'demasiados' || intentos >= MAX_INTENTOS_OTP) {
    return ofrecerAsesor({ ...s, fase: 'libre', verificacion: null, consultaPendiente: null }, deps, 'Ese código no coincide y ya no puedo intentarlo más en esta llamada.', fin);
  }
  return fin('Ese código no coincide. Revísalo y dímelo otra vez, número por número.', { estado: { ...s, verificacion: { ...v, intentos } } });
}

/** Lo que se manda por WhatsApp cuando el recibo necesita la cédula (por voz no se pide). */
export const TEXTO_RECIBO_WHATSAPP =
  '🧾 Para bajar tu recibo de matrícula escribe *menu*, entra a *Mi semestre* y elige *Recibo*. Te pediré tu cédula una sola vez.';

async function leerConsulta(telefono: string, tipo: TipoConsulta, s: EstadoDialogo, deps: DepsTurno, fin0: Fin, prefijo = ''): Promise<ResultadoTurno> {
  const fin: Fin = (r, extra = {}) => fin0(r, { estado: s, ...extra });
  try {
    const r = await deps.academico!.consultar(telefono, tipo);
    if (r.ok) return fin(`${prefijo}${r.paraVoz} ¿Necesitas algo más?`, { estado: { ...s, fase: 'libre' }, resultado: 'datos_estudiante', datosLeidos: tipo });
    // El recibo necesita la cédula y por voz no se pide: se dice y se ofrece seguir por WhatsApp.
    if (tipo === 'recibo' && r.motivo === 'sin_codigo' && deps.enviarWhatsApp && !deps.simulada) {
      return fin(`${prefijo}${r.paraVoz} ¿Quieres que te escriba por WhatsApp a este número para seguir desde ahí?`, { estado: { ...s, fase: 'ofrece_whatsapp_recibo' }, datosLeidos: tipo });
    }
    return fin(`${prefijo}${r.paraVoz}`, { estado: { ...s, fase: 'libre' }, datosLeidos: tipo });
  } catch {
    return ofrecerAsesor({ ...s, fase: 'libre' }, deps, `${prefijo}No pude consultar ${NOMBRE_CONSULTA[tipo]} en este momento.`, fin);
  }
}

// ------------------------------------------------------------------ asesor

export const PIDE_SOPORTE =
  /\b(soporte|mesa de ayuda|contrasena|clave|no (puedo|me deja|logro) (entrar|ingresar|acceder)|restablecer|desbloquear|bloquead[oa])\b/;

/**
 * Área de la cita según de dónde viene la persona: soporte técnico → «ti» (lo que necesita manda, aunque sea
 * estudiante); estudiante verificado EN ESTA LLAMADA con nivel pregrado → «pregrado»; si no, «posgrados» (la línea).
 */
export async function areaParaCita(s: EstadoDialogo, deps: DepsTurno): Promise<AreaAgenda> {
  if (s.soporte) return 'ti';
  if (s.pregrado) return 'pregrado';
  if (s.verificado && deps.academico) {
    try {
      if ((await deps.academico.estudianteDe(s.verificado))?.nivel === 'pregrado') return 'pregrado';
    } catch {
      // Sin saber el nivel: la línea es de posgrados.
    }
  }
  return 'posgrados';
}

const MOTIVO_CITA: Record<AreaAgenda, string> = {
  posgrados: 'Llamada a la línea de posgrados',
  pregrado: 'Llamada de estudiante de pregrado',
  ti: 'Llamada: soporte técnico',
};

function ofrecerAsesor(s: EstadoDialogo, deps: DepsTurno, intro: string, fin: Fin): ResultadoTurno {
  const que = deps.asesoresEnVivo ? '¿Quieres que te comunique con un asesor?' : '¿Quieres que te agende con un asesor o que te devuelvan la llamada?';
  return fin(`${intro} ${que}`, { estado: { ...s, fase: 'ofrece_asesor' } });
}

function ofrecerDevolucion(s: EstadoDialogo, intro: string, fin: Fin): ResultadoTurno {
  return fin(`${intro} ¿Quieres que un asesor te devuelva la llamada a este número?`, { estado: { ...s, fase: 'ofrece_devolucion' } });
}

/**
 * Pidió que lo llamen después: se deja la devolución al número desde el que llama, sin preguntar otra vez ni pasar por
 * las franjas. Sin número visible no se puede: se ofrece la cita.
 */
function herramientaDevolucion(s: EstadoDialogo, deps: DepsTurno, fin: Fin): ResultadoTurno {
  if (!/^\d{7,15}$/.test(digitos(deps.telefonoLlamante))) {
    return fin('No me aparece el número desde el que llamas, así que no puedo dejarte la devolución de la llamada. ¿Quieres que te agende con un asesor?', { estado: { ...s, fase: 'ofrece_asesor' } });
  }
  return fin('Listo, un asesor te devolverá la llamada al número desde el que me llamas, en horario de atención. No te puedo asegurar la hora exacta. ¿Te ayudo con algo más?', {
    estado: { ...s, fase: 'libre' }, resultado: 'devolver_llamada', aviso: 'Pidió que le devuelvan la llamada',
  });
}

async function herramientaAsesor(s: EstadoDialogo, deps: DepsTurno, fin0: Fin): Promise<ResultadoTurno> {
  const fin: Fin = (r, extra = {}) => fin0(r, { estado: s, ...extra });
  if (deps.asesoresEnVivo) {
    return fin('Te comunico con un asesor de posgrados. Un momento, por favor.', {
      accion: 'transfer', resultado: 'transferida', aviso: 'Llamada transferida a un asesor', estado: { ...s, fase: 'libre' },
    });
  }
  if (deps.agenda) {
    try {
      const area = await areaParaCita(s, deps);
      const franjas = (await deps.agenda.franjasLibres({ area, desde: deps.ahora(), dias: 7, max: 3 })).slice(0, 3);
      if (franjas.length) {
        const ops = franjas.map((f, k) => `${ORDINAL[k]}, el ${fechaHablada(f.inicio)}`).join('; ');
        return fin(`Ahora no hay asesores en línea, pero te puedo agendar una cita. Tengo ${franjas.length === 1 ? 'este espacio' : 'estos espacios'}: ${ops}. ¿Cuál te sirve?`, {
          estado: { ...s, fase: 'elige_franja', franjas, franjaElegida: null, areaCita: area },
        });
      }
    } catch {
      // Sin agenda: queda la devolución.
    }
  }
  return ofrecerDevolucion(s, 'Ahora no hay asesores disponibles.', fin);
}

async function reservarFranja(s: EstadoDialogo, deps: DepsTurno, fin0: Fin): Promise<ResultadoTurno> {
  const fin: Fin = (r, extra = {}) => fin0(r, { estado: s, ...extra });
  const f = s.franjaElegida !== null ? s.franjas[s.franjaElegida] : null;
  if (!f || !deps.agenda) return ofrecerDevolucion({ ...s, fase: 'libre' }, 'No pude agendar.', fin);
  try {
    const area = s.areaCita ?? 'posgrados';
    const r = await deps.agenda.reservar({
      telefono: deps.telefonoLlamante, area, franja: f, canal: 'voz', motivo: MOTIVO_CITA[area],
    });
    if (r.ok) {
      return fin(`¡Listo! Quedaste agendado con ${r.cita.asesorNombre} el ${fechaHablada(r.cita.inicio)}. ¿Algo más?`, {
        estado: { ...s, fase: 'libre', franjas: [], franjaElegida: null }, resultado: 'cita', cita: r.cita,
        aviso: `Cita agendada por voz con ${r.cita.asesorNombre}`,
      });
    }
    if (r.motivo === 'ocupada') {
      const nuevo = await herramientaAsesor({ ...s, franjas: [], franjaElegida: null }, deps, fin);
      return { ...nuevo, respuesta: cleanForSpeech(`Uy, ese espacio se acaba de ocupar. ${nuevo.respuesta}`) };
    }
  } catch {
    // cae a la devolución
  }
  return ofrecerDevolucion({ ...s, fase: 'libre', franjas: [], franjaElegida: null }, 'No pude agendar la cita.', fin);
}

// ------------------------------------------------------------------ elegir de una lista hablada

export function elegirFranja(texto: string, inicios: readonly string[]): number | null {
  const t = normalizeSpeech(texto);
  const n = inicios.length;
  if (!n) return null;
  if (/\b(primera|primero|uno|la 1|opcion 1)\b/.test(t) || t === '1') return 0;
  if (n > 1 && (/\b(segunda|segundo|dos|la 2|opcion 2)\b/.test(t) || t === '2')) return 1;
  if (n > 2 && (/\b(tercera|tercero|tres|la 3|opcion 3)\b/.test(t) || t === '3')) return 2;
  if (/\b(ultima|ultimo)\b/.test(t)) return n - 1;
  // «la del martes», «a las 3»
  const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const hits = inicios.map((iso, i) => {
    const hablada = normalizeSpeech(fechaHablada(iso));
    const dia = dias.find((d) => t.includes(d));
    const hora = t.match(/\b(?:a )?las (\d{1,2})\b/)?.[1];
    const okDia = !dia || hablada.startsWith(dia);
    const okHora = !hora || hablada.includes(` las ${hora} `) || (hora === '1' && hablada.includes(' la una '));
    return (dia || hora) && okDia && okHora ? i : -1;
  }).filter((i) => i >= 0);
  return hits.length === 1 ? hits[0] : null;
}

function elegirCandidato(texto: string, ids: readonly string[]): string | null {
  const t = normalizeSpeech(texto);
  const progs = ids.map((id) => getPosgrado(id)).filter((p): p is NonNullable<typeof p> => !!p);
  if (/\b(primera|primero|la 1)\b/.test(t)) return progs[0]?.id ?? null;
  if (/\b(segunda|segundo|la 2)\b/.test(t)) return progs[1]?.id ?? null;
  if (/\b(tercera|tercero)\b/.test(t)) return progs[2]?.id ?? null;
  const pistas: [RegExp, (p: (typeof progs)[number]) => boolean][] = [
    [/\bvirtual\b/, (p) => p.sitio === 'virtual.utb.edu.co'],
    [/\bpresencial\b/, (p) => p.sitio !== 'virtual.utb.edu.co'],
    [/\bespecializacion\b/, (p) => p.nivel === 'especializacion'],
    [/\bmaestria\b/, (p) => p.nivel === 'maestria'],
    [/\bdoctorado\b/, (p) => p.nivel === 'doctorado'],
  ];
  let quedan = progs;
  for (const [re, f] of pistas) if (re.test(t)) quedan = quedan.filter(f);
  if (quedan.length === 1 && quedan.length < progs.length) return quedan[0].id;
  const nombrados = programasMencionados(texto).filter((p) => ids.includes(p.id));
  return nombrados.length === 1 ? nombrados[0].id : null;
}
