/**
 * Número de WhatsApp del bot, para armar los enlaces `wa.me` de los QR.
 *
 * Se toma de `WHATSAPP_PUBLIC_NUMBER` si está definido. Si no, con Meta Cloud
 * se le pregunta a la Graph API cuál es el número del `phoneNumberId`
 * configurado (el mismo dato que ya muestra "Estado del sistema"). Sin ninguna
 * de las dos cosas devuelve null y el panel muestra el código para dictarlo,
 * en vez de un QR que no llevaría a ningún lado.
 */
import axios from 'axios';
import { config } from '../config';
import { describeExternalError } from './logSafe';

const GRAPH_URL = 'https://graph.facebook.com/v20.0';
const REINTENTO_MS = 5 * 60 * 1000;

let conocido: string | null = null;
let ultimoFallo = 0;

export async function numeroPublicoBot(): Promise<string | null> {
  if (config.metaCloud.publicNumber) return config.metaCloud.publicNumber;
  if (conocido) return conocido;
  const { token, phoneNumberId } = config.metaCloud;
  if (config.messagingAdapter !== 'meta' || !token || !phoneNumberId) return null;
  // Tras un fallo no se insiste en cada petición del panel.
  if (Date.now() - ultimoFallo < REINTENTO_MS) return null;
  try {
    const res = await axios.get(`${GRAPH_URL}/${phoneNumberId}`, {
      params: { fields: 'display_phone_number' },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 8_000,
    });
    const digitos = String(res.data?.display_phone_number ?? '').replace(/\D/g, '');
    if (!/^[1-9]\d{7,14}$/.test(digitos)) throw new Error('Meta no devolvió un número válido');
    conocido = digitos;
    return conocido;
  } catch (err) {
    ultimoFallo = Date.now();
    console.error('[asistencia] no se pudo consultar el número del bot:', describeExternalError(err));
    return null;
  }
}
