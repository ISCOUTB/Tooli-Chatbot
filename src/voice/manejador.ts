// Ciclo de vida de una llamada (eventos del proveedor ya verificados). Portado de FastFood
// (src/lib/voice/call-handler.ts) con la misma mecánica:
//   entrante → (apagado / regla «atiende una persona» → desvío) → reserva de cupo atómica → contestar
//   contestada → saludo con aviso de transcripción (y grabación) → grabar (si aplica) → escuchar
//   frase final → turno (dialogo.ts) → hablar → al terminar de hablar: transferir / colgar si quedó pendiente
//   colgó → duración, minutos cobrados, costo y ajuste del uso apartado.
// Nuevo en Tooli (para que se escuche bien):
//   - barge-in: un resultado parcial mientras el bot habla corta la reproducción (stopSpeaking) y escucha;
//   - frase puente: si el turno tarda más de `puenteMs`, se dice «Claro, déjame revisar…» y la respuesta va detrás;
//   - control de silencio: ~6 s callado tras hablar el bot → «¿sigues ahí?»; ~7 s más → despedida y cuelga. La fecha
//     límite vive en el estado de la llamada (Redis) y en un índice que barre cualquier instancia (barrerSilencios):
//     sobrevive a reinicios y, como la cumple solo quien gana el compare-and-set, se dice una sola vez aunque haya
//     varias instancias. El temporizador local solo la adelanta mientras la instancia siga viva;
//   - compare-and-set: un turno que se cruzó con otro más nuevo se descarta en vez de pisarlo.
// Sin credenciales del proveedor todo se registra pero no se manda ningún comando (así funciona sin cuenta).
import { billedMinutes, estimatedCostUsd, shouldWrapUp } from './caps';
import type { AjustesVoz } from './ajustes';
import { GRACIA_COLGAR_MS, plazoDuro, type AlmacenVoz } from './almacen';
import { DESPEDIDA_SILENCIO, SIGUES_AHI, correrTurno, frasePuente, textoSaludo, type DepsTurno, type ResultadoTurno } from './dialogo';
import { decideRouteNow } from './horario';
import type { ProviderCredentials, VoiceEvent, VoiceProvider } from './proveedor/tipos';
import { aplicarLexico, cleanForSpeech, digitosDictados, soloDictado, taparDatosDictados } from './texto';
import type { LlamadaVoz, Resultado } from './tipos';
import { crearCodigoWhatsAppVoz, pendientesVozEnMemoria, type CodigoWhatsAppVoz } from '../services/academico/verificacionVoz';

export interface Programador {
  /** Corre `fn` en `ms`; devuelve con qué cancelarlo. Sin programador no hay control de silencio (simulador). */
  en(ms: number, fn: () => void): () => void;
}

export const programadorReal: Programador = {
  en(ms, fn) {
    const t = setTimeout(fn, ms);
    t.unref?.();
    return () => clearTimeout(t);
  },
};

export interface AvisoPanel {
  tipo: 'transferencia' | 'cita' | 'devolucion' | 'otro';
  llamadaId: string;
  texto: string;
  simulada: boolean;
}

export interface DepsManejador {
  almacen: AlmacenVoz;
  proveedor: VoiceProvider;
  credenciales: () => ProviderCredentials | null;
  ajustes: () => Promise<AjustesVoz>;
  /** Dependencias del turno para esta llamada (la simulada recibe agenda y datos académicos simulados). */
  depsTurno: (llamada: LlamadaVoz, ajustes: AjustesVoz) => DepsTurno;
  /**
   * Código por WhatsApp: el almacén atómico compartido con el código al correo (producción: Lua de identityService).
   * Sin él, uno en memoria por manejador (pruebas y simulador).
   */
  codigoWhatsApp?: CodigoWhatsAppVoz;
  programador?: Programador | null;
  avisarPanel?: (aviso: AvisoPanel) => void;
  ahora?: () => Date;
  /** Si el turno tarda más que esto, se dice la frase puente. */
  puenteMs?: number;
  silencioMs?: [number, number];
  log?: (msg: string) => void;
}

export interface Nota { handled: boolean; note: string }

const RANGO: Record<Resultado, number> = {
  en_curso: 0, error: 1, colgo: 1, silencio: 1, fuera_de_horario: 2, sin_cupo: 2, consulta: 3, devolver_llamada: 4,
  datos_estudiante: 5, cita: 6, transferida: 7,
};
export const mejorResultado = (a: Resultado, b: Resultado | undefined): Resultado => (b && RANGO[b] > RANGO[a] ? b : a);

/**
 * Teléfono de quien llama a partir del `from` del proveedor: solo dígitos (E.164 sin «+»), o '' si no hay número.
 * Telnyx no documenta qué manda con el número oculto; en SIP lo habitual es «anonymous» o
 * «sip:anonymous@anonymous.invalid», y también llegan «Restricted», «unknown» o un URI SIP con un usuario sin número.
 * Nunca se toman los dígitos del dominio de un URI (sip:anonymous@192.168.1.1 no es el 19216811). Sin número no se
 * ofrece verificación ni devolución, y no se comparten topes ni códigos entre llamadas anónimas (R4).
 */
export function telefonoDeOrigen(from: string | null | undefined): string {
  const t = String(from ?? '').trim();
  if (!t || /anonymous|anonimo|restricted|private|privado|unknown|unavailable|withheld/i.test(t)) return '';
  const usuario = /^sips?:/i.test(t) ? t.replace(/^sips?:/i, '').split(/[@;]/)[0] : t;
  if (!/^\+?[\d\s().-]+$/.test(usuario)) return '';
  const digitos = usuario.replace(/\D/g, '');
  return /^\d{7,15}$/.test(digitos) && !/^0+$/.test(digitos) ? digitos : '';
}

