import axios from 'axios';
import {
  IMessagingAdapter,
  OutboundMessage,
  OutboundButtons,
  OutboundList,
  OutboundDocument,
  OutboundImage,
  OutboundMediaUrl,
} from './IMessagingAdapter';
import { config } from '../../config';
import { recordActivity } from '../../services/botUserService';
import { metaRecipient } from '../../services/whatsappId';

const GRAPH_URL = 'https://graph.facebook.com/v20.0';

/**
 * Adaptador para Meta WhatsApp Cloud API (oficial).
 * Sin throttling, entrega instantánea, gratuito hasta 1000 conv/mes.
 */
export class MetaCloudAdapter implements IMessagingAdapter {
  private readonly token: string;
  private readonly phoneNumberId: string;

  constructor(token?: string, phoneNumberId?: string) {
    this.token = token ?? config.metaCloud.token;
    this.phoneNumberId = phoneNumberId ?? config.metaCloud.phoneNumberId;
  }

  private get headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  private get messagesUrl() {
    return `${GRAPH_URL}/${this.phoneNumberId}/messages`;
  }

  /**
   * En Meta Cloud API el campo `from` del webhook ya viene como número E.164
   * (ej: 573001234567), no se necesita resolución de JID.
   */
  async resolveSenderId(jid: string): Promise<string> {
    return jid;
  }

  async sendText(msg: OutboundMessage): Promise<void> {
    await axios.post(
      this.messagesUrl,
      {
        messaging_product: 'whatsapp',
        ...metaRecipient(msg.to),
        type: 'text',
        text: { body: msg.text, preview_url: false },
      },
      { headers: this.headers, timeout: 15_000 }
    );
    if (msg.text) recordActivity(msg.to, 'out', msg.text).catch(() => {});
  }

  async sendButtons(msg: OutboundButtons): Promise<void> {
    // Meta: max 3 botones, título de botón max 20 chars
    const buttons = msg.buttons.slice(0, 3).map(b => ({
      type: 'reply',
      reply: {
        id: b.id,
        title: b.displayText.slice(0, 20),
      },
    }));

    await axios.post(
      this.messagesUrl,
      {
        messaging_product: 'whatsapp',
        ...metaRecipient(msg.to),
        type: 'interactive',
        interactive: {
          type: 'button',
          header: msg.title ? { type: 'text', text: msg.title.slice(0, 60) } : undefined,
          body: { text: msg.description.slice(0, 1024) },
          footer: msg.footer ? { text: msg.footer.slice(0, 60) } : undefined,
          action: { buttons },
        },
      },
      { headers: this.headers, timeout: 15_000 }
    );
  }

  async sendList(msg: OutboundList): Promise<void> {
    // Meta: max 10 filas totales, título de fila max 24 chars, descripción max 72 chars
    let totalRows = 0;
    const sections = msg.sections.map(s => ({
      title: s.title.slice(0, 24),
      rows: s.rows
        .filter(() => totalRows++ < 10)
        .map(r => ({
          id: r.id,
          title: r.title.slice(0, 24),
          description: (r.description ?? '').slice(0, 72),
        })),
    }));

    await axios.post(
      this.messagesUrl,
      {
        messaging_product: 'whatsapp',
        ...metaRecipient(msg.to),
        type: 'interactive',
        interactive: {
          type: 'list',
          header: msg.title ? { type: 'text', text: msg.title.slice(0, 60) } : undefined,
          body: { text: msg.description.slice(0, 1024) },
          footer: msg.footer ? { text: msg.footer.slice(0, 60) } : undefined,
          action: {
            button: msg.buttonText.slice(0, 20),
            sections,
          },
        },
      },
      { headers: this.headers, timeout: 15_000 }
    );
  }

  async sendDocument(msg: OutboundDocument): Promise<void> {
    // Paso 1: subir el archivo a la Media API de Meta
    const form = new FormData();
    form.append(
      'file',
      new Blob([msg.buffer], { type: msg.mimetype }),
      msg.fileName
    );
    form.append('messaging_product', 'whatsapp');
    form.append('type', msg.mimetype);

    const uploadRes = await axios.post(
      `${GRAPH_URL}/${this.phoneNumberId}/media`,
      form,
      {
        headers: { Authorization: `Bearer ${this.token}` },
        timeout: 60_000,
      }
    );
    const mediaId: string = uploadRes.data.id;

    // Paso 2: enviar el documento usando el media_id
    await axios.post(
      this.messagesUrl,
      {
        messaging_product: 'whatsapp',
        ...metaRecipient(msg.to),
        type: 'document',
        document: {
          id: mediaId,
          filename: msg.fileName,
          caption: msg.caption,
        },
      },
      { headers: this.headers, timeout: 15_000 }
    );
  }

  async sendImage(msg: OutboundImage): Promise<void> {
    const mimetype = msg.mimetype ?? 'image/png';

    // Paso 1: subir la imagen a la Media API de Meta
    const form = new FormData();
    form.append('file', new Blob([msg.buffer], { type: mimetype }), 'image.png');
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimetype);

    const uploadRes = await axios.post(
      `${GRAPH_URL}/${this.phoneNumberId}/media`,
      form,
      { headers: { Authorization: `Bearer ${this.token}` }, timeout: 60_000 }
    );
    const mediaId: string = uploadRes.data.id;

    // Paso 2: enviar la imagen usando el media_id
    await axios.post(
      this.messagesUrl,
      {
        messaging_product: 'whatsapp',
        ...metaRecipient(msg.to),
        type: 'image',
        image: { id: mediaId, caption: msg.caption },
      },
      { headers: this.headers, timeout: 15_000 }
    );
  }

  async sendMediaFromUrl(msg: OutboundMediaUrl): Promise<void> {
    // Meta soporta image, video, audio, document con link directo
    const mediaType = msg.kind; // 'image' | 'video' | 'audio' | 'document'

    const mediaPayload: Record<string, unknown> = {
      link: msg.url,
    };
    if (msg.caption && mediaType !== 'audio') {
      mediaPayload['caption'] = msg.caption;
    }
    if (msg.fileName && (mediaType === 'document' || mediaType === 'video')) {
      mediaPayload['filename'] = msg.fileName;
    }

    await axios.post(
      this.messagesUrl,
      {
        messaging_product: 'whatsapp',
        ...metaRecipient(msg.to),
        type: mediaType,
        [mediaType]: mediaPayload,
      },
      { headers: this.headers, timeout: 30_000 }
    );
  }
}
