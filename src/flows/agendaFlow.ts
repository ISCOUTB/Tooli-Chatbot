/**
 * Conversación de WhatsApp para agendar con un asesor: ofrecer franjas,
 * confirmar, ver «mis citas», cancelar y reprogramar.
 *
 * Es el NÚCLEO: recibe todo por `DepsFlujo` y no importa `shared.ts` (que abre
 * el adaptador al importarse) ni Redis. El cableado real está en
 * agendaFlowRuntime.ts; las pruebas lo arman con dobles (agendaFlow.test.ts).
 *
 * El estado de la conversación vive en su propia clave (`agenda:flujo:<tel>`)
 * y NO en la sesión del bot: así agendar desde un chat que ya está con un
 * asesor humano (`with_agent`) no le borra el `conversationId` a la persona.
 */

import type { AgendaApi, AreaAgenda, Cita, Franja, ResultadoReserva } from '../contratos/agenda';
import { ETIQUETA_AREA, diaEnPalabras, elegirVariadas, fechaEnPalabras, msDeIso } from '../services/agendaLogica';
import {
  COMANDO_CANCELAR, COMANDO_MIS_CITAS, COMANDO_REPROGRAMAR, resumenCita, textoConfirmacion, textoReprogramada, tituloFilaFranja,
} from '../services/agendaTextos';
import type { IMessagingAdapter } from '../adapters/messaging/IMessagingAdapter';
import { normalize } from './validation';
import { describeError } from '../services/logSafe';

export type PasoAgenda = 'area' | 'franja' | 'confirmar' | 'elegir_cita_cancelar' | 'confirmar_cancelar' | 'elegir_cita_reprogramar';

export interface EstadoFlujoAgenda {
  paso: PasoAgenda;
  area?: AreaAgenda;
  /** Las franjas que se le mostraron (para saber qué eligió). */
  franjas?: Franja[];
  /** La franja que está confirmando. */
  elegida?: Franja;
  /** Cita sobre la que se cancela o reprograma. */
  citaId?: string;
  /** Ids de las citas que se le listaron. */
  citas?: string[];
  nombre?: string;
  /** Ya vio horarios hasta este instante: "ver más" sigue desde ahí. */
  ultimo?: string;
  /** Inicios de las franjas que ya se le mostraron (para no repetirlas al pedir más). */
  vistas?: string[];
}

/** Tope de franjas que se leen por conversación: cubre la ventana máxima (60 días) de varios asesores. */
const MAX_FRANJAS_FLUJO = 1000;
/** Lo que se recuerda de lo ya mostrado (el estado vive en Redis 20 minutos). */
const MAX_VISTAS = 600;

export interface AgendaDelFlujo extends AgendaApi {
  reprogramar(citaId: string, telefono: string, franja: Franja): Promise<ResultadoReserva>;
}

export interface DepsFlujo {
  agenda: AgendaDelFlujo;
  mensajes: Pick<IMessagingAdapter, 'sendText' | 'sendButtons' | 'sendList'>;
  estado: {
    get(tel: string): Promise<EstadoFlujoAgenda | null>;
    set(tel: string, e: EstadoFlujoAgenda): Promise<void>;
    del(tel: string): Promise<void>;
  };
  ahora: () => number;
  activa: () => boolean;
}

export interface SesionMinima {
  step: string;
  data?: Record<string, string>;
}

/* ───────────────────────── Reconocer lo que escribe ────────────────────── */

const norm = (t: string) => normalize(t ?? '').replace(/[¿?¡!.,;]/g, ' ').replace(/\s+/g, ' ').trim();

export type IntencionAgenda = 'cancelar' | 'reprogramar' | 'mis_citas' | 'agendar' | null;

/**
 * Qué quiere hacer la persona con la agenda. Frases concretas a propósito:
 * una palabra suelta como «cita» dentro de otra pregunta no debe secuestrar
 * la conversación.
 */