/**
 * Envuelve las dependencias del turno para saber si tocó el mundo de afuera: un código enviado o un intento contado,
 * una cita reservada, un WhatsApp enviado. Un turno así no se puede descartar aunque llegue otra frase en medio: lo
 * que hizo ya pasó (punto 11). Lo que solo lee (consultar, franjas libres) no cuenta.
 */
type Prueba = (r: unknown) => boolean;
function envolver<T extends object>(obj: T, efectos: Record<string, Prueba>, marcar: () => void): T {
  return new Proxy(obj, {
    get(t, p) {
      const v = Reflect.get(t, p, t) as unknown;
      if (typeof v !== 'function') return v;
      const hubo = typeof p === 'string' ? efectos[p] : undefined;
      if (!hubo) return v.bind(t);
      return async (...a: unknown[]) => {
        const r = await (v as (...x: unknown[]) => Promise<unknown>).apply(t, a);
        if (hubo(r)) marcar();
        return r;
      };
    },
  });
}
export function conEfectos(deps: DepsTurno, marcar: () => void): DepsTurno {
  const campo = (r: unknown, k: string) => (r && typeof r === 'object' ? (r as Record<string, unknown>)[k] : undefined);
  return {
    ...deps,
    academico: deps.academico && envolver(deps.academico, {
      iniciarVerificacionPorDato: (r) => campo(r, 'estado') === 'enviado',
      confirmarVerificacion: (r) => campo(r, 'ok') === true || ['no_coincide', 'demasiados'].includes(String(campo(r, 'motivo'))),
    }, marcar),
    agenda: deps.agenda && envolver(deps.agenda, { reservar: (r) => campo(r, 'ok') === true, cancelar: (r) => r === true }, marcar),
    codigoWhatsApp: deps.codigoWhatsApp && envolver(deps.codigoWhatsApp, {
      iniciar: (r) => r === 'enviado',
      confirmar: (r) => r === 'ok' || r === 'no_coincide' || r === 'demasiados',
    }, marcar),
    enviarCodigo: async (t, c) => { const ok = await deps.enviarCodigo(t, c); if (ok) marcar(); return ok; },
    ...(deps.enviarWhatsApp ? { enviarWhatsApp: async (t: string, x: string) => { const ok = await deps.enviarWhatsApp!(t, x); if (ok) marcar(); return ok; } } : {}),
  };
}

/** Prefijo del `client_state` de la pata saliente de una transferencia: lleva el id de la llamada original. */
export const ESTADO_PATA = 'tooli-pata:';
/** Lo que Telnyx deja timbrar al asesor antes de dar la transferencia por fallida (timeout_secs por defecto). */
const TIMBRE_TRANSFER_MS = 30_000;

export const TEXTO_NO_CONTESTO_CON_NUMERO =
  'No pude comunicarte con un asesor: no contestó. Dejé tu número para que un asesor te devuelva la llamada en horario de atención. ¿Te ayudo con algo más?';
export const TEXTO_NO_CONTESTO_SIN_NUMERO =
  'No pude comunicarte con un asesor en este momento. Puedes volver a llamar o escribirnos por WhatsApp. ¿Te ayudo con algo más?';

export const TEXTO_SE_ACABA_TRANSFER = 'Se nos acaba el tiempo de esta llamada. Te paso con un asesor para terminar.';
export const TEXTO_SE_ACABA_COLGAR = 'Se nos acaba el tiempo de esta llamada. Si necesitas más, escríbenos por WhatsApp o vuelve a llamar. ¡Gracias!';

