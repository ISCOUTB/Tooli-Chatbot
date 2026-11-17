/**
 * Pasos del registro de asistencia por QR, sin mensajería ni Redis propios:
 * recibe lo que necesita (`DepsAsistencia`) para poder probarse con una
 * conversación simulada (ver asistenciaFlow.test.ts). `asistencia.ts` lo
 * conecta con el bot real.
 *
 * El QR de un evento abre WhatsApp con "Registrar mi asistencia: CÓDIGO". Al
 * llegar ese mensaje se pide la autorización de datos y, apenas la persona
 * acepta, queda en la lista del evento con su WhatsApp; el nombre y el correo
 * completan el registro después.
 */
import type { OutboundButtons } from '../adapters/messaging/IMessagingAdapter';
import { normalizarCorreo } from '../services/asistenciaImport';
import {
  AsistenciaError, type Asistente, type EventoAsistencia, type OrigenAsistente, type ResultadoRegistro,
} from '../services/asistenciaService';
import type { Session } from '../services/session';
import { parseGlobalCommand } from './commands';
import { BOTONES_CONSENTIMIENTO, parseSiNo } from './recomendacionView';
import {
  CONSENTIMIENTO_NEGADO, CORREO_INVALIDO, EVENTO_NO_DISPONIBLE, NOMBRE_INVALIDO, NO_SE_PUDO_REGISTRAR, PEDIR_NOMBRE,
  confirmacion, parseCodigoAsistencia, parseNombre, pedirConsentimiento, pedirCorreo, quiereOmitir, yaRegistrado,
} from './asistenciaView';

export interface DepsAsistencia {
  enviarTexto(to: string, text: string): Promise<void>;
  enviarBotones(msg: OutboundButtons): Promise<void>;
  /** Sesión propia del registro, aparte de la del bot. */
  leerSesion(from: string): Promise<Session | null>;
  guardarSesion(from: string, session: Session): Promise<void>;
  borrarSesion(from: string): Promise<void>;
  getEvento(id: string): Promise<EventoAsistencia | null>;
  getEventoPorCodigo(codigo: string): Promise<EventoAsistencia | null>;
  getAsistentePorWhatsapp(eventoId: string, whatsapp: string): Promise<Asistente | null>;
  registrarAsistente(
    eventoId: string,
    datos: { whatsapp: string; nombre?: string; correo?: string },
    opciones: { origen: OrigenAsistente; consentimiento: boolean; exigirAbierto?: boolean },
  ): Promise<ResultadoRegistro>;
  track(evento: 'asistencia_registrada' | 'asistencia_consentimiento_no'): Promise<void>;
}

/**
 * Devuelve la función que atiende un mensaje entrante: true si era de
 * asistencia; false si no, y entonces el mensaje sigue al flujo normal del bot.
 */
