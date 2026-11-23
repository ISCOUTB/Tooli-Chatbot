/**
 * Decorador del adaptador de mensajería para el simulador de WhatsApp.
 *
 * - A un número simulado (57 0000…, ver services/simulacion.ts) NUNCA le llega
 *   nada del adaptador real: lo que el bot le manda queda en el buzón del
 *   simulador. Se decide por el número, así que vale también para lo que sale
 *   fuera de la conversación (un temporizador, un recordatorio).
 * - Mientras se atiende un mensaje simulado, lo que el bot quiera mandarle a
 *   OTRO número (un aviso a un asesor, por ejemplo) tampoco sale: queda como
 *   nota en la conversación simulada.
 * - Todo lo demás pasa tal cual al adaptador real.
 *
 * Los métodos opcionales (marcar leído, subir imágenes…) solo existen si el
 * adaptador real los tiene: el flujo pregunta por ellos para decidir qué hacer
 * (p. ej. los flyers solo salen con Meta) y el simulador debe verse igual.
 */
import type {
  IMessagingAdapter, OutboundButtons, OutboundDocument, OutboundImage, OutboundList, OutboundMediaUrl, OutboundMessage,
} from './IMessagingAdapter';
import { buzon, enSimulacion, esNumeroSimulado, saltarEnSimulacion } from '../../services/simulacion';

/** Imágenes más grandes no se guardan en el buzón (se muestra la tarjeta sin la foto). */
const MAX_BYTES_IMAGEN = 2 * 1024 * 1024;

type Destino = 'simulado' | 'bloqueado' | 'real';

function destino(to: string, que: string): Destino {
  if (esNumeroSimulado(to)) return 'simulado';
  if (enSimulacion()) {
    saltarEnSimulacion('WhatsApp', `No se envió ${que} a otro número (${to.slice(0, 4)}…${to.slice(-2)}): en el simulador nada sale a números reales.`);
    return 'bloqueado';
  }
  return 'real';
}

export function conZonaDePruebas(real: IMessagingAdapter): IMessagingAdapter {
  const adaptador: IMessagingAdapter = {
    async sendText(msg: OutboundMessage) {
      const d = destino(msg.to, 'un texto');
      if (d === 'simulado') return buzon.anotar(msg.to, { tipo: 'texto', texto: msg.text ?? '' });
      if (d === 'real') return real.sendText(msg);
    },
    async sendButtons(msg: OutboundButtons) {
      const d = destino(msg.to, 'unos botones');
      if (d === 'simulado') {
        return buzon.anotar(msg.to, {
          tipo: 'botones', titulo: msg.title, texto: msg.description, pie: msg.footer,
          botones: msg.buttons.map((b) => ({ id: b.id, texto: b.displayText })),
        });
      }
      if (d === 'real') return real.sendButtons(msg);
    },
    async sendList(msg: OutboundList) {
      const d = destino(msg.to, 'una lista');
      if (d === 'simulado') {
        return buzon.anotar(msg.to, {
          tipo: 'lista', titulo: msg.title, texto: msg.description, pie: msg.footer, boton: msg.buttonText,
          secciones: msg.sections.map((s) => ({
            titulo: s.title, filas: s.rows.map((r) => ({ id: r.id, titulo: r.title, descripcion: r.description })),
          })),
        });
      }
      if (d === 'real') return real.sendList(msg);
    },
    async sendDocument(msg: OutboundDocument) {
      const d = destino(msg.to, 'un documento');
      if (d === 'simulado') {
        return buzon.anotar(msg.to, { tipo: 'documento', nombre: msg.fileName, mimetype: msg.mimetype, bytes: msg.buffer.length, pie: msg.caption });
      }
      if (d === 'real') return real.sendDocument(msg);
    },
    async sendImage(msg: OutboundImage) {
      const d = destino(msg.to, 'una imagen');
      if (d === 'simulado') {
        const mime = msg.mimetype ?? 'image/png';
        const cabe = msg.buffer.length <= MAX_BYTES_IMAGEN && /^image\/(png|jpeg|webp|gif)$/.test(mime);
        return buzon.anotar(msg.to, {
          tipo: 'imagen', pie: msg.caption,
          ...(cabe ? { src: `data:${mime};base64,${msg.buffer.toString('base64')}` } : { detalle: 'Imagen demasiado grande para el simulador' }),
        });
      }
      if (d === 'real') return real.sendImage(msg);
    },
    async sendMediaFromUrl(msg: OutboundMediaUrl) {
      const d = destino(msg.to, 'un archivo');
      if (d === 'simulado') {
        return buzon.anotar(msg.to, { tipo: 'media', clase: msg.kind, url: msg.url, nombre: msg.fileName, pie: msg.caption });
      }
      if (d === 'real') return real.sendMediaFromUrl(msg);
    },
    resolveSenderId: (jid: string) => real.resolveSenderId(jid),
  };

  if (real.marcarLeido) {
    // Recibe el id de un mensaje de Meta: el simulador nunca tiene uno, así que nada que decidir aquí.
    adaptador.marcarLeido = (messageId, escribiendo) => real.marcarLeido!(messageId, escribiendo);
  }
  if (real.subirImagen) {
    adaptador.subirImagen = async (buffer, mimetype) => {
      // Subir a la Media API de Meta desde una prueba no tiene sentido y su id
      // podría quedar en la caché de flyers que usan las personas reales.
      if (enSimulacion()) throw new Error('El simulador no sube imágenes a Meta');
      return real.subirImagen!(buffer, mimetype);
    };
  }
  if (real.sendImageId) {
    adaptador.sendImageId = async (to, mediaId, caption) => {
      const d = destino(to, 'una imagen');
      if (d === 'simulado') return buzon.anotar(to, { tipo: 'imagen', pie: caption, detalle: 'Imagen subida a Meta (no se puede ver en el simulador)' });
      if (d === 'real') return real.sendImageId!(to, mediaId, caption);
    };
  }
  return adaptador;
}