export function crearManejador(d: DepsManejador) {
  const ahora = d.ahora ?? (() => new Date());
  const log = d.log ?? ((m: string) => console.warn(`[voz] ${m}`));
  const puenteMs = d.puenteMs ?? 700;
  const [silencio1, silencio2] = d.silencioMs ?? [6000, 7000];
  const timers = new Map<string, () => void>();
  const codigoWhatsApp = d.codigoWhatsApp ?? crearCodigoWhatsAppVoz(pendientesVozEnMemoria());
  // Marca de actividad estrictamente creciente (dos eventos en el mismo milisegundo no se confunden).
  const tick = (x: LlamadaVoz) => Math.max(ahora().getTime(), x.actividad + 1);

  const cmd = async (label: string, run: (c: ProviderCredentials) => Promise<void>): Promise<boolean> => {
    const creds = d.credenciales();
    if (!creds) {
      log(`sin llave del proveedor: «${label}» no se envió`);
      return false;
    }
    try {
      await run(creds);
      return true;
    } catch (err) {
      log(`${label} falló: ${err instanceof Error ? err.message : 'error'}`);
      return false;
    }
  };

  /** Lee, cambia y guarda con compare-and-set; reintenta si otro evento escribió en medio. null = la función desistió. */
  async function actualizar(id: string, fn: (l: LlamadaVoz) => LlamadaVoz | null): Promise<LlamadaVoz | null> {
    for (let i = 0; i < 4; i++) {
      const l = await d.almacen.leer(id);
      if (!l) return null;
      const cambiada = fn(l);
      if (!cambiada) return null;
      const guardada = await d.almacen.guardar(cambiada);
      if (guardada) return guardada;
    }
    log('no se pudo guardar el estado de la llamada (conflictos seguidos)');
    return null;
  }

  /**
   * `registro`: lo que queda en la transcripción si no debe ser lo dicho (datos académicos leídos). Si el `speak` falla
   * (422, 5xx, sin llave) no llegará su `speak_ended`: se hace aquí lo que ese evento haría (punto 8, escenario B).
   */
  async function decir(l: LlamadaVoz, a: AjustesVoz, texto: string, commandId: string, interrumpir = true, registro?: string): Promise<boolean> {
    const limpio = cleanForSpeech(texto);
    await d.almacen.agregarLinea(l.id, { r: 'a', t: registro ?? limpio, at: ahora().toISOString() }, a.retencionDias);
    const ok = await cmd('speak', (c) => d.proveedor.speak(c, l.proveedorCallId, aplicarLexico(limpio), { voice: a.voz, language: a.idioma, commandId, interrumpir }));
    if (!ok) await noSono(l.id, a, `${commandId}-sin-audio`);
    return ok;
  }

  /**
   * Un `speak` que no salió: si hay una frase puente sonando delante, el fin de ESA hará lo pendiente; si no, se
   * transfiere o cuelga lo pendiente o se arma el control de silencio, como al terminar de hablar.
   */
  async function noSono(id: string, a: AjustesVoz, cmdBase: string) {
    let actuar = false;
    let despues: LlamadaVoz['despuesDeHablar'] = null;
    const l = await actualizar(id, (x) => {
      actuar = false;
      despues = null;
      if (x.estado !== 'activa') return null;
      if ((x.puentes ?? 0) > 0) return { ...x, puentes: x.puentes - 1 };
      actuar = true;
      despues = x.despuesDeHablar;
      return { ...x, hablando: false, despuesDeHablar: null };
    });
    if (l && actuar) await ejecutarPendiente(l, a, despues as LlamadaVoz['despuesDeHablar'], cmdBase);
  }

  /** Lo que se hace cuando termina de sonar lo último: transferir, colgar o empezar a contar el silencio. */
  async function ejecutarPendiente(l: LlamadaVoz, a: AjustesVoz, pendiente: LlamadaVoz['despuesDeHablar'], cmdBase: string): Promise<Nota> {
    if (pendiente === 'transfer' && a.numeroDesvio) return transferir(l, a, a.numeroDesvio, cmdBase);
    if (pendiente) {
      await cmd('hangup', (c) => d.proveedor.hangup(c, l.proveedorCallId, `${cmdBase}-bye`));
      return { handled: true, note: 'hangup' };
    }
    await programarSilencio(l);
    return { handled: true, note: 'escuchando' };
  }

  /**
   * Pasa la llamada a un asesor (punto 9). Primero se marca transferida, así lo que llegue desde ya (la charla con el
   * asesor) no dispara turnos, silencios ni avisos; después se detiene la transcripción (Telnyx solo la para al colgar o
   * con transcription_stop) y se transfiere con tope de duración y con la pata saliente atada a esta llamada por su
   * client_state (punto 16). Si el transfer falla de una, el bot retoma.
   */
  async function transferir(l: LlamadaVoz, a: AjustesVoz, desvio: string, cmdBase: string): Promise<Nota> {
    const limiteSeg = a.maxMinutosTransferencia * 60;
    const en = ahora();
    const t = await actualizar(l.id, (x) => (x.estado === 'activa' && !x.transferidaEn ? {
      ...x,
      transferidaEn: en.toISOString(),
      transferidaHasta: en.getTime() + TIMBRE_TRANSFER_MS + limiteSeg * 1000,
      pataContestada: false,
      resultado: mejorResultado(x.resultado, 'transferida'),
      despuesDeHablar: null,
      silencioVence: null,
      hablando: false,
    } : null));
    if (!t) return { handled: false, note: 'ya transferida' };
    cancelarLocal(l.id);
    await d.almacen.vigilar(l.id, plazoDuro(t));
    await cmd('transcription_stop', (c) => d.proveedor.stopListening(c, l.proveedorCallId, `${cmdBase}-nolisten`));
    const ok = await cmd('transfer', (c) => d.proveedor.transfer(c, l.proveedorCallId, desvio, `${cmdBase}-transfer`, { limiteSeg, estadoPata: `${ESTADO_PATA}${l.id}` }));
    if (!ok) {
      await retomar(l.id, a, `${cmdBase}-retoma`);
      return { handled: true, note: 'la transferencia falló: retoma' };
    }
    return { handled: true, note: 'transfer' };
  }

  /**
   * El asesor no contestó, dio ocupado o el transfer falló (punto 16): Telnyx deja la llamada original activa. El bot
   * vuelve a escuchar, lo dice y deja la devolución en la cola del panel (con número; sin él no se puede devolver).
   */
  async function retomar(id: string, a: AjustesVoz, cmdBase: string) {
    let texto = '';
    const l = await actualizar(id, (x) => {
      if (x.estado !== 'activa' || !x.transferidaEn) return null;
      const conNumero = /^\d{7,15}$/.test(x.telefono);
      texto = conNumero ? TEXTO_NO_CONTESTO_CON_NUMERO : TEXTO_NO_CONTESTO_SIN_NUMERO;
      return {
        ...x,
        transferidaEn: null,
        transferidaHasta: null,
        pataContestada: false,
        // «transferida» resuelve la llamada y la sacaría de la cola: aquí NO se resolvió.
        resultado: conNumero ? 'devolver_llamada' : 'en_curso',
        resumen: conNumero ? 'La transferencia a un asesor no se completó: devolver la llamada' : x.resumen,
        silencio: 0,
        dialogo: { ...x.dialogo, fase: 'libre', ultimaRespuesta: texto, ultimaDatos: null },
      };
    });
    if (!l) return;
    if (l.resultado === 'devolver_llamada') {
      d.avisarPanel?.({ tipo: 'devolucion', llamadaId: l.id, texto: 'La transferencia no se completó: devolver la llamada', simulada: l.simulada });
    }
    await d.almacen.vigilar(l.id, plazoDuro(l));
    await cmd('transcription_start', (c) => d.proveedor.startListening(c, l.proveedorCallId, a.idioma, `${cmdBase}-listen`));
    await decir(l, a, texto, `${cmdBase}-aviso`);
  }

  /**
   * Eventos de la pata saliente de una transferencia: llegan con OTRO call_control_id y el client_state de la llamada
   * original. null si el evento no es de una pata nuestra.
   */
  async function eventoDePata(ev: VoiceEvent, a: AjustesVoz): Promise<Nota | null> {
    const id = ev.clientState?.startsWith(ESTADO_PATA) ? ev.clientState.slice(ESTADO_PATA.length) : '';
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    const l = await d.almacen.leer(id);
    if (!l || l.proveedor !== d.proveedor.id) return { handled: false, note: 'pata de una llamada desconocida' };
    if (ev.kind === 'answered') {
      await actualizar(id, (x) => (x.pataContestada ? null : { ...x, pataContestada: true }));
      return { handled: true, note: 'el asesor contestó' };
    }
    if (ev.kind !== 'hangup') return { handled: false, note: 'evento de la pata saliente' };
    const segPata = ev.durationSeconds ?? null;
    if (l.estado === 'cerrada' && l.transferidaEn && l.segPata == null && segPata != null && !l.simulada) {
      // La llamada se cerró antes y estimó la pata: se corrige con su duración real (costo y uso del día y el mes).
      let delta = 0;
      const c = await actualizar(id, (x) => {
        if (x.segPata != null) return null;
        const minutosPata = billedMinutes(segPata);
        delta = minutosPata - x.minutosPata;
        return {
          ...x, segPata, minutosPata, minutosCobrados: x.minutosCobrados + delta,
          costoUsd: estimatedCostUsd(x.duracionSeg, a.costoMinutoUsd) + estimatedCostUsd(segPata, a.costoMinutoUsd),
        };
      });
      if (c && delta) await d.almacen.ajustarUso(c.usoDia, c.usoMes, delta);
      return { handled: true, note: 'pata colgada: costo corregido' };
    }
    if (l.estado !== 'activa' || !l.transferidaEn) return { handled: false, note: 'pata colgada' };
    if (segPata != null && l.pataContestada) await actualizar(id, (x) => ({ ...x, segPata }));
    if (l.pataContestada) {
      // Terminó la charla con el asesor: el bot no retoma una llamada que ya atendió una persona.
      await cmd('hangup', (c) => d.proveedor.hangup(c, l.proveedorCallId, `${ev.eventId}-fin`));
      return { handled: true, note: 'el asesor colgó' };
    }
    await retomar(id, a, ev.eventId);
    return { handled: true, note: 'el asesor no contestó: retoma' };
  }

  /**
   * Aviso de fin de tiempo (30 s antes del tope de la llamada), una sola vez: con una frase final o con un resultado
   * parcial (una llamada con solo parciales también llega al tope, #35 R5). null si todavía no toca.
   */
  async function avisarFinDeTiempo(l0: LlamadaVoz, a: AjustesVoz, eventId: string): Promise<Nota | null> {
    const inicio = Date.parse(l0.contestada ?? l0.iniciada);
    if (!shouldWrapUp(inicio, l0.minutosPermitidos, ahora().getTime())) return null;
    const transferir = Boolean(a.numeroDesvio);
    const l = await actualizar(l0.id, (x) => (x.despuesDeHablar
      ? null
      : { ...x, despuesDeHablar: transferir ? 'transfer' : 'hangup', hablando: false, silencio: 0, actividad: tick(x) }));
    if (!l) return { handled: false, note: 'tope de la llamada (ya avisado)' };
    await decir(l, a, transferir ? TEXTO_SE_ACABA_TRANSFER : TEXTO_SE_ACABA_COLGAR, `${eventId}-wrap`);
    return { handled: true, note: 'tope de la llamada' };
  }

  function cancelarLocal(id: string) {
    timers.get(id)?.();
    timers.delete(id);
  }

  /** Hubo actividad: se borra la fecha límite del estado (la que lo cumpla después ya no la encuentra). */
  async function cancelarSilencio(l: LlamadaVoz) {
    cancelarLocal(l.id);
    if (l.silencioVence == null) return;
    await actualizar(l.id, (x) => (x.silencioVence == null ? null : { ...x, silencioVence: null }));
  }

  /** Tras hablar el bot: fecha límite en el estado y en el índice del barrido; el temporizador local la adelanta. */
  async function programarSilencio(l: LlamadaVoz) {
    if (!d.programador || l.estado !== 'activa' || l.silencio >= 2 || l.transferidaEn) return;
    const vence = ahora().getTime() + (l.silencio === 0 ? silencio1 : silencio2);
    const g = await actualizar(l.id, (x) => (x.estado === 'activa' && x.silencio === l.silencio && !x.hablando ? { ...x, silencioVence: vence } : null));
    if (!g) return;
    await d.almacen.indexarSilencio(l.id, vence);
    cancelarLocal(l.id);
    timers.set(l.id, d.programador.en(Math.max(0, vence - ahora().getTime()), () => {
      timers.delete(l.id);
      void cumplirSilencio(l.id, vence).catch((err) => log(`silencio falló: ${err instanceof Error ? err.message : err}`));
    }));
  }

  async function cumplirSilencio(id: string, vence: number): Promise<Nota> {
    const r = await silencio(id, vence);
    await d.almacen.quitarSilencio(id, vence);
    return r;
  }

  /**
   * Barrido (cada ~1 s en cada instancia): cumple las fechas límite vencidas de las llamadas de este proveedor. Dos
   * instancias que barren a la vez leen la misma fecha, pero solo una gana el compare-and-set que la pone en null.
   */
  async function barrerSilencios(limite = 50): Promise<number> {
    let dichos = 0;
    for (const { id, vence } of await d.almacen.silenciosVencidos(ahora().getTime(), limite)) {
      const l = await d.almacen.leer(id);
      if (l && l.proveedor === d.proveedor.id && l.silencioVence === vence && (await silencio(id, vence)).handled) dichos++;
      await d.almacen.quitarSilencio(id, vence);
    }
    return dichos;
  }

  /**
   * Control de silencio. Con `vence`, solo actúa si esa sigue siendo la fecha límite de la llamada (si habló después,
   * o si otra instancia ya la cumplió, no hace nada). Sin `vence` (simulador), actúa siempre.
   */
  async function silencio(id: string, vence?: number): Promise<Nota> {
    const a = await d.ajustes();
    let dicho: { texto: string; etapa: 1 | 2 } | null = null;
    const l = await actualizar(id, (x) => {
      dicho = null;
      // Transferida: el silencio es de la charla con el asesor, no del bot (punto 9).
      if (x.estado !== 'activa' || x.silencio >= 2 || x.transferidaEn) return null;
      if (vence !== undefined && x.silencioVence !== vence) return null;
      const etapa = x.silencio === 0 ? 1 : 2;
      dicho = { texto: etapa === 1 ? SIGUES_AHI : DESPEDIDA_SILENCIO, etapa };
      return {
        ...x,
        silencio: etapa,
        silencioVence: null,
        despuesDeHablar: etapa === 2 ? 'hangup' : x.despuesDeHablar,
        resultado: etapa === 2 && x.resultado === 'en_curso' ? 'silencio' : x.resultado,
      };
    });
    if (!l || !dicho) return { handled: false, note: 'sin silencio' };
    const { texto, etapa } = dicho as { texto: string; etapa: 1 | 2 };
    await decir(l, a, texto, `${l.id}-sil${etapa}-${l.version}`);
    return { handled: true, note: etapa === 1 ? 'sigues ahí' : 'despedida por silencio' };
  }

  /**
   * Cierra la llamada una sola vez (compare-and-set): duración, minutos cobrados y costo; borra lo sensible que el
   * registro no necesita durante la retención (última respuesta, código dictado, teléfono verificado, verificación en
   * curso, dígitos juntados; punto 12) y cambia en el uso lo apartado por lo cobrado.
   */
  async function cerrarLlamada(id: string, a: AjustesVoz, seg: number): Promise<LlamadaVoz | null> {
    cancelarLocal(id);
    const s = Math.max(0, Math.min(86_400, Math.round(seg)));
    const fin = ahora();
    const l = await actualizar(id, (x) => {
      if (x.estado === 'cerrada') return null;
      // La pata del asesor también se cobra (punto 14): su duración real si llegó su call.hangup; si no, se estima
      // desde la transferencia y se corrige cuando llegue.
      const segPata = x.segPata ?? (x.transferidaEn ? Math.max(0, Math.round((fin.getTime() - Date.parse(x.transferidaEn)) / 1000)) : 0);
      const minutosPata = x.simulada ? 0 : billedMinutes(segPata);
      return {
      ...x,
      estado: 'cerrada',
      cerrada: fin.toISOString(),
      duracionSeg: s,
      minutosPata,
      minutosCobrados: x.simulada ? 0 : billedMinutes(s) + minutosPata,
      costoUsd: x.simulada ? 0 : estimatedCostUsd(s, a.costoMinutoUsd) + estimatedCostUsd(segPata, a.costoMinutoUsd),
      resultado: x.resultado === 'en_curso' ? (x.contestada ? 'colgo' : 'error') : x.resultado,
      hablando: false,
      despuesDeHablar: null,
      silencioVence: null,
      dictado: '',
      verificada: x.verificada || Boolean(x.dialogo.verificado),
      dialogo: { ...x.dialogo, ultimaRespuesta: null, ultimaDatos: null, verificacion: null, codigoDictado: null, verificado: null },
      };
    });
    if (!l) return null;
    // Lo apartado al contestar se cambia por lo cobrado (el uso del día/mes queda con minutos reales).
    if (!l.simulada) await d.almacen.ajustarUso(l.usoDia, l.usoMes, l.minutosCobrados - l.minutosPermitidos);
    await d.almacen.dejarDeVigilar(l.id);
    return l;
  }

  /**
   * Tope duro (punto 8), en el barrido de cada instancia: una llamada activa que pasó su máximo (+ margen) se cuelga
   * aunque el aviso de tiempo y el control de silencio no lo hayan hecho (un speak_started tardío, un speak que falló,
   * solo parciales). Si tras la gracia no llega el call.hangup, se cierra aquí y devuelve lo apartado.
   */
  async function barrerPlazos(limite = 20): Promise<number> {
    let atendidas = 0;
    const a = await d.ajustes();
    for (const { id } of await d.almacen.vigiladasVencidas(ahora().getTime(), limite)) {
      const l = await d.almacen.leer(id);
      if (!l || l.estado !== 'activa') { await d.almacen.dejarDeVigilar(id); continue; }
      if (l.proveedor !== d.proveedor.id && !l.simulada) continue;
      const ya = ahora().getTime();
      const plazo = plazoDuro(l);
      if (l.colgadoForzado == null && plazo > ya) { await d.almacen.vigilar(id, plazo); continue; }
      const desde = Date.parse(l.contestada ?? l.iniciada);
      const segundos = l.contestada ? (ya - desde) / 1000 : 0;
      if (l.simulada) {
        if (await cerrarLlamada(id, a, segundos)) atendidas++;
        continue;
      }
      // Reconciliar (punto 10): si el proveedor dice que la llamada ya no existe, su call.hangup se perdió; se cierra
      // con la duración que da el proveedor sin mandar nada. Sin respuesta, se trata como viva.
      const creds = d.credenciales();
      const estado = creds && d.proveedor.estadoLlamada ? await d.proveedor.estadoLlamada(creds, l.proveedorCallId) : null;
      if (estado && !estado.viva) {
        if (await cerrarLlamada(id, a, estado.duracionSeg ?? segundos)) atendidas++;
        continue;
      }
      if (l.colgadoForzado != null && estado?.viva && ya - l.colgadoForzado < 5 * GRACIA_COLGAR_MS) {
        // Sigue viva después de colgarla: se insiste (Telnyx ignora el mismo command_id por 60 s).
        await cmd('hangup', (c) => d.proveedor.hangup(c, l.proveedorCallId, `${id}-tope-${ya}`));
        await d.almacen.vigilar(id, ya + GRACIA_COLGAR_MS);
        continue;
      }
      if (l.colgadoForzado == null) {
        // Primera vez: se cuelga (solo una instancia gana el compare-and-set) y se espera el call.hangup.
        const g = await actualizar(id, (x) => (x.estado === 'activa' && x.colgadoForzado == null
          ? { ...x, colgadoForzado: ya, despuesDeHablar: null, silencioVence: null }
          : null));
        if (!g) continue;
        cancelarLocal(id);
        await cmd('hangup', (c) => d.proveedor.hangup(c, l.proveedorCallId, `${id}-tope`));
        await d.almacen.vigilar(id, ya + GRACIA_COLGAR_MS);
        atendidas++;
        continue;
      }
      // Ya se colgó y no llegó el call.hangup: se cierra aquí con lo que duró y devuelve lo apartado.
      if (await cerrarLlamada(id, a, estado?.duracionSeg ?? segundos)) atendidas++;
    }
    return atendidas;
  }

  async function procesarEvento(ev: VoiceEvent): Promise<Nota> {
    if (!(await d.almacen.reclamarEvento(d.proveedor.id, ev.eventId))) return { handled: false, note: 'duplicado' };
    try {
      return await despachar(ev);
    } catch (err) {
      // Se libera el id: si el proveedor reenvía este evento, se vuelve a intentar en vez de darse por hecho.
      await d.almacen.liberarEvento(d.proveedor.id, ev.eventId);
      throw err;
    }
  }

  async function despachar(ev: VoiceEvent): Promise<Nota> {
    const a = await d.ajustes();
    const desvio = a.numeroDesvio;
    switch (ev.kind) {
      case 'incoming': {
        if (ev.direction && ev.direction !== 'incoming') return { handled: false, note: 'saliente' };
        // Nunca se transfiere sin tope (Telnyx deja hasta 4 h por defecto): tampoco con la línea apagada o sin cupo.
        const conTope = { limiteSeg: a.maxMinutosTransferencia * 60 };
        if (!a.activo) {
          if (desvio) await cmd('transfer', (c) => d.proveedor.transfer(c, ev.callId, desvio, `${ev.eventId}-fwd`, conTope));
          return { handled: true, note: 'apagado' };
        }
        const ruta = decideRouteNow(a.reglasRuteo, Boolean(desvio), ahora());
        if (ruta.effective === 'person' && desvio) {
          await cmd('transfer', (c) => d.proveedor.transfer(c, ev.callId, desvio, `${ev.eventId}-sched`, conTope));
          return { handled: true, note: 'horario: atiende una persona' };
        }
        const simulada = d.proveedor.id === 'simulador';
        const r = await d.almacen.reservarLlamada({
          proveedor: d.proveedor.id, proveedorCallId: ev.callId, telefono: telefonoDeOrigen(ev.from), simulada, topes: a, ahora: ahora(),
        });
        if (!r.ok) {
          if (r.motivo === 'duplicada') return { handled: false, note: 'llamada repetida' };
          // Ese número ya llamó las veces del día: no se contesta ni se transfiere (cada transferencia también cuesta).
          if (r.motivo === 'tope_numero') {
            await cmd('hangup', (c) => d.proveedor.hangup(c, ev.callId, `${ev.eventId}-tope-numero`));
            return { handled: true, note: 'tope de llamadas de ese número' };
          }
          // Queda en el registro (sin gastar cupo) para que entre a la cola de devoluciones.
          const reg = await d.almacen.reservarLlamada({
            proveedor: d.proveedor.id, proveedorCallId: `${ev.callId}#sin-cupo`, telefono: telefonoDeOrigen(ev.from), simulada, topes: a, ahora: ahora(), soloRegistro: true,
          });
          if (reg.ok) await d.almacen.guardar({ ...reg.llamada, estado: 'cerrada', resultado: 'sin_cupo', cerrada: ahora().toISOString(), minutosPermitidos: 0 });
          if (desvio) await cmd('transfer', (c) => d.proveedor.transfer(c, ev.callId, desvio, `${ev.eventId}-cap`, conTope));
          else await cmd('hangup', (c) => d.proveedor.hangup(c, ev.callId, `${ev.eventId}-cap`));
          return { handled: true, note: 'sin cupo' };
        }
        // Colgó antes de terminar este incoming (su call.hangup llegó primero y no encontró la llamada): se cierra ya y
        // devuelve lo apartado, en vez de quedar activa y «desconocida» para siempre.
        if (await d.almacen.fueColgada(d.proveedor.id, ev.callId)) {
          await cerrarLlamada(r.llamada.id, a, 0);
          return { handled: true, note: 'colgó antes de contestar' };
        }
        await cmd('answer', (c) => d.proveedor.answer(c, ev.callId, `${ev.eventId}-answer`));
        return { handled: true, note: 'contestada' };
      }

      case 'answered': {
        const l0 = await d.almacen.porProveedor(d.proveedor.id, ev.callId);
        if (!l0) return (await eventoDePata(ev, a)) ?? { handled: false, note: 'llamada desconocida' };
        const texto = textoSaludo({ saludo: a.saludo, nombreAgente: a.nombreAgente, grabar: a.grabar, retencionDias: a.retencionDias });
        const l = await actualizar(l0.id, (x) => ({ ...x, contestada: x.contestada ?? ahora().toISOString(), actividad: tick(x), dialogo: { ...x.dialogo, ultimaRespuesta: texto } }));
        if (!l) return { handled: false, note: 'llamada cerrada' };
        // El tope duro cuenta desde que se contestó.
        await d.almacen.vigilar(l.id, plazoDuro(l));
        await decir(l, a, texto, `${ev.eventId}-hello`);
        if (a.grabar) await cmd('record_start', (c) => d.proveedor.startRecording(c, ev.callId, `${ev.eventId}-rec`));
        await cmd('transcription_start', (c) => d.proveedor.startListening(c, ev.callId, a.idioma, `${ev.eventId}-listen`));
        return { handled: true, note: 'saludo' };
      }

      case 'speech': {
        const texto = ev.transcript?.trim() ?? '';
        if (!texto) return { handled: false, note: 'vacío' };
        const l0 = await d.almacen.porProveedor(d.proveedor.id, ev.callId);
        if (!l0 || l0.estado !== 'activa') return { handled: false, note: 'llamada cerrada' };
        // Ya la atiende un asesor: lo que diga no es para el bot ni se guarda (punto 9).
        if (l0.transferidaEn) return { handled: false, note: 'transferida: no se atiende' };
        await cancelarSilencio(l0);
        if (!ev.isFinal) {
          // Una llamada con solo parciales también llega al tope: el aviso y el colgado no esperan una frase final (R5).
          const tope = await avisarFinDeTiempo(l0, a, ev.eventId);
          if (tope) return tope;
          // Barge-in: la persona empezó a hablar encima del bot. Se corta el audio y se espera la frase final.
          const cortar = l0.hablando;
          await actualizar(l0.id, (x) => ({ ...x, hablando: false, puentes: cortar ? 0 : x.puentes, silencio: 0, actividad: tick(x) }));
          if (cortar) {
            await cmd('playback_stop', (c) => d.proveedor.stopSpeaking(c, ev.callId, `${ev.eventId}-stop`));
            return { handled: true, note: 'barge-in' };
          }
          return { handled: false, note: 'parcial' };
        }
        // La transcripción se guarda 180 días: sin el código de verificación, el código estudiantil ni la cédula. Mientras
        // la línea pide un código, cualquier número dictado se tapa (también la primera parte de un código partido).
        const pideCodigo = l0.dialogo.fase === 'pide_otp' || l0.dialogo.fase === 'pide_codigo_estudiantil';
        await d.almacen.agregarLinea(l0.id, { r: 'c', t: taparDatosDictados(texto, pideCodigo ? 1 : 4), at: ahora().toISOString() }, a.retencionDias);
        if (l0.hablando) await cmd('playback_stop', (c) => d.proveedor.stopSpeaking(c, ev.callId, `${ev.eventId}-stop`));

        const tope = await avisarFinDeTiempo(l0, a, ev.eventId);
        if (tope) return tope;

        // Cada frase final se numera: si llega otra más nueva mientras esta piensa, la nueva gana. En el mismo paso se
        // juntan los dígitos de frases seguidas que son solo un dictado mientras se pide el código (punto 13).
        let miFrase = 0;
        let miBase = 0;
        let dialogoBase = l0.dialogo;
        let digitosPrevios = '';
        const dictadoSolo = soloDictado(texto);
        await actualizar(l0.id, (x) => {
          miFrase = (x.frase ?? 0) + 1;
          miBase = x.turnoAplicado ?? 0;
          dialogoBase = x.dialogo;
          const junta = x.dialogo.fase === 'pide_otp' && dictadoSolo;
          digitosPrevios = junta ? x.dictado ?? '' : '';
          const dictado = junta ? `${digitosPrevios}${digitosDictados(texto)}`.slice(-12) : '';
          return { ...x, frase: miFrase, dictado, hablando: false, silencio: 0, actividad: tick(x) };
        });
        const base = d.depsTurno(l0, a);
        // Código por WhatsApp: siempre por el almacén atómico compartido (topes y bloqueo valen para todas las instancias).
        const efectos = { hubo: false };
        const deps = conEfectos({ ...base, codigoWhatsApp: base.codigoWhatsApp ?? codigoWhatsApp }, () => { efectos.hubo = true; });
        const promesa = correrTurno(texto, dialogoBase, deps, { digitosPrevios });
        let puente = false;
        let cancelarPuente: (() => void) | null = null;
        const tardo = await Promise.race([
          promesa.then(() => false, () => false),
          new Promise<boolean>((res) => {
            const t = setTimeout(() => res(true), puenteMs);
            cancelarPuente = () => { clearTimeout(t); res(false); };
          }),
        ]);
        (cancelarPuente as (() => void) | null)?.();
        if (tardo) {
          puente = true;
          await actualizar(l0.id, (x) => ({ ...x, puentes: (x.puentes ?? 0) + 1 }));
          await decir(l0, a, frasePuente(l0.dialogo.turnos), `${ev.eventId}-bridge`);
        }
        const r: ResultadoTurno = await promesa;

        let descartado: 'viejo' | 'base' | null = null;
        const l = await actualizar(l0.id, (x) => {
          descartado = null;
          if (x.estado !== 'activa') return null;
          // Llegó una frase más nueva, u otro turno cambió el diálogo sobre el que se calculó este: si no tocó nada
          // afuera, quedó viejo y no se dice (compare-and-set del diálogo). Si ya verificó, gastó un intento, mandó un
          // código o reservó una cita, se aplica y se dice igual: eso ya pasó (punto 11).
          const vieja = (x.frase ?? 0) !== miFrase;
          const otraBase = (x.turnoAplicado ?? 0) !== miBase;
          if ((vieja || otraBase) && !efectos.hubo) { descartado = vieja ? 'viejo' : 'base'; return null; }
          const accion = r.accion === 'transfer' && !desvio ? 'hangup' : r.accion;
          const dialogo = vieja || otraBase ? { ...r.estado, verificado: r.estado.verificado ?? x.dialogo.verificado } : r.estado;
          return {
            ...x,
            dialogo,
            turnoAplicado: (x.turnoAplicado ?? 0) + 1,
            resultado: mejorResultado(x.resultado, r.resultado),
            despuesDeHablar: accion === 'none' ? x.despuesDeHablar : accion,
            resumen: r.aviso ?? x.resumen,
            dictado: r.dictadoUsado ? '' : x.dictado,
            verificacionNegada: r.verificacionNegada ?? x.verificacionNegada,
          };
        });
        if (!l) {
          // La frase puente ya sonó y no va nada detrás: su fin no debe esperar una respuesta que no llegará.
          if (puente && descartado) await actualizar(l0.id, (x) => (x.puentes > 0 ? { ...x, puentes: x.puentes - 1 } : null));
          return { handled: false, note: descartado === 'viejo' ? 'turno viejo descartado' : descartado ? 'turno descartado: otro turno cambió el diálogo' : 'llamada cerrada' };
        }
        if (r.verificacionNegada) {
          d.avisarPanel?.({
            tipo: 'otro', llamadaId: l.id, simulada: l.simulada,
            texto: r.verificacionNegada === 'bloqueado'
              ? 'Verificación por voz bloqueada 1 h por intentos fallidos'
              : 'Verificación por voz en pausa: tope de códigos (puede durar hasta 24 h)',
          });
        }
        if (r.aviso) {
          d.avisarPanel?.({
            tipo: r.accion === 'transfer' ? 'transferencia' : r.resultado === 'cita' ? 'cita' : r.resultado === 'devolver_llamada' ? 'devolucion' : 'otro',
            llamadaId: l.id, texto: r.aviso, simulada: l.simulada,
          });
        }
        await decir(l, a, r.respuesta, `${ev.eventId}-reply`, !puente, r.datosLeidos ? `[datos académicos leídos: ${r.datosLeidos}]` : undefined);
        return { handled: true, note: `turno (${r.accion}${puente ? ', con puente' : ''})` };
      }

      case 'speak_started': {
        const l0 = await d.almacen.porProveedor(d.proveedor.id, ev.callId);
        if (!l0) return { handled: false, note: 'llamada desconocida' };
        // Llegó después del speak_ended de esa misma frase (o de una posterior): no vuelve a «hablando» ni borra el
        // control de silencio ya armado; si no, la llamada quedaba abierta para siempre (punto 8, escenario A).
        const at = Date.parse(ev.occurredAt ?? '');
        if (Number.isFinite(at) && l0.finHabla != null && at <= l0.finHabla) return { handled: false, note: 'speak_started tardío' };
        cancelarLocal(l0.id);
        await actualizar(l0.id, (x) => (x.estado === 'activa' ? { ...x, hablando: true, silencioVence: null } : null));
        return { handled: true, note: 'hablando' };
      }

      case 'speak_ended': {
        const l0 = await d.almacen.porProveedor(d.proveedor.id, ev.callId);
        if (!l0) return { handled: false, note: 'llamada desconocida' };
        let despues: LlamadaVoz['despuesDeHablar'] = null;
        let eraPuente = false;
        const at = Date.parse(ev.occurredAt ?? '');
        const l = await actualizar(l0.id, (x) => {
          despues = null;
          eraPuente = (x.puentes ?? 0) > 0;
          const finHabla = Number.isFinite(at) ? Math.max(at, x.finHabla ?? 0) : x.finHabla;
          // Terminó la frase puente: lo pendiente es de la respuesta que suena detrás.
          if (eraPuente) return { ...x, puentes: x.puentes - 1, finHabla };
          despues = x.despuesDeHablar;
          return { ...x, hablando: false, despuesDeHablar: null, finHabla };
        });
        if (!l) return { handled: false, note: 'sin cambios' };
        if (eraPuente) return { handled: true, note: 'terminó la frase puente' };
        return ejecutarPendiente(l, a, despues as LlamadaVoz['despuesDeHablar'], ev.eventId);
      }

      case 'hangup': {
        const l0 = await d.almacen.porProveedor(d.proveedor.id, ev.callId);
        if (!l0) {
          const pata = await eventoDePata(ev, a);
          if (pata) return pata;
          await d.almacen.marcarColgada(d.proveedor.id, ev.callId);
          return { handled: false, note: 'llamada desconocida (se recuerda que colgó)' };
        }
        cancelarLocal(l0.id);
        if (l0.estado === 'cerrada') return { handled: false, note: 'ya cerrada' };
        const desdeContestada = l0.contestada ? Math.round((ahora().getTime() - Date.parse(l0.contestada)) / 1000) : 0;
        const l = await cerrarLlamada(l0.id, a, ev.durationSeconds ?? desdeContestada);
        return l ? { handled: true, note: 'cerrada' } : { handled: false, note: 'ya cerrada' };
      }

      default:
        return { handled: false, note: ev.rawType || 'otro' };
    }
  }

  return { procesarEvento, silencio, barrerSilencios, barrerPlazos, cancelarTodo: () => { for (const c of timers.values()) c(); timers.clear(); } };
}

export type Manejador = ReturnType<typeof crearManejador>;