export function crearAtencionAsistencia(deps: DepsAsistencia) {
  const QR = { origen: 'qr' as const, consentimiento: true };

  async function enviarConsentimiento(from: string, evento: EventoAsistencia): Promise<void> {
    await deps.enviarBotones({
      to: from,
      title: '📍 Asistencia',
      description: pedirConsentimiento(evento.nombre),
      footer: 'Tus datos se usan solo para fines de la UTB',
      buttons: [...BOTONES_CONSENTIMIENTO],
    });
  }

  async function iniciar(from: string, codigo: string): Promise<void> {
    const evento = await deps.getEventoPorCodigo(codigo);
    if (!evento || evento.estado !== 'abierto') {
      await deps.borrarSesion(from);
      await deps.enviarTexto(from, EVENTO_NO_DISPONIBLE);
      return;
    }
    const previo = await deps.getAsistentePorWhatsapp(evento.id, from);
    if (previo?.origen === 'qr' && previo.nombre) {
      await deps.borrarSesion(from);
      await deps.enviarTexto(from, yaRegistrado(evento.nombre));
      return;
    }
    await deps.guardarSesion(from, { step: 'consentimiento', data: { eventoId: evento.id } });
    await enviarConsentimiento(from, evento);
  }

  async function terminar(from: string, evento: EventoAsistencia, nombre: string): Promise<void> {
    await deps.borrarSesion(from);
    await deps.enviarTexto(from, confirmacion(nombre, evento.nombre));
  }

  return async function atenderAsistencia(from: string, text: string, nombrePerfil = ''): Promise<boolean> {
    const codigo = parseCodigoAsistencia(text);
    if (codigo) {
      await iniciar(from, codigo);
      return true;
    }

    const s = await deps.leerSesion(from);
    if (!s) return false;
    // "menu", "salir" o "volver" abandonan el registro y los atiende el bot.
    if (parseGlobalCommand(text)) {
      await deps.borrarSesion(from);
      return false;
    }

    const evento = await deps.getEvento(s.data.eventoId ?? '');
    if (!evento) {
      await deps.borrarSesion(from);
      await deps.enviarTexto(from, EVENTO_NO_DISPONIBLE);
      return true;
    }

    try {
      if (s.step === 'consentimiento') {
        const respuesta = parseSiNo(text);
        if (respuesta === 'no') {
          await deps.track('asistencia_consentimiento_no');
          await deps.borrarSesion(from);
          await deps.enviarTexto(from, CONSENTIMIENTO_NEGADO);
          return true;
        }
        if (respuesta !== 'si') {
          await enviarConsentimiento(from, evento);
          return true;
        }
        // La persona queda en la lista desde este momento: si no responde lo
        // que sigue, el evento igual sabe que estuvo y cómo escribirle.
        const { asistente } = await deps.registrarAsistente(evento.id, { whatsapp: from }, { ...QR, exigirAbierto: true });
        await deps.track('asistencia_registrada');
        // Ya venía en la lista importada con su nombre: no se le vuelve a pedir.
        if (asistente.nombre) {
          if (asistente.correo) {
            await terminar(from, evento, asistente.nombre);
            return true;
          }
          await deps.guardarSesion(from, { step: 'correo', data: { ...s.data, nombre: asistente.nombre } });
          await deps.enviarTexto(from, pedirCorreo(asistente.nombre));
          return true;
        }
        // El nombre del perfil de WhatsApp sirve mientras escribe el suyo; nunca
        // reemplaza a uno que ya estuviera guardado.
        if (nombrePerfil.trim()) {
          await deps.registrarAsistente(evento.id, { whatsapp: from, nombre: nombrePerfil }, QR);
        }
        await deps.guardarSesion(from, { step: 'nombre', data: s.data });
        await deps.enviarTexto(from, PEDIR_NOMBRE);
        return true;
      }

      if (s.step === 'nombre') {
        const nombre = parseNombre(text);
        if (!nombre) {
          await deps.enviarTexto(from, NOMBRE_INVALIDO);
          return true;
        }
        const { asistente } = await deps.registrarAsistente(evento.id, { whatsapp: from, nombre }, QR);
        if (asistente.correo) {
          await terminar(from, evento, nombre);
          return true;
        }
        await deps.guardarSesion(from, { step: 'correo', data: { ...s.data, nombre } });
        await deps.enviarTexto(from, pedirCorreo(nombre));
        return true;
      }

      if (s.step === 'correo') {
        if (!quiereOmitir(text)) {
          const correo = normalizarCorreo(text);
          if (!correo) {
            await deps.enviarTexto(from, CORREO_INVALIDO);
            return true;
          }
          await deps.registrarAsistente(evento.id, { whatsapp: from, correo }, QR);
        }
        await terminar(from, evento, s.data.nombre ?? '');
        return true;
      }
    } catch (err) {
      // Un evento que cerró o se llenó mientras la persona respondía no es una
      // falla del bot: se le avisa y el mensaje queda atendido.
      if (err instanceof AsistenciaError) {
        await deps.borrarSesion(from);
        await deps.enviarTexto(from, err.code === 'invalid_data' ? NO_SE_PUDO_REGISTRAR : EVENTO_NO_DISPONIBLE);
        return true;
      }
      throw err;
    }

    // Paso desconocido (sesión de una versión anterior): se suelta sin ruido.
    await deps.borrarSesion(from);
    return false;
  };
}
