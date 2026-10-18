import axios from 'axios';
import { IMessagingAdapter, OutboundMessage, OutboundButtons, OutboundList, OutboundDocument, OutboundImage, OutboundMediaUrl } from './IMessagingAdapter';
import { config } from '../../config';
import { recordActivity } from '../../services/botUserService';
import { describeError, maskPhone } from '../../services/logSafe';

export class EvolutionAPIAdapter implements IMessagingAdapter {
  private readonly baseUrl: string;
  private readonly instance: string;
  private readonly apiKey: string;
  // Cache en memoria: @lid → número E.164. El mapping no cambia para un usuario dado.
  private readonly lidCache = new Map<string, string>();

  constructor() {
    this.baseUrl = config.evolutionApi.baseUrl;
    this.instance = config.evolutionApi.instance;
    this.apiKey = config.evolutionApi.apiKey;
  }

  /**
   * Si el JID es @lid, busca en el histórico de Evolution un mensaje con senderPn
   * para resolver al número E.164 real. Cachea el resultado en memoria.
   * Si no es @lid, lo devuelve tal cual.
   */
  async resolveSenderId(jid: string): Promise<string> {
    if (!jid.endsWith('@lid')) return jid;

    const cached = this.lidCache.get(jid);
    if (cached) return cached;

    try {
      const res = await axios.post(
        `${this.baseUrl}/chat/findMessages/${this.instance}`,
        { where: { key: { remoteJid: jid } }, limit: 50 },
        { headers: { apikey: this.apiKey }, timeout: 10_000 }
      );
      const records: Array<{ key?: { senderPn?: string } }> = res.data?.messages?.records ?? [];
      const withPn = records.find(r => r.key?.senderPn);
      const senderPn = withPn?.key?.senderPn;
      if (senderPn) {
        const phone = senderPn.split('@')[0];
        this.lidCache.set(jid, phone);
        return phone;
      }
    } catch (err: unknown) {
      console.error('[resolveSenderId] error:', describeError({ response: { status: axios.isAxiosError(err) ? err.response?.status : undefined } }));
    }

    // Fallback: devolver el @lid (probablemente fallará el envío, pero al menos quedó logueado)
    return jid;
  }

  async sendText(msg: OutboundMessage): Promise<void> {
    await axios.post(
      `${this.baseUrl}/message/sendText/${this.instance}`,
      { number: msg.to, text: msg.text, delay: 0 },
      { headers: { apikey: this.apiKey }, timeout: 10_000 }
    );
    if (msg.text) recordActivity(msg.to, 'out', msg.text).catch(() => {});
  }

  async sendButtons(msg: OutboundButtons): Promise<void> {
    await axios.post(
      `${this.baseUrl}/message/sendButtons/${this.instance}`,
      {
        number: msg.to,
        title: msg.title,
        description: msg.description,
        footer: msg.footer ?? '',
        buttons: msg.buttons.map(b => ({
          type: 'reply',
          displayText: b.displayText,
          id: b.id,
        })),
      },
      { headers: { apikey: this.apiKey }, timeout: 10_000 }
    );
  }

  async sendMediaFromUrl(msg: OutboundMediaUrl): Promise<void> {
    if (msg.kind === 'audio') {
      await axios.post(
        `${this.baseUrl}/message/sendWhatsAppAudio/${this.instance}`,
        { number: msg.to, audio: msg.url },
        { headers: { apikey: this.apiKey }, timeout: 30_000 }
      );
      return;
    }

    await axios.post(
      `${this.baseUrl}/message/sendMedia/${this.instance}`,
      {
        number: msg.to,
        mediatype: msg.kind,
        mimetype: msg.mimetype,
        media: msg.url,
        fileName: msg.fileName,
        caption: msg.caption,
      },
      { headers: { apikey: this.apiKey }, timeout: 30_000 }
    );
  }

  async sendDocument(msg: OutboundDocument): Promise<void> {
    await axios.post(
      `${this.baseUrl}/message/sendMedia/${this.instance}`,
      {
        number: msg.to,
        mediatype: 'document',
        mimetype: msg.mimetype,
        media: msg.buffer.toString('base64'),
        fileName: msg.fileName,
        caption: msg.caption,
      },
      { headers: { apikey: this.apiKey }, timeout: 30_000 }
    );
  }

  async sendList(msg: OutboundList): Promise<void> {
    const payload = {
      number: msg.to,
      title: msg.title,
      description: msg.description,
      footerText: msg.footer ?? ' ',
      buttonText: msg.buttonText,
      sections: msg.sections.map(s => ({
        title: s.title,
        rows: s.rows.map(r => ({
          rowId: r.id,
          title: r.title,
          description: r.description ?? ' ',
        })),
      })),
    };
    console.log('[sendList] to:', maskPhone(msg.to));
    try {
      const res = await axios.post(
        `${this.baseUrl}/message/sendList/${this.instance}`,
        payload,
        { headers: { apikey: this.apiKey }, timeout: 10_000 }
      );
      console.log('[sendList] status:', res.status);
    } catch (err: unknown) {
      console.error('[sendList] ERROR:', describeError({ response: { status: axios.isAxiosError(err) ? err.response?.status : undefined } }));
      throw err;
    }
  }

  async sendImage(_msg: OutboundImage): Promise<void> {
    // Evolution API no se usa para NutriA — stub requerido por la interfaz
    console.warn('[EvolutionAPIAdapter] sendImage no implementado para Evolution API');
  }
}