export function intencionAgenda(texto: string): IntencionAgenda {
  const n = norm(texto);
  if (!n || n.split(' ').length > 12) return null;
  if (/\bcancelar (mi |la |esa |una |mis )?(cita|citas)\b/.test(n) || /^cancelar cita$/.test(n)) return 'cancelar';
  if (/\b(reprogramar|reagendar)( mi| la| esa| una)?( cita)?\b/.test(n) || /\b(cambiar|mover|modificar)( de)?( mi| la| esa)? (cita|hora de mi cita|horario de mi cita)\b/.test(n)) return 'reprogramar';
  if (/\b(mis citas|mi cita|ver mi cita|ver mis citas|tengo (alguna )?cita|cuando es mi cita|que citas tengo)\b/.test(n)) return 'mis_citas';
  if (/\b(agendar|agendarme|agendame|reagendar)\b/.test(n)) return 'agendar';
  if (/^(agenda|cita|citas|una cita|agendar cita)$/.test(n)) return 'agendar';
  if (/\b(reservar|sacar|pedir|programar|solicitar|apartar|separar|hacer)( una| mi| un)? (cita|turno)\b/.test(n)) return 'agendar';
  if (/\b(quiero|necesito|quisiera|me gustaria|puedo|podria|deseo|busco)\b.*\b(una |mi |un )?cita\b/.test(n)) return 'agendar';
  if (/\bcita con (un |una |el |la )?(asesor|asesora|persona|ejecutiv)/.test(n)) return 'agendar';
  return null;
}

/** El área de agenda que corresponde a lo que la persona venía haciendo, o null si no se sabe. */
export function areaDeSesion(sesion: SesionMinima | null | undefined): AreaAgenda | null {
  const d = sesion?.data ?? {};
  if (d.area === 'ti') return 'ti';
  if (d.area === 'posgrados') return 'posgrados';
  if (d.area === 'admisiones') return d.originArea === 'posgrado' || d.nivel?.startsWith('Posgrado') ? 'posgrados' : 'pregrado';
  if (d.originArea === 'posgrado') return 'posgrados';
  if (d.originArea === 'pregrado') return 'pregrado';
  return null;
}

/** Id de opción que llega al tocar un botón o una fila, o el número que escribió. */
function opcion(texto: string, prefijo: string): string | null {
  const t = (texto ?? '').trim();
  if (t.startsWith(prefijo)) return t.slice(prefijo.length);
  return null;
}

const esSi = (n: string) => /^(si|sip|sii|ok|okay|dale|listo|confirmo|confirmar|de acuerdo|claro|perfecto|vale|1)$/.test(n) || /^(si|sí) /.test(n);
const esNo = (n: string) => /^(no|nop|nel|cancelar|ninguna|ninguno|nada|despues|no gracias|salir|menu|conservarla)$/.test(n);

/* ──────────────────────────────── El flujo ─────────────────────────────── */

export function crearFlujoAgenda(deps: DepsFlujo) {
  const { mensajes, agenda } = deps;

  const texto = (to: string, text: string) => mensajes.sendText({ to, text });

  /**
   * «Ver más» sigue desde la franja siguiente a la más tardía ya mostrada, por días distintos, sobre TODA la
   * ventana (antes se leían solo las 40 primeras franjas y a la quinta página decía que no había más). Si ya no queda
   * nada después, vuelve a las horas que quedaron atrás sin mostrarse; nunca repite una franja.
   */
  function siguientesFranjas(todas: Franja[], e: EstadoFlujoAgenda): Franja[] {
    const vistas = new Set(e.vistas ?? []);
    const nuevas = todas.filter((f) => !vistas.has(f.inicio));
    const despues = e.ultimo ? nuevas.filter((f) => f.inicio > e.ultimo!) : nuevas;
    const picks = elegirVariadas(despues, 3);
    if (picks.length < 3) {
      const antes = nuevas.filter((f) => !picks.includes(f));
      picks.push(...elegirVariadas(antes, 3 - picks.length));
    }
    return picks.sort((a, b) => a.inicio.localeCompare(b.inicio));
  }

  async function ofrecerFranjas(from: string, e: EstadoFlujoAgenda): Promise<void> {
    const area = e.area!;
    const todas = await agenda.franjasLibres({ area, max: MAX_FRANJAS_FLUJO });
    const picks = siguientesFranjas(todas, e);
    if (!picks.length) {
      await deps.estado.del(from);
      await texto(from, e.ultimo
        ? 'Ya no tengo más horarios disponibles por ahora. 😕 Escribe *agendar* más tarde para ver si se liberan.'
        : `Por ahora no hay horarios disponibles con ${ETIQUETA_AREA[area]} en los próximos días. 😕\n\nUn asesor te responderá por este chat en cuanto pueda.`);
      return;
    }
    const ahora = deps.ahora();
    await deps.estado.set(from, {
      ...e, paso: 'franja', franjas: picks, elegida: undefined,
      ultimo: picks.reduce((m, f) => (f.inicio > m ? f.inicio : m), e.ultimo ?? picks[0].inicio),
      vistas: [...(e.vistas ?? []), ...picks.map((f) => f.inicio)].slice(-MAX_VISTAS),
    });
    await mensajes.sendList({
      to: from,
      title: e.citaId ? '🔁 Nuevo horario' : '📅 Agendar con un asesor',
      description:
        `Elige el horario que te quede mejor para tu cita de *${ETIQUETA_AREA[area]}*.\n` +
        `_Hora de Colombia · ${picks.map((f) => diaEnPalabras(msDeIso(f.inicio), ahora)).filter((d, i, a) => a.indexOf(d) === i).join(', ')}_`,
      footer: 'Escribe menu para salir',
      buttonText: 'Ver horarios',
      sections: [
        {
          title: 'Horarios disponibles',
          rows: picks.map((f, i) => ({
            id: `ag:s:${i}`,
            title: tituloFilaFranja(msDeIso(f.inicio)),
            description: `Con ${f.asesorNombre}`.slice(0, 72),
          })),
        },
        { title: 'Otras opciones', rows: [{ id: 'ag:mas', title: '🔄 Ver más horarios' }, { id: 'ag:no', title: '✖️ Mejor no' }] },
      ],
    });
  }

  async function iniciar(from: string, area: AreaAgenda | null, nombre?: string): Promise<void> {
    const mias = await agenda.citasDe(from);
    if (!area) {
      await deps.estado.set(from, { paso: 'area', nombre });
      await mensajes.sendButtons({
        to: from,
        title: '📅 Agendar con un asesor',
        description: '¿Con qué área quieres tu cita?',
        footer: 'Escribe menu para salir',
        buttons: [
          { id: 'ag:a:posgrados', displayText: '🎓 Posgrados' },
          { id: 'ag:a:pregrado', displayText: '🏫 Pregrado' },
          { id: 'ag:a:ti', displayText: '🖥️ Soporte TI' },
        ],
      });
      return;
    }
    if (mias.length) {
      await texto(from, `Ya tienes ${mias.length === 1 ? 'una cita' : `${mias.length} citas`} agendada${mias.length === 1 ? '' : 's'}: escribe *${COMANDO_MIS_CITAS}* para verla${mias.length === 1 ? '' : 's'}.`);
    }
    await ofrecerFranjas(from, { paso: 'franja', area, nombre });
  }

  async function mostrarMisCitas(from: string): Promise<void> {
    const mias = await agenda.citasDe(from);
    if (!mias.length) {
      await texto(from, `No tienes citas agendadas.\n\nPara reservar una escribe *agendar*.`);
      return;
    }
    const ahora = deps.ahora();
    const cuerpo = mias.map((c, i) => `*${i + 1}.* ${resumenCita(c, ahora).replace(/\n/g, '\n    ')}`).join('\n\n');
    await texto(from,
      `📋 *Tus citas*\n\n${cuerpo}\n\nPara cancelar escribe *${COMANDO_CANCELAR}*; para cambiar el horario, *${COMANDO_REPROGRAMAR}*.`);
  }

  async function elegirCita(from: string, paso: 'elegir_cita_cancelar' | 'elegir_cita_reprogramar'): Promise<void> {
    const mias = await agenda.citasDe(from);
    if (!mias.length) {
      await deps.estado.del(from);
      await texto(from, 'No tienes citas agendadas. Para reservar una escribe *agendar*.');
      return;
    }
    const cancelar = paso === 'elegir_cita_cancelar';
    if (mias.length === 1) {
      await seleccionarCita(from, mias[0], cancelar ? 'cancelar' : 'reprogramar');
      return;
    }
    await deps.estado.set(from, { paso, citas: mias.slice(0, 9).map((c) => c.id) });
    await mensajes.sendList({
      to: from,
      title: cancelar ? '✖️ Cancelar una cita' : '🔁 Reprogramar una cita',
      description: cancelar ? '¿Cuál cita quieres cancelar?' : '¿Cuál cita quieres cambiar de horario?',
      footer: 'Escribe menu para salir',
      buttonText: 'Elegir cita',
      sections: [{
        title: 'Tus citas',
        rows: mias.slice(0, 9).map((c, i) => ({
          id: `ag:c:${i}`,
          title: tituloFilaFranja(msDeIso(c.inicio)),
          description: `${ETIQUETA_AREA[c.area]} · con ${c.asesorNombre}`.slice(0, 72),
        })),
      }],
    });
  }

  async function seleccionarCita(from: string, cita: Cita, accion: 'cancelar' | 'reprogramar'): Promise<void> {
    const ahora = deps.ahora();
    if (accion === 'cancelar') {
      await deps.estado.set(from, { paso: 'confirmar_cancelar', citaId: cita.id });
      await mensajes.sendButtons({
        to: from,
        title: '✖️ ¿Cancelar esta cita?',
        description: resumenCita(cita, ahora),
        buttons: [{ id: 'ag:cok', displayText: 'Sí, cancelar' }, { id: 'ag:no', displayText: 'No, conservarla' }],
      });
      return;
    }
    await ofrecerFranjas(from, { paso: 'franja', area: cita.area, citaId: cita.id, nombre: cita.nombre });
  }

  async function pedirConfirmacion(from: string, e: EstadoFlujoAgenda, f: Franja): Promise<void> {
    await deps.estado.set(from, { ...e, paso: 'confirmar', elegida: f });
    const ahora = deps.ahora();
    await mensajes.sendButtons({
      to: from,
      title: e.citaId ? '🔁 Confirma el cambio' : '📅 Confirma tu cita',
      description:
        `${fechaEnPalabras(msDeIso(f.inicio), ahora)}\n👤 Con ${f.asesorNombre} · ${ETIQUETA_AREA[e.area!]}\n\n¿Agendamos?`,
      buttons: [
        { id: 'ag:ok', displayText: 'Confirmar' },
        { id: 'ag:otra', displayText: 'Otro horario' },
        { id: 'ag:no', displayText: 'No agendar' },
      ],
    });
  }

  async function ejecutarReserva(from: string, e: EstadoFlujoAgenda): Promise<void> {
    const f = e.elegida!;
    const ahora = deps.ahora();
    let r: ResultadoReserva;
    try {
      r = e.citaId
        ? await agenda.reprogramar(e.citaId, from, f)
        : await agenda.reservar({ telefono: from, nombre: e.nombre, area: e.area!, franja: f, canal: 'whatsapp' });
    } catch (err) {
      // describeError tapa correos y números que traiga el mensaje del error (nunca err.message crudo).
      console.error('[agenda] fallo al reservar por WhatsApp:', describeError(err));
      await deps.estado.del(from);
      await texto(from, 'No pude agendar tu cita en este momento. 😕 Intenta de nuevo en unos minutos o escribe *agendar*.');
      return;
    }
    if (r.ok) {
      await deps.estado.del(from);
      await texto(from, e.citaId ? textoReprogramada(r.cita, ahora) : textoConfirmacion(r.cita, ahora));
      return;
    }
    if (r.motivo === 'limite') {
      await deps.estado.del(from);
      await texto(from, `Ya tienes el máximo de citas agendadas a la vez. 📋\n\nEscribe *${COMANDO_MIS_CITAS}* para verlas o *${COMANDO_CANCELAR}* si quieres liberar una.`);
      return;
    }
    // ocupada o inválida: la hora se acaba de ir (o ya no es válida). Se vuelven a ofrecer horarios.
    await texto(from, r.motivo === 'ocupada' ? 'Ese horario se acaba de ocupar. 😕 Mira estos otros:' : 'Ese horario ya no está disponible. 😕 Mira estos otros:');
    await ofrecerFranjas(from, { ...e, paso: 'franja', ultimo: undefined, vistas: undefined, elegida: undefined });
  }

  async function nada(from: string, conAgente: boolean): Promise<boolean> {
    // Con un asesor humano en el chat, lo que no es una opción del flujo es para él: se suelta el flujo.
    if (conAgente) {
      await deps.estado.del(from);
      return false;
    }
    await texto(from, 'No te entendí. 🤔 Elige una opción de arriba, o escribe *menu* para salir.');
    return true;
  }

  /** Atiende un mensaje dentro de un flujo ya iniciado. */
  async function manejarPaso(from: string, raw: string, e: EstadoFlujoAgenda, sesion: SesionMinima | null): Promise<boolean> {
    const conAgente = sesion?.step === 'with_agent';
    const n = norm(raw);
    // «mi semestre» (datos académicos) también sale: lo atiende el menú, no la agenda.
    if (n === 'menu' || n === 'salir' || n === 'mi semestre') {
      await deps.estado.del(from);
      return false;
    }
    if (raw.trim() === 'ag:ofrecer') {
      // Un segundo toque del mismo botón: se empieza de cero.
      await deps.estado.del(from);
      await iniciar(from, areaDeSesion(sesion), sesion?.data?.nombre);
      return true;
    }
    const intencion = intencionAgenda(raw);
    if (intencion && intencion !== 'agendar' && !conAgente) {
      // Cambió de idea (por ejemplo, pide cancelar una cita en pleno agendado): lo nuevo manda.
      await deps.estado.del(from);
      return atender(from, raw, sesion);
    }
    switch (e.paso) {
      case 'area': {
        const id = opcion(raw, 'ag:a:') ?? ({ '1': 'posgrados', '2': 'pregrado', '3': 'ti' } as Record<string, string>)[n] ?? (n.includes('posgrado') ? 'posgrados' : n.includes('pregrado') ? 'pregrado' : n === 'ti' || n.includes('soporte') ? 'ti' : '');
        if (id === 'posgrados' || id === 'pregrado' || id === 'ti') {
          await ofrecerFranjas(from, { ...e, paso: 'franja', area: id });
          return true;
        }
        if (opcion(raw, 'ag:no') !== null || esNo(n)) return cerrar(from);
        return nada(from, conAgente);
      }
      case 'franja': {
        if (opcion(raw, 'ag:mas') !== null || /^(mas|ver mas|otros|4)$/.test(n)) {
          await ofrecerFranjas(from, e);
          return true;
        }
        if (opcion(raw, 'ag:no') !== null || esNo(n)) return cerrar(from);
        const idx = opcion(raw, 'ag:s:');
        const i = idx !== null ? Number(idx) : /^[1-3]$/.test(n) ? Number(n) - 1 : -1;
        const f = Number.isInteger(i) ? e.franjas?.[i] : undefined;
        if (f) {
          await pedirConfirmacion(from, e, f);
          return true;
        }
        return nada(from, conAgente);
      }
      case 'confirmar': {
        if (opcion(raw, 'ag:ok') !== null || esSi(n)) {
          if (!e.elegida) return nada(from, conAgente);
          await ejecutarReserva(from, e);
          return true;
        }
        if (opcion(raw, 'ag:otra') !== null || /^(otro|otra|otro horario|cambiar|2)$/.test(n)) {
          await ofrecerFranjas(from, { ...e, elegida: undefined });
          return true;
        }
        if (opcion(raw, 'ag:no') !== null || esNo(n) || n === '3') return cerrar(from);
        return nada(from, conAgente);
      }
      case 'elegir_cita_cancelar':
      case 'elegir_cita_reprogramar': {
        const idx = opcion(raw, 'ag:c:');
        const i = idx !== null ? Number(idx) : /^[1-9]$/.test(n) ? Number(n) - 1 : -1;
        const id = Number.isInteger(i) ? e.citas?.[i] : undefined;
        if (id) {
          const cita = (await agenda.citasDe(from)).find((c) => c.id === id);
          if (!cita) {
            await deps.estado.del(from);
            await texto(from, 'Esa cita ya no está vigente. Escribe *mis citas* para ver las que tienes.');
            return true;
          }
          await seleccionarCita(from, cita, e.paso === 'elegir_cita_cancelar' ? 'cancelar' : 'reprogramar');
          return true;
        }
        if (opcion(raw, 'ag:no') !== null || esNo(n)) return cerrar(from);
        return nada(from, conAgente);
      }
      case 'confirmar_cancelar': {
        if (opcion(raw, 'ag:cok') !== null || esSi(n) || n === 'cancelar') {
          const cita = (await agenda.citasDe(from)).find((c) => c.id === e.citaId);
          await deps.estado.del(from);
          const ok = cita ? await agenda.cancelar(cita.id, from) : false;
          await texto(from, ok && cita
            ? `✅ Cancelé tu cita del ${fechaEnPalabras(msDeIso(cita.inicio), deps.ahora())}.\n\nSi quieres agendar otra, escribe *agendar*.`
            : 'No encontré esa cita vigente (quizá ya estaba cancelada). Escribe *mis citas* para ver las que tienes.');
          return true;
        }
        if (opcion(raw, 'ag:no') !== null || esNo(n)) {
          await deps.estado.del(from);
          await texto(from, 'Perfecto, tu cita sigue en pie. 👍');
          return true;
        }
        return nada(from, conAgente);
      }
    }
    return false;
  }

  async function cerrar(from: string): Promise<boolean> {
    await deps.estado.del(from);
    await texto(from, 'Listo, no agendé nada. 👍 Cuando quieras, escribe *agendar*.');
    return true;
  }

  /**
   * Punto de entrada desde el bot. Devuelve true si el mensaje era de la agenda
   * (ya se respondió) y false si debe seguir el flujo normal.
   */
  async function atender(from: string, raw: string, sesion: SesionMinima | null): Promise<boolean> {
    if (!deps.activa()) return false;
    const conAgente = sesion?.step === 'with_agent';
    const estado = await deps.estado.get(from);
    if (estado) return manejarPaso(from, raw, estado, sesion);

    const t = (raw ?? '').trim();
    if (t.startsWith('ag:')) {
      if (t === 'ag:ofrecer') {
        await iniciar(from, areaDeSesion(sesion), sesion?.data?.nombre);
        return true;
      }
      if (t === 'ag:no') {
        await texto(from, 'Listo 👍 Sin problema.');
        return true;
      }
      await texto(from, 'Esa opción ya venció. Escribe *agendar* para ver horarios disponibles.');
      return true;
    }
    // Con un asesor humano en el chat, las palabras sueltas son para él: solo se agenda tocando el botón.
    if (conAgente) return false;
    const intencion = intencionAgenda(t);
    if (!intencion) return false;
    switch (intencion) {
      case 'mis_citas': await mostrarMisCitas(from); return true;
      case 'cancelar': await elegirCita(from, 'elegir_cita_cancelar'); return true;
      case 'reprogramar': await elegirCita(from, 'elegir_cita_reprogramar'); return true;
      case 'agendar': await iniciar(from, areaDeSesion(sesion), sesion?.data?.nombre); return true;
    }
    return false;
  }

  /**
   * Tras pasar a alguien con un asesor: si no habrá respuesta pronta (fuera de
   * horario o nadie libre) y hay horarios, le ofrece reservar uno.
   */
  async function ofrecerTrasHandoff(from: string, area: AreaAgenda, motivo: 'fuera_horario' | 'sin_asesor'): Promise<boolean> {
    if (!deps.activa()) return false;
    const hay = await agenda.franjasLibres({ area, max: 1 });
    if (!hay.length) return false;
    await mensajes.sendButtons({
      to: from,
      title: '📅 ¿Prefieres agendar?',
      description: motivo === 'fuera_horario'
        ? 'Estamos fuera del horario de atención. Si quieres, reserva una cita con un asesor en un horario que te quede bien.'
        : 'Ahora mismo no hay asesores libres. Si quieres, reserva una cita y un asesor te atiende a la hora que elijas.',
      footer: 'Tu mensaje ya quedó registrado',
      buttons: [{ id: 'ag:ofrecer', displayText: '📅 Agendar cita' }, { id: 'ag:no', displayText: 'No, gracias' }],
    });
    return true;
  }

  return { atender, ofrecerTrasHandoff, iniciar, mostrarMisCitas };
}

export type FlujoAgenda = ReturnType<typeof crearFlujoAgenda>;
